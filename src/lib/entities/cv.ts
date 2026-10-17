import { sql } from "drizzle-orm";
import { logError } from "@/lib/log";
import { RECORD_TYPES } from "@/lib/metrics/candidates";
import { salesforceConfigured, sf } from "@/lib/sf/client";
import { asDate, isSfId, num, run, str } from "./search";

/**
 * Finding a person's CV. In Salesforce it can sit in three different places,
 * and the staff spend real time hunting for it:
 *   1. a file on the Contact itself (what `CV__c` is meant to mark),
 *   2. a file on one of their Cases — an application, or a Case of the
 *      "קורות חיים" type opened from their email,
 *   3. an attachment on an email of one of those Cases, which is where a CV
 *      that arrived by mail actually lands (the file hangs off the
 *      EmailMessage, not the Case).
 * This gathers all three for one email address — every Contact that carries it
 * and every Case of theirs, including Cases with no Contact whose sender
 * address is it. Files are never mirrored: the list comes live from Salesforce
 * and is opened only through `/api/emails/[email]/files/[documentId]`.
 */

export type CvSource = "contact" | "case" | "email";

export interface CvFile {
  documentId: string;
  versionId: string;
  title: string;
  extension: string | null;
  size: number;
  createdAt: Date | null;
  /** Every place in Salesforce this file hangs off — a CV is often in more than one. */
  sources: CvSource[];
  /** The Contact it is on, when it is on one. */
  contactId: string | null;
  contactName: string | null;
  /** The Case it belongs to, directly or through its email. */
  caseId: string | null;
  caseNumber: string | null;
  caseType: string | null;
  caseTypeLabel: string | null;
  /** The email it came in on, when it arrived by mail. */
  emailSubject: string | null;
  emailIncoming: boolean | null;
  emailAt: Date | null;
  /** The name or the Case says this is a CV, not just any attachment. */
  looksLikeCv: boolean;
}

export interface EmailCvs {
  files: CvFile[];
  /** What was searched, so the screen can say "checked, found nothing". */
  checked: { contacts: number; cases: number; cvCases: number; emails: number };
  /** `CV__c` is ticked on at least one of the Contacts. */
  cvFlag: boolean;
  error: string | null;
}

/** A file this size or smaller is a mail signature image, not a CV. */
const MIN_SIZE = 8_000;
const SKIP_EXTENSIONS = new Set(["png", "gif", "jpg", "jpeg", "bmp", "svg", "ics", "vcf", "p7s", "gz", "eml"]);
const CV_NAME = /\bcv\b|c\.v|resume|קו"?ח|קוח|קורות/i;
/** Enough for anyone's history; a Contact with more email than this is a mailing list, not a candidate. */
const MAX_EMAILS = 300;
/** ContentDocumentLink must be filtered by ids, and a SOQL statement has a length limit. */
const CHUNK = 120;

interface LinkRow {
  ContentDocumentId: string;
  LinkedEntityId: string;
  ContentDocument: {
    Title: string;
    FileExtension: string | null;
    ContentSize: number;
    LatestPublishedVersionId: string;
    CreatedDate: string;
  };
}

/** Every CV-ish file of the person behind one email address. */
export async function loadEmailCvs(email: string): Promise<EmailCvs> {
  const empty = { contacts: 0, cases: 0, cvCases: 0, emails: 0 };
  if (!salesforceConfigured()) return { files: [], checked: empty, cvFlag: false, error: "Salesforce לא מחובר" };

  // The person: their Contacts, their Cases, and the emails on those Cases.
  const contacts = await run(sql`
    SELECT ct.id, ct.name, coalesce(ct.data->>'CV__c', 'false') = 'true' AS has_cv
      FROM sf_contact ct WHERE NOT ct.is_deleted AND ct.email = ${email} ORDER BY ct.created_date`);
  const cases = await run(sql`
    SELECT a.id, a.data->>'CaseNumber' AS case_number, rt.developer_name, rt.name AS type_label, a.created_date
      FROM sf_case a
      LEFT JOIN sf_record_type rt ON rt.id = a.record_type_id
     WHERE NOT a.is_deleted
       AND (a.contact_id IN (SELECT ct.id FROM sf_contact ct WHERE NOT ct.is_deleted AND ct.email = ${email})
            OR (a.contact_id IS NULL AND a.data->>'SuppliedEmail' = ${email}))
     ORDER BY a.created_date DESC`);
  const caseIds = cases.map((c) => String(c.id)).filter(isSfId);
  const emails = caseIds.length
    ? await run(sql`
        SELECT m.id, m.parent_id, m.subject, m.incoming, m.message_date
          FROM sf_email_message m
         WHERE NOT m.is_deleted AND m.parent_id IN (${sql.join(caseIds.map((id) => sql`${id}`), sql`, `)})
         ORDER BY m.message_date DESC NULLS LAST
         LIMIT ${MAX_EMAILS}`)
    : [];

  const byCase = new Map(cases.map((c) => [String(c.id), c]));
  const byEmail = new Map(emails.map((m) => [String(m.id), m]));
  const contactName = new Map(contacts.map((c) => [String(c.id), str(c.name)]));
  const checked = {
    contacts: contacts.length,
    cases: cases.length,
    cvCases: cases.filter((c) => str(c.developer_name) === RECORD_TYPES.cvMessage).length,
    emails: emails.length,
  };
  const cvFlag = contacts.some((c) => c.has_cv === true || c.has_cv === "true");

  // Ids are checked against the Salesforce id shape before they go into the SOQL string.
  const ids = [...contacts.map((c) => String(c.id)), ...caseIds, ...emails.map((m) => String(m.id))].filter(isSfId);
  if (!ids.length) return { files: [], checked, cvFlag, error: null };

  const links: LinkRow[] = [];
  try {
    for (let i = 0; i < ids.length; i += CHUNK) {
      const batch = ids.slice(i, i + CHUNK);
      links.push(
        ...(await sf.query<LinkRow>(
          `SELECT ContentDocumentId, LinkedEntityId, ContentDocument.Title, ContentDocument.FileExtension,
                  ContentDocument.ContentSize, ContentDocument.LatestPublishedVersionId, ContentDocument.CreatedDate
             FROM ContentDocumentLink WHERE LinkedEntityId IN (${batch.map((id) => `'${id}'`).join(",")})`,
        )),
      );
    }
  } catch (err) {
    logError("cv files", err);
    return { files: [], checked, cvFlag, error: "לא ניתן לטעון את הקבצים מ-Salesforce כרגע" };
  }

  const files = new Map<string, CvFile>();
  for (const l of links) {
    const doc = l.ContentDocument;
    const extension = doc.FileExtension?.toLowerCase() ?? null;
    // Signature images and calendar invites ride along on every email; they are never a CV.
    if (extension && SKIP_EXTENSIONS.has(extension) && doc.ContentSize < MIN_SIZE) continue;

    const linked = l.LinkedEntityId;
    const message = byEmail.get(linked);
    const onCase = byCase.get(linked);
    const source: CvSource = contactName.has(linked) ? "contact" : onCase ? "case" : "email";
    const owner = onCase ?? (message ? byCase.get(String(message.parent_id)) : undefined);

    // The same document is usually linked more than once — to the Contact and to
    // the email it arrived on — and every one of those places is worth showing,
    // because each is a place the staff would otherwise have to look in.
    const file: CvFile = files.get(l.ContentDocumentId) ?? {
      documentId: l.ContentDocumentId,
      versionId: doc.LatestPublishedVersionId,
      title: doc.Title,
      extension,
      size: doc.ContentSize,
      createdAt: asDate(doc.CreatedDate),
      sources: [],
      contactId: null,
      contactName: null,
      caseId: null,
      caseNumber: null,
      caseType: null,
      caseTypeLabel: null,
      emailSubject: null,
      emailIncoming: null,
      emailAt: null,
      looksLikeCv: false,
    };
    if (!file.sources.includes(source)) file.sources.push(source);
    if (source === "contact" && !file.contactId) {
      file.contactId = linked;
      file.contactName = contactName.get(linked) ?? null;
    }
    if (message && !file.emailAt) {
      file.emailSubject = str(message.subject);
      file.emailIncoming = message.incoming === true;
      file.emailAt = asDate(message.message_date);
    }
    // A CV-type Case is the most telling one, so it wins over any other Case.
    const caseType = owner ? str(owner.developer_name) : null;
    if (owner && (!file.caseId || (caseType === RECORD_TYPES.cvMessage && file.caseType !== RECORD_TYPES.cvMessage))) {
      file.caseId = String(owner.id);
      file.caseNumber = str(owner.case_number);
      file.caseType = caseType;
      file.caseTypeLabel = str(owner.type_label);
    }
    file.looksLikeCv =
      file.caseType === RECORD_TYPES.cvMessage || CV_NAME.test(file.title) || (file.sources.includes("contact") && cvFlag);
    files.set(file.documentId, file);
  }

  const sorted = [...files.values()].sort((a, b) => {
    if (a.looksLikeCv !== b.looksLikeCv) return a.looksLikeCv ? -1 : 1;
    return (b.createdAt?.getTime() ?? 0) - (a.createdAt?.getTime() ?? 0);
  });
  return { files: sorted, checked, cvFlag, error: null };
}

/** Where a file is opened from, inside the email address's own page. */
export const cvFilePath = (email: string, documentId: string) =>
  `/api/emails/${encodeURIComponent(email)}/files/${documentId}`;

/** A size for people: "240 KB". */
export const fileSize = (bytes: number) => (bytes >= 1_000_000 ? `${(bytes / 1_048_576).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`);

/** How many of the gathered files look like a CV rather than any attachment. */
export const cvCount = (files: readonly CvFile[]) => num(files.filter((f) => f.looksLikeCv).length);

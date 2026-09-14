import { sql, type SQL } from "drizzle-orm";
import { RECORD_TYPES } from "@/lib/metrics/candidates";
import { CANDIDATE_ACCOUNT_PATTERN } from "@/lib/metrics/marketing";
import { salesforceConfigured, sf } from "@/lib/sf/client";
import { asDate, containsPattern, dayBounds, isSfId, isTrue, num, PAGE_SIZE, phoneDigits, run, str } from "./search";

/**
 * Candidates: Contacts in the candidate Accounts, and any Contact that applied.
 * Files (CVs) are not mirrored: they are listed live from Salesforce, and only
 * those linked to the candidate or to one of their applications can be opened.
 */

export interface CandidateFilters {
  q: string;
  district: string;
  city: string;
  account: string;
  cv: "yes" | "no" | "";
  applied: "yes" | "no" | "";
  fromDay: string;
  toDay: string;
}

export interface CandidateRow {
  id: string;
  name: string | null;
  email: string | null;
  phone: string | null;
  city: string | null;
  district: string | null;
  accountName: string | null;
  hasCv: boolean;
  applications: number;
  lastApplicationAt: Date | null;
  createdAt: Date | null;
}

const CANDIDATES = sql`
  WITH apps AS (
    SELECT a.contact_id, count(*) AS n, max(a.created_date) AS last_at
      FROM sf_case a JOIN sf_record_type rt ON rt.id = a.record_type_id
     WHERE rt.developer_name IN (${RECORD_TYPES.application}, ${RECORD_TYPES.accepted}) AND NOT a.is_deleted AND a.contact_id IS NOT NULL
     GROUP BY a.contact_id
  ),
  cand AS (
    SELECT ct.id, ct.name, ct.created_date, ct.data, acc.name AS account_name,
           coalesce(ct.email, lower(nullif(ct.data->>'email_cambium__c', ''))) AS email,
           coalesce(nullif(ct.data->>'MobilePhone', ''), nullif(ct.data->>'Phone', ''), nullif(ct.data->>'phoneNumber_cambium__c', '')) AS phone,
           coalesce(nullif(ct.data->>'City_fix__c', ''), nullif(ct.data->>'city_index__c', '')) AS city,
           nullif(ct.data->>'district_index__c', '') AS district,
           coalesce(ct.data->>'CV__c', 'false') = 'true' AS has_cv,
           coalesce(apps.n, 0) AS applications, apps.last_at
      FROM sf_contact ct
      LEFT JOIN sf_account acc ON acc.id = ct.account_id
      LEFT JOIN apps ON apps.contact_id = ct.id
     WHERE NOT ct.is_deleted AND (acc.name ILIKE ${CANDIDATE_ACCOUNT_PATTERN} OR apps.n IS NOT NULL)
  )`;

function toCandidate(r: Record<string, unknown>): CandidateRow {
  return {
    id: String(r.id),
    name: str(r.name),
    email: str(r.email),
    phone: str(r.phone),
    city: str(r.city),
    district: str(r.district),
    accountName: str(r.account_name),
    hasCv: isTrue(r.has_cv),
    applications: num(r.applications),
    lastApplicationAt: asDate(r.last_at),
    createdAt: asDate(r.created_date),
  };
}

export async function searchCandidates(
  f: CandidateFilters,
  { page = 1, pageSize = PAGE_SIZE }: { page?: number; pageSize?: number } = {},
): Promise<{ rows: CandidateRow[]; total: number }> {
  const parts: SQL[] = [sql`true`];
  if (f.q) {
    const p = containsPattern(f.q);
    const digits = phoneDigits(f.q);
    parts.push(sql`(c.name ILIKE ${p} OR c.email ILIKE ${p}
      ${digits ? sql`OR regexp_replace(coalesce(c.phone, ''), '[^0-9]', '', 'g') LIKE ${`%${digits}%`}` : sql.raw("")})`);
  }
  if (f.district) parts.push(sql`c.district = ${f.district}`);
  if (f.city) parts.push(sql`c.city ILIKE ${containsPattern(f.city)}`);
  if (f.account) parts.push(sql`c.account_name = ${f.account}`);
  if (f.cv === "yes") parts.push(sql`c.has_cv`);
  if (f.cv === "no") parts.push(sql`NOT c.has_cv`);
  if (f.applied === "yes") parts.push(sql`c.applications > 0`);
  if (f.applied === "no") parts.push(sql`c.applications = 0`);
  const { from, to } = dayBounds(f.fromDay, f.toDay);
  if (from) parts.push(sql`c.created_date >= ${from}`);
  if (to) parts.push(sql`c.created_date < ${to}`);
  const where = sql.join(parts, sql` AND `);

  const [rows, count] = await Promise.all([
    run(sql`${CANDIDATES} SELECT c.* FROM cand c WHERE ${where}
             ORDER BY c.last_at DESC NULLS LAST, c.created_date DESC LIMIT ${pageSize} OFFSET ${(page - 1) * pageSize}`),
    run(sql`${CANDIDATES} SELECT count(*) AS n FROM cand c WHERE ${where}`),
  ]);
  return { rows: rows.map(toCandidate), total: num(count[0]?.n) };
}

export async function loadCandidateFilterOptions(): Promise<{ districts: string[]; accounts: string[] }> {
  const [districts, accounts] = await Promise.all([
    run(sql`${CANDIDATES} SELECT c.district AS v, count(*) AS n FROM cand c WHERE c.district IS NOT NULL GROUP BY 1 ORDER BY 2 DESC`),
    run(sql`${CANDIDATES} SELECT c.account_name AS v, count(*) AS n FROM cand c WHERE c.account_name IS NOT NULL GROUP BY 1 ORDER BY 2 DESC LIMIT 20`),
  ]);
  return { districts: districts.map((r) => String(r.v)), accounts: accounts.map((r) => String(r.v)) };
}

/** Skill checkboxes on the Contact, with their labels. */
export const SKILL_FIELDS: [field: string, label: string][] = [
  ["Team_work__c", "עבודה בצוות"],
  ["Service__c", "שירותיות"],
  ["Creative_thinking__c", "חשיבה יצירתית"],
  ["Self_study_and_fast__c", "לימוד עצמי ומהיר"],
  ["expression__c", "התבטאות בכתב ובעל פה"],
  ["administration__c", "אדמיניסטרציה"],
  ["Multitasking__c", "מולטיטסקינג"],
  ["Digital_skills__c", "מיומנויות דיגיטליות"],
  ["Training_and_teaching__c", "הדרכה והוראה"],
  ["Care_and_empathy__c", "טיפול ואמפתיה"],
  ["Analysis_and_presentation__c", "ניתוח והצגת נתונים"],
  ["Entrepreneurship__c", "יזמות"],
  ["skill_tech__c", "ידע טכנולוגי"],
  ["Financial_knowledge__c", "ידע פיננסי"],
  ["time_management__c", "ניהול זמן עצמאי"],
  ["people_management__c", "ניהול אנשים"],
  ["marketing_and_sales__c", "שיווק ומכירות"],
];

export interface CandidateDetail extends CandidateRow {
  firstName: string | null;
  birthDate: string | null;
  gender: string | null;
  contactType: string | null;
  skills: string[];
  fastApply: boolean;
  talent: boolean;
  lastActivityDate: string | null;
}

export async function loadCandidate(id: string): Promise<CandidateDetail | null> {
  if (!isSfId(id)) return null;
  const [r] = await run(sql`${CANDIDATES} SELECT c.* FROM cand c WHERE c.id = ${id}`);
  if (!r) return null;
  const data = (r.data ?? {}) as Record<string, unknown>;
  const listed = (str(data.skills_cambium__c) ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const checked = SKILL_FIELDS.filter(([field]) => isTrue(data[field])).map(([, label]) => label);
  return {
    ...toCandidate(r),
    firstName: str(data.FirstName) ?? str(data.firstName_cambium__c),
    birthDate: str(data.Birthdate) ?? str(data.dateOfBirth_cambium__c),
    gender: str(data.Gender__c),
    contactType: str(data.contact_type_C__c),
    skills: [...new Set([...listed, ...checked])],
    fastApply: isTrue(data.Field6__c),
    talent: isTrue(data.Field3__c),
    lastActivityDate: str(data.LastActivityDate),
  };
}

/** A file name for display and download: the title, with the extension added only if the title lacks it. */
export const fileName = (f: Pick<CandidateFile, "title" | "extension">) =>
  f.extension && !f.title.toLowerCase().endsWith(`.${f.extension}`) ? `${f.title}.${f.extension}` : f.title;

export interface CandidateFile {
  documentId: string;
  versionId: string;
  title: string;
  extension: string | null;
  size: number;
  createdAt: Date | null;
  /** The application the file is attached to, when it is not on the candidate. */
  applicationId: string | null;
}

/** Files attached to the candidate or to any of their applications, straight from Salesforce. */
export async function loadCandidateFiles(contactId: string): Promise<{ files: CandidateFile[]; error: string | null }> {
  if (!isSfId(contactId)) return { files: [], error: null };
  if (!salesforceConfigured()) return { files: [], error: "Salesforce לא מחובר" };
  const appIds = (
    await run(sql`
      SELECT a.id FROM sf_case a JOIN sf_record_type rt ON rt.id = a.record_type_id
       WHERE a.contact_id = ${contactId} AND NOT a.is_deleted
         AND rt.developer_name IN (${RECORD_TYPES.application}, ${RECORD_TYPES.accepted})
       ORDER BY a.created_date DESC LIMIT 150`)
  ).map((r) => String(r.id));
  // Ids are validated to the Salesforce id shape before they go into the SOQL string.
  const ids = [contactId, ...appIds].filter(isSfId);
  try {
    const links = await sf.query<{
      ContentDocumentId: string;
      LinkedEntityId: string;
      ContentDocument: { Title: string; FileExtension: string | null; ContentSize: number; LatestPublishedVersionId: string; CreatedDate: string };
    }>(
      `SELECT ContentDocumentId, LinkedEntityId, ContentDocument.Title, ContentDocument.FileExtension, ContentDocument.ContentSize,
              ContentDocument.LatestPublishedVersionId, ContentDocument.CreatedDate
         FROM ContentDocumentLink WHERE LinkedEntityId IN (${ids.map((i) => `'${i}'`).join(",")})`,
    );
    const byDocument = new Map<string, CandidateFile>();
    for (const l of links) {
      const existing = byDocument.get(l.ContentDocumentId);
      const onApplication = l.LinkedEntityId !== contactId;
      if (existing && (existing.applicationId === null || onApplication)) continue;
      byDocument.set(l.ContentDocumentId, {
        documentId: l.ContentDocumentId,
        versionId: l.ContentDocument.LatestPublishedVersionId,
        title: l.ContentDocument.Title,
        extension: l.ContentDocument.FileExtension?.toLowerCase() ?? null,
        size: l.ContentDocument.ContentSize,
        createdAt: asDate(l.ContentDocument.CreatedDate),
        applicationId: onApplication ? l.LinkedEntityId : null,
      });
    }
    return { files: [...byDocument.values()].sort((a, b) => (b.createdAt?.getTime() ?? 0) - (a.createdAt?.getTime() ?? 0)), error: null };
  } catch (err) {
    console.error("[candidates] listing files failed", (err as Error).message);
    return { files: [], error: "לא ניתן לטעון את הקבצים מ-Salesforce כרגע" };
  }
}

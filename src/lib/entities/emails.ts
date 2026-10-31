import { sql, type SQL } from "drizzle-orm";
import { normStatus, RECORD_TYPES } from "@/lib/metrics/candidates";
import { CANDIDATES } from "./candidates";
import { AREA_VALUES, NAPA_VALUES, placeFilterSql, placeLabel, type PlaceLabel } from "@/lib/geo/filters";
import { MIN_SIZE, SKIP_EXTENSIONS } from "./cv";
import { asDate, choice, containsPattern, num, PAGE_SIZE, param, phoneDigits, run, str, type SearchParams } from "./search";
import { orderBy, type Sort, type SortColumn } from "./sort";

/**
 * Email addresses: one person per address. For historical reasons the same
 * candidate is often several Contacts, and the address is what ties them
 * together. Every candidate's address is listed; each one gathers all the
 * Contacts that carry it (in any Account) and every Case on those Contacts,
 * plus Cases with no Contact whose sender address (`SuppliedEmail`) is it.
 * Contact emails are already lower-cased by the sync, as is `SuppliedEmail`.
 */

/** An address as it appears in a URL or a search: trimmed, lower-cased, plausibly an email. */
export function normEmail(value: string): string | null {
  const v = value.trim().toLowerCase();
  return v.length <= 254 && /^[^\s@]+@[^\s@]+$/.test(v) ? v : null;
}

export const emailPath = (email: string) => `/emails/${encodeURIComponent(email)}`;

/** Every Case of the address's Contacts, and Contact-less Cases sent from it. */
const PERSON_CASES = (emails: SQL) => sql`
  SELECT a.id, ct.email, a.contact_id, a.created_date, a.record_type_id
    FROM sf_case a JOIN sf_contact ct ON ct.id = a.contact_id
   WHERE NOT a.is_deleted AND NOT ct.is_deleted AND ct.email IN (${emails})
  UNION ALL
  SELECT a.id, a.data->>'SuppliedEmail', NULL, a.created_date, a.record_type_id
    FROM sf_case a
   WHERE NOT a.is_deleted AND a.contact_id IS NULL AND a.data->>'SuppliedEmail' IN (${emails})`;

export interface EmailFilters {
  q: string;
  multi: boolean;
  type: string;
  /** At least one application (or none). */
  applied?: "yes" | "no" | "";
  /** At least one attached file (or none), from the mirrored file links. */
  files?: "yes" | "no" | "";
  /** Where the person lives: CBS district (1–7) or "unknown", and sub-district (lib/geo/filters.ts). */
  area?: string;
  napa?: string;
}

/** The list's filters as the URL carries them, read here so the page and the contact export agree. */
export function emailFilters(search: SearchParams): Required<EmailFilters> {
  return {
    q: param(search, "q"),
    multi: param(search, "multi") === "1",
    type: param(search, "type", 80),
    applied: choice(search, "applied", ["yes", "no"] as const),
    files: choice(search, "files", ["yes", "no"] as const),
    area: choice(search, "area", AREA_VALUES),
    napa: choice(search, "napa", NAPA_VALUES),
  };
}

export interface EmailRow {
  email: string;
  contacts: number;
  names: string[];
  phone: string | null;
  cases: number;
  /** Application Cases among them. */
  applications: number;
  /** Distinct files on the person's Contacts, Cases and their emails (mail signatures left out). */
  files: number;
  /** Where the person lives, from their Contacts (the newest one with a known place). */
  place: PlaceLabel;
  firstCaseAt: Date | null;
  lastCaseAt: Date | null;
}

const APPLICATION_TYPES = sql`SELECT id FROM sf_record_type WHERE developer_name IN (${RECORD_TYPES.application}, ${RECORD_TYPES.accepted})`;
const SKIPPED = [...SKIP_EXTENSIONS];

/*
 * Files come from the mirror of where files hang (lib/sf/sync-files.ts): on a Contact, on a CV or
 * application Case, or on an email of one. The address's own page reads Salesforce live and can
 * show a few more (files on Cases of other types). Small images and invites are mail signatures.
 */
const EMAILS = sql`${CANDIDATES},
  emails AS (SELECT DISTINCT c.email FROM cand c WHERE c.email IS NOT NULL),
  places AS (
    SELECT DISTINCT ON (c.email) c.email, c.place_kind, c.napa, c.locality
      FROM cand c WHERE c.email IS NOT NULL
     ORDER BY c.email, (c.napa IS NULL), (c.locality IS NULL), c.created_date DESC NULLS LAST
  ),
  people AS (
    SELECT ct.email, count(*) AS contacts,
           array_agg(DISTINCT ct.name) FILTER (WHERE ct.name IS NOT NULL) AS names,
           max(coalesce(nullif(ct.data->>'MobilePhone', ''), nullif(ct.data->>'Phone', ''), nullif(ct.data->>'phoneNumber_cambium__c', ''))) AS phone
      FROM sf_contact ct JOIN emails e ON e.email = ct.email
     WHERE NOT ct.is_deleted
     GROUP BY ct.email
  ),
  cases AS (${PERSON_CASES(sql`SELECT email FROM emails`)}),
  case_totals AS (
    SELECT email, count(*) AS cases, count(*) FILTER (WHERE record_type_id IN (${APPLICATION_TYPES})) AS applications,
           min(created_date) AS first_at, max(created_date) AS last_at,
           array_agg(DISTINCT record_type_id) AS types
      FROM cases GROUP BY email
  ),
  file_docs AS (
    SELECT ct.email, l.document_id, l.extension, l.size
      FROM sf_file_link l JOIN sf_contact ct ON ct.id = l.linked_entity_id
     WHERE l.entity_type = 'contact' AND NOT ct.is_deleted AND ct.email IN (SELECT email FROM emails)
    UNION ALL
    SELECT c.email, l.document_id, l.extension, l.size
      FROM cases c JOIN sf_file_link l ON l.entity_type = 'case' AND l.linked_entity_id = c.id
    UNION ALL
    SELECT c.email, l.document_id, l.extension, l.size
      FROM cases c
      JOIN sf_email_message m ON m.parent_id = c.id AND NOT m.is_deleted
      JOIN sf_file_link l ON l.entity_type = 'email' AND l.linked_entity_id = m.id
  ),
  file_totals AS (
    SELECT email, count(DISTINCT document_id) AS files FROM file_docs
     WHERE NOT (coalesce(extension, '') IN ${SKIPPED} AND coalesce(size, 0) < ${MIN_SIZE})
     GROUP BY email
  ),
  person AS (
    SELECT p.*, coalesce(t.cases, 0) AS cases, coalesce(t.applications, 0) AS applications, t.first_at, t.last_at, t.types,
           coalesce(f.files, 0) AS files, coalesce(pl.place_kind, 'unknown') AS place_kind, pl.napa, pl.locality
      FROM people p
      LEFT JOIN case_totals t ON t.email = p.email
      LEFT JOIN file_totals f ON f.email = p.email
      LEFT JOIN places pl ON pl.email = p.email
  )`;

function toEmailRow(r: Record<string, unknown>): EmailRow {
  return {
    email: String(r.email),
    contacts: num(r.contacts),
    names: Array.isArray(r.names) ? (r.names as string[]) : [],
    phone: str(r.phone),
    cases: num(r.cases),
    applications: num(r.applications),
    files: num(r.files),
    place: placeLabel(r),
    firstCaseAt: asDate(r.first_at),
    lastCaseAt: asDate(r.last_at),
  };
}

/** The columns the list can be sorted by; `last` (the newest case) is the default. */
export const EMAIL_SORTS: readonly SortColumn[] = [
  { key: "last", kind: "date", by: sql`p.last_at` },
  { key: "email", kind: "text", by: sql`p.email` },
  { key: "name", kind: "text", by: sql`p.names[1]` },
  { key: "contacts", kind: "number", by: sql`p.contacts` },
  { key: "cases", kind: "number", by: sql`p.cases` },
  { key: "applications", kind: "number", by: sql`p.applications` },
  { key: "files", kind: "number", by: sql`p.files` },
  { key: "first", kind: "date", by: sql`p.first_at` },
];

/** Every filter of the list as one WHERE, shared by the list and by the contact export. */
function whereOf(f: EmailFilters): SQL {
  const parts: SQL[] = [sql`true`];
  if (f.q) {
    const p = containsPattern(f.q);
    const digits = phoneDigits(f.q);
    // Any of the address's Contacts may match, not only the one whose phone is shown.
    parts.push(sql`(p.email ILIKE ${p} OR p.email IN (
      SELECT ct.email FROM sf_contact ct WHERE NOT ct.is_deleted AND ct.email IS NOT NULL AND (ct.name ILIKE ${p}
        ${digits
          ? sql`OR regexp_replace(coalesce(ct.data->>'MobilePhone', ''), '[^0-9]', '', 'g') LIKE ${`%${digits}%`}
                OR regexp_replace(coalesce(ct.data->>'Phone', ''), '[^0-9]', '', 'g') LIKE ${`%${digits}%`}`
          : sql.raw("")})))`);
  }
  if (f.multi) parts.push(sql`p.contacts > 1`);
  if (f.type) parts.push(sql`EXISTS (SELECT 1 FROM sf_record_type rt WHERE rt.developer_name = ${f.type} AND rt.id = ANY (p.types))`);
  if (f.applied === "yes") parts.push(sql`p.applications > 0`);
  if (f.applied === "no") parts.push(sql`p.applications = 0`);
  if (f.files === "yes") parts.push(sql`p.files > 0`);
  if (f.files === "no") parts.push(sql`p.files = 0`);
  parts.push(...placeFilterSql("p", f.area ?? "", f.napa ?? ""));
  return sql.join(parts, sql` AND `);
}

export async function searchEmails(
  f: EmailFilters,
  { page = 1, pageSize = PAGE_SIZE, sort }: { page?: number; pageSize?: number; sort?: Sort } = {},
): Promise<{ rows: EmailRow[]; total: number }> {
  const where = whereOf(f);

  const [rows, count] = await Promise.all([
    run(sql`${EMAILS} SELECT p.* FROM person p WHERE ${where}
             ORDER BY ${orderBy(EMAIL_SORTS, sort ?? { key: "last", dir: "desc" }, sql`p.email`)}
             LIMIT ${pageSize} OFFSET ${(page - 1) * pageSize}`),
    run(sql`${EMAILS} SELECT count(*) AS n FROM person p WHERE ${where}`),
  ]);
  return { rows: rows.map(toEmailRow), total: num(count[0]?.n) };
}

export type EmailContactField = "email" | "phone";
/** A guard, not a quota: more than this is a mailing-list job, not a copy-paste. */
export const MAX_EMAIL_CONTACTS = 5_000;

/**
 * The addresses (or phones) behind every row the filter finds, not only the page on screen,
 * each once (phones compared by digits), newest activity first.
 */
export async function loadEmailListContacts(
  f: EmailFilters,
  field: EmailContactField,
): Promise<{ values: string[]; truncated: boolean }> {
  const column = field === "email" ? sql`p.email` : sql`p.phone`;
  const rows = await run(sql`${EMAILS}
    SELECT ${column} AS v, max(coalesce(p.last_at, p.first_at)) AS at FROM person p
     WHERE ${whereOf(f)} AND ${column} IS NOT NULL AND btrim(${column}) <> ''
     GROUP BY 1 ORDER BY 2 DESC NULLS LAST
     LIMIT ${MAX_EMAIL_CONTACTS + 1}`);
  const seen = new Set<string>();
  const values: string[] = [];
  for (const r of rows) {
    const value = String(r.v).trim();
    const key = field === "phone" ? value.replace(/\D/g, "") : value.toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    values.push(field === "email" ? key : value);
  }
  return { values: values.slice(0, MAX_EMAIL_CONTACTS), truncated: values.length > MAX_EMAIL_CONTACTS };
}

/** Case record types, most common first, for the filter menu and the type chips. */
export async function loadCaseTypes(): Promise<{ value: string; label: string }[]> {
  const rows = await run(sql`
    SELECT rt.developer_name, rt.name, count(a.id) AS n
      FROM sf_record_type rt LEFT JOIN sf_case a ON a.record_type_id = rt.id AND NOT a.is_deleted
     WHERE rt.sobject_type = 'Case'
     GROUP BY 1, 2 HAVING count(a.id) > 0 ORDER BY 3 DESC`);
  return rows.map((r) => ({ value: String(r.developer_name), label: String(r.name) }));
}

export interface EmailContact {
  id: string;
  name: string | null;
  phone: string | null;
  city: string | null;
  accountName: string | null;
  hasCv: boolean;
  createdAt: Date | null;
  cases: number;
}

export async function loadEmailContacts(email: string): Promise<EmailContact[]> {
  const rows = await run(sql`
    SELECT ct.id, ct.name, ct.created_date, acc.name AS account_name,
           coalesce(nullif(ct.data->>'MobilePhone', ''), nullif(ct.data->>'Phone', ''), nullif(ct.data->>'phoneNumber_cambium__c', '')) AS phone,
           coalesce(nullif(ct.data->>'City_fix__c', ''), nullif(ct.data->>'city_index__c', '')) AS city,
           coalesce(ct.data->>'CV__c', 'false') = 'true' AS has_cv,
           (SELECT count(*) FROM sf_case a WHERE a.contact_id = ct.id AND NOT a.is_deleted) AS cases
      FROM sf_contact ct LEFT JOIN sf_account acc ON acc.id = ct.account_id
     WHERE NOT ct.is_deleted AND ct.email = ${email}
     ORDER BY ct.created_date`);
  return rows.map((r) => ({
    id: String(r.id),
    name: str(r.name),
    phone: str(r.phone),
    city: str(r.city),
    accountName: str(r.account_name),
    hasCv: r.has_cv === true || r.has_cv === "true",
    createdAt: asDate(r.created_date),
    cases: num(r.cases),
  }));
}

export interface EmailCase {
  id: string;
  caseNumber: string | null;
  recordType: string | null;
  typeLabel: string;
  subject: string | null;
  status: string | null;
  createdAt: Date;
  closedAt: Date | null;
  /** null when the Case has no Contact and was matched by its sender address. */
  contactId: string | null;
  contactName: string | null;
  jobId: string | null;
  jobTitle: string | null;
  company: string | null;
  ownerName: string | null;
  origin: string | null;
}

/** Where a Case opens in the platform, when it has a page of its own. */
export function casePath(c: Pick<EmailCase, "id" | "recordType">): string | null {
  if (c.recordType === RECORD_TYPES.application || c.recordType === RECORD_TYPES.accepted) return `/applications/${c.id}`;
  if (c.recordType === RECORD_TYPES.position) return `/positions/${c.id}`;
  return null;
}

export const MAX_EMAIL_CASES = 1000;

export async function loadEmailCases(email: string): Promise<{ cases: EmailCase[]; total: number }> {
  const rows = await run(sql`
    WITH cases AS (${PERSON_CASES(sql`${email}`)})
    SELECT a.id, a.data->>'CaseNumber' AS case_number, rt.developer_name, rt.name AS type_label,
           a.data->>'Subject' AS subject, a.status, a.created_date, a.closed_date, a.data->>'Origin' AS origin,
           c.contact_id, ct.name AS contact_name, u.name AS owner_name,
           CASE WHEN jrt.developer_name = ${RECORD_TYPES.position} THEN j.id END AS job_id,
           CASE WHEN jrt.developer_name = ${RECORD_TYPES.position}
                THEN coalesce(nullif(j.data->>'Position_cambium__c', ''), nullif(j.data->>'Subject', '')) END AS job_title,
           coalesce(nullif(j.data->>'company_cambium__c', ''), nullif(a.data->>'company_cambium__c', '')) AS company,
           count(*) OVER () AS total
      FROM cases c
      JOIN sf_case a ON a.id = c.id
      LEFT JOIN sf_record_type rt ON rt.id = a.record_type_id
      LEFT JOIN sf_contact ct ON ct.id = c.contact_id
      LEFT JOIN sf_user u ON u.id = a.owner_id
      LEFT JOIN sf_case j ON j.id = a.parent_id
      LEFT JOIN sf_record_type jrt ON jrt.id = j.record_type_id
     ORDER BY a.created_date, a.id
     LIMIT ${MAX_EMAIL_CASES}`);
  return {
    total: num(rows[0]?.total),
    cases: rows.map((r) => ({
      id: String(r.id),
      caseNumber: str(r.case_number),
      recordType: str(r.developer_name),
      typeLabel: str(r.type_label) ?? "ללא סוג",
      subject: str(r.subject),
      status: normStatus(str(r.status)),
      createdAt: asDate(r.created_date)!,
      closedAt: asDate(r.closed_date),
      contactId: str(r.contact_id),
      contactName: str(r.contact_name),
      jobId: str(r.job_id),
      jobTitle: str(r.job_title),
      company: str(r.company),
      ownerName: str(r.owner_name),
      origin: str(r.origin),
    })),
  };
}

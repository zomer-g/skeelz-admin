import { sql, type SQL } from "drizzle-orm";
import { normStatus, RECORD_TYPES } from "@/lib/metrics/candidates";
import { CANDIDATES } from "./candidates";
import { asDate, containsPattern, num, PAGE_SIZE, phoneDigits, run, str } from "./search";

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
}

export interface EmailRow {
  email: string;
  contacts: number;
  names: string[];
  phone: string | null;
  cases: number;
  firstCaseAt: Date | null;
  lastCaseAt: Date | null;
}

const EMAILS = sql`${CANDIDATES},
  emails AS (SELECT DISTINCT c.email FROM cand c WHERE c.email IS NOT NULL),
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
    SELECT email, count(*) AS cases, min(created_date) AS first_at, max(created_date) AS last_at,
           array_agg(DISTINCT record_type_id) AS types
      FROM cases GROUP BY email
  ),
  person AS (
    SELECT p.*, coalesce(t.cases, 0) AS cases, t.first_at, t.last_at, t.types
      FROM people p LEFT JOIN case_totals t ON t.email = p.email
  )`;

function toEmailRow(r: Record<string, unknown>): EmailRow {
  return {
    email: String(r.email),
    contacts: num(r.contacts),
    names: Array.isArray(r.names) ? (r.names as string[]) : [],
    phone: str(r.phone),
    cases: num(r.cases),
    firstCaseAt: asDate(r.first_at),
    lastCaseAt: asDate(r.last_at),
  };
}

export async function searchEmails(
  f: EmailFilters,
  { page = 1, pageSize = PAGE_SIZE }: { page?: number; pageSize?: number } = {},
): Promise<{ rows: EmailRow[]; total: number }> {
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
  const where = sql.join(parts, sql` AND `);

  const [rows, count] = await Promise.all([
    run(sql`${EMAILS} SELECT p.* FROM person p WHERE ${where}
             ORDER BY p.last_at DESC NULLS LAST, p.email LIMIT ${pageSize} OFFSET ${(page - 1) * pageSize}`),
    run(sql`${EMAILS} SELECT count(*) AS n FROM person p WHERE ${where}`),
  ]);
  return { rows: rows.map(toEmailRow), total: num(count[0]?.n) };
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

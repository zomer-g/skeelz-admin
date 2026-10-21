import { sql, type SQL } from "drizzle-orm";
import { asDate, containsPattern, dayBounds, isSfId, num, PAGE_SIZE, run, str } from "./search";
import { orderBy, type Sort, type SortColumn } from "./sort";

/**
 * Employer leads as Cases (/leads): Cases of type `lead_employer` ("ליד מעסיק"), worked by the
 * sales staff. The employers tab counts leads from the Account's employer status
 * (lib/metrics/employers.ts); this list shows the Cases themselves.
 */

export const LEAD_CASE_TYPE = "lead_employer";

export interface LeadFilters {
  q: string;
  status: string;
  owner: string;
  fromDay: string;
  toDay: string;
}

export interface LeadRow {
  id: string;
  caseNumber: string | null;
  subject: string | null;
  status: string | null;
  accountId: string | null;
  accountName: string | null;
  /** The Account's own employer status ("סטטוס מעסיק"), which the employers tab follows. */
  accountStatus: string | null;
  contactId: string | null;
  contactName: string | null;
  contactEmail: string | null;
  contactPhone: string | null;
  ownerName: string | null;
  createdAt: Date | null;
  closedAt: Date | null;
  /** The last change of the Case's status. */
  statusChangedAt: Date | null;
  description: string | null;
}

const LEADS = sql`
  WITH lead AS (
    SELECT c.id, c.data->>'CaseNumber' AS case_number, c.data->>'Subject' AS subject, c.status, c.created_date, c.closed_date,
           c.data->>'Description' AS description,
           acc.id AS account_id, acc.name AS account_name, acc.data->>'acount_status__c' AS account_status,
           ct.id AS contact_id, ct.name AS contact_name, ct.email AS contact_email,
           coalesce(nullif(ct.data->>'MobilePhone', ''), nullif(ct.data->>'Phone', '')) AS contact_phone,
           u.name AS owner_name,
           (SELECT max(h.created_date) FROM sf_case_history h WHERE h.case_id = c.id AND h.field = 'Status') AS status_changed_at
      FROM sf_case c
      JOIN sf_record_type rt ON rt.id = c.record_type_id
      LEFT JOIN sf_account acc ON acc.id = c.account_id
      LEFT JOIN sf_contact ct ON ct.id = c.contact_id
      LEFT JOIN sf_user u ON u.id = c.owner_id
     WHERE rt.developer_name = ${LEAD_CASE_TYPE} AND NOT c.is_deleted
  )`;

export const LEAD_SORTS: readonly SortColumn[] = [
  { key: "created", kind: "date", by: sql`l.created_date` },
  { key: "account", kind: "text", by: sql`l.account_name` },
  { key: "status", kind: "text", by: sql`l.status` },
  { key: "owner", kind: "text", by: sql`l.owner_name` },
  { key: "changed", kind: "date", by: sql`coalesce(l.status_changed_at, l.created_date)` },
];

const toLead = (r: Record<string, unknown>): LeadRow => ({
  id: String(r.id),
  caseNumber: str(r.case_number),
  subject: str(r.subject),
  status: str(r.status),
  accountId: str(r.account_id),
  accountName: str(r.account_name),
  accountStatus: str(r.account_status),
  contactId: str(r.contact_id),
  contactName: str(r.contact_name),
  contactEmail: str(r.contact_email),
  contactPhone: str(r.contact_phone),
  ownerName: str(r.owner_name),
  createdAt: asDate(r.created_date),
  closedAt: asDate(r.closed_date),
  statusChangedAt: asDate(r.status_changed_at),
  description: str(r.description),
});

export async function searchLeads(
  f: LeadFilters,
  { page = 1, pageSize = PAGE_SIZE, sort }: { page?: number; pageSize?: number; sort?: Sort } = {},
): Promise<{ rows: LeadRow[]; total: number }> {
  const parts: SQL[] = [sql`true`];
  if (f.q) {
    const p = containsPattern(f.q);
    parts.push(sql`(l.account_name ILIKE ${p} OR l.subject ILIKE ${p} OR l.contact_name ILIKE ${p} OR l.contact_email ILIKE ${p} OR l.case_number ILIKE ${p})`);
  }
  if (f.status) parts.push(sql`l.status = ${f.status}`);
  if (f.owner) parts.push(sql`l.owner_name = ${f.owner}`);
  const { from, to } = dayBounds(f.fromDay, f.toDay);
  if (from) parts.push(sql`l.created_date >= ${from}`);
  if (to) parts.push(sql`l.created_date < ${to}`);
  const where = sql.join(parts, sql` AND `);
  const [rows, count] = await Promise.all([
    run(sql`${LEADS} SELECT l.* FROM lead l WHERE ${where}
             ORDER BY ${orderBy(LEAD_SORTS, sort ?? { key: "created", dir: "desc" }, sql`l.id`)}
             LIMIT ${pageSize} OFFSET ${(page - 1) * pageSize}`),
    run(sql`${LEADS} SELECT count(*) AS n FROM lead l WHERE ${where}`),
  ]);
  return { rows: rows.map(toLead), total: num(count[0]?.n) };
}

/** The statuses and owners the leads actually have, for the filter selects. */
export async function loadLeadFilterOptions(): Promise<{ statuses: { value: string; count: number }[]; owners: string[] }> {
  const [statuses, owners] = await Promise.all([
    run(sql`${LEADS} SELECT l.status AS v, count(*) AS n FROM lead l WHERE l.status IS NOT NULL GROUP BY 1 ORDER BY 2 DESC`),
    run(sql`${LEADS} SELECT DISTINCT l.owner_name AS v FROM lead l WHERE l.owner_name IS NOT NULL ORDER BY 1`),
  ]);
  return { statuses: statuses.map((r) => ({ value: String(r.v), count: num(r.n) })), owners: owners.map((r) => String(r.v)) };
}

export async function loadLead(id: string): Promise<LeadRow | null> {
  if (!isSfId(id)) return null;
  const [r] = await run(sql`${LEADS} SELECT l.* FROM lead l WHERE l.id = ${id}`);
  return r ? toLead(r) : null;
}

import { sql, type SQL } from "drizzle-orm";
import { normStatus, RECORD_TYPES } from "@/lib/metrics/candidates";
import { companyKeySql, companyNameOf } from "@/lib/metrics/company";
import { applicationPaidSql } from "@/lib/metrics/paid";
import { asDate, containsPattern, dayBounds, isSfId, isTrue, num, PAGE_SIZE, phoneDigits, run, str } from "./search";

/**
 * Applications: Cases of the two application record types — an application
 * made on the site, and the one it becomes when converted to a placement. The
 * record type is not shown or filtered here: whether a candidate was hired is
 * read from the status ("התקבל") alone.
 */

export interface ApplicationFilters {
  q: string;
  status: string;
  paid: "paid" | "unpaid" | "";
  fromDay: string;
  toDay: string;
  owner: string;
  jobId?: string;
  contactId?: string;
  companyKey?: string;
}

export interface ApplicationRow {
  id: string;
  caseNumber: string | null;
  status: string | null;
  createdAt: Date;
  closedAt: Date | null;
  paid: boolean;
  candidateId: string | null;
  candidateName: string | null;
  candidateEmail: string | null;
  candidatePhone: string | null;
  jobId: string | null;
  jobTitle: string | null;
  company: string | null;
  ownerName: string | null;
}

const NORM_STATUS = sql.raw(`btrim(regexp_replace(replace(a.status, chr(160), ' '), ' +', ' ', 'g'))`);

const FROM = sql`
  FROM sf_case a
  JOIN sf_record_type rt ON rt.id = a.record_type_id
  LEFT JOIN sf_case j ON j.id = a.parent_id
  LEFT JOIN sf_contact ct ON ct.id = a.contact_id
  LEFT JOIN sf_user u ON u.id = a.owner_id`;

const IS_APPLICATION = sql`rt.developer_name IN (${RECORD_TYPES.application}, ${RECORD_TYPES.accepted}) AND NOT a.is_deleted`;

const COLUMNS = sql`
  a.id, a.data->>'CaseNumber' AS case_number, rt.developer_name AS record_type, a.status, a.created_date, a.closed_date,
  ${applicationPaidSql("a", "j")} AS paid,
  a.contact_id,
  coalesce(ct.name, nullif(a.data->>'full_name__c', ''), nullif(a.data->>'A_Name_Cam__c', ''), nullif(a.data->>'SuppliedName', '')) AS candidate_name,
  coalesce(nullif(lower(a.data->>'ContactEmail'), ''), ct.email) AS candidate_email,
  coalesce(nullif(a.data->>'ContactMobile', ''), nullif(a.data->>'ContactPhone', ''), nullif(ct.data->>'MobilePhone', '')) AS candidate_phone,
  a.parent_id,
  coalesce(nullif(j.data->>'Position_cambium__c', ''), nullif(a.data->>'position_name_for_applied__c', ''), nullif(a.data->>'Position_Name__c', ''), nullif(j.data->>'Subject', '')) AS job_title,
  coalesce(nullif(j.data->>'company_cambium__c', ''), nullif(a.data->>'company_cambium__c', '')) AS company,
  u.name AS owner_name`;

function whereOf(f: ApplicationFilters): SQL {
  const parts: SQL[] = [IS_APPLICATION];
  if (f.q) {
    const p = containsPattern(f.q);
    const digits = phoneDigits(f.q);
    const phone = digits
      ? sql`OR regexp_replace(coalesce(a.data->>'ContactMobile', ''), '[^0-9]', '', 'g') LIKE ${`%${digits}%`}
            OR regexp_replace(coalesce(ct.data->>'MobilePhone', ''), '[^0-9]', '', 'g') LIKE ${`%${digits}%`}`
      : sql.raw("");
    parts.push(sql`(
      ct.name ILIKE ${p} OR a.data->>'full_name__c' ILIKE ${p} OR a.data->>'ContactEmail' ILIKE ${p} OR ct.email ILIKE ${p}
      OR a.data->>'CaseNumber' ILIKE ${p}
      OR j.data->>'Position_cambium__c' ILIKE ${p} OR a.data->>'position_name_for_applied__c' ILIKE ${p}
      OR j.data->>'company_cambium__c' ILIKE ${p} OR a.data->>'company_cambium__c' ILIKE ${p}
      ${phone}
    )`);
  }
  if (f.status) parts.push(sql`${NORM_STATUS} = ${normStatus(f.status)}`);
  if (f.paid === "paid") parts.push(applicationPaidSql("a", "j"));
  if (f.paid === "unpaid") parts.push(sql`NOT ${applicationPaidSql("a", "j")}`);
  const { from, to } = dayBounds(f.fromDay, f.toDay);
  if (from) parts.push(sql`a.created_date >= ${from}`);
  if (to) parts.push(sql`a.created_date < ${to}`);
  if (f.owner) parts.push(sql`u.name = ${f.owner}`);
  if (f.jobId && isSfId(f.jobId)) parts.push(sql`a.parent_id = ${f.jobId}`);
  if (f.contactId && isSfId(f.contactId)) parts.push(sql`a.contact_id = ${f.contactId}`);
  if (f.companyKey) {
    parts.push(sql`a.parent_id IN (
      SELECT p.id FROM sf_case p LEFT JOIN sf_account acc ON acc.id = p.account_id
       WHERE ${companyKeySql(companyNameOf())} = ${f.companyKey})`);
  }
  return sql.join(parts, sql` AND `);
}

function toRow(r: Record<string, unknown>): ApplicationRow {
  return {
    id: String(r.id),
    caseNumber: str(r.case_number),
    status: normStatus(str(r.status)),
    createdAt: asDate(r.created_date)!,
    closedAt: asDate(r.closed_date),
    paid: isTrue(r.paid),
    candidateId: str(r.contact_id),
    candidateName: str(r.candidate_name),
    candidateEmail: str(r.candidate_email),
    candidatePhone: str(r.candidate_phone),
    jobId: str(r.parent_id),
    jobTitle: str(r.job_title),
    company: str(r.company),
    ownerName: str(r.owner_name),
  };
}

export async function searchApplications(
  f: ApplicationFilters,
  { page = 1, pageSize = PAGE_SIZE }: { page?: number; pageSize?: number } = {},
): Promise<{ rows: ApplicationRow[]; total: number }> {
  const where = whereOf(f);
  const [rows, count] = await Promise.all([
    run(sql`SELECT ${COLUMNS} ${FROM} WHERE ${where} ORDER BY a.created_date DESC LIMIT ${pageSize} OFFSET ${(page - 1) * pageSize}`),
    run(sql`SELECT count(*) AS n ${FROM} WHERE ${where}`),
  ]);
  return { rows: rows.map(toRow), total: num(count[0]?.n) };
}

/** Statuses and owners in use, most common first, for the filter menus. */
export async function loadApplicationFilterOptions(): Promise<{ statuses: string[]; owners: string[] }> {
  const [statuses, owners] = await Promise.all([
    run(sql`SELECT ${NORM_STATUS} AS v, count(*) AS n ${FROM} WHERE ${IS_APPLICATION} AND a.status IS NOT NULL GROUP BY 1 ORDER BY 2 DESC`),
    run(sql`SELECT u.name AS v, count(*) AS n ${FROM} WHERE ${IS_APPLICATION} AND u.name IS NOT NULL GROUP BY 1 ORDER BY 2 DESC`),
  ]);
  return { statuses: statuses.map((r) => String(r.v)), owners: owners.map((r) => String(r.v)) };
}

export interface ApplicationDetail extends ApplicationRow {
  subject: string | null;
  description: string | null;
  rejectReasons: string[];
  fastApplied: boolean;
  candidateStatus: string | null;
  placementDate: string | null;
  siteJobKey: string | null;
}

export async function loadApplication(id: string): Promise<ApplicationDetail | null> {
  if (!isSfId(id)) return null;
  const [r] = await run(sql`
    SELECT ${COLUMNS},
           a.data->>'Subject' AS subject, a.data->>'Description' AS description, a.data->>'Field21__c' AS reject_reasons,
           a.data->>'fast_applied__c' AS fast_applied, a.data->>'Candidate_Status__c' AS candidate_status,
           coalesce(a.data->>'Field49__c', a.data->>'Placement_Date__c') AS placement_date,
           coalesce(j.site_job_key, a.site_job_key) AS site_job_key
      ${FROM} WHERE ${IS_APPLICATION} AND a.id = ${id}`);
  if (!r) return null;
  return {
    ...toRow(r),
    subject: str(r.subject),
    description: str(r.description),
    rejectReasons: (str(r.reject_reasons) ?? "")
      .split(";")
      .map((s) => normStatus(s)!)
      .filter(Boolean),
    fastApplied: isTrue(r.fast_applied),
    candidateStatus: str(r.candidate_status),
    placementDate: str(r.placement_date),
    siteJobKey: str(r.site_job_key),
  };
}

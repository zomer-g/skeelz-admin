import { sql, type SQL } from "drizzle-orm";
import { normStatus, RECORD_TYPES, STATUS } from "@/lib/metrics/candidates";
import { companyKeySql, companyNameOf } from "@/lib/metrics/company";
import { applicationPaidSql } from "@/lib/metrics/paid";
import { ageInDays, asDate, containsPattern, dayOf, dayBounds, isSfId, isTrue, num, PAGE_SIZE, phoneDigits, run, str } from "./search";

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
  /** When the status became "התקבל". */
  acceptedAt: Date | null;
  /** תאריך תחילת עבודה (`Placement_Date__c`), YYYY-MM-DD. */
  startDate: string | null;
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
  u.name AS owner_name,
  -- When the status first became "התקבל"; before status history was kept, the Case closes on it.
  coalesce(
    (SELECT min(h.created_date) FROM sf_case_history h
      WHERE h.case_id = a.id AND h.field = 'Status'
        AND btrim(regexp_replace(replace(h.new_value, chr(160), ' '), ' +', ' ', 'g')) = ${STATUS.accepted}),
    CASE WHEN ${NORM_STATUS} = ${STATUS.accepted} THEN a.closed_date END
  ) AS accepted_at,
  nullif(a.data->>'Placement_Date__c', '') AS start_date`;

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
    acceptedAt: asDate(r.accepted_at),
    startDate: str(r.start_date)?.slice(0, 10) ?? null,
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
  /** חוסר התאמה (`Field21__c`) */
  rejectReasons: string[];
  /** הגשה מהירה */
  fastApplied: boolean;
  /** הגשה למשרה בתשלום (`A_Money__c`) as Salesforce has it; `paid` also counts a paid job (lib/metrics/paid.ts). */
  paidApplicationFlag: boolean;
  /** משרה של זהר */
  zohar: boolean;
  /** פולו-אפ, YYYY-MM-DD */
  followUp: string | null;
  /** סטטוס השמה (`interested_satatus__c`) */
  placementStatus: string | null;
  candidateStatus: string | null;
  /** תאריך השמה (`Field49__c`); the start date (`Placement_Date__c`) is `startDate`. */
  placementDate: string | null;
  invoiceDate: string | null;
  paymentDate: string | null;
  /** אחוז משכר */
  salaryPercent: number | null;
  /** לגביה לפני מע"מ */
  collectionBeforeVat: number | null;
  /** עמלה 7.5% (a text field in Salesforce) */
  commission: string | null;
  projectStatus: string | null;
  jobCaseNumber: string | null;
  recordType: string | null;
  accountName: string | null;
  type: string | null;
  origin: string | null;
  reason: string | null;
  priority: string | null;
  /** Case Source: the email the Case came from, when it did. */
  sourceId: string | null;
  /** Web Email (`SuppliedEmail`) */
  webEmail: string | null;
  createdByName: string | null;
  lastModifiedByName: string | null;
  lastModifiedAt: Date | null;
  /** אורך חיי המקרה in days, computed (the formula field goes stale in the mirror). */
  ageDays: number | null;
  siteJobKey: string | null;
}

const numOrNull = (v: unknown) => {
  if (v == null || v === "") return null;
  const n = Number(String(v).replace(/[^\d.-]/g, ""));
  return Number.isFinite(n) ? n : null;
};

export async function loadApplication(id: string): Promise<ApplicationDetail | null> {
  if (!isSfId(id)) return null;
  const [r] = await run(sql`
    SELECT ${COLUMNS},
           a.data->>'Subject' AS subject, a.data->>'Description' AS description, a.data->>'Field21__c' AS reject_reasons,
           a.data->>'fast_applied__c' AS fast_applied, a.data->>'A_Money__c' AS a_money, a.data->>'zohar_position__c' AS zohar,
           a.data->>'follow_up__c' AS follow_up, a.data->>'interested_satatus__c' AS placement_status,
           a.data->>'Candidate_Status__c' AS candidate_status, a.data->>'Field49__c' AS placement_date,
           a.data->>'Invoice_Date__c' AS invoice_date, a.data->>'Payment_Date__c' AS payment_date,
           a.data->>'Salary_Percentage__c' AS salary_percent, a.data->>'Collection_Before_VAT__c' AS collection,
           a.data->>'Commission__c' AS commission, a.data->>'Project_Status__c' AS project_status,
           j.data->>'CaseNumber' AS job_case_number, rt.name AS record_type_name,
           (SELECT acc.name FROM sf_account acc WHERE acc.id = a.account_id) AS account_name,
           a.data->>'Type' AS case_type, a.data->>'Origin' AS origin, a.data->>'Reason' AS reason, a.data->>'Priority' AS priority,
           a.data->>'SourceId' AS source_id, lower(nullif(a.data->>'SuppliedEmail', '')) AS web_email,
           (SELECT cu.name FROM sf_user cu WHERE cu.id = a.data->>'CreatedById') AS created_by,
           (SELECT mu.name FROM sf_user mu WHERE mu.id = a.data->>'LastModifiedById') AS modified_by,
           a.data->>'LastModifiedDate' AS modified_at,
           coalesce(j.site_job_key, a.site_job_key) AS site_job_key
      ${FROM} WHERE ${IS_APPLICATION} AND a.id = ${id}`);
  if (!r) return null;
  const row = toRow(r);
  return {
    ...row,
    subject: str(r.subject),
    description: str(r.description),
    rejectReasons: (str(r.reject_reasons) ?? "")
      .split(";")
      .map((s) => normStatus(s)!)
      .filter(Boolean),
    fastApplied: isTrue(r.fast_applied),
    paidApplicationFlag: isTrue(r.a_money),
    zohar: isTrue(r.zohar),
    followUp: dayOf(str(r.follow_up)),
    placementStatus: str(r.placement_status),
    candidateStatus: str(r.candidate_status),
    placementDate: dayOf(str(r.placement_date)),
    invoiceDate: dayOf(str(r.invoice_date)),
    paymentDate: dayOf(str(r.payment_date)),
    salaryPercent: numOrNull(r.salary_percent),
    collectionBeforeVat: numOrNull(r.collection),
    commission: str(r.commission),
    projectStatus: str(r.project_status),
    jobCaseNumber: str(r.job_case_number),
    recordType: str(r.record_type_name),
    accountName: str(r.account_name),
    type: str(r.case_type),
    origin: str(r.origin),
    reason: str(r.reason),
    priority: str(r.priority),
    sourceId: str(r.source_id),
    webEmail: str(r.web_email),
    createdByName: str(r.created_by),
    lastModifiedByName: str(r.modified_by),
    lastModifiedAt: asDate(r.modified_at),
    ageDays: ageInDays(row.createdAt, row.closedAt),
    siteJobKey: str(r.site_job_key),
  };
}

import { sql, type SQL } from "drizzle-orm";
import { RECORD_TYPES } from "@/lib/metrics/candidates";
import { companyKeySql, companyNameOf } from "@/lib/metrics/company";
import { jobPaidSql } from "@/lib/metrics/paid";
import { asDate, containsPattern, htmlToText, isSfId, isTrue, num, PAGE_SIZE, run, str } from "./search";

/**
 * Employers, as the site knows them: jobs grouped by company name (the Account
 * name for older jobs without one), with company-level details taken from the
 * company's most recent job.
 */

export const JOB_STATUS_LABELS: Record<string, string> = { Active: "פעילה", Suspended: "מושהית", Closed: "סגורה", off: "כבויה" };
const JOB_TIME_LABELS: Record<string, string> = { FullTime: "מלאה", PartialTime: "חלקית", Shifts: "משמרות", Freelance: "פרילנס", Temporary: "זמנית" };

export const jobStatusLabel = (v: string | null) => (v ? (JOB_STATUS_LABELS[v] ?? v) : "ללא סטטוס");
export const jobTimeLabel = (v: string | null) =>
  v
    ? v
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean)
        .map((t) => JOB_TIME_LABELS[t] ?? t)
        .join(", ")
    : null;

const COMPANY_NAME = companyNameOf();

const JOBS = sql`
  jobs AS (
    SELECT p.id, p.created_date, p.site_job_key, p.data->>'CaseNumber' AS case_number,
           ${sql.raw(COMPANY_NAME)} AS company_name,
           ${companyKeySql(COMPANY_NAME)} AS company_key,
           coalesce(nullif(p.data->>'Position_cambium__c', ''), nullif(p.data->>'Position_Name__c', ''), nullif(p.data->>'Subject', '')) AS title,
           nullif(p.data->>'PStatus__c', '') AS p_status,
           ${jobPaidSql("p")} AS paid,
           nullif(p.data->>'PLocation_cambium__c', '') AS location,
           nullif(p.data->>'PTime_cambium__c', '') AS job_time,
           nullif(p.data->>'PFullName_cambium__c', '') AS contact_name,
           lower(nullif(p.data->>'PEmail_cambium__c', '')) AS contact_email,
           nullif(p.data->>'PPhone_cambium__c', '') AS contact_phone,
           coalesce(p.data->>'isSelfApply_cambium__c', 'false') = 'true' AS self_apply
      FROM sf_case p
      JOIN sf_record_type rt ON rt.id = p.record_type_id
      LEFT JOIN sf_account acc ON acc.id = p.account_id
     WHERE rt.developer_name = ${RECORD_TYPES.position} AND NOT p.is_deleted
  ),
  job_apps AS (
    SELECT a.parent_id, count(*) AS n
      FROM sf_case a JOIN sf_record_type art ON art.id = a.record_type_id
     WHERE art.developer_name IN (${RECORD_TYPES.application}, ${RECORD_TYPES.accepted}) AND NOT a.is_deleted AND a.parent_id IS NOT NULL
     GROUP BY a.parent_id
  )`;

const COMPANIES = sql`
  WITH ${JOBS},
  companies AS (
    SELECT j.company_key AS key,
           (array_agg(j.company_name ORDER BY j.created_date DESC))[1] AS name,
           count(*) AS jobs,
           count(*) FILTER (WHERE j.p_status = 'Active') AS active_jobs,
           count(*) FILTER (WHERE j.paid) AS paid_jobs,
           count(*) FILTER (WHERE j.paid AND j.p_status = 'Active') AS paid_active_jobs,
           coalesce(sum(ja.n), 0) AS applications,
           min(j.created_date) AS first_job_at,
           max(j.created_date) AS last_job_at,
           (array_agg(j.contact_name ORDER BY j.created_date DESC) FILTER (WHERE j.contact_name IS NOT NULL))[1] AS contact_name,
           (array_agg(j.contact_email ORDER BY j.created_date DESC) FILTER (WHERE j.contact_email IS NOT NULL))[1] AS contact_email,
           (array_agg(j.contact_phone ORDER BY j.created_date DESC) FILTER (WHERE j.contact_phone IS NOT NULL))[1] AS contact_phone,
           array_remove(array_agg(DISTINCT j.location), NULL) AS locations
      FROM jobs j LEFT JOIN job_apps ja ON ja.parent_id = j.id
     WHERE j.company_key IS NOT NULL
     GROUP BY j.company_key
  )`;

export interface CompanyFilters {
  q: string;
  /** Include companies with no active job. */
  all: boolean;
  paid: "paid" | "";
  location: string;
  sort: "active" | "recent" | "applications" | "name" | "";
}

export interface CompanyRow {
  key: string;
  name: string;
  jobs: number;
  activeJobs: number;
  paidJobs: number;
  paidActiveJobs: number;
  applications: number;
  firstJobAt: Date | null;
  lastJobAt: Date | null;
  contactName: string | null;
  contactEmail: string | null;
  contactPhone: string | null;
  locations: string[];
}

function toCompany(r: Record<string, unknown>): CompanyRow {
  return {
    key: String(r.key),
    name: str(r.name) ?? String(r.key),
    jobs: num(r.jobs),
    activeJobs: num(r.active_jobs),
    paidJobs: num(r.paid_jobs),
    paidActiveJobs: num(r.paid_active_jobs),
    applications: num(r.applications),
    firstJobAt: asDate(r.first_job_at),
    lastJobAt: asDate(r.last_job_at),
    contactName: str(r.contact_name),
    contactEmail: str(r.contact_email),
    contactPhone: str(r.contact_phone),
    locations: Array.isArray(r.locations) ? (r.locations as string[]) : [],
  };
}

const ORDER: Record<Exclude<CompanyFilters["sort"], "">, SQL> = {
  active: sql`c.active_jobs DESC, c.last_job_at DESC`,
  recent: sql`c.last_job_at DESC`,
  applications: sql`c.applications DESC, c.last_job_at DESC`,
  name: sql`c.name ASC`,
};

export async function searchCompanies(
  f: CompanyFilters,
  { page = 1, pageSize = PAGE_SIZE }: { page?: number; pageSize?: number } = {},
): Promise<{ rows: CompanyRow[]; total: number; withoutActive: number }> {
  const parts: SQL[] = [sql`true`];
  if (!f.all) parts.push(sql`c.active_jobs > 0`);
  if (f.paid === "paid") parts.push(f.all ? sql`c.paid_jobs > 0` : sql`c.paid_active_jobs > 0`);
  if (f.q) {
    const p = containsPattern(f.q);
    parts.push(sql`(c.name ILIKE ${p} OR c.contact_name ILIKE ${p} OR c.contact_email ILIKE ${p} OR c.contact_phone ILIKE ${p})`);
  }
  if (f.location) parts.push(sql`EXISTS (SELECT 1 FROM unnest(c.locations) l WHERE l ILIKE ${containsPattern(f.location)})`);
  const where = sql.join(parts, sql` AND `);
  const order = ORDER[f.sort || "active"];

  const [rows, count] = await Promise.all([
    run(sql`${COMPANIES} SELECT c.* FROM companies c WHERE ${where} ORDER BY ${order} LIMIT ${pageSize} OFFSET ${(page - 1) * pageSize}`),
    // How many the "active only" default hides, so the page can offer to show them.
    run(sql`${COMPANIES} SELECT count(*) AS n, count(*) FILTER (WHERE c.active_jobs = 0) AS inactive FROM companies c
             WHERE ${sql.join(parts.filter((_, i) => f.all || i !== 1), sql` AND `)}`),
  ]);
  return { rows: rows.map(toCompany), total: f.all ? num(count[0]?.n) : num(count[0]?.n) - num(count[0]?.inactive), withoutActive: num(count[0]?.inactive) };
}

export interface CompanyJob {
  id: string;
  caseNumber: string | null;
  title: string | null;
  status: string | null;
  paid: boolean;
  location: string | null;
  time: string | null;
  selfApply: boolean;
  createdAt: Date | null;
  siteJobKey: string | null;
  applications: number;
  contactName: string | null;
  contactEmail: string | null;
}

export async function loadCompany(key: string): Promise<{ company: CompanyRow; jobs: CompanyJob[] } | null> {
  if (!key || key.length > 300) return null;
  const [rows, jobs] = await Promise.all([
    run(sql`${COMPANIES} SELECT c.* FROM companies c WHERE c.key = ${key}`),
    run(sql`WITH ${JOBS}
      SELECT j.*, coalesce(ja.n, 0) AS applications FROM jobs j LEFT JOIN job_apps ja ON ja.parent_id = j.id
       WHERE j.company_key = ${key}
       ORDER BY (j.p_status = 'Active') DESC NULLS LAST, j.created_date DESC`),
  ]);
  if (!rows[0]) return null;
  return {
    company: toCompany(rows[0]),
    jobs: jobs.map((r) => ({
      id: String(r.id),
      caseNumber: str(r.case_number),
      title: str(r.title),
      status: str(r.p_status),
      paid: isTrue(r.paid),
      location: str(r.location),
      time: jobTimeLabel(str(r.job_time)),
      selfApply: isTrue(r.self_apply),
      createdAt: asDate(r.created_date),
      siteJobKey: str(r.site_job_key),
      applications: num(r.applications),
      contactName: str(r.contact_name),
      contactEmail: str(r.contact_email),
    })),
  };
}

export interface JobDetails {
  companyName: string | null;
  companyKey: string | null;
  status: string | null;
  location: string | null;
  time: string | null;
  contactName: string | null;
  contactEmail: string | null;
  contactPhone: string | null;
  comments: string | null;
  description: string | null;
  selfApply: boolean;
  siteUpdatedAt: Date | null;
}

/** The job's own fields, as the site filled them. */
export async function loadJobDetails(id: string): Promise<JobDetails | null> {
  if (!isSfId(id)) return null;
  const [r] = await run(sql`
    SELECT ${sql.raw(COMPANY_NAME)} AS company_name, ${companyKeySql(COMPANY_NAME)} AS company_key,
           p.data->>'PStatus__c' AS p_status, p.data->>'PLocation_cambium__c' AS location, p.data->>'PTime_cambium__c' AS job_time,
           p.data->>'PFullName_cambium__c' AS contact_name, lower(p.data->>'PEmail_cambium__c') AS contact_email,
           p.data->>'PPhone_cambium__c' AS contact_phone, p.data->>'PComments_cambium__c' AS comments,
           p.data->>'PDescription_cambium__c' AS description, p.data->>'isSelfApply_cambium__c' AS self_apply,
           p.data->>'PModifiedDate_cambium__c' AS site_updated
      FROM sf_case p LEFT JOIN sf_account acc ON acc.id = p.account_id
     WHERE p.id = ${id}`);
  if (!r) return null;
  return {
    companyName: str(r.company_name),
    companyKey: str(r.company_key),
    status: str(r.p_status),
    location: str(r.location),
    time: jobTimeLabel(str(r.job_time)),
    contactName: str(r.contact_name),
    contactEmail: str(r.contact_email),
    contactPhone: str(r.contact_phone),
    comments: str(r.comments),
    description: htmlToText(str(r.description)),
    selfApply: isTrue(r.self_apply),
    siteUpdatedAt: asDate(r.site_updated),
  };
}

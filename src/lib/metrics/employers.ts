import { sql } from "drizzle-orm";
import { cached } from "@/lib/cache";
import { getDb } from "@/lib/db/client";
import { CALL_PARTY, normStatus, RECORD_TYPES, stats, type Stats } from "./candidates";
import { companyKeySql, employerEmailsSql } from "./company";
import { jobPaidSql } from "./paid";

/**
 * Employers tab. Definitions live in docs/employers-tab-metrics.md.
 *
 * An employer lead is a Case of record type `lead_employer`; its Account is the
 * employer. The lead's pipeline is its Status, whose history Salesforce keeps, so
 * every stage carries the date it was first reached. The employer's jobs are the
 * Position Cases on the same Account, and a job is live on the site while
 * `PStatus__c` is "Active".
 */

export const LEAD_RECORD_TYPE = "lead_employer";

export const LEAD_STATUS = {
  first: normStatus("פנייה ראשונה")!,
  second: normStatus("פנייה שנייה")!,
  third: normStatus("פנייה שלישית")!,
  contractSent: normStatus("תשובה חיובית נשלח חוזה")!,
  later: normStatus("לפנות בהמשך")!,
  signed: normStatus("נחתם חוזה")!,
  negative: normStatus("תשובה שלילית")!,
  noAnswer: normStatus("אין תשובה")!,
};

/** `PStatus__c` of a job that is live on the site. */
export const ACTIVE_JOB_STATUS = "Active";

export const NO_TOUCH_DAYS = 30;

const DAY = 86_400_000;

/** Same whitespace folding as normStatus, in SQL. `col` is a column written in code. */
const norm = (col: string) => sql.raw(`btrim(regexp_replace(replace(${col}, chr(160), ' '), ' +', ' ', 'g'))`);

/** A logged call on the Task aliased `t`. */
const isCall = sql.raw(`(t.task_subtype = 'Call' OR t.type ILIKE 'call%')`);

// Site jobs share one Account, so a job finds its employer by company name (see ./company.ts).
const companyKey = companyKeySql;
const employerEmails = employerEmailsSql;

type Row = Record<string, unknown>;
const run = async <T extends Row>(query: ReturnType<typeof sql>) => (await getDb().execute<T>(query)).rows as T[];
const num = (v: unknown) => Number(v ?? 0);
const str = (v: unknown) => (typeof v === "string" && v !== "" ? v : null);
const asDate = (v: unknown) => (v == null ? null : v instanceof Date ? v : new Date(String(v)));

/* ------------------------------------------------------------------ leads */

export interface LeadFacts {
  id: string;
  caseNumber: string | null;
  accountId: string | null;
  accountName: string | null;
  ownerName: string | null;
  status: string | null;
  createdAt: Date;
  firstAt: Date | null;
  secondAt: Date | null;
  thirdAt: Date | null;
  contractSentAt: Date | null;
  signedAt: Date | null;
  negativeAt: Date | null;
  noAnswerAt: Date | null;
  laterAt: Date | null;
  /** The employer's earliest lead: where "days from first lead to signing" starts. */
  firstLeadAt: Date;
  /** Outgoing emails and logged calls on the lead, up to the signing (or up to now). */
  emails: number;
  calls: number;
}

/** Cached briefly (see lib/cache.ts). */
export function loadLeadFacts(): Promise<LeadFacts[]> {
  return cached("lead-facts", queryLeadFacts);
}

async function queryLeadFacts(): Promise<LeadFacts[]> {
  // A stage counts from its first appearance in the status history; a lead that
  // sits in a stage with no history for it (created straight into it) reached it when created.
  const reached = (key: keyof typeof LEAD_STATUS) =>
    sql`coalesce(min(h.created_date) FILTER (WHERE ${norm("h.new_value")} = ${LEAD_STATUS[key]}),
                 CASE WHEN ${norm("l.status")} = ${LEAD_STATUS[key]} THEN l.created_date END)`;

  const rows = await run(sql`
    WITH leads AS (
      SELECT c.id, c.account_id, c.owner_id, c.status, c.created_date, c.data->>'CaseNumber' AS case_number
        FROM sf_case c JOIN sf_record_type rt ON rt.id = c.record_type_id
       WHERE rt.developer_name = ${LEAD_RECORD_TYPE} AND NOT c.is_deleted
    ),
    lf AS (
      SELECT l.id, l.account_id, l.owner_id, l.status, l.created_date, l.case_number,
             ${reached("first")} AS first_at,
             ${reached("second")} AS second_at,
             ${reached("third")} AS third_at,
             ${reached("contractSent")} AS contract_sent_at,
             ${reached("signed")} AS signed_at,
             ${reached("negative")} AS negative_at,
             ${reached("noAnswer")} AS no_answer_at,
             ${reached("later")} AS later_at
        FROM leads l
        LEFT JOIN sf_case_history h ON h.case_id = l.id AND h.field = 'Status'
       GROUP BY l.id, l.account_id, l.owner_id, l.status, l.created_date, l.case_number
    )
    SELECT lf.*, acc.name AS account_name, u.name AS owner_name,
           min(lf.created_date) OVER (PARTITION BY coalesce(lf.account_id, lf.id)) AS first_lead_at,
           (SELECT count(*) FROM sf_email_message e
             WHERE e.parent_id = lf.id AND NOT e.incoming AND NOT e.is_deleted
               AND e.message_date <= coalesce(lf.signed_at, now()))::int AS emails,
           (SELECT count(*) FROM sf_task t
             WHERE t.what_id = lf.id AND NOT t.is_deleted AND ${isCall}
               AND coalesce(t.completed_at, t.created_date) <= coalesce(lf.signed_at, now()))::int AS calls
      FROM lf
      LEFT JOIN sf_account acc ON acc.id = lf.account_id
      LEFT JOIN sf_user u ON u.id = lf.owner_id`);

  return rows.map((r) => ({
    id: String(r.id),
    caseNumber: str(r.case_number),
    accountId: str(r.account_id),
    accountName: str(r.account_name),
    ownerName: str(r.owner_name),
    status: normStatus(str(r.status)),
    createdAt: asDate(r.created_date)!,
    firstAt: asDate(r.first_at),
    secondAt: asDate(r.second_at),
    thirdAt: asDate(r.third_at),
    contractSentAt: asDate(r.contract_sent_at),
    signedAt: asDate(r.signed_at),
    negativeAt: asDate(r.negative_at),
    noAnswerAt: asDate(r.no_answer_at),
    laterAt: asDate(r.later_at),
    firstLeadAt: asDate(r.first_lead_at)!,
    emails: num(r.emails),
    calls: num(r.calls),
  }));
}

export interface LeadMetrics {
  newLeads: number;
  /** Leads created in the range that ever reached each stage. */
  stages: Record<keyof typeof LEAD_STATUS, number>;
  currentStatus: { status: string; count: number }[];
  /** Leads whose contract was signed in the range. */
  signed: LeadFacts[];
  touchesToSign: Stats;
  touchMix: { emails: number | null; calls: number | null };
  daysToSign: Stats;
}

const inRange = (d: Date | null, from: Date, to: Date): d is Date => d !== null && d >= from && d < to;
const mean = (v: number[]) => (v.length ? v.reduce((s, x) => s + x, 0) / v.length : null);

export function computeLeadMetrics(leads: LeadFacts[], from: Date, to: Date): LeadMetrics {
  const cohort = leads.filter((l) => inRange(l.createdAt, from, to));
  const at: Record<keyof typeof LEAD_STATUS, (l: LeadFacts) => Date | null> = {
    first: (l) => l.firstAt,
    second: (l) => l.secondAt,
    third: (l) => l.thirdAt,
    contractSent: (l) => l.contractSentAt,
    later: (l) => l.laterAt,
    signed: (l) => l.signedAt,
    negative: (l) => l.negativeAt,
    noAnswer: (l) => l.noAnswerAt,
  };
  const stages = Object.fromEntries(
    (Object.keys(at) as (keyof typeof LEAD_STATUS)[]).map((k) => [k, cohort.filter((l) => at[k](l)).length]),
  ) as Record<keyof typeof LEAD_STATUS, number>;

  const current = new Map<string, number>();
  for (const l of cohort) current.set(l.status ?? "ללא סטטוס", (current.get(l.status ?? "ללא סטטוס") ?? 0) + 1);

  const signed = leads.filter((l) => inRange(l.signedAt, from, to));
  return {
    newLeads: cohort.length,
    stages,
    currentStatus: [...current.entries()].map(([status, count]) => ({ status, count })).sort((a, b) => b.count - a.count),
    signed,
    touchesToSign: stats(signed.map((l) => l.emails + l.calls)),
    touchMix: { emails: mean(signed.map((l) => l.emails)), calls: mean(signed.map((l) => l.calls)) },
    daysToSign: stats(signed.map((l) => (l.signedAt!.getTime() - l.firstLeadAt.getTime()) / DAY)),
  };
}

/* ------------------------------------------------------- signed employers */

export interface SignedEmployer {
  accountId: string;
  name: string | null;
  leadId: string;
  ownerName: string | null;
  signedAt: Date;
  jobsSinceSigned: number;
  paidJobsSinceSigned: number;
  activeJobs: number;
  paidActiveJobs: number;
  /** Latest call or outgoing email with the employer, on any of its Cases. */
  lastTouchAt: Date | null;
}

/** Every employer with a signed contract, as of now. */
export async function loadSignedEmployers(): Promise<SignedEmployer[]> {
  const rows = await run(sql`
    WITH signed AS (
      SELECT DISTINCT ON (c.account_id) c.account_id, c.id AS lead_id, c.owner_id, s.signed_at
        FROM sf_case c
        JOIN sf_record_type rt ON rt.id = c.record_type_id
        JOIN LATERAL (
          SELECT coalesce(
                   (SELECT min(h.created_date) FROM sf_case_history h
                     WHERE h.case_id = c.id AND h.field = 'Status' AND ${norm("h.new_value")} = ${LEAD_STATUS.signed}),
                   CASE WHEN ${norm("c.status")} = ${LEAD_STATUS.signed} THEN c.created_date END) AS signed_at
        ) s ON true
       WHERE rt.developer_name = ${LEAD_RECORD_TYPE} AND NOT c.is_deleted AND c.account_id IS NOT NULL AND s.signed_at IS NOT NULL
       ORDER BY c.account_id, s.signed_at
    ),
    signed_keys AS (
      SELECT s.account_id, ${companyKey("acc.name")} AS company_key
        FROM signed s JOIN sf_account acc ON acc.id = s.account_id
    ),
    jobs AS (
      SELECT p.id, k.account_id, p.created_date,
             ${jobPaidSql("p")} AS paid,
             coalesce((p.data->>'PStatus__c') = ${ACTIVE_JOB_STATUS}, false) AS active,
             ${employerEmails("p")} AS employer_emails
        FROM sf_case p
        JOIN sf_record_type rt ON rt.id = p.record_type_id
        -- The employer's own Account, or, for a site job under the shared Account, the same company name.
        JOIN signed_keys k
          ON k.account_id = p.account_id
          OR (k.company_key IS NOT NULL AND k.company_key = ${companyKey("p.data->>'company_cambium__c'")})
       WHERE rt.developer_name = ${RECORD_TYPES.position} AND NOT p.is_deleted
    ),
    lead_cases AS (
      SELECT c.id, c.account_id FROM sf_case c JOIN sf_record_type rt ON rt.id = c.record_type_id
       WHERE rt.developer_name = ${LEAD_RECORD_TYPE} AND NOT c.is_deleted AND c.account_id IN (SELECT account_id FROM signed)
    ),
    touches AS (
      -- On the employer's leads and jobs: every call and outgoing email.
      SELECT c.account_id, e.message_date AS at
        FROM sf_email_message e JOIN (SELECT id, account_id FROM lead_cases UNION ALL SELECT id, account_id FROM jobs) c ON c.id = e.parent_id
       WHERE NOT e.incoming AND NOT e.is_deleted
      UNION ALL
      SELECT c.account_id, coalesce(t.completed_at, t.created_date)
        FROM sf_task t JOIN (SELECT id, account_id FROM lead_cases UNION ALL SELECT id, account_id FROM jobs) c ON c.id = t.what_id
       WHERE NOT t.is_deleted AND ${isCall}
      UNION ALL
      -- On applications to its jobs: only what went to the employer, not to the candidate.
      SELECT j.account_id, e.message_date
        FROM sf_email_message e JOIN sf_case a ON a.id = e.parent_id JOIN jobs j ON j.id = a.parent_id
       WHERE NOT e.incoming AND NOT e.is_deleted
         AND EXISTS (SELECT 1 FROM unnest(j.employer_emails) addr WHERE strpos(e.to_address, addr) > 0)
      UNION ALL
      SELECT j.account_id, coalesce(t.completed_at, t.created_date)
        FROM sf_task t JOIN sf_case a ON a.id = t.what_id JOIN jobs j ON j.id = a.parent_id
       WHERE NOT t.is_deleted AND ${isCall} AND btrim(t.call_party) = ${CALL_PARTY.employer}
    )
    SELECT s.account_id, acc.name, s.lead_id, u.name AS owner_name, s.signed_at,
           (SELECT count(*) FROM jobs j WHERE j.account_id = s.account_id AND j.created_date >= s.signed_at)::int AS jobs_since,
           (SELECT count(*) FROM jobs j WHERE j.account_id = s.account_id AND j.created_date >= s.signed_at AND j.paid)::int AS paid_jobs_since,
           (SELECT count(*) FROM jobs j WHERE j.account_id = s.account_id AND j.active)::int AS active_jobs,
           (SELECT count(*) FROM jobs j WHERE j.account_id = s.account_id AND j.active AND j.paid)::int AS paid_active_jobs,
           (SELECT max(x.at) FROM touches x WHERE x.account_id = s.account_id) AS last_touch_at
      FROM signed s
      LEFT JOIN sf_account acc ON acc.id = s.account_id
      LEFT JOIN sf_user u ON u.id = s.owner_id
     ORDER BY s.signed_at DESC`);

  return rows.map((r) => ({
    accountId: String(r.account_id),
    name: str(r.name),
    leadId: String(r.lead_id),
    ownerName: str(r.owner_name),
    signedAt: asDate(r.signed_at)!,
    jobsSinceSigned: num(r.jobs_since),
    paidJobsSinceSigned: num(r.paid_jobs_since),
    activeJobs: num(r.active_jobs),
    paidActiveJobs: num(r.paid_active_jobs),
    lastTouchAt: asDate(r.last_touch_at),
  }));
}

/**
 * Jobs per employer among all employers that opened jobs in the range: all jobs, and paid ones.
 * An employer is the job's company name, or its Account when the name is missing.
 */
export async function loadJobsPerEmployer(from: Date, to: Date): Promise<{ employers: number; jobs: number; paidEmployers: number; paidJobs: number }> {
  const [r] = await run(sql`
    SELECT count(DISTINCT e.employer) AS employers, count(*) AS jobs,
           count(DISTINCT e.employer) FILTER (WHERE e.paid) AS paid_employers,
           count(*) FILTER (WHERE e.paid) AS paid_jobs
      FROM (
        SELECT coalesce(${companyKey("p.data->>'company_cambium__c'")}, p.account_id) AS employer, ${jobPaidSql("p")} AS paid
          FROM sf_case p JOIN sf_record_type rt ON rt.id = p.record_type_id
         WHERE rt.developer_name = ${RECORD_TYPES.position} AND NOT p.is_deleted
           AND p.created_date >= ${from} AND p.created_date < ${to}
      ) e
     WHERE e.employer IS NOT NULL`);
  return { employers: num(r?.employers), jobs: num(r?.jobs), paidEmployers: num(r?.paid_employers), paidJobs: num(r?.paid_jobs) };
}

/* --------------------------------------------------------- active jobs */

export type ActivityKind = "call" | "email" | "task";

export interface JobActivity {
  at: Date;
  kind: ActivityKind;
  /** Logged on one of the job's applications (with the employer), not on the job itself. */
  onApplication: boolean;
}

/**
 * The last contact with the employer about each job: any activity logged on the
 * job, or an email or call with the employer on one of its applications (to or
 * from the job's contact address, or a call marked "מעסיק").
 * Without `ids`, every active job.
 */
export async function loadJobActivity(ids?: string[]): Promise<Map<string, JobActivity>> {
  if (ids && !ids.length) return new Map();
  const which = ids ? sql`p.id IN ${ids}` : sql`(p.data->>'PStatus__c') = ${ACTIVE_JOB_STATUS}`;
  const rows = await run(sql`
    SELECT p.id, la.at, la.kind, la.on_application
      FROM sf_case p
      JOIN sf_record_type rt ON rt.id = p.record_type_id
      JOIN LATERAL (
        SELECT x.at, x.kind, x.on_application FROM (
          SELECT e.message_date AS at, 'email' AS kind, false AS on_application
            FROM sf_email_message e WHERE e.parent_id = p.id AND NOT e.is_deleted
          UNION ALL
          SELECT coalesce(t.completed_at, t.created_date),
                 CASE WHEN ${isCall} THEN 'call' WHEN t.task_subtype = 'Email' THEN 'email' ELSE 'task' END,
                 false
            FROM sf_task t WHERE t.what_id = p.id AND NOT t.is_deleted
          UNION ALL
          SELECT e.message_date, 'email', true
            FROM sf_case a JOIN sf_email_message e ON e.parent_id = a.id
           WHERE a.parent_id = p.id AND NOT a.is_deleted AND NOT e.is_deleted
             AND EXISTS (
               SELECT 1 FROM unnest(${employerEmails("p")}) addr
                WHERE strpos(CASE WHEN e.incoming THEN e.from_address ELSE e.to_address END, addr) > 0
             )
          UNION ALL
          SELECT coalesce(t.completed_at, t.created_date), 'call', true
            FROM sf_case a JOIN sf_task t ON t.what_id = a.id
           WHERE a.parent_id = p.id AND NOT a.is_deleted AND NOT t.is_deleted AND ${isCall}
             AND btrim(t.call_party) = ${CALL_PARTY.employer}
        ) x WHERE x.at IS NOT NULL ORDER BY x.at DESC LIMIT 1
      ) la ON true
     WHERE rt.developer_name = ${RECORD_TYPES.position} AND NOT p.is_deleted AND ${which}`);
  return new Map(
    rows.map((r) => [String(r.id), { at: asDate(r.at)!, kind: String(r.kind) as ActivityKind, onApplication: r.on_application === true }]),
  );
}

export const daysSince = (d: Date | null, now = new Date()) => (d ? Math.floor((now.getTime() - d.getTime()) / DAY) : null);

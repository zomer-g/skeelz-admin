import { sql } from "drizzle-orm";
import type { DashboardParams } from "@/lib/dashboard/params";
import { getDb } from "@/lib/db/client";
import { RECORD_TYPES } from "./candidates";
import { applicationPaidSql, paidJobKeysSql } from "./paid";

/**
 * Marketing tab: the site's macro picture from the GA4 mirror.
 *
 * Only additive measures are summed across days and rows — sessions, new users,
 * engaged sessions, page views and event counts. Unique active users are not,
 * since a person active on several days would be counted once per day.
 *
 * The paid scope narrows everything that belongs to a job: Salesforce
 * applications, and the GA job events (opens, apply clicks, confirmations) by
 * the job's public key. Site-wide traffic (sessions, users, sign-ups) has no job
 * and is the same in both scopes.
 */

/** GA events that happen on a job, and so can be told paid from unpaid by the job key. */
const JOB_EVENT_NAMES = new Set<string>(["open_job_page", "Job_application_click_1", "Job_application_yes"]);

export const SITE_EVENTS = {
  openJob: "open_job_page",
  applyClick: "Job_application_click_1",
  applyYes: "Job_application_yes",
  signUpClick: "sign_up_click1",
  signUpFirst: "sign_up_first_phase_complete",
  signUpSecond: "sign_up_second_phase_complete",
  login: "login_main_page",
  search: "search&filter",
  skillsFilter: "skiils_filter",
  jobTypeFilter: "job_type_filter",
} as const;

export const CHANNEL_LABELS: Record<string, string> = {
  Direct: "ישיר",
  "Organic Search": "חיפוש אורגני",
  "Paid Search": "חיפוש ממומן",
  "Organic Social": "רשתות חברתיות",
  "Paid Social": "רשתות חברתיות בתשלום",
  Referral: "הפניות מאתרים",
  Email: "מייל",
  SMS: "SMS",
  Display: "באנרים",
  "Organic Video": "וידאו",
  "Paid Video": "וידאו בתשלום",
  "Cross-network": "קמפיינים משולבים",
  Unassigned: "לא משויך",
};

export interface MarketingMetrics {
  sessions: number;
  newUsers: number;
  engagedSessions: number;
  pageViews: number;
  dailySessions: Map<string, number>;
  channels: { channel: string; sessions: number; newUsers: number; engaged: number }[];
  sources: { source: string; medium: string; sessions: number; newUsers: number; engaged: number }[];
  events: Map<string, number>;
  topPages: { path: string; views: number }[];
  jobPages: { jobs: number; views: number };
  /** Salesforce applications created in the range, in the selected scope. */
  applications: number;
  /** Applications created in the range and job opens that carry a job key: all, and paid. Independent of the scope. */
  split: { applications: { all: number; paid: number }; jobOpens: { all: number; paid: number } };
  gaSyncedAt: Date | null;
  /** Salesforce: accounts that hold candidates (name contains "מועמד"). */
  candidateAccounts: { account: string; contacts: number; newInRange: number; applicants: number }[];
  /** Distinct contacts with an application created in the range, whatever their account. */
  applicantsTotal: number;
  /** Salesforce applications created per Israel day. */
  dailyApplications: Map<string, number>;
  /** GA "Job_application_yes" (the apply confirmation) per day. */
  dailyApplyConfirmations: Map<string, number>;
}

/** Accounts whose contacts are candidates are named with "מועמד". */
export const CANDIDATE_ACCOUNT_PATTERN = "%מועמד%";

type Row = Record<string, unknown>;

async function rows<T extends Row>(query: ReturnType<typeof sql>): Promise<T[]> {
  return (await getDb().execute<T>(query)).rows as T[];
}

const n = (v: unknown) => Number(v ?? 0);

export async function loadMarketingMetrics(p: DashboardParams): Promise<MarketingMetrics> {
  const inDays = (column: string) => sql`${sql.raw(column)} >= ${p.fromDay}::date AND ${sql.raw(column)} <= ${p.toDay}::date`;
  const paidOnly = p.scope === "paid";
  // Applications with their job, so the paid test can fall back to the job's own flag.
  const apps = sql`sf_case a JOIN sf_record_type rt ON rt.id = a.record_type_id LEFT JOIN sf_case aj ON aj.id = a.parent_id`;
  const appsInRange = sql`
    rt.developer_name IN (${RECORD_TYPES.application}, ${RECORD_TYPES.accepted})
    AND NOT a.is_deleted AND a.created_date >= ${p.from} AND a.created_date < ${p.to}`;
  const appScope = paidOnly ? sql`AND ${applicationPaidSql("a", "aj")}` : sql.raw("");
  const keyScope = paidOnly ? sql`AND site_job_key IN (${paidJobKeysSql})` : sql.raw("");

  const appliedInRange = sql`
    SELECT DISTINCT a.contact_id FROM ${apps}
     WHERE ${appsInRange} AND a.contact_id IS NOT NULL ${appScope}`;

  const [sfAccounts, sfApplicants, sfDaily, gaApplyDaily] = await Promise.all([
    rows(sql`
      WITH acc AS (SELECT id, name FROM sf_account WHERE NOT is_deleted AND name ILIKE ${CANDIDATE_ACCOUNT_PATTERN}),
           applied AS (${appliedInRange})
      SELECT acc.name,
             count(c.id) AS contacts,
             count(c.id) FILTER (WHERE c.created_date >= ${p.from} AND c.created_date < ${p.to}) AS new_in_range,
             count(c.id) FILTER (WHERE c.id IN (SELECT contact_id FROM applied)) AS applicants
        FROM acc JOIN sf_contact c ON c.account_id = acc.id AND NOT c.is_deleted
       GROUP BY acc.name ORDER BY 2 DESC`),
    rows(sql`SELECT count(*) AS n FROM (${appliedInRange}) x`),
    rows(sql`
      SELECT to_char(a.created_date AT TIME ZONE 'Asia/Jerusalem', 'YYYY-MM-DD') AS day, count(*) AS n
        FROM ${apps}
       WHERE ${appsInRange} ${appScope}
       GROUP BY 1`),
    rows(sql`
      SELECT date::text AS day, sum(event_count) AS n FROM ga_event_daily
       WHERE ${inDays("date")} AND event_name = ${SITE_EVENTS.applyYes} ${keyScope} GROUP BY 1`),
  ]);

  const [totals, pages, series, channels, sources, events, topPages, jobPages, appCounts, state] = await Promise.all([
    rows(sql`SELECT sum(sessions) AS sessions, sum(new_users) AS new_users, sum(engaged_sessions) AS engaged FROM ga_channel_daily WHERE ${inDays("date")}`),
    rows(sql`SELECT sum(views) AS views FROM ga_page_daily WHERE ${inDays("date")}`),
    rows(sql`SELECT date::text AS day, sum(sessions) AS sessions FROM ga_channel_daily WHERE ${inDays("date")} GROUP BY 1`),
    rows(sql`
      SELECT channel_group, sum(sessions) AS sessions, sum(new_users) AS new_users, sum(engaged_sessions) AS engaged
        FROM ga_channel_daily WHERE ${inDays("date")} GROUP BY 1 ORDER BY 2 DESC`),
    rows(sql`
      SELECT source, medium, sum(sessions) AS sessions, sum(new_users) AS new_users, sum(engaged_sessions) AS engaged
        FROM ga_channel_daily WHERE ${inDays("date")} GROUP BY 1, 2 ORDER BY 3 DESC LIMIT 12`),
    rows(sql`
      SELECT event_name, sum(event_count) AS n,
             sum(event_count) FILTER (WHERE site_job_key IS NOT NULL) AS keyed,
             sum(event_count) FILTER (WHERE site_job_key IN (${paidJobKeysSql})) AS paid
        FROM ga_event_daily WHERE ${inDays("date")} GROUP BY 1`),
    rows(sql`
      SELECT page_path, sum(views) AS views FROM ga_page_daily
       WHERE ${inDays("date")} AND site_job_key IS NULL GROUP BY 1 ORDER BY 2 DESC LIMIT 10`),
    rows(sql`
      SELECT count(DISTINCT site_job_key) AS jobs, sum(views) AS views FROM ga_page_daily
       WHERE ${inDays("date")} AND site_job_key IS NOT NULL ${keyScope}`),
    rows(sql`
      SELECT count(*) AS n, count(*) FILTER (WHERE ${applicationPaidSql("a", "aj")}) AS paid
        FROM ${apps} WHERE ${appsInRange}`),
    rows(sql`SELECT last_success_at FROM sync_state WHERE object = 'GA4'`),
  ]);

  const syncedAt = state[0]?.last_success_at;
  const openRow = events.find((r) => r.event_name === SITE_EVENTS.openJob);
  const applications = { all: n(appCounts[0]?.n), paid: n(appCounts[0]?.paid) };
  return {
    sessions: n(totals[0]?.sessions),
    newUsers: n(totals[0]?.new_users),
    engagedSessions: n(totals[0]?.engaged),
    pageViews: n(pages[0]?.views),
    dailySessions: new Map(series.map((r) => [String(r.day), n(r.sessions)])),
    channels: channels.map((r) => ({ channel: String(r.channel_group), sessions: n(r.sessions), newUsers: n(r.new_users), engaged: n(r.engaged) })),
    sources: sources.map((r) => ({
      source: String(r.source),
      medium: String(r.medium),
      sessions: n(r.sessions),
      newUsers: n(r.new_users),
      engaged: n(r.engaged),
    })),
    events: new Map(events.map((r) => [String(r.event_name), n(paidOnly && JOB_EVENT_NAMES.has(String(r.event_name)) ? r.paid : r.n)])),
    topPages: topPages.map((r) => ({ path: String(r.page_path), views: n(r.views) })),
    jobPages: { jobs: n(jobPages[0]?.jobs), views: n(jobPages[0]?.views) },
    applications: paidOnly ? applications.paid : applications.all,
    split: { applications, jobOpens: { all: n(openRow?.keyed), paid: n(openRow?.paid) } },
    gaSyncedAt: syncedAt ? new Date(syncedAt as string | Date) : null,
    candidateAccounts: sfAccounts.map((r) => ({
      account: String(r.name),
      contacts: n(r.contacts),
      newInRange: n(r.new_in_range),
      applicants: n(r.applicants),
    })),
    applicantsTotal: n(sfApplicants[0]?.n),
    dailyApplications: new Map(sfDaily.map((r) => [String(r.day), n(r.n)])),
    dailyApplyConfirmations: new Map(gaApplyDaily.map((r) => [String(r.day), n(r.n)])),
  };
}

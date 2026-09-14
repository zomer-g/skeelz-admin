import { sql } from "drizzle-orm";
import type { DashboardParams } from "@/lib/dashboard/params";
import { getDb } from "@/lib/db/client";
import { RECORD_TYPES } from "./candidates";

/**
 * Marketing tab: the site's macro picture from the GA4 mirror.
 *
 * Only additive measures are summed across days and rows — sessions, new users,
 * engaged sessions, page views and event counts. Unique active users are not,
 * since a person active on several days would be counted once per day.
 */

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
  applications: number;
  gaSyncedAt: Date | null;
}

type Row = Record<string, unknown>;

async function rows<T extends Row>(query: ReturnType<typeof sql>): Promise<T[]> {
  return (await getDb().execute<T>(query)).rows as T[];
}

const n = (v: unknown) => Number(v ?? 0);

export async function loadMarketingMetrics(p: DashboardParams): Promise<MarketingMetrics> {
  const inDays = (column: string) => sql`${sql.raw(column)} >= ${p.fromDay}::date AND ${sql.raw(column)} <= ${p.toDay}::date`;

  const [totals, pages, series, channels, sources, events, topPages, jobPages, apps, state] = await Promise.all([
    rows(sql`SELECT sum(sessions) AS sessions, sum(new_users) AS new_users, sum(engaged_sessions) AS engaged FROM ga_channel_daily WHERE ${inDays("date")}`),
    rows(sql`SELECT sum(views) AS views FROM ga_page_daily WHERE ${inDays("date")}`),
    rows(sql`SELECT date::text AS day, sum(sessions) AS sessions FROM ga_channel_daily WHERE ${inDays("date")} GROUP BY 1`),
    rows(sql`
      SELECT channel_group, sum(sessions) AS sessions, sum(new_users) AS new_users, sum(engaged_sessions) AS engaged
        FROM ga_channel_daily WHERE ${inDays("date")} GROUP BY 1 ORDER BY 2 DESC`),
    rows(sql`
      SELECT source, medium, sum(sessions) AS sessions, sum(new_users) AS new_users, sum(engaged_sessions) AS engaged
        FROM ga_channel_daily WHERE ${inDays("date")} GROUP BY 1, 2 ORDER BY 3 DESC LIMIT 12`),
    rows(sql`SELECT event_name, sum(event_count) AS n FROM ga_event_daily WHERE ${inDays("date")} GROUP BY 1`),
    rows(sql`
      SELECT page_path, sum(views) AS views FROM ga_page_daily
       WHERE ${inDays("date")} AND site_job_key IS NULL GROUP BY 1 ORDER BY 2 DESC LIMIT 10`),
    rows(sql`
      SELECT count(DISTINCT site_job_key) AS jobs, sum(views) AS views FROM ga_page_daily
       WHERE ${inDays("date")} AND site_job_key IS NOT NULL`),
    rows(sql`
      SELECT count(*) AS n FROM sf_case c JOIN sf_record_type rt ON rt.id = c.record_type_id
       WHERE rt.developer_name IN (${RECORD_TYPES.application}, ${RECORD_TYPES.accepted})
         AND NOT c.is_deleted AND c.created_date >= ${p.from} AND c.created_date < ${p.to}`),
    rows(sql`SELECT last_success_at FROM sync_state WHERE object = 'GA4'`),
  ]);

  const syncedAt = state[0]?.last_success_at;
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
    events: new Map(events.map((r) => [String(r.event_name), n(r.n)])),
    topPages: topPages.map((r) => ({ path: String(r.page_path), views: n(r.views) })),
    jobPages: { jobs: n(jobPages[0]?.jobs), views: n(jobPages[0]?.views) },
    applications: n(apps[0]?.n),
    gaSyncedAt: syncedAt ? new Date(syncedAt as string | Date) : null,
  };
}

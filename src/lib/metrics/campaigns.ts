import { sql } from "drizzle-orm";
import { addDays, israelDay } from "@/lib/dashboard/params";
import { getDb } from "@/lib/db/client";
import { NON_CAMPAIGNS } from "@/lib/integrations/marketing-sync";
import type { ApplicationFacts } from "./candidates";
import { JOB_EVENTS, type Position } from "./jobs";

/**
 * Campaigns come from GA4's UTM campaign names — every tagged mailing shows up
 * on its own. Editors add what GA cannot know: a display name, the SMOOV
 * campaign id, a corrected send day, and the jobs the campaign promoted.
 *
 * The send day defaults to the campaign's busiest day. The impact on a linked
 * job compares the IMPACT_DAYS from the send day with the same number of days
 * before it.
 */

export const MAILING_MEDIUMS = ["sms", "email", "whatsapp"];
export const IMPACT_DAYS = 7;

export interface CampaignSummary {
  key: string;
  label: string | null;
  medium: string;
  sessions: number;
  newUsers: number;
  engaged: number;
  firstDay: string;
  lastDay: string;
  sendDay: string;
  detectedSendDay: string;
  opens: number;
  applyClicks: number;
  applyYes: number;
  smoovCampaignId: number | null;
  linkedJobs: number;
}

type Row = Record<string, unknown>;
const run = async <T extends Row>(query: ReturnType<typeof sql>) => (await getDb().execute<T>(query)).rows as T[];
const num = (v: unknown) => Number(v ?? 0);
const str = (v: unknown) => (v == null ? null : String(v));

export const isMailing = (c: Pick<CampaignSummary, "medium" | "smoovCampaignId">) =>
  MAILING_MEDIUMS.includes(c.medium.toLowerCase()) || c.smoovCampaignId !== null;

export const campaignLabel = (c: Pick<CampaignSummary, "key" | "label">) => c.label || c.key;

/** Campaigns with sessions in the inclusive day range; `key` narrows to one. */
export async function loadCampaignSummaries(fromDay: string, toDay: string, key?: string): Promise<CampaignSummary[]> {
  const keyFilter = key ? sql`AND campaign = ${key}` : sql.raw("");
  const rows = await run(sql`
    WITH d AS (
      SELECT campaign, date, sum(sessions) AS s, sum(new_users) AS nu, sum(engaged_sessions) AS es
        FROM ga_campaign_daily
       WHERE date >= ${fromDay}::date AND date <= ${toDay}::date AND campaign NOT IN ${NON_CAMPAIGNS} ${keyFilter}
       GROUP BY campaign, date
    ),
    tot AS (
      SELECT campaign, sum(s) AS sessions, sum(nu) AS new_users, sum(es) AS engaged, min(date) AS first_day, max(date) AS last_day
        FROM d GROUP BY campaign
    ),
    peak AS (SELECT DISTINCT ON (campaign) campaign, date AS peak_day FROM d ORDER BY campaign, s DESC, date),
    med AS (
      SELECT DISTINCT ON (campaign) campaign, medium
        FROM (SELECT campaign, medium, sum(sessions) AS s FROM ga_campaign_daily
               WHERE date >= ${fromDay}::date AND date <= ${toDay}::date ${keyFilter} GROUP BY 1, 2) x
       ORDER BY campaign, s DESC
    ),
    ev AS (
      SELECT campaign,
             sum(event_count) FILTER (WHERE event_name = ${JOB_EVENTS.opens}) AS opens,
             sum(event_count) FILTER (WHERE event_name = ${JOB_EVENTS.applyClicks}) AS apply_clicks,
             sum(event_count) FILTER (WHERE event_name = ${JOB_EVENTS.applyYes}) AS apply_yes
        FROM ga_campaign_event_daily
       WHERE date >= ${fromDay}::date AND date <= ${toDay}::date ${keyFilter}
       GROUP BY campaign
    ),
    links AS (SELECT campaign_key, count(*) AS n FROM campaign_jobs GROUP BY 1)
    SELECT tot.campaign, tot.sessions, tot.new_users, tot.engaged, tot.first_day::text AS first_day, tot.last_day::text AS last_day,
           peak.peak_day::text AS peak_day, med.medium, ev.opens, ev.apply_clicks, ev.apply_yes,
           cs.label, cs.smoov_campaign_id, cs.send_day::text AS send_day, links.n AS linked_jobs
      FROM tot
      JOIN peak USING (campaign)
      JOIN med USING (campaign)
      LEFT JOIN ev USING (campaign)
      LEFT JOIN campaign_settings cs ON cs.campaign_key = tot.campaign
      LEFT JOIN links ON links.campaign_key = tot.campaign
     ORDER BY tot.sessions DESC`);

  return rows.map((r) => ({
    key: String(r.campaign),
    label: str(r.label),
    medium: String(r.medium ?? ""),
    sessions: num(r.sessions),
    newUsers: num(r.new_users),
    engaged: num(r.engaged),
    firstDay: String(r.first_day),
    lastDay: String(r.last_day),
    detectedSendDay: String(r.peak_day),
    sendDay: str(r.send_day) ?? String(r.peak_day),
    opens: num(r.opens),
    applyClicks: num(r.apply_clicks),
    applyYes: num(r.apply_yes),
    smoovCampaignId: r.smoov_campaign_id == null ? null : num(r.smoov_campaign_id),
    linkedJobs: num(r.linked_jobs),
  }));
}

export async function loadCampaignDailySessions(key: string, fromDay: string, toDay: string): Promise<Map<string, number>> {
  const rows = await run(sql`
    SELECT date::text AS day, sum(sessions) AS n FROM ga_campaign_daily
     WHERE campaign = ${key} AND date >= ${fromDay}::date AND date <= ${toDay}::date GROUP BY 1`);
  return new Map(rows.map((r) => [String(r.day), num(r.n)]));
}

export async function loadCampaignLandingPages(key: string): Promise<{ page: string; siteJobKey: string | null; sessions: number }[]> {
  const rows = await run(sql`
    SELECT landing_page, max(site_job_key) AS site_job_key, sum(sessions) AS sessions FROM ga_campaign_landing_daily
     WHERE campaign = ${key} GROUP BY 1 ORDER BY 3 DESC LIMIT 25`);
  return rows.map((r) => ({ page: String(r.landing_page), siteJobKey: str(r.site_job_key), sessions: num(r.sessions) }));
}

export async function loadCampaignSettings(key: string) {
  const [row] = await run(sql`SELECT label, smoov_campaign_id, send_day::text AS send_day, updated_by, updated_at FROM campaign_settings WHERE campaign_key = ${key}`);
  return row
    ? {
        label: str(row.label),
        smoovCampaignId: row.smoov_campaign_id == null ? null : num(row.smoov_campaign_id),
        sendDay: str(row.send_day),
        updatedBy: str(row.updated_by),
      }
    : null;
}

export async function loadLinkedJobIds(key: string): Promise<string[]> {
  const rows = await run(sql`SELECT job_case_id FROM campaign_jobs WHERE campaign_key = ${key} ORDER BY linked_at`);
  return rows.map((r) => String(r.job_case_id));
}

export async function loadSmoovStats(campaignId: number) {
  const [row] = await run(sql`SELECT sent, opens, clicks, bounces, unsubscribes, sent_at, fetched_at FROM smoov_campaign_stats WHERE campaign_id = ${campaignId}`);
  return row
    ? {
        sent: row.sent == null ? null : num(row.sent),
        opens: row.opens == null ? null : num(row.opens),
        clicks: row.clicks == null ? null : num(row.clicks),
        bounces: row.bounces == null ? null : num(row.bounces),
        unsubscribes: row.unsubscribes == null ? null : num(row.unsubscribes),
        sentAt: row.sent_at ? new Date(String(row.sent_at)) : null,
        fetchedAt: row.fetched_at ? new Date(String(row.fetched_at)) : null,
      }
    : null;
}

export interface WindowCounts {
  opens: number;
  applyClicks: number;
  applications: number;
}

export interface JobImpact {
  position: Position;
  campaignSessions: number;
  before: WindowCounts;
  after: WindowCounts;
}

/** Each linked job in the IMPACT_DAYS from the send day, against the same span before it. */
export async function loadJobImpacts(key: string, sendDay: string, jobs: Position[], facts: ApplicationFacts[]): Promise<JobImpact[]> {
  const beforeFrom = addDays(sendDay, -IMPACT_DAYS);
  const beforeTo = addDays(sendDay, -1);
  const afterTo = addDays(sendDay, IMPACT_DAYS - 1);
  const keys = jobs.map((j) => j.siteJobKey).filter((k): k is string => Boolean(k));

  const [events, landing] = keys.length
    ? await Promise.all([
        run(sql`
          SELECT site_job_key, event_name,
                 sum(event_count) FILTER (WHERE date >= ${beforeFrom}::date AND date <= ${beforeTo}::date) AS before,
                 sum(event_count) FILTER (WHERE date >= ${sendDay}::date AND date <= ${afterTo}::date) AS after
            FROM ga_event_daily
           WHERE site_job_key IN ${keys} AND event_name IN ${[JOB_EVENTS.opens, JOB_EVENTS.applyClicks]}
             AND date >= ${beforeFrom}::date AND date <= ${afterTo}::date
           GROUP BY 1, 2`),
        run(sql`
          SELECT site_job_key, sum(sessions) AS n FROM ga_campaign_landing_daily
           WHERE campaign = ${key} AND site_job_key IN ${keys} GROUP BY 1`),
      ])
    : [[], []];

  return jobs.map((position) => {
    const k = position.siteJobKey;
    const ev = (name: string, side: "before" | "after") => num(events.find((e) => e.site_job_key === k && e.event_name === name)?.[side]);
    const apps = facts.filter((f) => f.parentId === position.id).map((f) => israelDay(f.createdAt));
    return {
      position,
      campaignSessions: num(landing.find((l) => l.site_job_key === k)?.n),
      before: {
        opens: ev(JOB_EVENTS.opens, "before"),
        applyClicks: ev(JOB_EVENTS.applyClicks, "before"),
        applications: apps.filter((d) => d >= beforeFrom && d <= beforeTo).length,
      },
      after: {
        opens: ev(JOB_EVENTS.opens, "after"),
        applyClicks: ev(JOB_EVENTS.applyClicks, "after"),
        applications: apps.filter((d) => d >= sendDay && d <= afterTo).length,
      },
    };
  });
}

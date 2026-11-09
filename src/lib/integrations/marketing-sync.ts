import { and, eq, gte, lt, lte, sql } from "drizzle-orm";
import { addDays, israelDay, israelMidnight } from "@/lib/dashboard/params";
import { getDb } from "@/lib/db/client";
import {
  gaCampaignDaily,
  gaCampaignEventDaily,
  gaApplicationMinute,
  gaCampaignLandingDaily,
  gaChannelDaily,
  gaEventDaily,
  gaPageDaily,
  gtmVersions,
  smoovCampaigns,
  smoovCampaignStats,
  smoovLists,
  syncRuns,
  syncState,
} from "@/lib/db/schema";
import { ga4Configured, gaDate, jobKeyFromPath, runReport } from "@/lib/google/ga4";
import { getLiveVersion, gtmConfigured, sendsJobId } from "@/lib/google/gtm";
import { smoov, smoovConfigured } from "@/lib/smoov/client";
import { runSmoovPush, smoovPushConfigured, smoovPushDue } from "@/lib/smoov/push";
import { logError, safeErrorMessage } from "@/lib/log";
import { gaMinuteToUtc, rebuildApplicationSources, stripMarks } from "@/lib/metrics/attribution";
import { APPLIED_EVENTS, APPLIED_EVENTS_SINCE } from "@/lib/metrics/jobs";

/**
 * Google Analytics, Tag Manager and SMOOV into Postgres. Separate from the
 * Salesforce sync (different APIs, quotas and cadence), but recorded in the same
 * sync_state / sync_runs tables so the sync screen shows everything together.
 */

/** SMOOV_PUSH writes the job-seekers list (src/lib/smoov/push.ts); the others only read. */
export type MarketingSource = "GA4" | "GTM" | "SMOOV" | "SMOOV_PUSH";

export interface MarketingResult {
  source: MarketingSource;
  rows: number;
  note?: string;
  error?: string;
  ms: number;
}

/** The public site's GA history the mirror starts from (applications begin in Feb 2025). */
const GA_START_DAY = "2025-02-01";
/** GA keeps revising the last day or two; each run re-pulls this many days. */
const GA_REFRESH_DAYS = 3;
const GA_CHUNK_DAYS = 31;
const INSERT_CHUNK = 1000;

/** GA's placeholder "campaigns" for untagged traffic. */
export const NON_CAMPAIGNS = ["(direct)", "(organic)", "(referral)", "(not set)", "(data deleted)", "(ai-assistant)", "(cross-network)"];
/** Site events worth attributing to campaigns. */
const CAMPAIGN_EVENTS = [
  "open_job_page",
  "job_application_registered",
  "job_application_guest",
  "Job_application_click_1",
  "Job_application_yes",
  "sign_up_second_phase_complete",
];
const taggedCampaigns = { notExpression: { filter: { fieldName: "sessionCampaignName", inListFilter: { values: NON_CAMPAIGNS } } } };

async function saveState(object: string, values: Partial<typeof syncState.$inferInsert>): Promise<void> {
  await getDb().insert(syncState).values({ object, ...values }).onConflictDoUpdate({ target: syncState.object, set: values });
}

async function insertChunks<T extends Record<string, unknown>>(
  insert: (rows: T[]) => Promise<unknown>,
  rows: T[],
): Promise<void> {
  for (let i = 0; i < rows.length; i += INSERT_CHUNK) await insert(rows.slice(i, i + INSERT_CHUNK));
}

async function syncGa4(): Promise<{ rows: number; note: string }> {
  const db = getDb();
  const [state] = await db.select().from(syncState).where(eq(syncState.object, "GA4"));
  const today = israelDay();
  let from = state?.cursor ? addDays(israelDay(state.cursor), -GA_REFRESH_DAYS) : GA_START_DAY;
  let total = 0;
  let quota: number | null = null;

  while (from <= today) {
    const to = addDays(from, GA_CHUNK_DAYS - 1) < today ? addDays(from, GA_CHUNK_DAYS - 1) : today;
    const range = { startDate: from, endDate: to };

    const pages = await runReport({ ...range, dimensions: ["date", "pagePath"], metrics: ["screenPageViews", "activeUsers", "sessions"] });
    const events = await runReport({ ...range, dimensions: ["date", "eventName", "pagePath"], metrics: ["eventCount", "totalUsers"] });
    const channels = await runReport({
      ...range,
      dimensions: ["date", "sessionDefaultChannelGroup", "sessionSource", "sessionMedium"],
      metrics: ["sessions", "activeUsers", "newUsers", "engagedSessions"],
    });
    const campaigns = await runReport({
      ...range,
      dimensions: ["date", "sessionCampaignName", "sessionSource", "sessionMedium"],
      metrics: ["sessions", "newUsers", "engagedSessions"],
      dimensionFilter: taggedCampaigns,
    });
    const campaignEvents = await runReport({
      ...range,
      dimensions: ["date", "sessionCampaignName", "eventName"],
      metrics: ["eventCount"],
      dimensionFilter: {
        andGroup: { expressions: [taggedCampaigns, { filter: { fieldName: "eventName", inListFilter: { values: CAMPAIGN_EVENTS } } }] },
      },
    });
    const campaignLanding = await runReport({
      ...range,
      dimensions: ["date", "sessionCampaignName", "landingPage"],
      metrics: ["sessions"],
      dimensionFilter: taggedCampaigns,
    });
    // The accepted applications per minute, for matching each Salesforce application to its source.
    const applyMinutes =
      to >= APPLIED_EVENTS_SINCE
        ? await runReport({
            ...range,
            dimensions: ["dateHourMinute", "eventName", "pagePath", "sessionSource", "sessionMedium", "sessionCampaignName", "sessionDefaultChannelGroup", "deviceCategory"],
            metrics: ["eventCount"],
            dimensionFilter: { filter: { fieldName: "eventName", inListFilter: { values: [...APPLIED_EVENTS] } } },
          })
        : { rows: [], quotaRemaining: null };
    quota = applyMinutes.quotaRemaining ?? campaignLanding.quotaRemaining ?? channels.quotaRemaining ?? quota;

    // Replace the whole window: GA's numbers for recent days change after the fact.
    await db.transaction(async (tx) => {
      await tx.delete(gaPageDaily).where(and(gte(gaPageDaily.date, from), lte(gaPageDaily.date, to)));
      await tx.delete(gaEventDaily).where(and(gte(gaEventDaily.date, from), lte(gaEventDaily.date, to)));
      await tx.delete(gaChannelDaily).where(and(gte(gaChannelDaily.date, from), lte(gaChannelDaily.date, to)));
      await tx.delete(gaCampaignDaily).where(and(gte(gaCampaignDaily.date, from), lte(gaCampaignDaily.date, to)));
      await tx.delete(gaCampaignEventDaily).where(and(gte(gaCampaignEventDaily.date, from), lte(gaCampaignEventDaily.date, to)));
      await tx.delete(gaCampaignLandingDaily).where(and(gte(gaCampaignLandingDaily.date, from), lte(gaCampaignLandingDaily.date, to)));
      await tx.delete(gaApplicationMinute).where(and(gte(gaApplicationMinute.minute, israelMidnight(from)), lt(gaApplicationMinute.minute, israelMidnight(addDays(to, 1)))));

      await insertChunks(
        (rows) => tx.insert(gaApplicationMinute).values(rows).onConflictDoNothing(),
        applyMinutes.rows.map((r) => ({
          minute: gaMinuteToUtc(r.dims.dateHourMinute!),
          eventName: r.dims.eventName!,
          pagePath: r.dims.pagePath!,
          siteJobKey: jobKeyFromPath(r.dims.pagePath!),
          source: stripMarks(r.dims.sessionSource!),
          medium: stripMarks(r.dims.sessionMedium!),
          campaign: stripMarks(r.dims.sessionCampaignName!),
          channelGroup: r.dims.sessionDefaultChannelGroup!,
          deviceCategory: r.dims.deviceCategory!,
          eventCount: r.metrics.eventCount!,
        })),
      );

      await insertChunks(
        (rows) => tx.insert(gaCampaignDaily).values(rows).onConflictDoNothing(),
        campaigns.rows.map((r) => ({
          date: gaDate(r.dims.date!),
          campaign: r.dims.sessionCampaignName!,
          source: r.dims.sessionSource!,
          medium: r.dims.sessionMedium!,
          sessions: r.metrics.sessions!,
          newUsers: r.metrics.newUsers!,
          engagedSessions: r.metrics.engagedSessions!,
        })),
      );
      await insertChunks(
        (rows) => tx.insert(gaCampaignEventDaily).values(rows).onConflictDoNothing(),
        campaignEvents.rows.map((r) => ({
          date: gaDate(r.dims.date!),
          campaign: r.dims.sessionCampaignName!,
          eventName: r.dims.eventName!,
          eventCount: r.metrics.eventCount!,
        })),
      );
      await insertChunks(
        (rows) => tx.insert(gaCampaignLandingDaily).values(rows).onConflictDoNothing(),
        campaignLanding.rows.map((r) => ({
          date: gaDate(r.dims.date!),
          campaign: r.dims.sessionCampaignName!,
          landingPage: r.dims.landingPage!,
          siteJobKey: jobKeyFromPath(r.dims.landingPage!),
          sessions: r.metrics.sessions!,
        })),
      );

      await insertChunks(
        (rows) => tx.insert(gaPageDaily).values(rows).onConflictDoNothing(),
        pages.rows.map((r) => ({
          date: gaDate(r.dims.date!),
          pagePath: r.dims.pagePath!,
          siteJobKey: jobKeyFromPath(r.dims.pagePath!),
          views: r.metrics.screenPageViews!,
          activeUsers: r.metrics.activeUsers!,
          sessions: r.metrics.sessions!,
        })),
      );
      await insertChunks(
        (rows) => tx.insert(gaEventDaily).values(rows).onConflictDoNothing(),
        events.rows.map((r) => ({
          date: gaDate(r.dims.date!),
          eventName: r.dims.eventName!,
          pagePath: r.dims.pagePath!,
          siteJobKey: jobKeyFromPath(r.dims.pagePath!),
          eventCount: r.metrics.eventCount!,
          totalUsers: r.metrics.totalUsers!,
        })),
      );
      await insertChunks(
        (rows) => tx.insert(gaChannelDaily).values(rows).onConflictDoNothing(),
        channels.rows.map((r) => ({
          date: gaDate(r.dims.date!),
          channelGroup: r.dims.sessionDefaultChannelGroup!,
          source: r.dims.sessionSource!,
          medium: r.dims.sessionMedium!,
          sessions: r.metrics.sessions!,
          activeUsers: r.metrics.activeUsers!,
          newUsers: r.metrics.newUsers!,
          engagedSessions: r.metrics.engagedSessions!,
        })),
      );
    });

    total +=
      pages.rows.length + events.rows.length + channels.rows.length + campaigns.rows.length + campaignEvents.rows.length + campaignLanding.rows.length + applyMinutes.rows.length;
    await saveState("GA4", { cursor: israelMidnight(to) });
    from = addDays(to, 1);
  }

  const [{ n }] = (await db.select({ n: sql<number>`count(*)::int` }).from(gaPageDaily)) as [{ n: number }];
  await saveState("GA4", { rowCount: n });
  // Salesforce applications created since the last run get their source now, older ones are re-checked.
  const sources = await rebuildApplicationSources();
  const matched = `application sources: ${sources.matched}/${sources.applications} matched${sources.ambiguous ? `, ${sources.ambiguous} ambiguous` : ""}`;
  return { rows: total, note: quota == null ? matched : `quota left today: ${quota} · ${matched}` };
}

async function syncGtm(): Promise<{ rows: number; note: string }> {
  const version = await getLiveVersion();
  const versionId = version.containerVersionId ?? "unknown";
  const values = {
    name: version.name ?? null,
    fingerprint: version.fingerprint ?? null,
    tagCount: version.tag?.length ?? 0,
    triggerCount: version.trigger?.length ?? 0,
    variableCount: version.variable?.length ?? 0,
    sendsJobId: sendsJobId(version),
    data: version,
  };
  await getDb()
    .insert(gtmVersions)
    .values({ versionId, ...values })
    .onConflictDoUpdate({ target: gtmVersions.versionId, set: { ...values, lastSeenAt: new Date() } });
  await saveState("GTM", { rowCount: values.tagCount });
  return { rows: 1, note: `live version ${versionId}: ${values.tagCount} tags, job_id ${values.sendsJobId ? "sent" : "not sent"}` };
}

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v)) ? Number(v) : null);

function toDate(v: unknown): Date | null {
  if (typeof v !== "string" || !v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

async function syncSmoov(): Promise<{ rows: number; note: string }> {
  const db = getDb();
  const lists = await smoov.lists();
  for (const list of lists) {
    const values = { name: typeof list.name === "string" ? list.name : null, contactsCount: num(list.contactsCount), data: list };
    await db.insert(smoovLists).values({ id: list.id, ...values }).onConflictDoUpdate({ target: smoovLists.id, set: { ...values, syncedAt: new Date() } });
  }

  const tracked = await db.select().from(smoovCampaigns).where(eq(smoovCampaigns.active, true));
  const failed: number[] = [];
  for (const campaign of tracked) {
    try {
      const s = await smoov.campaignStatistics(campaign.id);
      // Field names as SMOOV spells them.
      const values = {
        sentAt: toDate(s.sentDate),
        sent: num(s.howManyWasSent),
        opens: num(s.howManyWasWatched),
        clicks: num(s.clicked),
        bounces: num(s.bounced),
        unsubscribes: num(s.unsubcribed),
        data: s,
      };
      await db
        .insert(smoovCampaignStats)
        .values({ campaignId: campaign.id, ...values })
        .onConflictDoUpdate({ target: smoovCampaignStats.campaignId, set: { ...values, fetchedAt: new Date() } });
    } catch (err) {
      failed.push(campaign.id);
      logError(`marketing SMOOV campaign ${campaign.id}`, err);
    }
  }
  await saveState("SMOOV", { rowCount: lists.length });
  return {
    rows: lists.length + tracked.length - failed.length,
    note: `${lists.length} lists, ${tracked.length - failed.length}/${tracked.length} campaigns${failed.length ? `; failed: ${failed.join(", ")}` : ""}`,
  };
}

const SOURCES: {
  source: MarketingSource;
  configured: () => boolean;
  /** For a source slower than the marketing cadence: skipped (and not recorded) until it is due. */
  due?: () => Promise<boolean>;
  run: (trigger: string) => Promise<{ rows: number; note: string }>;
}[] = [
  { source: "GA4", configured: ga4Configured, run: syncGa4 },
  { source: "GTM", configured: gtmConfigured, run: syncGtm },
  { source: "SMOOV", configured: smoovConfigured, run: syncSmoov },
  { source: "SMOOV_PUSH", configured: smoovPushConfigured, due: smoovPushDue, run: runSmoovPush },
];

/** What a source's refresh button on /admin/sync runs: SMOOV is its lists and campaigns plus the push. */
export const MARKETING_GROUPS = {
  GA4: ["GA4"],
  GTM: ["GTM"],
  SMOOV: ["SMOOV", "SMOOV_PUSH"],
} as const satisfies Record<string, readonly MarketingSource[]>;
export type MarketingGroup = keyof typeof MARKETING_GROUPS;

export function isMarketingGroup(value: string): value is MarketingGroup {
  return Object.hasOwn(MARKETING_GROUPS, value);
}

export function marketingGroupConfigured(group: MarketingGroup): boolean {
  return SOURCES.some((s) => (MARKETING_GROUPS[group] as readonly string[]).includes(s.source) && s.configured());
}

export function marketingConfigured(): boolean {
  return SOURCES.some((s) => s.configured());
}

/** Every source, or only one group's when an admin refreshes that source at /admin/sync. */
export async function runMarketingSync(trigger: string, group?: MarketingGroup): Promise<MarketingResult[]> {
  const db = getDb();
  const results: MarketingResult[] = [];
  const only: readonly string[] | null = group ? MARKETING_GROUPS[group] : null;
  for (const { source, configured, due, run } of SOURCES) {
    if (only && !only.includes(source)) continue;
    // An admin's request from /admin/sync runs every source now, due or not.
    if (!configured() || (due && !trigger.startsWith("manual:") && !(await due()))) continue;
    const started = Date.now();
    const [row] = await db.insert(syncRuns).values({ object: source, mode: "marketing", trigger }).returning({ id: syncRuns.id });
    await saveState(source, { lastStartedAt: new Date() });
    try {
      const { rows, note } = await run(trigger);
      await saveState(source, { lastSuccessAt: new Date(), lastError: null });
      await db.update(syncRuns).set({ finishedAt: new Date(), upserted: rows, deleted: 0, note: note || null }).where(eq(syncRuns.id, row!.id));
      results.push({ source, rows, note, ms: Date.now() - started });
    } catch (err) {
      const error = safeErrorMessage(err);
      logError(`marketing ${source}`, err);
      await saveState(source, { lastError: error.slice(0, 2000) });
      await db.update(syncRuns).set({ finishedAt: new Date(), upserted: 0, deleted: 0, error }).where(eq(syncRuns.id, row!.id));
      results.push({ source, rows: 0, error, ms: Date.now() - started });
    }
  }
  return results;
}

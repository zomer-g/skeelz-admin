/**
 * Background sync for the xhostd deployment. launch.sh starts it next to the
 * web server when SYNC_WORKER=true — a separate process with its own small heap,
 * so a large sync can never push the web server into an OOM kill.
 *
 * Once a minute it decides what, if anything, to run — one job per tick:
 *   1. an admin's request from the sync screen, oldest first
 *   2. the nightly Salesforce reconcile, in the SYNC_RECONCILE_HOUR_UTC hour
 *   3. an incremental Salesforce sync every SYNC_INTERVAL_MIN minutes (default 10)
 *   4. Google Analytics / Tag Manager / SMOOV every MARKETING_SYNC_INTERVAL_MIN (default 360)
 * and then, when WEBHOOK_URL is set, delivers due webhook events (src/lib/api/outbound.ts).
 */
import { asc, desc, eq, inArray, isNull } from "drizzle-orm";
import { deliverPending, detectCaseChanges, enqueueSyncFailures, maybeDailySummary } from "@/lib/api/outbound";
import { getDb } from "@/lib/db/client";
import { syncRequests, syncRuns, syncState } from "@/lib/db/schema";
import { ga4Configured } from "@/lib/google/ga4";
import { marketingConfigured, runMarketingSync } from "@/lib/integrations/marketing-sync";
import { salesforceConfigured } from "@/lib/sf/client";
import { runSync, type SyncMode } from "@/lib/sf/sync";
import { safeErrorMessage } from "@/lib/log";

type JobMode = SyncMode | "marketing";

const INTERVAL_MIN = Number(process.env.SYNC_INTERVAL_MIN ?? 10);
const MARKETING_INTERVAL_MIN = Number(process.env.MARKETING_SYNC_INTERVAL_MIN ?? 360);
const FAILED_RETRY_MIN = 30;
const RECONCILE_HOUR_UTC = Number(process.env.SYNC_RECONCILE_HOUR_UTC ?? 0); // 02:00–03:00 Israel time
const MODES = new Set<JobMode>(["incremental", "full", "reconcile", "marketing"]);

const log = (msg: string) => console.log(`[sync-worker] ${new Date().toISOString()} ${msg}`);

/** Webhook work never takes a sync down with it. */
async function safely(label: string, work: () => Promise<unknown>): Promise<void> {
  try {
    await work();
  } catch (err) {
    log(`${label} failed: ${safeErrorMessage(err)}`);
  }
}

let running = false;
let lastIncrementalAt = 0;
let lastMarketingAt = 0;

async function lastRunAt(mode: string): Promise<number> {
  const [row] = await getDb()
    .select({ at: syncRuns.startedAt })
    .from(syncRuns)
    .where(eq(syncRuns.mode, mode))
    .orderBy(desc(syncRuns.startedAt))
    .limit(1);
  return row?.at.getTime() ?? 0;
}

async function chooseScheduled(): Promise<JobMode | null> {
  const sf = salesforceConfigured();
  if (sf && new Date().getUTCHours() === RECONCILE_HOUR_UTC && Date.now() - (await lastRunAt("reconcile")) > 20 * 3600_000) {
    return "reconcile";
  }
  if (sf && Date.now() - lastIncrementalAt >= INTERVAL_MIN * 60_000) return "incremental";
  if (marketingConfigured()) {
    const states = await getDb()
      .select()
      .from(syncState)
      .where(inArray(syncState.object, ["GA4", "GTM", "SMOOV"]));
    // A migration that resets the GA mirror (or a first deploy) leaves no cursor: backfill now, not in six hours.
    if (ga4Configured() && !states.find((s) => s.object === "GA4")?.cursor) return "marketing";
    // A source that failed (a key or permission since fixed) is retried every half hour, not every six.
    const retryDue = states.some(
      (s) => s.lastError && s.lastError !== "not visible to the integration user" && Date.now() - (s.lastStartedAt?.getTime() ?? 0) >= FAILED_RETRY_MIN * 60_000,
    );
    if (retryDue) return "marketing";
    // Survive restarts: a redeploy should not trigger a fresh Google/SMOOV pull every time.
    lastMarketingAt ||= await lastRunAt("marketing");
    if (Date.now() - lastMarketingAt >= MARKETING_INTERVAL_MIN * 60_000) return "marketing";
  }
  return null;
}

async function run(mode: JobMode, trigger: string): Promise<void> {
  const started = Date.now();
  log(`${mode} starting (${trigger})`);

  if (mode === "marketing") {
    lastMarketingAt = Date.now();
    const results = await runMarketingSync(trigger);
    const summary = results.map((r) => `${r.source} ${r.error ? `ERROR ${r.error}` : `+${r.rows}${r.note ? ` (${r.note})` : ""}`}`);
    log(`marketing finished in ${Math.round((Date.now() - started) / 1000)}s: ${summary.join("; ") || "nothing configured"}`);
    await safely("webhook failures", () => enqueueSyncFailures(results));
    return;
  }

  if (!salesforceConfigured()) {
    log(`${mode} skipped: Salesforce is not configured`);
    return;
  }
  if (mode !== "reconcile") lastIncrementalAt = Date.now();
  const summary = await runSync(mode, trigger);
  if (summary.locked) {
    log(`${mode} skipped: another sync holds the lock`);
    return;
  }
  const failed = summary.results.filter((r) => r.error).map((r) => r.object);
  log(`${mode} finished in ${Math.round(summary.ms / 1000)}s${failed.length ? `; failed: ${failed.join(", ")}` : ""}`);
  await safely("webhook changes", async () => {
    const changes = await detectCaseChanges();
    if (changes.baseline) log("webhook: recorded the current jobs and applications as the baseline");
    else if (changes.suppressed) log("webhook: too many changes at once (mirror rebuild?); recorded without sending");
    else if (changes.events) log(`webhook: queued ${changes.events} events`);
    await enqueueSyncFailures(summary.results.map((r) => ({ source: r.object, error: r.error })));
  });
}

async function tick(): Promise<void> {
  if (running) return;
  running = true;
  try {
    const db = getDb();
    const [request] = await db
      .select()
      .from(syncRequests)
      .where(isNull(syncRequests.pickedAt))
      .orderBy(asc(syncRequests.requestedAt))
      .limit(1);

    if (request) {
      await db.update(syncRequests).set({ pickedAt: new Date() }).where(eq(syncRequests.id, request.id));
      const mode = MODES.has(request.mode as JobMode) ? (request.mode as JobMode) : "incremental";
      await run(mode, `manual:${request.requestedBy}`);
      await db.update(syncRequests).set({ doneAt: new Date() }).where(eq(syncRequests.id, request.id));
    } else {
      const mode = await chooseScheduled();
      if (mode) await run(mode, "schedule");
    }

    await safely("webhook delivery", async () => {
      await maybeDailySummary();
      await deliverPending();
    });
  } catch (err) {
    log(`tick failed: ${(err as Error).stack ?? err}`);
  } finally {
    running = false;
  }
}

log(
  `started; Salesforce every ${INTERVAL_MIN} min (reconcile ${RECONCILE_HOUR_UTC}:00 UTC), ` +
    `Google/SMOOV every ${MARKETING_INTERVAL_MIN} min`,
);
// Give the web server and migrations a head start before the first (possibly full) load.
setTimeout(() => void tick(), 20_000);
setInterval(() => void tick(), 60_000);

for (const signal of ["SIGTERM", "SIGINT"] as const) {
  process.on(signal, () => {
    log(`received ${signal}; exiting`);
    process.exit(0);
  });
}

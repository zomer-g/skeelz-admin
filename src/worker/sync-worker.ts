/**
 * Background Salesforce sync for the xhostd deployment. launch.sh starts it
 * next to the web server when SYNC_WORKER=true — a separate process with its
 * own small heap, so a large sync can never push the web server into an OOM kill.
 *
 * Once a minute it decides what, if anything, to run:
 *   1. an admin's "sync now" request from the admin screen, oldest first
 *   2. the nightly reconcile, in the RECONCILE_HOUR_UTC hour, once a day
 *   3. an incremental sync every SYNC_INTERVAL_MIN minutes (default 10)
 */
import { asc, desc, eq, isNull } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { syncRequests, syncRuns } from "@/lib/db/schema";
import { salesforceConfigured } from "@/lib/sf/client";
import { runSync, type SyncMode } from "@/lib/sf/sync";

const INTERVAL_MIN = Number(process.env.SYNC_INTERVAL_MIN ?? 10);
const RECONCILE_HOUR_UTC = Number(process.env.SYNC_RECONCILE_HOUR_UTC ?? 0); // 02:00–03:00 Israel time
const MODES = new Set<SyncMode>(["incremental", "full", "reconcile"]);

const log = (msg: string) => console.log(`[sync-worker] ${new Date().toISOString()} ${msg}`);

let running = false;
let lastIncrementalAt = 0;
let warnedUnconfigured = false;

async function lastReconcileAt(): Promise<number> {
  const [row] = await getDb()
    .select({ at: syncRuns.startedAt })
    .from(syncRuns)
    .where(eq(syncRuns.mode, "reconcile"))
    .orderBy(desc(syncRuns.startedAt))
    .limit(1);
  return row?.at.getTime() ?? 0;
}

async function tick(): Promise<void> {
  if (running) return;
  running = true;
  try {
    if (!salesforceConfigured()) {
      if (!warnedUnconfigured) log("Salesforce is not configured; waiting");
      warnedUnconfigured = true;
      return;
    }

    const db = getDb();
    let mode: SyncMode | null = null;
    let trigger = "schedule";

    const [request] = await db
      .select()
      .from(syncRequests)
      .where(isNull(syncRequests.pickedAt))
      .orderBy(asc(syncRequests.requestedAt))
      .limit(1);

    if (request) {
      await db.update(syncRequests).set({ pickedAt: new Date() }).where(eq(syncRequests.id, request.id));
      mode = MODES.has(request.mode as SyncMode) ? (request.mode as SyncMode) : "incremental";
      trigger = `manual:${request.requestedBy}`;
    } else {
      const now = new Date();
      if (now.getUTCHours() === RECONCILE_HOUR_UTC && Date.now() - (await lastReconcileAt()) > 20 * 3600_000) {
        mode = "reconcile";
      } else if (Date.now() - lastIncrementalAt >= INTERVAL_MIN * 60_000) {
        mode = "incremental";
      }
    }
    if (!mode) return;

    if (mode !== "reconcile") lastIncrementalAt = Date.now();
    log(`${mode} starting (${trigger})`);
    const summary = await runSync(mode, trigger);

    if (summary.locked) log(`${mode} skipped: another sync holds the lock`);
    else {
      const failed = summary.results.filter((r) => r.error).map((r) => r.object);
      log(`${mode} finished in ${Math.round(summary.ms / 1000)}s${failed.length ? `; failed: ${failed.join(", ")}` : ""}`);
    }
    if (request) await db.update(syncRequests).set({ doneAt: new Date() }).where(eq(syncRequests.id, request.id));
  } catch (err) {
    log(`tick failed: ${(err as Error).stack ?? err}`);
  } finally {
    running = false;
  }
}

log(`started; incremental every ${INTERVAL_MIN} min, reconcile at ${RECONCILE_HOUR_UTC}:00 UTC`);
// Give the web server and migrations a head start before the first (possibly full) load.
setTimeout(() => void tick(), 20_000);
setInterval(() => void tick(), 60_000);

for (const signal of ["SIGTERM", "SIGINT"] as const) {
  process.on(signal, () => {
    log(`received ${signal}; exiting`);
    process.exit(0);
  });
}

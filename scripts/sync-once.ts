/**
 * Runs one Salesforce sync in the foreground — for local development against
 * the PGlite database (npm run db:local), or to seed a fresh database.
 *
 *   npm run sync:once                 # incremental (a full load on an empty database)
 *   npm run sync:once -- full
 *   npm run sync:once -- reconcile
 */
import { getPool } from "../src/lib/db/client";
import { runSync, type SyncMode } from "../src/lib/sf/sync";

async function main() {
  const arg = process.argv[2];
  const mode: SyncMode = arg === "full" || arg === "reconcile" ? arg : "incremental";
  const summary = await runSync(mode, "cli");
  if (summary.locked) {
    console.log("[sync-once] another sync holds the lock; nothing done");
    return;
  }
  const failed = summary.results.filter((r) => r.error);
  console.log(`[sync-once] ${mode} finished in ${Math.round(summary.ms / 1000)}s${failed.length ? `; ${failed.length} failed` : ""}`);
  if (failed.length) process.exitCode = 1;
}

main()
  .catch((err: Error) => {
    console.error("[sync-once] FAILED:", err.stack ?? err.message);
    process.exitCode = 1;
  })
  .finally(() => getPool().end());

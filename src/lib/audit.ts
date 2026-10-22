import { sql } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { auditLog } from "@/lib/db/schema";
import { errorCode } from "@/lib/log";

/** A signed-in user opened a screen. Fire-and-forget: logging never slows a render. */
export function logPageView(actor: string, path: string): void {
  void writeAudit(actor, "page.view", path);
}

export async function writeAudit(
  actor: string,
  action: string,
  target?: string | null,
  details?: Record<string, unknown>,
): Promise<void> {
  try {
    await getDb().insert(auditLog).values({ actor, action, target: target ?? null, details: details ?? null });
  } catch (err) {
    // An audit write must never take down the operation it describes.
    console.error(`[audit] write failed: ${errorCode(err)}`, { action });
  }
}

/** How long the activity log (including every file access and CV search) is kept. Stated in the privacy policy. */
export const LOG_RETENTION_MONTHS = 24;

/**
 * Deletes log entries older than the retention period: the activity log, file-access alerts and
 * extra-file approvals, and access reviews. Run nightly by the sync worker.
 */
export async function purgeOldLogs(): Promise<number> {
  const db = getDb();
  const cutoff = sql`now() - make_interval(months => ${LOG_RETENTION_MONTHS})`;
  const removed = await db.execute(sql`DELETE FROM audit_log WHERE at < ${cutoff}`);
  await db.execute(sql`DELETE FROM security_alerts WHERE created_at < ${cutoff}`);
  await db.execute(sql`DELETE FROM file_quota_grants WHERE granted_at < ${cutoff}`);
  await db.execute(sql`DELETE FROM export_quota_grants WHERE granted_at < ${cutoff}`);
  await db.execute(sql`DELETE FROM access_reviews WHERE reviewed_at < ${cutoff}`);
  return removed.rowCount ?? 0;
}

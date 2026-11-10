import { sql } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { auditLog } from "@/lib/db/schema";
import { errorCode } from "@/lib/log";

/** Which people a screen showed (lib/security/people-screen.tsx): ids for "who saw X", `count` = people new today. */
export const RECORDS_SHOWN = "records.shown";

/** A signed-in user opened a screen. Fire-and-forget: logging never slows a render. */
export function logPageView(actor: string, path: string): void {
  void writeAudit(actor, "page.view", path);
}

/** Audit writes that failed in this process since it started, for the admins' banner (AdminAlerts). */
const failures = { count: 0, last: null as Date | null };
export const auditWriteFailures = (): { count: number; last: Date | null } => ({ ...failures });

function noteFailure(action: string, err: unknown): void {
  failures.count++;
  failures.last = new Date();
  console.error(`[audit] write failed: ${errorCode(err)}`, { action });
}

/**
 * An informational entry (a screen view, a handshake): a failed write is counted and shown to the
 * admins, but never takes down the operation it describes. Anything that hands personal data
 * over (a file, contact details, people over MCP or the API) uses writeAuditStrict instead.
 */
export async function writeAudit(
  actor: string,
  action: string,
  target?: string | null,
  details?: Record<string, unknown>,
): Promise<void> {
  try {
    await getDb().insert(auditLog).values({ actor, action, target: target ?? null, details: details ?? null });
  } catch (err) {
    noteFailure(action, err);
  }
}

/** The entry behind a hand-over of personal data could not be written: the data must not go out. */
export class AuditWriteError extends Error {
  readonly code = "audit_write_failed";
  constructor() {
    super("audit write failed");
    this.name = "AuditWriteError";
  }
}

/**
 * The entry that a hand-over of personal data is recorded (and counted) by. It throws when the
 * write fails, so the caller refuses instead of handing the data over unlogged and uncounted.
 */
export async function writeAuditStrict(
  actor: string,
  action: string,
  target?: string | null,
  details?: Record<string, unknown>,
): Promise<void> {
  try {
    await getDb().insert(auditLog).values({ actor, action, target: target ?? null, details: details ?? null });
  } catch (err) {
    noteFailure(action, err);
    throw new AuditWriteError();
  }
}

/** The answer when an AuditWriteError stopped a hand-over. */
export const auditUnavailable = () =>
  new Response("לא ניתן לתעד את הפעולה כרגע, ולכן היא לא בוצעה. נסו שוב בעוד רגע.", {
    status: 503,
    headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store", "Retry-After": "30" },
  });

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
  await db.execute(sql`DELETE FROM api_calls WHERE at < ${cutoff}`);
  return removed.rowCount ?? 0;
}

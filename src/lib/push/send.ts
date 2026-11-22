import { eq, inArray, isNull, sql } from "drizzle-orm";
import { writeAudit } from "@/lib/audit";
import { hasRole, isRole } from "@/lib/auth/roles";
import { getDb } from "@/lib/db/client";
import { pushNotices, pushSubscriptions, securityAlerts, users } from "@/lib/db/schema";
import { errorCode } from "@/lib/log";
import { pinnedFetch } from "@/lib/net/pinned-fetch";
import { loadReviewStatus } from "@/lib/security/reviews";
import { buildPayload, pendingNotices, PUSH_EVENTS, type PushKind } from "./events";
import { allowedEndpoint, encryptPayload, vapidAuthorization, vapidKeys, type PushTarget } from "./webpush";

/** A subscription that failed this many times in a row (not 404/410) is dropped too. */
const MAX_FAILURES = 10;

export interface SendResult {
  sent: number;
  failed: number;
  removed: number;
}

/** One POST to one push service. 404/410 = the subscription is gone. Never throws. */
async function deliver(target: PushTarget, body: Buffer): Promise<"ok" | "gone" | "failed"> {
  const keys = vapidKeys();
  const url = allowedEndpoint(target.endpoint);
  if (!keys || !url) return "gone";
  try {
    const res = await pinnedFetch(url, {
      method: "POST",
      headers: {
        Authorization: await vapidAuthorization(url, keys),
        "Content-Encoding": "aes128gcm",
        "Content-Type": "application/octet-stream",
        TTL: String(24 * 3600),
        Urgency: "normal",
      },
      body,
      signal: AbortSignal.timeout(10_000),
    });
    await res.body?.cancel().catch(() => {});
    if (res.status === 404 || res.status === 410) return "gone";
    return res.ok ? "ok" : "failed";
  } catch (err) {
    console.error(`[push] delivery failed: ${errorCode(err)}`);
    return "failed";
  }
}

/**
 * Sends one kind of notice to every subscription of every active user whose role — read from the
 * users table now, so neither "view as" nor a role changed since subscribing matters — allows the
 * screen it opens. Never throws: a push failure must not break its caller.
 */
export async function sendNotice(kind: PushKind): Promise<SendResult> {
  const result: SendResult = { sent: 0, failed: 0, removed: 0 };
  if (!vapidKeys()) return result;
  try {
    const db = getDb();
    const event = PUSH_EVENTS[kind];
    const rows = await db
      .select({ id: pushSubscriptions.id, endpoint: pushSubscriptions.endpoint, p256dh: pushSubscriptions.p256dh, auth: pushSubscriptions.auth, role: users.role })
      .from(pushSubscriptions)
      .innerJoin(users, eq(users.id, pushSubscriptions.userId))
      .where(eq(users.active, true));
    const plaintext = Buffer.from(JSON.stringify(buildPayload(kind)));
    for (const row of rows) {
      if (!isRole(row.role) || !hasRole(row.role, event.minRole)) continue;
      const outcome = await deliver(row, encryptPayload(plaintext, row));
      if (outcome === "ok") {
        result.sent++;
        await db.update(pushSubscriptions).set({ lastSuccessAt: new Date(), failures: 0 }).where(eq(pushSubscriptions.id, row.id));
      } else if (outcome === "gone") {
        result.removed++;
        await db.delete(pushSubscriptions).where(eq(pushSubscriptions.id, row.id));
      } else {
        result.failed++;
        await db
          .update(pushSubscriptions)
          .set({ failures: sql`${pushSubscriptions.failures} + 1` })
          .where(eq(pushSubscriptions.id, row.id));
      }
    }
    if (result.removed) await writeAudit("system", "push.subscriptions_removed", kind, { count: result.removed, reason: "push_service_gone" });
  } catch (err) {
    console.error(`[push] send failed: ${errorCode(err)}`);
  }
  return result;
}

/** Subscriptions of users who are no longer active, or that kept failing, are deleted. */
export async function pruneSubscriptions(): Promise<number> {
  const db = getDb();
  const inactive = db.select({ id: users.id }).from(users).where(eq(users.active, false));
  const a = await db.delete(pushSubscriptions).where(inArray(pushSubscriptions.userId, inactive));
  const b = await db.delete(pushSubscriptions).where(sql`${pushSubscriptions.failures} >= ${MAX_FAILURES}`);
  const removed = (a.rowCount ?? 0) + (b.rowCount ?? 0);
  if (removed) await writeAudit("system", "push.subscriptions_removed", null, { count: removed, reason: "inactive_or_failing" });
  return removed;
}

/**
 * The worker's pass, once a minute: new open security alerts and access reviews that became due
 * or entered their last days get one notice per kind, and each event is recorded so it is never
 * sent twice. With no keys or no subscriptions it does nothing (no queries beyond one count).
 */
export async function runPushPass(): Promise<{ notices: PushKind[]; removed: number }> {
  if (!vapidKeys()) return { notices: [], removed: 0 };
  const db = getDb();
  const removed = await pruneSubscriptions();
  const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(pushSubscriptions);
  const [alerts, reviews] = await Promise.all([
    db.select({ id: securityAlerts.id, handledAt: securityAlerts.handledAt }).from(securityAlerts).where(isNull(securityAlerts.handledAt)),
    loadReviewStatus().then((m) => [...m.values()]),
  ]);
  if (!alerts.length && !reviews.some((r) => r.state !== "valid")) return { notices: [], removed };
  const sentRows = await db.select({ key: pushNotices.key }).from(pushNotices).where(inArray(pushNotices.kind, ["security_alert", "access_review"]));
  const pending = pendingNotices(alerts, reviews, new Set(sentRows.map((r) => r.key)));
  const notices: PushKind[] = [];
  for (const p of pending) {
    // Recorded first, so a crash mid-send never repeats it; with no subscriptions yet the events
    // are still recorded — a person who subscribes later is not woken by old ones.
    await db
      .insert(pushNotices)
      .values(p.keys.map((key) => ({ key, kind: p.kind })))
      .onConflictDoNothing();
    if (n) await sendNotice(p.kind);
    notices.push(p.kind);
  }
  return { notices, removed };
}

/** Audit writes failing in a process: at most one notice per process every six hours. */
let lastAuditNotice = 0;
export function noticeAuditFailure(): void {
  if (!vapidKeys() || Date.now() - lastAuditNotice < 6 * 3600_000) return;
  lastAuditNotice = Date.now();
  void sendNotice("audit_failure").catch(() => {});
}

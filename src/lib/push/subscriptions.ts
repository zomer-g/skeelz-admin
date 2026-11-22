import { and, eq } from "drizzle-orm";
import { writeAudit } from "@/lib/audit";
import type { SessionUser } from "@/lib/auth/session";
import { getDb } from "@/lib/db/client";
import { pushSubscriptions } from "@/lib/db/schema";
import { allowedEndpoint, validKeys } from "./webpush";

/** What the browser's PushSubscription.toJSON() sends; anything else is refused. */
export function parseSubscription(body: unknown): { endpoint: string; p256dh: string; auth: string } | null {
  if (!body || typeof body !== "object") return null;
  const b = body as { endpoint?: unknown; keys?: { p256dh?: unknown; auth?: unknown } };
  if (typeof b.endpoint !== "string" || !allowedEndpoint(b.endpoint)) return null;
  const p256dh = b.keys?.p256dh;
  const auth = b.keys?.auth;
  if (!validKeys(p256dh, auth)) return null;
  return { endpoint: b.endpoint, p256dh, auth: auth as string };
}

/** A device asks for notices. An endpoint already held by someone else moves to this user (same browser, new sign-in). */
export async function saveSubscription(user: SessionUser, sub: { endpoint: string; p256dh: string; auth: string }, userAgent: string | null): Promise<void> {
  await getDb()
    .insert(pushSubscriptions)
    .values({ userId: user.id, ...sub, userAgent: userAgent?.slice(0, 300) ?? null })
    .onConflictDoUpdate({
      target: pushSubscriptions.endpoint,
      set: { userId: user.id, p256dh: sub.p256dh, auth: sub.auth, userAgent: userAgent?.slice(0, 300) ?? null, failures: 0 },
    });
  // The endpoint is a capability URL of the push service: it is not logged, only the device kind.
  await writeAudit(user.email, "push.subscribed", null, { device: deviceKind(userAgent) });
}

export async function deleteSubscription(user: SessionUser, endpoint: string): Promise<boolean> {
  const res = await getDb()
    .delete(pushSubscriptions)
    .where(and(eq(pushSubscriptions.userId, user.id), eq(pushSubscriptions.endpoint, endpoint)));
  const removed = (res.rowCount ?? 0) > 0;
  if (removed) await writeAudit(user.email, "push.unsubscribed");
  return removed;
}

export async function countSubscriptions(userId: string): Promise<number> {
  return (await getDb().select({ id: pushSubscriptions.id }).from(pushSubscriptions).where(eq(pushSubscriptions.userId, userId))).length;
}

/** A coarse label for the audit entry and the settings page: never the full user agent. */
export function deviceKind(ua: string | null): string {
  if (!ua) return "unknown";
  if (/iPhone|iPad|iPod/.test(ua)) return "ios";
  if (/Android/.test(ua)) return "android";
  if (/Windows/.test(ua)) return "windows";
  if (/Mac OS X/.test(ua)) return "mac";
  if (/Linux/.test(ua)) return "linux";
  return "other";
}

import type { Role } from "@/lib/auth/roles";

/**
 * What a push notice may say. A notice crosses Google's, Apple's, Mozilla's or Microsoft's push
 * servers, so it carries no personal data at all: a fixed Hebrew title and body per kind, the
 * screen to open (where the person signs in and sees the details), and a tag so a newer notice
 * of the same kind replaces the older one. No names, emails, phones, CV words, staff figures or
 * counts. `push.test.ts` pins this.
 */

export type PushKind = "security_alert" | "access_review" | "audit_failure";

export interface PushEvent {
  kind: PushKind;
  /** The role the linked screen asks for; checked against the users table when sending. */
  minRole: Role;
  /** Same-origin path the notice opens. */
  path: string;
  title: string;
  body: string;
}

export const PUSH_EVENTS: Record<PushKind, PushEvent> = {
  security_alert: {
    kind: "security_alert",
    minRole: "admin",
    path: "/admin/security",
    title: "התראת אבטחה חדשה",
    body: "יש התראת אבטחה שממתינה לטיפול. הפרטים במערכת הניהול.",
  },
  access_review: {
    kind: "access_review",
    minRole: "admin",
    path: "/admin/users",
    title: "אישור הרשאות מתקרב",
    body: "יש משתמשים שאישור ההרשאות שלהם פג או עומד לפוג. הפרטים במערכת הניהול.",
  },
  audit_failure: {
    kind: "audit_failure",
    minRole: "admin",
    path: "/admin/audit",
    title: "תקלה ביומן הפעילות",
    body: "רישום ביומן הפעילות נכשל. הפרטים במערכת הניהול.",
  },
};

/** Exactly what goes inside the encrypted message, and nothing else. */
export interface PushPayload {
  title: string;
  body: string;
  url: string;
  tag: string;
}

/** The only builder of a payload: it takes a kind, so nothing from a row can reach it. */
export function buildPayload(kind: PushKind): PushPayload {
  const e = PUSH_EVENTS[kind];
  return { title: e.title, body: e.body, url: e.path, tag: e.kind };
}

/** A path the service worker may open: ours, absolute, and not protocol-relative. */
export function isSafePath(path: unknown): path is string {
  return typeof path === "string" && path.startsWith("/") && !path.startsWith("//") && !path.includes("\\") && !/[\u0000-\u001f]/.test(path);
}

/* ------------------------------------------------------------------ what is new */

export interface AlertRowLike {
  id: number;
  handledAt: Date | null;
  // Other columns (the user's email, the day) may be on the row but are never read here.
}

export interface ReviewLike {
  userId: string;
  state: "valid" | "soon" | "due";
  validUntil: Date | null;
}

export interface PendingNotice {
  kind: PushKind;
  /** The events this notice covers, each recorded in push_notices so it is sent once. */
  keys: string[];
}

/** One key per open alert: a security_alerts row is one event. */
export const alertKey = (a: AlertRowLike) => `alert:${a.id}`;

/** One key per user per review period and state: a renewal or a role change starts a new one. */
export const reviewKey = (r: ReviewLike) => `review:${r.userId}:${r.state}:${r.validUntil ? r.validUntil.toISOString() : "none"}`;

/**
 * The notices to send now: one per kind that has an event not yet sent. Pure — the worker loads
 * the rows and the keys already sent, and records the keys after sending.
 */
export function pendingNotices(alerts: AlertRowLike[], reviews: ReviewLike[], sent: ReadonlySet<string>): PendingNotice[] {
  const out: PendingNotice[] = [];
  const alertKeys = alerts.filter((a) => !a.handledAt).map(alertKey).filter((k) => !sent.has(k));
  if (alertKeys.length) out.push({ kind: "security_alert", keys: alertKeys });
  const reviewKeys = reviews.filter((r) => r.state !== "valid").map(reviewKey).filter((k) => !sent.has(k));
  if (reviewKeys.length) out.push({ kind: "access_review", keys: reviewKeys });
  return out;
}

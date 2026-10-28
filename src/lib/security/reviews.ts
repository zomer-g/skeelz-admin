import { desc, eq } from "drizzle-orm";
import { writeAudit } from "@/lib/audit";
import type { Role } from "@/lib/auth/roles";
import { getDb } from "@/lib/db/client";
import { accessReviews, users } from "@/lib/db/schema";

/**
 * The access review: an admin confirms, user by user, that each active user should still have
 * access with the role they have, and each confirmation holds for 60 days. In its last 10 days the
 * admins see a reminder on every page and may already renew it, for 60 days counted from the end of
 * the current period, so renewing early loses nothing and the users don't all fall due on one day.
 * A user with no confirmation, an expired one, or a role or staff-manager flag changed since is due.
 * Nothing is revoked on its own — the admin changes the role or deactivates the user.
 */

export const REVIEW_DAYS = 60;
/** The last days of a period, when the admins are reminded and may renew. */
export const RENEW_WINDOW_DAYS = 10;
const DAY_MS = 86_400_000;

/** valid: more than the window left; soon: in the window, renewable; due: none, expired or changed. */
export type ReviewState = "valid" | "soon" | "due";

export interface ReviewStatus {
  userId: string;
  lastReviewedAt: Date | null;
  lastReviewedBy: string | null;
  /** The role at that review; a change since then needs a fresh confirmation anyway. */
  lastRole: string | null;
  /** Until when the last confirmation holds; null when there is none. */
  validUntil: Date | null;
  state: ReviewState;
  /** Whole days left until validUntil (0 on the last day); null when due. */
  daysLeft: number | null;
  /** The state is due: kept for the callers that only ask whether something waits. */
  due: boolean;
}

/** A row from before valid_until was stored held for REVIEW_DAYS from when it was made. */
export const validUntilOf = (r: { reviewedAt: Date; validUntil: Date | null }) => r.validUntil ?? new Date(r.reviewedAt.getTime() + REVIEW_DAYS * DAY_MS);

export function reviewState(validUntil: Date | null, changed: boolean, now = new Date()): { state: ReviewState; daysLeft: number | null } {
  if (!validUntil || changed || validUntil.getTime() <= now.getTime()) return { state: "due", daysLeft: null };
  const daysLeft = Math.floor((validUntil.getTime() - now.getTime()) / DAY_MS);
  return { state: daysLeft < RENEW_WINDOW_DAYS ? "soon" : "valid", daysLeft };
}

/** What a new confirmation holds until: a renewal adds REVIEW_DAYS to the current period; anything else starts now. */
export function nextValidUntil(current: { validUntil: Date | null; state: ReviewState }, now = new Date()): Date {
  const from = current.state === "soon" && current.validUntil ? current.validUntil : now;
  return new Date(from.getTime() + REVIEW_DAYS * DAY_MS);
}

export async function loadReviewStatus(now = new Date()): Promise<Map<string, ReviewStatus>> {
  const db = getDb();
  const [active, reviews] = await Promise.all([
    db.select({ id: users.id, role: users.role, staffManager: users.staffManager }).from(users).where(eq(users.active, true)),
    db
      .selectDistinctOn([accessReviews.userId], {
        userId: accessReviews.userId,
        reviewedAt: accessReviews.reviewedAt,
        reviewedBy: accessReviews.reviewedBy,
        role: accessReviews.role,
        staffManager: accessReviews.staffManager,
        validUntil: accessReviews.validUntil,
      })
      .from(accessReviews)
      .orderBy(accessReviews.userId, desc(accessReviews.reviewedAt)),
  ]);
  const last = new Map(reviews.map((r) => [r.userId, r]));
  return new Map(
    active.map((u) => {
      const r = last.get(u.id);
      const validUntil = r ? validUntilOf(r) : null;
      // A change of role or of the staff-manager flag since the last confirmation needs a fresh one.
      const changed = Boolean(r) && (r!.role !== u.role || r!.staffManager !== u.staffManager);
      const { state, daysLeft } = reviewState(validUntil, changed, now);
      return [
        u.id,
        { userId: u.id, lastReviewedAt: r?.reviewedAt ?? null, lastReviewedBy: r?.reviewedBy ?? null, lastRole: r?.role ?? null, validUntil, state, daysLeft, due: state === "due" },
      ];
    }),
  );
}

/** Users whose confirmation is due, and those in their last days, for the bar on every page. */
export async function countReviews(): Promise<{ due: number; soon: number }> {
  const all = [...(await loadReviewStatus()).values()];
  return { due: all.filter((s) => s.state === "due").length, soon: all.filter((s) => s.state === "soon").length };
}

/**
 * An admin confirms one user's access and role: due → 60 days from now; in the last days → 60 more
 * days after the current period. A confirmation that still has more than the window left is not renewed.
 */
export async function confirmAccess(admin: string, userId: string): Promise<void> {
  const db = getDb();
  const [user] = await db
    .select({ email: users.email, role: users.role, staffManager: users.staffManager, active: users.active })
    .from(users)
    .where(eq(users.id, userId));
  if (!user?.active) return;
  const current = (await loadReviewStatus()).get(userId);
  if (!current || current.state === "valid") return;
  const validUntil = nextValidUntil(current);
  await db.insert(accessReviews).values({ userId, role: user.role as Role, staffManager: user.staffManager, reviewedBy: admin, validUntil });
  await writeAudit(admin, "access.reviewed", user.email, {
    role: user.role,
    staffManager: user.staffManager,
    renewal: current.state === "soon",
    validUntil: validUntil.toISOString(),
  });
}

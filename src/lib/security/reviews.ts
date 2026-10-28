import { desc, eq, sql } from "drizzle-orm";
import { writeAudit } from "@/lib/audit";
import type { Role } from "@/lib/auth/roles";
import { israelDay } from "@/lib/dashboard/params";
import { getDb } from "@/lib/db/client";
import { accessReviews, users } from "@/lib/db/schema";

/**
 * The monthly access review: every Israel month an admin confirms, user by user, that each active
 * user should still have access with the role they have. Until then the admins see a reminder on
 * every page. Nothing is revoked on its own — the admin changes the role or deactivates the user.
 */

/** "2026-10": the Israel month a review counts for. */
export const reviewMonth = (d = new Date()) => israelDay(d).slice(0, 7);

export interface ReviewStatus {
  userId: string;
  lastReviewedAt: Date | null;
  lastReviewedBy: string | null;
  /** The role at that review; a change since then needs a fresh confirmation anyway. */
  lastRole: string | null;
  /** No confirmation this month, or the role or staff-manager flag changed after it. */
  due: boolean;
}

export async function loadReviewStatus(): Promise<Map<string, ReviewStatus>> {
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
      })
      .from(accessReviews)
      .orderBy(accessReviews.userId, desc(accessReviews.reviewedAt)),
  ]);
  const last = new Map(reviews.map((r) => [r.userId, r]));
  const month = reviewMonth();
  return new Map(
    active.map((u) => {
      const r = last.get(u.id);
      // A change of role or of the staff-manager flag since the last confirmation needs a fresh one.
      const due = !r || reviewMonth(r.reviewedAt) !== month || r.role !== u.role || r.staffManager !== u.staffManager;
      return [u.id, { userId: u.id, lastReviewedAt: r?.reviewedAt ?? null, lastReviewedBy: r?.reviewedBy ?? null, lastRole: r?.role ?? null, due }];
    }),
  );
}

export async function countDueReviews(): Promise<number> {
  return [...(await loadReviewStatus()).values()].filter((s) => s.due).length;
}

/** An admin confirms one user's access and role for this month. */
export async function confirmAccess(admin: string, userId: string): Promise<void> {
  const db = getDb();
  const [user] = await db
    .select({ email: users.email, role: users.role, staffManager: users.staffManager, active: users.active })
    .from(users)
    .where(eq(users.id, userId));
  if (!user?.active) return;
  await db.insert(accessReviews).values({ userId, role: user.role as Role, staffManager: user.staffManager, reviewedBy: admin });
  await writeAudit(admin, "access.reviewed", user.email, { role: user.role, staffManager: user.staffManager, month: reviewMonth() });
}

/** How many reviews were done this month, for the review card's summary. */
export async function reviewsThisMonth(): Promise<number> {
  const month = reviewMonth();
  const [r] = await getDb()
    .select({ n: sql<number>`count(DISTINCT ${accessReviews.userId})::int` })
    .from(accessReviews)
    .where(sql`to_char(${accessReviews.reviewedAt} AT TIME ZONE 'Asia/Jerusalem', 'YYYY-MM') = ${month}`);
  return r?.n ?? 0;
}

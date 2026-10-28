"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { writeAudit } from "@/lib/audit";
import { AuthError, requireUser } from "@/lib/auth/session";
import { getDb } from "@/lib/db/client";
import { sfUser, users } from "@/lib/db/schema";
import { isSfId } from "@/lib/entities/search";

// Who is which Salesforce / monday user decides whose activity and hours the staff screens attribute to
// whom (docs/staff.md), so changing a link takes an admin who is also a staff manager. Checked here, on
// every call, whatever the page showed.

const PATH = "/admin/staff-links";
const UUID_RE = /^[0-9a-f-]{36}$/i;
const MONDAY_ID = /^\d{1,15}$/;

async function requireLinker() {
  const user = await requireUser("admin");
  if (!user.staffManager) throw new AuthError(403, "רק אדמין שהוא גם מנהל עובדים יכול לשנות קישורי עובדים");
  return user;
}

async function loadTarget(id: string) {
  if (!UUID_RE.test(id)) throw new Error("invalid id");
  const [target] = await getDb()
    .select({ id: users.id, email: users.email, sfUserId: users.sfUserId, mondayUserId: users.mondayUserId })
    .from(users)
    .where(eq(users.id, id))
    .limit(1);
  if (!target) throw new Error("user not found");
  return target;
}

/** Links a site user to their Salesforce User (or clears it). */
export async function linkSfUser(form: FormData): Promise<void> {
  const admin = await requireLinker();
  const sfUserId = String(form.get("sfUserId") ?? "").trim();
  if (sfUserId && !isSfId(sfUserId)) throw new Error("invalid Salesforce user");
  const target = await loadTarget(String(form.get("id") ?? ""));
  if ((target.sfUserId ?? "") === sfUserId) return;

  const db = getDb();
  if (sfUserId) {
    const [known] = await db.select({ id: sfUser.id }).from(sfUser).where(eq(sfUser.id, sfUserId)).limit(1);
    if (!known) throw new Error("unknown Salesforce user");
    // One site user per Salesforce user: someone else's activity must never become this person's.
    const [taken] = await db.select({ id: users.id }).from(users).where(eq(users.sfUserId, sfUserId)).limit(1);
    if (taken) throw new Error("Salesforce user already linked");
  }
  await db.update(users).set({ sfUserId: sfUserId || null }).where(eq(users.id, target.id));
  await writeAudit(admin.email, sfUserId ? "user.sf_linked" : "user.sf_unlinked", target.email, { from: target.sfUserId, to: sfUserId || null });
  revalidatePath(PATH);
}

/** Which monday user an employee is: their done tasks there become their hours. */
export async function linkMondayUser(form: FormData): Promise<void> {
  const admin = await requireLinker();
  const mondayUserId = String(form.get("mondayUserId") ?? "").trim();
  if (mondayUserId && !MONDAY_ID.test(mondayUserId)) throw new Error("invalid monday user id");
  const target = await loadTarget(String(form.get("id") ?? ""));
  if ((target.mondayUserId ?? "") === mondayUserId) return;

  const db = getDb();
  if (mondayUserId) {
    // One employee per monday user: someone else's hours must never become this person's.
    const [taken] = await db.select({ id: users.id }).from(users).where(eq(users.mondayUserId, mondayUserId)).limit(1);
    if (taken) throw new Error("monday user already linked");
  }
  await db.update(users).set({ mondayUserId: mondayUserId || null }).where(eq(users.id, target.id));
  await writeAudit(admin.email, mondayUserId ? "staff.monday_linked" : "staff.monday_unlinked", target.email);
  revalidatePath(PATH);
  revalidatePath("/staff", "layout");
}

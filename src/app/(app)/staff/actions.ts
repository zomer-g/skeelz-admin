"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { writeAudit } from "@/lib/audit";
import { requireStaffManager } from "@/lib/auth/session";
import { getDb } from "@/lib/db/client";
import { users } from "@/lib/db/schema";
import { staffSourceStatus, syncMonday } from "@/lib/staff/monday";

// Staff data (docs/staff.md): every action checks for a staff manager itself, whatever the page showed.
// The audit entries say who did what to whom, never the hours.

const UUID_RE = /^[0-9a-f-]{36}$/i;
const MONDAY_ID = /^\d{1,15}$/;

export type StaffActionState = { ok: boolean; message: string } | null;

/** Which monday user an employee is: their done tasks there become their hours. */
export async function setMondayUser(form: FormData): Promise<void> {
  const manager = await requireStaffManager();
  const id = String(form.get("id") ?? "");
  const mondayUserId = String(form.get("mondayUserId") ?? "").trim();
  if (!UUID_RE.test(id)) throw new Error("invalid id");
  if (mondayUserId && !MONDAY_ID.test(mondayUserId)) throw new Error("invalid monday user id");

  const db = getDb();
  const [target] = await db.select({ id: users.id, email: users.email, mondayUserId: users.mondayUserId }).from(users).where(eq(users.id, id)).limit(1);
  if (!target) throw new Error("user not found");
  if ((target.mondayUserId ?? "") === mondayUserId) return;
  if (mondayUserId) {
    // One employee per monday user: someone else's hours must never become this person's.
    const [taken] = await db.select({ id: users.id }).from(users).where(eq(users.mondayUserId, mondayUserId)).limit(1);
    if (taken) throw new Error("monday user already linked");
  }
  await db.update(users).set({ mondayUserId: mondayUserId || null }).where(eq(users.id, target.id));
  await writeAudit(manager.email, mondayUserId ? "staff.monday_linked" : "staff.monday_unlinked", target.email);
  revalidatePath("/staff");
}

/** Pulls monday.com now instead of waiting for the hourly sync. */
export async function syncStaffNow(_prev: StaffActionState): Promise<StaffActionState> {
  const manager = await requireStaffManager();
  const state = await staffSourceStatus();
  if (state?.lastStartedAt && Date.now() - state.lastStartedAt.getTime() < 60_000) {
    return { ok: false, message: "סנכרון רץ לפני פחות מדקה. אפשר לנסות שוב בעוד רגע" };
  }
  await writeAudit(manager.email, "staff.sync_requested", "monday");
  const r = await syncMonday();
  revalidatePath("/staff", "layout");
  if (r.skipped) return { ok: false, message: "החיבור למאנדיי לא הוגדר: חסר המשתנה MONDAY_TOKEN בשרת" };
  if (r.error) return { ok: false, message: `הסנכרון נכשל: ${r.error}` };
  return { ok: true, message: `הסנכרון הסתיים: ${r.rows} משימות` };
}

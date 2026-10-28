"use server";

import { revalidatePath } from "next/cache";
import { writeAudit } from "@/lib/audit";
import { requireStaffManager } from "@/lib/auth/session";
import { staffSourceStatus, syncMonday } from "@/lib/staff/monday";

// Staff data (docs/staff.md): every action checks for a staff manager itself, whatever the page showed.
// The audit entries say who did what to whom, never the hours.

export type StaffActionState = { ok: boolean; message: string } | null;

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
  revalidatePath("/admin/sync");
  if (r.skipped) return { ok: false, message: "החיבור למאנדיי לא הוגדר: חסר המשתנה MONDAY_TOKEN בשרת" };
  if (r.error) return { ok: false, message: `הסנכרון נכשל: ${r.error}` };
  return { ok: true, message: `הסנכרון הסתיים: ${r.rows} משימות` };
}

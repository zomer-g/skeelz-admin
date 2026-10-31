"use server";

import { revalidatePath } from "next/cache";
import { writeAudit } from "@/lib/audit";
import { requireStaffManager } from "@/lib/auth/session";
import { deleteTimeEntries, importTimesheet, loadDemoTimesheet } from "@/lib/staff/timesheet";

// Timesheets (docs/staff.md): every action checks for a staff manager itself, whatever the page showed.
// The audit entries say who did what and how many rows, never the hours.

export type TimesheetActionState = { ok: boolean; message: string; errors?: { line: number; message: string }[] } | null;

const MAX_TEXT = 1_000_000;

/** Builds the FICTITIOUS demo timesheet of שרית שביט from her own Salesforce tasks, replacing the previous demo. */
export async function loadDemo(_prev: TimesheetActionState): Promise<TimesheetActionState> {
  const manager = await requireStaffManager();
  const r = await loadDemoTimesheet();
  if (!r) return { ok: false, message: "אין משתמש במערכת שמקושר למשתמש ה-Salesforce של שרית שביט. מקשרים בניהול › קישור עובדים" };
  await writeAudit(manager.email, "staff.timesheet_demo_loaded", r.userId, { windows: r.windows });
  revalidatePath("/staff/windows");
  return { ok: true, message: `נטען דוח שעות דמו ל${r.name}: ${r.windows} חלונות עבודה` };
}

/** Removes every demo row, of everyone. */
export async function deleteDemo(_prev: TimesheetActionState): Promise<TimesheetActionState> {
  const manager = await requireStaffManager();
  const n = await deleteTimeEntries("demo");
  await writeAudit(manager.email, "staff.timesheet_demo_deleted", "demo", { rows: n });
  revalidatePath("/staff/windows");
  return { ok: true, message: n ? `נמחקו ${n} שורות דמו` : "לא היו נתוני דמו" };
}

/** A real timesheet pasted or uploaded as text: who, date, from, to (Israel time). */
export async function importSheet(_prev: TimesheetActionState, form: FormData): Promise<TimesheetActionState> {
  const manager = await requireStaffManager();
  const file = form.get("file");
  const pasted = String(form.get("text") ?? "");
  const text = file instanceof File && file.size ? await file.text() : pasted;
  if (!text.trim()) return { ok: false, message: "לא הודבק טקסט ולא נבחר קובץ" };
  if (text.length > MAX_TEXT) return { ok: false, message: "הקובץ גדול מדי" };
  const r = await importTimesheet(text);
  await writeAudit(manager.email, "staff.timesheet_imported", "sheet", { rows: r.rows, people: r.people, days: r.days, errors: r.errors.length });
  revalidatePath("/staff/windows");
  const errors = r.errors.slice(0, 50);
  if (!r.rows) return { ok: false, message: "לא נשמרה אף שורה", errors };
  return {
    ok: !r.errors.length,
    message: `נשמרו ${r.rows} חלונות של ${r.people} עובדים ב-${r.days} ימים${r.errors.length ? `. ${r.errors.length} שורות לא נקלטו` : ""}`,
    errors,
  };
}

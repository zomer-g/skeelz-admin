"use server";

import { revalidatePath } from "next/cache";
import { writeAudit } from "@/lib/audit";
import { requireStaffManager } from "@/lib/auth/session";
import { parseDashboardParams } from "@/lib/dashboard/params";
import { addSheetSource, removeSheetSource, spreadsheetIdFrom, syncTimesheetSheets } from "@/lib/staff/gsheet";
import { deleteTimeEntries, fitReconstructedTimesheet, importTimesheet, loadDemoTimesheet } from "@/lib/staff/timesheet";

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
  const reconstructed = form.get("reconstructed") === "on";
  const r = await importTimesheet(text, { reconstructed });
  await writeAudit(manager.email, "staff.timesheet_imported", reconstructed ? "manual" : "sheet", {
    rows: r.rows,
    people: r.people,
    days: r.days,
    errors: r.errors.length,
    reconstructed,
  });
  revalidatePath("/staff/windows");
  const errors = r.errors.slice(0, 50);
  if (!r.rows) return { ok: false, message: "לא נשמרה אף שורה", errors };
  return {
    ok: !r.errors.length,
    message: `נשמרו ${r.rows} חלונות של ${r.people} עובדים ב-${r.days} ימים${r.errors.length ? `. ${r.errors.length} שורות לא נקלטו` : ""}`,
    errors,
  };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Fits one employee's reconstructed timesheet in the shown range to their Salesforce actions (docs/staff.md,
 * "התאמת שחזור לפעולות"): every action inside a window, the month's total kept from breaks. Only a reconstruction is rewritten.
 */
export async function fitTimesheet(_prev: TimesheetActionState, form: FormData): Promise<TimesheetActionState> {
  const manager = await requireStaffManager();
  const userId = String(form.get("userId") ?? "");
  if (!UUID.test(userId)) return { ok: false, message: "עובד לא תקין" };
  const p = parseDashboardParams({ range: "custom", from: String(form.get("from") ?? ""), to: String(form.get("to") ?? "") });
  const r = await fitReconstructedTimesheet(userId, p.fromDay, p.toDay, p.from, p.to);
  if (!r) return { ok: true, message: "כל הפעולות כבר בתוך חלונות העבודה, אין מה להתאים" };
  if ("error" in r) return { ok: false, message: r.error };
  await writeAudit(manager.email, "staff.timesheet_fitted", userId, {
    from: p.fromDay,
    to: p.toDay,
    covered: r.covered,
    splits: r.splits,
    windowsBefore: r.windowsBefore,
    windowsAfter: r.windowsAfter,
  });
  revalidatePath("/staff/windows");
  revalidatePath("/staff");
  const short = r.addedMinutes - r.freedMinutes;
  return {
    ok: true,
    message: `הדוח של ${r.name} הותאם: ${r.covered} פעולות נכנסו לשעות העבודה, ${r.splits} חלונות פוצלו (${r.windowsBefore} חלונות לפני, ${r.windowsAfter} אחרי). ${
      short > 0 ? `לא היו מספיק הפסקות, ולכן סך השעות גדל ב-${short} דקות.` : "סך השעות לא השתנה."
    }`,
  };
}

/** Adds a Google Sheet to pull timesheets from, and pulls at once so the result shows. */
export async function addSheet(_prev: TimesheetActionState, form: FormData): Promise<TimesheetActionState> {
  const manager = await requireStaffManager();
  const id = spreadsheetIdFrom(String(form.get("sheet") ?? ""));
  if (!id) return { ok: false, message: "זה לא נראה כמו קישור ל-Google Sheet" };
  await addSheetSource(id, manager.email);
  await writeAudit(manager.email, "staff.sheet_source_added", id);
  const r = await syncTimesheetSheets(manager.email);
  revalidatePath("/staff/windows");
  return r.error ? { ok: false, message: `הגיליון נוסף, אבל המשיכה נכשלה: ${r.error}` } : { ok: true, message: "הגיליון נוסף ונמשך" };
}

export async function removeSheet(_prev: TimesheetActionState, form: FormData): Promise<TimesheetActionState> {
  const manager = await requireStaffManager();
  const id = spreadsheetIdFrom(String(form.get("sheet") ?? ""));
  if (!id || !(await removeSheetSource(id))) return { ok: false, message: "הגיליון לא נמצא" };
  await writeAudit(manager.email, "staff.sheet_source_removed", id);
  revalidatePath("/staff/windows");
  return { ok: true, message: "המשיכה מהגיליון הופסקה. מה שכבר נקלט נשאר" };
}

export async function pullSheets(_prev: TimesheetActionState): Promise<TimesheetActionState> {
  const manager = await requireStaffManager();
  const r = await syncTimesheetSheets(manager.email);
  revalidatePath("/staff/windows");
  if (r.error) return { ok: false, message: `המשיכה נכשלה: ${r.error}` };
  return { ok: true, message: r.changed ? `עודכנו ${r.changed} גיליונות` : "אין שינוי מאז המשיכה הקודמת" };
}

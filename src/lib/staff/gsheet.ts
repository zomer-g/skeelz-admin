import { createHash } from "node:crypto";
import { eq } from "drizzle-orm";
import { writeAudit } from "@/lib/audit";
import { getDb } from "@/lib/db/client";
import { sfUser, staffSheetSources, staffSourceState, users, type SheetTabResult } from "@/lib/db/schema";
import { googleConfigured, googleFetch } from "@/lib/google/auth";
import { safeErrorMessage } from "@/lib/log";
import { replaceTimeEntries } from "./timesheet";
import { parseHoursTab, tabEmployeeKey } from "./windows";

/**
 * Timesheets pulled from Google Sheets (docs/staff.md, "משיכה מגוגל שיטס"): each listed spreadsheet,
 * shared (view only) with the site's Google service account, has a tab per employee ("שרית נובמבר 26").
 * The worker reads them every few minutes; every tab's days replace that employee's 'sheet' rows of
 * those days, so the dashboard follows the sheet without a manual import. Read only: the Sheets API
 * with the spreadsheets.readonly scope. Staff data: called only by the worker and by staff-manager actions.
 */

export const GSHEET_SOURCE = "gsheet";
const API = "https://sheets.googleapis.com/v4/spreadsheets";
/** A spreadsheet id as Google makes them (the part of the URL after /d/). */
const SHEET_ID = /^[A-Za-z0-9_-]{25,100}$/;

/** The spreadsheet id from a pasted link or id, or null. */
export function spreadsheetIdFrom(input: string): string | null {
  const s = input.trim();
  const m = s.match(/\/spreadsheets\/d\/([A-Za-z0-9_-]+)/);
  const id = m ? m[1]! : s;
  return SHEET_ID.test(id) ? id : null;
}

interface SheetMeta {
  properties?: { title?: string };
  sheets?: { properties?: { title?: string } }[];
}

const quoteTab = (t: string) => `'${t.replace(/'/g, "''")}'`;

async function readSpreadsheet(id: string): Promise<{ title: string | null; tabs: { title: string; values: string[][] }[] }> {
  const meta = await googleFetch<SheetMeta>(`${API}/${id}?fields=properties.title,sheets.properties.title`);
  const titles = (meta.sheets ?? []).map((s) => s.properties?.title ?? "").filter(Boolean);
  if (!titles.length) return { title: meta.properties?.title ?? null, tabs: [] };
  const params = new URLSearchParams({ valueRenderOption: "FORMATTED_VALUE", majorDimension: "ROWS" });
  for (const t of titles) params.append("ranges", `${quoteTab(t)}!A1:L200`);
  const data = await googleFetch<{ valueRanges?: { values?: string[][] }[] }>(`${API}/${id}/values:batchGet?${params.toString()}`);
  return {
    title: meta.properties?.title ?? null,
    tabs: titles.map((title, i) => ({ title, values: data.valueRanges?.[i]?.values ?? [] })),
  };
}

/** Employees by the first word of their names (site name and Salesforce name); a word two people share matches nobody. */
async function employeesByFirstWord(): Promise<Map<string, { id: string; name: string } | null>> {
  const rows = await getDb()
    .select({ id: users.id, name: users.name, email: users.email, sfName: sfUser.name })
    .from(users)
    .leftJoin(sfUser, eq(sfUser.id, users.sfUserId))
    .where(eq(users.active, true));
  const map = new Map<string, { id: string; name: string } | null>();
  for (const u of rows) {
    const label = u.sfName ?? u.name ?? u.email;
    const words = new Set([u.name, u.sfName].map((n) => n?.trim().split(/\s+/)[0]?.toLowerCase()).filter((w): w is string => Boolean(w)));
    for (const w of words) {
      const seen = map.get(w);
      if (seen === undefined) map.set(w, { id: u.id, name: label });
      else if (seen && seen.id !== u.id) map.set(w, null);
    }
  }
  return map;
}

export interface SheetSyncResult {
  sources: number;
  changed: number;
  windows: number;
  error: string | null;
}

/** Reads every listed spreadsheet and stores what changed. `actor` is who the audit entry names. */
export async function syncTimesheetSheets(actor = "system"): Promise<SheetSyncResult> {
  const db = getDb();
  const started = new Date();
  await db
    .insert(staffSourceState)
    .values({ source: GSHEET_SOURCE, lastStartedAt: started })
    .onConflictDoUpdate({ target: staffSourceState.source, set: { lastStartedAt: started } });
  if (!googleConfigured()) {
    const error = "חשבון השירות של Google לא מוגדר";
    await db.update(staffSourceState).set({ lastError: error }).where(eq(staffSourceState.source, GSHEET_SOURCE));
    return { sources: 0, changed: 0, windows: 0, error };
  }
  const sources = await db.select().from(staffSheetSources);
  const people = sources.length ? await employeesByFirstWord() : new Map();
  let changed = 0;
  let windows = 0;
  let firstError: string | null = null;

  for (const src of sources) {
    try {
      const sheet = await readSpreadsheet(src.spreadsheetId);
      const results: SheetTabResult[] = [];
      const writes: { userId: string; rows: ReturnType<typeof parseHoursTab>["rows"]; days: string[] }[] = [];
      for (const tab of sheet.tabs) {
        const key = tabEmployeeKey(tab.title);
        if (!key) continue;
        const who = people.get(key);
        if (!who) {
          results.push({ tab: tab.title, employee: null, windows: 0, days: 0, error: who === null ? "השם מתאים ליותר מעובד אחד" : "אין עובד פעיל בשם הזה" });
          continue;
        }
        const parsed = parseHoursTab(tab.values);
        results.push({ tab: tab.title, employee: who.name, windows: parsed.rows.length, days: parsed.days.length, error: parsed.errors[0] ?? null });
        if (parsed.days.length) writes.push({ userId: who.id, rows: parsed.rows, days: parsed.days });
      }
      const hash = createHash("sha256")
        .update(JSON.stringify(writes.map((w) => [w.userId, w.days, w.rows.map((r) => [r.start.getTime(), r.end.getTime()])])))
        .digest("hex");
      if (hash !== src.lastHash) {
        for (const w of writes) windows += await replaceTimeEntries(w.userId, "sheet", w.rows, w.days);
        changed += 1;
        await writeAudit(actor, "staff.timesheet_imported", "gsheet", {
          spreadsheet: src.spreadsheetId,
          people: writes.length,
          rows: writes.reduce((t, w) => t + w.rows.length, 0),
          days: writes.reduce((t, w) => t + w.days.length, 0),
        });
      }
      await db
        .update(staffSheetSources)
        .set({ title: sheet.title, lastSyncedAt: new Date(), lastError: null, lastHash: hash, lastResult: results })
        .where(eq(staffSheetSources.spreadsheetId, src.spreadsheetId));
    } catch (err) {
      const error = safeErrorMessage(err);
      firstError ??= error;
      await db.update(staffSheetSources).set({ lastSyncedAt: new Date(), lastError: error }).where(eq(staffSheetSources.spreadsheetId, src.spreadsheetId));
    }
  }
  await db
    .update(staffSourceState)
    .set({ lastSuccessAt: firstError ? undefined : new Date(), lastError: firstError, items: windows })
    .where(eq(staffSourceState.source, GSHEET_SOURCE));
  return { sources: sources.length, changed, windows, error: firstError };
}

export async function listSheetSources() {
  return getDb().select().from(staffSheetSources).orderBy(staffSheetSources.addedAt);
}

export async function addSheetSource(spreadsheetId: string, by: string): Promise<void> {
  await getDb().insert(staffSheetSources).values({ spreadsheetId, addedBy: by }).onConflictDoNothing();
}

/** Stops pulling a spreadsheet. What it already brought in stays, as any imported report does. */
export async function removeSheetSource(spreadsheetId: string): Promise<boolean> {
  const r = await getDb().delete(staffSheetSources).where(eq(staffSheetSources.spreadsheetId, spreadsheetId)).returning({ id: staffSheetSources.spreadsheetId });
  return r.length > 0;
}

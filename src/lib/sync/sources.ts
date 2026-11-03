/**
 * The sources that /admin/sync lists, what each one's objects are called, and the update log
 * built from `sync_runs`: one entry per run of a source, not one per object.
 */

export type SourceId = "salesforce" | "ga" | "gtm" | "smoov" | "monday";

export const SOURCE_LABELS: Record<SourceId, string> = {
  salesforce: "Salesforce",
  ga: "Google Analytics",
  gtm: "Google Tag Manager",
  smoov: "SMOOV",
  monday: "monday.com",
};

/** Hebrew names for the objects inside a source; the technical name is shown beside them. */
export const OBJECT_LABELS: Record<string, string> = {
  Account: "חשבונות (חברות ומעסיקים)",
  AccountHistory: "היסטוריית סטטוס מעסיק",
  Case: "פניות (משרות, הגשות, לידים)",
  CaseHistory: "היסטוריית סטטוסים",
  Contact: "אנשי קשר (מועמדים)",
  CvTopics: "תחומים בקורות חיים",
  EmailMessage: "מיילים",
  Event: "פגישות",
  Files: "קבצים מקושרים",
  RecordType: "סוגי רשומה",
  Task: "שיחות ומשימות",
  User: "משתמשי Salesforce",
  GA4: "דוחות Google Analytics",
  GTM: "קונטיינר Tag Manager",
  SMOOV: "רשימות וקמפיינים",
  SMOOV_PUSH: "דחיפה לרשימת מחפשי העבודה",
  monday: "שעות עובדים",
};

export function sourceOf(object: string): SourceId {
  if (object === "GA4") return "ga";
  if (object === "GTM") return "gtm";
  if (object === "SMOOV" || object === "SMOOV_PUSH") return "smoov";
  if (object === "monday") return "monday";
  return "salesforce";
}

/** The source a queued request from /admin/sync refreshes ("marketing" alone is Google and SMOOV together). */
export function sourcesOfRequest(mode: string): SourceId[] {
  if (mode === "marketing") return ["ga", "gtm", "smoov"];
  if (mode === "marketing:GA4") return ["ga"];
  if (mode === "marketing:GTM") return ["gtm"];
  if (mode === "marketing:SMOOV") return ["smoov"];
  return ["salesforce"];
}

export interface RunRow {
  id: number;
  object: string;
  mode: string;
  trigger: string;
  startedAt: Date;
  finishedAt: Date | null;
  upserted: number | null;
  deleted: number | null;
  error: string | null;
  note: string | null;
}

export interface RunGroup {
  id: number;
  source: SourceId;
  mode: string;
  trigger: string;
  startedAt: Date;
  /** Null while one of its objects is still running. */
  finishedAt: Date | null;
  upserted: number;
  deleted: number;
  failed: string[];
  runs: RunRow[];
}

/** Objects of one run start one after another; a gap this long means a new run. */
const SAME_RUN_GAP_MS = 3 * 60_000;

/** Groups runs (newest first, as read) into one entry per source run. */
export function groupRuns(rows: RunRow[], limit: number): RunGroup[] {
  const groups: RunGroup[] = [];
  for (const r of rows) {
    const source = sourceOf(r.object);
    const last = groups.at(-1);
    const joins =
      last &&
      last.source === source &&
      last.mode === r.mode &&
      last.trigger === r.trigger &&
      !last.runs.some((x) => x.object === r.object) &&
      last.startedAt.getTime() - (r.finishedAt ?? r.startedAt).getTime() < SAME_RUN_GAP_MS;
    if (joins) {
      last.runs.unshift(r);
      last.startedAt = r.startedAt;
      if (!r.finishedAt) last.finishedAt = null;
      last.upserted += r.upserted ?? 0;
      last.deleted += r.deleted ?? 0;
      if (r.error) last.failed.unshift(r.object);
      continue;
    }
    if (groups.length === limit) break;
    groups.push({
      id: r.id,
      source,
      mode: r.mode,
      trigger: r.trigger,
      startedAt: r.startedAt,
      finishedAt: r.finishedAt,
      upserted: r.upserted ?? 0,
      deleted: r.deleted ?? 0,
      failed: r.error ? [r.object] : [],
      runs: [r],
    });
  }
  return groups;
}

/** Who started a run: the person's address for a request from the screen, else the schedule. */
export function triggerLabel(trigger: string): string {
  return trigger.startsWith("manual:") ? trigger.slice("manual:".length) : "אוטומטי";
}

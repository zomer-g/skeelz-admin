/**
 * Work windows from a timesheet and the Salesforce actions done inside them (docs/staff.md,
 * "פעולות ביחידת זמן"). Pure functions only, no database: the page's loader (`timesheet.ts`)
 * feeds them, and `windows.test.ts` pins every rule.
 */

export const TIME_SOURCES = ["demo", "sheet", "api", "manual"] as const;
export type TimeSource = (typeof TIME_SOURCES)[number];

/** An action is credited with the minutes since the one before it, at most this many. */
export const ATTRIBUTION_CAP_MIN = 45;
/** The demo timesheet: a window opens this long before the first task and closes this long after the last. */
export const DEMO_PAD_MIN = 15;
/** The demo timesheet: a pause longer than this between two tasks splits the day into two windows. */
export const DEMO_SPLIT_GAP_MIN = 120;

const MIN = 60_000;
const QUARTER = 15 * MIN;
const TZ = "Asia/Jerusalem";
const DAY_FMT = new Intl.DateTimeFormat("en-CA", { timeZone: TZ });

/** The Israel calendar day of an instant, YYYY-MM-DD. */
export const israelDayOf = (d: Date) => DAY_FMT.format(d);

export interface TimeWindow {
  /** The Israel day the window belongs to, YYYY-MM-DD. */
  workDate: string;
  start: Date;
  end: Date;
}

export interface WorkWindow extends TimeWindow {
  /** Some of it comes from the demo timesheet. */
  demo: boolean;
}

/* ------------------------------------------------------------------ demo */

/**
 * A FICTITIOUS timesheet made from an employee's own task times: per Israel day, from the first
 * task minus 15 minutes (down to the quarter hour) to the last task plus 15 minutes (up to the
 * quarter hour), split in two wherever two consecutive tasks are more than two hours apart.
 */
export function demoWindows(times: readonly Date[]): TimeWindow[] {
  const sorted = times.filter((t) => !Number.isNaN(t.getTime())).sort((a, b) => a.getTime() - b.getTime());
  const out: TimeWindow[] = [];
  let group: Date[] = [];
  const flush = () => {
    const first = group[0];
    const last = group[group.length - 1];
    if (first && last) {
      out.push({
        workDate: israelDayOf(first),
        // Israel's offset is whole hours, so quarter hours in UTC are quarter hours in Israel.
        start: new Date(Math.floor((first.getTime() - DEMO_PAD_MIN * MIN) / QUARTER) * QUARTER),
        end: new Date(Math.ceil((last.getTime() + DEMO_PAD_MIN * MIN) / QUARTER) * QUARTER),
      });
    }
    group = [];
  };
  for (const t of sorted) {
    const prev = group[group.length - 1];
    if (prev && (israelDayOf(prev) !== israelDayOf(t) || t.getTime() - prev.getTime() > DEMO_SPLIT_GAP_MIN * MIN)) flush();
    group.push(t);
  }
  flush();
  return out;
}

/* ------------------------------------------------------------- windows */

export interface Entry extends TimeWindow {
  userId: string;
  source: string;
}

/**
 * A real timesheet wins over the demo: for an employee and a day that has rows from any other
 * source, that day's demo rows are left out, so loading the real file never counts a day twice.
 */
export function preferReal<T extends Entry>(entries: readonly T[]): T[] {
  const real = new Set(entries.filter((e) => e.source !== "demo").map((e) => `${e.userId}|${e.workDate}`));
  return entries.filter((e) => e.source !== "demo" || !real.has(`${e.userId}|${e.workDate}`));
}

/** One employee's windows, overlapping or touching ones merged, so no minute is counted twice. Sorted by start. */
export function mergeWindows(windows: readonly (TimeWindow & { source?: string; demo?: boolean })[]): WorkWindow[] {
  const sorted = windows
    .filter((w) => w.end.getTime() > w.start.getTime())
    .map((w) => ({ workDate: w.workDate, start: w.start, end: w.end, demo: Boolean(w.demo) || w.source === "demo" }))
    .sort((a, b) => a.start.getTime() - b.start.getTime());
  const out: WorkWindow[] = [];
  for (const w of sorted) {
    const cur = out[out.length - 1];
    if (cur && w.start.getTime() <= cur.end.getTime()) {
      if (w.end.getTime() > cur.end.getTime()) cur.end = w.end;
      cur.demo ||= w.demo;
    } else out.push({ ...w });
  }
  return out;
}

export const windowMinutes = (w: TimeWindow) => (w.end.getTime() - w.start.getTime()) / MIN;

/* ------------------------------------------------------------- actions */

export type ActionKind = "email" | "call" | "task";
export type ActionCategory = "cv_request" | "employer" | "candidate" | "other";

/** הגשות קמביום: a candidate's application to a job. */
export const SUBMISSION_TYPE = "RecordType2";
/** "קורות חיים" Cases: a CV that arrived by mail. */
export const CV_CASE_TYPE = "cv_message";

export const CATEGORY_LABELS: Record<ActionCategory, string> = {
  cv_request: "בקשת קורות חיים",
  employer: "מול המעסיק",
  candidate: "מול המועמד",
  other: "פעולות אחרות",
};

/** As the monthly counts classify a task (monthCounts in data.ts): emails = subtype Email, calls = subtype Call or a Type starting with Call. */
export function actionKind(subtype: string | null, type: string | null): ActionKind {
  if (subtype === "Email") return "email";
  if (subtype === "Call" || /^call/i.test(type ?? "")) return "call";
  return "task";
}

/**
 * Subjects seen on real tasks (Sept–Oct 2026; Salesforce prefixes emails with "דואר אלקטרוני: "):
 * - asking for a CV: the template "קיבלנו את מועמדותך למשרת …" (and the candidate's replies to it,
 *   "RE: קיבלנו את מועמדותך…"), or any subject that says "קורות חיים";
 * - with the employer: "SKEELZ | מועמד/ת למשרת … – <name>" (sending a candidate), "הגשה למשרה: …"
 *   (and its RE: thread), "עדכון סטטוס: מועמדים למשרת …";
 * - everything else on a submission is with the candidate: calls ("שיחה"), "עידכון מסקילז",
 *   "בהמשך לשיחתנו", replies.
 */
const CV_REQUEST = /קיבלנו את מועמדותך|קורות\s*חיים/;
const TO_EMPLOYER = /SKEELZ\s*\|\s*מועמד|הגשה למשרה|עדכון סטטוס:\s*מועמדים/i;

/**
 * What an action was for, by the type of Case it sits on and its subject. Every action on a
 * `cv_message` Case is a CV request; on a submission (RecordType2) the subject decides between a CV
 * request, the employer and the candidate; actions anywhere else are "other".
 */
export function actionCategory(caseType: string | null, subject: string | null): ActionCategory {
  if (caseType === CV_CASE_TYPE) return "cv_request";
  if (caseType !== SUBMISSION_TYPE) return "other";
  const s = subject ?? "";
  if (CV_REQUEST.test(s)) return "cv_request";
  if (TO_EMPLOYER.test(s)) return "employer";
  return "candidate";
}

export interface Action {
  id: string;
  at: Date;
  kind: ActionKind;
  category: ActionCategory;
  caseId: string | null;
  caseType: string | null;
  /** The job a submission belongs to (its ParentId). */
  positionId: string | null;
}

export interface AttributedAction extends Action {
  /** Index of the window it fell in, or null outside every window. */
  window: number | null;
  /** Minutes credited to it; 0 outside every window. */
  minutes: number;
}

export interface WindowResult extends WorkWindow {
  minutes: number;
  actions: number;
  attributed: number;
  /** The window's minutes no action was credited with: "לא משויך". */
  unassigned: number;
}

/**
 * The attribution model. Within each window the actions are sorted; each gets the minutes since
 * the previous action (the first: since the window opened), at most ATTRIBUTION_CAP_MIN. What is
 * left of the window is unassigned. An action outside every window gets no time. `windows` are one
 * employee's, merged (mergeWindows).
 */
export function attribute(windows: readonly WorkWindow[], actions: readonly Action[], cap = ATTRIBUTION_CAP_MIN): { actions: AttributedAction[]; windows: WindowResult[] } {
  const ws = [...windows].sort((a, b) => a.start.getTime() - b.start.getTime());
  const results: WindowResult[] = ws.map((w) => ({ ...w, minutes: windowMinutes(w), actions: 0, attributed: 0, unassigned: windowMinutes(w) }));
  const prev = ws.map((w) => w.start.getTime());
  const out: AttributedAction[] = [];
  for (const a of [...actions].sort((x, y) => x.at.getTime() - y.at.getTime() || x.id.localeCompare(y.id))) {
    const t = a.at.getTime();
    const i = ws.findIndex((w) => w.start.getTime() <= t && t <= w.end.getTime());
    if (i < 0) {
      out.push({ ...a, window: null, minutes: 0 });
      continue;
    }
    const minutes = Math.min(cap, Math.max(0, (t - prev[i]!) / MIN));
    prev[i] = t;
    const r = results[i]!;
    r.actions += 1;
    r.attributed += minutes;
    r.unassigned = r.minutes - r.attributed;
    out.push({ ...a, window: i, minutes });
  }
  return { actions: out, windows: results };
}

/* ------------------------------------------------------------- summary */

export interface KindCounts {
  total: number;
  email: number;
  call: number;
  task: number;
}

const zeroKinds = (): KindCounts => ({ total: 0, email: 0, call: 0, task: 0 });

export interface PositionTime {
  positionId: string | null;
  minutes: number;
  actions: number;
  submissions: number;
}

export interface WindowsSummary {
  hours: number;
  attributedHours: number;
  unassignedHours: number;
  /** Actions inside a window, by kind. */
  inWindow: KindCounts;
  /** Actions outside every window, by kind. */
  outside: KindCounts;
  /** Minutes credited, by kind. */
  minutesByKind: KindCounts;
  /** Actions in windows per hour worked; null without hours. */
  perHour: KindCounts | null;
  /** Average minutes credited per action in a window; null where there are none. */
  avgMinutes: Record<keyof KindCounts, number | null>;
  /** Distinct submissions (RecordType2) touched in a window, and the minutes on them. */
  submissions: number;
  submissionMinutes: number;
  avgPerSubmission: number | null;
  categories: Record<ActionCategory, { actions: number; minutes: number }>;
  /** Submission time by the job it belongs to, most minutes first. */
  positions: PositionTime[];
  windows: WindowResult[];
}

/** Everything the dashboard shows for one employee, from their merged windows and their actions in the range. */
export function summarizeWindows(windows: readonly WorkWindow[], actions: readonly Action[], cap = ATTRIBUTION_CAP_MIN): WindowsSummary {
  const r = attribute(windows, actions, cap);
  const inWindow = zeroKinds();
  const outside = zeroKinds();
  const minutesByKind = zeroKinds();
  const categories = Object.fromEntries((Object.keys(CATEGORY_LABELS) as ActionCategory[]).map((c) => [c, { actions: 0, minutes: 0 }])) as WindowsSummary["categories"];
  const submissions = new Set<string>();
  let submissionMinutes = 0;
  const positions = new Map<string, { positionId: string | null; minutes: number; actions: number; subs: Set<string> }>();

  for (const a of r.actions) {
    const bucket = a.window == null ? outside : inWindow;
    bucket.total += 1;
    bucket[a.kind] += 1;
    if (a.window == null) continue;
    minutesByKind.total += a.minutes;
    minutesByKind[a.kind] += a.minutes;
    categories[a.category].actions += 1;
    categories[a.category].minutes += a.minutes;
    if (a.caseType === SUBMISSION_TYPE && a.caseId) {
      submissions.add(a.caseId);
      submissionMinutes += a.minutes;
      const key = a.positionId ?? "";
      const p = positions.get(key) ?? { positionId: a.positionId, minutes: 0, actions: 0, subs: new Set<string>() };
      p.minutes += a.minutes;
      p.actions += 1;
      p.subs.add(a.caseId);
      positions.set(key, p);
    }
  }

  const totalMinutes = r.windows.reduce((t, w) => t + w.minutes, 0);
  const hours = totalMinutes / 60;
  const avg = (minutes: number, n: number) => (n ? minutes / n : null);
  return {
    hours,
    attributedHours: minutesByKind.total / 60,
    unassignedHours: (totalMinutes - minutesByKind.total) / 60,
    inWindow,
    outside,
    minutesByKind,
    perHour: hours > 0 ? { total: inWindow.total / hours, email: inWindow.email / hours, call: inWindow.call / hours, task: inWindow.task / hours } : null,
    avgMinutes: {
      total: avg(minutesByKind.total, inWindow.total),
      email: avg(minutesByKind.email, inWindow.email),
      call: avg(minutesByKind.call, inWindow.call),
      task: avg(minutesByKind.task, inWindow.task),
    },
    submissions: submissions.size,
    submissionMinutes,
    avgPerSubmission: avg(submissionMinutes, submissions.size),
    categories,
    positions: [...positions.values()]
      .map((p) => ({ positionId: p.positionId, minutes: p.minutes, actions: p.actions, submissions: p.subs.size }))
      .sort((a, b) => b.minutes - a.minutes || b.submissions - a.submissions),
    windows: r.windows,
  };
}

/* ----------------------------------------------------------- the file */

export interface SheetRow {
  line: number;
  /** An email address or a site user id, as written. */
  who: string;
  workDate: string;
  start: Date;
  end: Date;
}

const ISO_DAY = /^(\d{4})-(\d{1,2})-(\d{1,2})$/;
const IL_DAY = /^(\d{1,2})[./](\d{1,2})[./](\d{2}|\d{4})$/;
const TIME = /^(\d{1,2}):(\d{2})(?::\d{2})?$/;
export const MAX_SHEET_ROWS = 5000;

function parseDay(v: string): string | null {
  let y: number, m: number, d: number;
  const iso = ISO_DAY.exec(v);
  const il = IL_DAY.exec(v);
  if (iso) [y, m, d] = [Number(iso[1]), Number(iso[2]), Number(iso[3])];
  else if (il) [d, m, y] = [Number(il[1]), Number(il[2]), Number(il[3].length === 2 ? `20${il[3]}` : il[3])];
  else return null;
  const date = new Date(Date.UTC(y, m - 1, d));
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) return null;
  return date.toISOString().slice(0, 10);
}

/** Israel's offset from UTC at an instant, in minutes (120 or 180). */
function israelOffsetMinutes(at: number): number {
  const zone = new Intl.DateTimeFormat("en-US", { timeZone: TZ, timeZoneName: "longOffset" }).formatToParts(new Date(at)).find((p) => p.type === "timeZoneName")?.value;
  const m = zone?.match(/GMT([+-])(\d{2}):?(\d{2})?/);
  if (!m) return 120;
  return (m[1] === "-" ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3] ?? 0));
}

/** The instant of an Israel wall-clock time on an Israel day ("2026-10-25", 9, 30). */
export function israelInstant(day: string, hour: number, minute: number): Date {
  const [y, m, d] = day.split("-").map(Number) as [number, number, number];
  const wall = Date.UTC(y, m - 1, d, hour, minute);
  const first = wall - israelOffsetMinutes(wall) * MIN;
  return new Date(wall - israelOffsetMinutes(first) * MIN);
}

function parseTime(v: string): [number, number] | null {
  const t = TIME.exec(v);
  if (!t) return null;
  const h = Number(t[1]);
  const mi = Number(t[2]);
  return h <= 24 && mi < 60 && (h < 24 || mi === 0) ? [h, mi] : null;
}

/**
 * A timesheet pasted or uploaded as text: one window per line, columns separated by comma, tab or
 * semicolon: who (email or site user id), date (2026-10-25 or 25.10.2026), from, to (09:00, Israel
 * time). A first line that is not a row (a header) is skipped. Bad lines come back as errors with
 * their line number; nothing is guessed.
 */
export function parseTimesheet(text: string): { rows: SheetRow[]; errors: { line: number; message: string }[] } {
  const rows: SheetRow[] = [];
  const errors: { line: number; message: string }[] = [];
  const lines = text.replace(/^﻿/, "").split(/\r?\n/);
  lines.forEach((raw, i) => {
    const line = i + 1;
    if (!raw.trim()) return;
    const cols = raw.split(/[\t,;]/).map((c) => c.trim().replace(/^"(.*)"$/, "$1").trim());
    const [who = "", dayText = "", fromText = "", toText = ""] = cols;
    const workDate = parseDay(dayText);
    if (!workDate && rows.length === 0 && errors.length === 0 && !/\d/.test(dayText)) return; // a header
    if (rows.length >= MAX_SHEET_ROWS) {
      if (errors.length < 50) errors.push({ line, message: `יותר מ-${MAX_SHEET_ROWS} שורות` });
      return;
    }
    if (!who) return void errors.push({ line, message: "חסר עובד (מייל או מזהה משתמש)" });
    if (!workDate) return void errors.push({ line, message: `תאריך לא מובן: "${dayText}"` });
    const from = parseTime(fromText);
    const to = parseTime(toText);
    if (!from || !to) return void errors.push({ line, message: `שעה לא מובנת: "${from ? toText : fromText}"` });
    const start = israelInstant(workDate, from[0], from[1]);
    const end = israelInstant(workDate, to[0], to[1]);
    if (end.getTime() <= start.getTime()) return void errors.push({ line, message: "שעת הסיום לא אחרי שעת ההתחלה" });
    rows.push({ line, who: who.toLowerCase(), workDate, start, end });
  });
  return { rows, errors };
}

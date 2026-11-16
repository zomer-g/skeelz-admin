/**
 * Work windows from a timesheet and the Salesforce actions done inside them (docs/staff.md,
 * "פעולות ביחידת זמן"). Pure functions only, no database: the page's loader (`timesheet.ts`)
 * feeds them, and `windows.test.ts` pins every rule.
 */

export const TIME_SOURCES = ["demo", "sheet", "api", "manual"] as const;
export type TimeSource = (typeof TIME_SOURCES)[number];

/**
 * An action is credited with the minutes since the one before it (the first in a window: since the window
 * opened) when that stretch is at most this long.
 */
export const ATTRIBUTION_CAP_MIN = 45;
/**
 * A longer stretch is a break, not work on the next action: the action gets this many minutes and the rest
 * of the stretch stays unassigned (until 16.11.2026 it got the full cap, which credited idle time to it).
 */
export const BREAK_CREDIT_MIN = 15;
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
  /** The sources of the rows merged into it (demo, sheet, api, manual). */
  sources?: string[];
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
export function mergeWindows(windows: readonly (TimeWindow & { source?: string; demo?: boolean; sources?: string[] })[]): WorkWindow[] {
  const sorted = windows
    .filter((w) => w.end.getTime() > w.start.getTime())
    .map((w) => ({
      workDate: w.workDate,
      start: w.start,
      end: w.end,
      demo: Boolean(w.demo) || w.source === "demo",
      sources: [...new Set([...(w.sources ?? []), ...(w.source ? [w.source] : [])])],
    }))
    .sort((a, b) => a.start.getTime() - b.start.getTime());
  const out: WorkWindow[] = [];
  for (const w of sorted) {
    const cur = out[out.length - 1];
    if (cur && w.start.getTime() <= cur.end.getTime()) {
      if (w.end.getTime() > cur.end.getTime()) cur.end = w.end;
      cur.demo ||= w.demo;
      cur.sources = [...new Set([...(cur.sources ?? []), ...w.sources])];
    } else out.push({ ...w });
  }
  return out;
}

/* ------------------------------------------------- fitting a reconstruction */

const floorQ = (t: number) => Math.floor(t / QUARTER) * QUARTER;
const ceilQ = (t: number) => Math.ceil(t / QUARTER) * QUARTER;

/** Around an action a fitted timesheet keeps at least this much on each side, so the action is never at a cut edge. */
export const FIT_KEEP_MIN = 15;
/** An action outside every window joins a window of the same day that ends or starts within this many minutes; farther away it gets its own window. */
export const FIT_JOIN_MIN = 60;

export interface FitResult {
  windows: TimeWindow[];
  /** Actions that were outside every window before. */
  covered: number;
  /** Minutes added to cover them. */
  addedMinutes: number;
  /** Minutes taken out of breaks to keep the total; less than addedMinutes when there were not enough breaks. */
  freedMinutes: number;
  /** Windows cut in two at a break. */
  splits: number;
}

/**
 * Fits a reconstructed timesheet (no report was handed in) to the actions, keeping its total: every action
 * ends up inside a window, and the time that takes comes out of breaks. Windows are quarter hours, in
 * Israel time.
 *
 * Only days that already have a window are fitted; actions on a day with no window at all are left alone.
 *
 * 1. Cover: an action outside every window extends the nearest window of its day (within FIT_JOIN_MIN) to
 *    the quarter hour that holds it with FIT_KEEP_MIN to spare, or opens a quarter-hour window of its own.
 * 2. Free: the minutes added are taken back from the longest breaks inside windows that hold actions: a
 *    stretch with no action longer than ATTRIBUTION_CAP_MIN, keeping FIT_KEEP_MIN after the action before it
 *    and before the one after it. A break in the middle of a window splits it in two (a morning and an
 *    afternoon, say); one at a window's edge shortens it. Windows with no action at all are left alone:
 *    they rest on other activity (logins, edits) the tasks don't show.
 *
 * No action is ever cut out. When the breaks are not enough, the total grows by what is missing (freedMinutes
 * < addedMinutes) rather than leaving an action outside.
 */
export function fitWindows(windows: readonly TimeWindow[], actions: readonly Date[]): FitResult {
  const keep = FIT_KEEP_MIN * MIN;
  const ws = mergeWindows(windows).map((w) => ({ workDate: w.workDate, start: w.start.getTime(), end: w.end.getTime() }));
  const total = (list: { start: number; end: number }[]) => list.reduce((t, w) => t + (w.end - w.start), 0);
  const before = total(ws);
  // Only days the timesheet covers: a day with no window has no report at all, and its actions are not "outside the hours"
  // of a reconstruction. Fitting must never invent a timesheet for such a day (a range reaching into a month with no report).
  const days = new Set(ws.map((w) => w.workDate));
  const times = actions
    .map((a) => a.getTime())
    .filter((t) => !Number.isNaN(t) && days.has(israelDayOf(new Date(t))))
    .sort((a, b) => a - b);
  const inside = (t: number) => ws.some((w) => w.start <= t && t <= w.end);

  // 1. Cover. Every action outside counts, also one that an earlier extension already took in.
  const covered = times.filter((t) => !inside(t)).length;
  for (const t of times) {
    if (inside(t)) continue;
    const day = israelDayOf(new Date(t));
    const near = ws
      .filter((w) => w.workDate === day)
      .map((w) => ({ w, gap: t < w.start ? w.start - t : t - w.end }))
      .filter((x) => x.gap <= FIT_JOIN_MIN * MIN)
      .sort((a, b) => a.gap - b.gap)[0];
    if (near) {
      if (t < near.w.start) near.w.start = Math.min(near.w.start, floorQ(t - keep));
      else near.w.end = Math.max(near.w.end, ceilQ(t + keep));
    } else {
      ws.push({ workDate: day, start: floorQ(t - keep), end: ceilQ(t + keep) });
    }
    const merged = mergeWindows(ws.map((w) => ({ workDate: w.workDate, start: new Date(w.start), end: new Date(w.end) })));
    ws.splice(0, ws.length, ...merged.map((w) => ({ workDate: w.workDate, start: w.start.getTime(), end: w.end.getTime() })));
  }
  const added = total(ws) - before;

  // 2. Free, longest breaks first.
  type Cut = { w: (typeof ws)[number]; from: number; to: number; edge: "start" | "end" | "middle" };
  const cuts: Cut[] = [];
  for (const w of ws) {
    const own = times.filter((t) => w.start <= t && t <= w.end);
    if (!own.length) continue;
    const add = (from: number, to: number, edge: Cut["edge"]) => {
      if (to - from >= QUARTER) cuts.push({ w, from, to, edge });
    };
    if (own[0]! - w.start > ATTRIBUTION_CAP_MIN * MIN) add(w.start, floorQ(own[0]! - keep), "start");
    for (let i = 1; i < own.length; i++) {
      if (own[i]! - own[i - 1]! > ATTRIBUTION_CAP_MIN * MIN) add(ceilQ(own[i - 1]! + keep), floorQ(own[i]! - keep), "middle");
    }
    if (w.end - own[own.length - 1]! > ATTRIBUTION_CAP_MIN * MIN) add(ceilQ(own[own.length - 1]! + keep), w.end, "end");
  }
  cuts.sort((a, b) => b.to - b.from - (a.to - a.from) || a.from - b.from);
  let need = added;
  let splits = 0;
  const holes: Cut[] = [];
  for (const c of cuts) {
    if (need <= 0) break;
    const take = Math.min(c.to - c.from, ceilQ(need));
    // A break in the middle is cut from its start (right after the action before it); an edge from the outside in.
    if (c.edge === "end") holes.push({ ...c, from: c.to - take });
    else holes.push({ ...c, to: c.from + take });
    if (c.edge === "middle") splits += 1;
    need -= take;
  }
  const out: TimeWindow[] = [];
  for (const w of ws) {
    const mine = holes.filter((h) => h.w === w).sort((a, b) => a.from - b.from);
    let start = w.start;
    for (const h of mine) {
      if (h.from > start) out.push({ workDate: w.workDate, start: new Date(start), end: new Date(h.from) });
      start = Math.max(start, h.to);
    }
    if (w.end > start) out.push({ workDate: w.workDate, start: new Date(start), end: new Date(w.end) });
  }
  out.sort((a, b) => a.start.getTime() - b.start.getTime());
  return { windows: out, covered, addedMinutes: added / MIN, freedMinutes: (added - Math.max(0, need)) / MIN, splits };
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
 * Subjects seen on real tasks (Sept–Oct 2026; Salesforce prefixes emails with "דואר אלקטרוני: "), every
 * employee's templates (שרית's and אסתי's differ):
 * - asking for a CV: the templates "קיבלנו את מועמדותך למשרת …" and "קיבלתי את בקשתך להגיש מועמדות…"
 *   (and replies to them), or a subject that asks to send one ("בבקשה שלחי קורות חיים", "שלחי בבקשה קורות
 *   חיים", "קורות חיים עדכניים"). Checked first;
 * - with the employer: "SKEELZ | מועמד/ת למשרת … – <name>" and "הגשה למשרה: …" / "הגשת מועמדות למשרה: …"
 *   (sending a candidate, and their threads), "עדכון סטטוס: מועמדים למשרת …", and a CV sent on
 *   ("… קורות חיים של <name>");
 * - any other subject that says "קורות חיים" is a CV request;
 * - everything else on a submission is with the candidate: calls ("שיחה"), "עידכון מסקילז",
 *   "בהמשך לשיחתנו", replies.
 */
const CV_ASK = /קיבלנו את מועמדותך|קיבלתי את בקשתך|שלח\S*\s+(?:\S+\s+){0,2}קורות\s*חיים|קורות\s*חיים\s+עדכני/;
const TO_EMPLOYER = /SKEELZ\s*\|\s*מועמד|הגש(?:ה|ת\s+מועמדות)\s+למשר|עדכון סטטוס:\s*מועמדים|קורות\s*חיים\s+של\s/i;
const CV_ANY = /קורות\s*חיים/;

/**
 * What an action was for, by the type of Case it sits on and its subject. Every action on a
 * `cv_message` Case is a CV request; on a submission (RecordType2) the subject decides between a CV
 * request, the employer and the candidate; actions anywhere else are "other".
 */
export function actionCategory(caseType: string | null, subject: string | null): ActionCategory {
  if (caseType === CV_CASE_TYPE) return "cv_request";
  if (caseType !== SUBMISSION_TYPE) return "other";
  const s = subject ?? "";
  if (CV_ASK.test(s)) return "cv_request";
  if (TO_EMPLOYER.test(s)) return "employer";
  if (CV_ANY.test(s)) return "cv_request";
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
  /** The Account (an employer) the task sits on, when it is on an Account rather than a Case. */
  accountId?: string | null;
  /** The Case's number, for the detailed timesheet (never the subject: it names candidates). */
  caseNumber?: string | null;
}

/** Where an action sits, for the time per record type: a Case's RecordType DeveloperName, or one of these. */
export const ON_ACCOUNT = "@account";
export const ON_NOTHING = "@none";

/** The record-type key of an action: its Case's type, an Account, or nothing (no Case or Account, or a Case with no type). */
export function actionTarget(a: Pick<Action, "caseId" | "caseType" | "accountId">): { key: string; recordId: string | null } {
  if (a.caseId) return { key: a.caseType ?? ON_NOTHING, recordId: a.caseType ? a.caseId : null };
  if (a.accountId) return { key: ON_ACCOUNT, recordId: a.accountId };
  return { key: ON_NOTHING, recordId: null };
}

export interface AttributedAction extends Action {
  /** Index of the window it fell in, or null outside every window. */
  window: number | null;
  /** Minutes credited to it; 0 outside every window. */
  minutes: number;
  /** It came after a break (a stretch longer than the cap) and got BREAK_CREDIT_MIN only. */
  afterBreak: boolean;
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
 * the previous action (the first: since the window opened) when that stretch is at most
 * ATTRIBUTION_CAP_MIN. A longer stretch is a break: the action gets BREAK_CREDIT_MIN and the rest stays
 * unassigned. What is left of the window is unassigned. An action outside every window gets no time.
 * `windows` are one employee's, merged (mergeWindows).
 */
export function attribute(
  windows: readonly WorkWindow[],
  actions: readonly Action[],
  cap = ATTRIBUTION_CAP_MIN,
  breakCredit = BREAK_CREDIT_MIN,
): { actions: AttributedAction[]; windows: WindowResult[] } {
  const ws = [...windows].sort((a, b) => a.start.getTime() - b.start.getTime());
  const results: WindowResult[] = ws.map((w) => ({ ...w, minutes: windowMinutes(w), actions: 0, attributed: 0, unassigned: windowMinutes(w) }));
  const prev = ws.map((w) => w.start.getTime());
  const out: AttributedAction[] = [];
  for (const a of [...actions].sort((x, y) => x.at.getTime() - y.at.getTime() || x.id.localeCompare(y.id))) {
    const t = a.at.getTime();
    const i = ws.findIndex((w) => w.start.getTime() <= t && t <= w.end.getTime());
    if (i < 0) {
      out.push({ ...a, window: null, minutes: 0, afterBreak: false });
      continue;
    }
    const gap = Math.max(0, (t - prev[i]!) / MIN);
    const afterBreak = gap > cap;
    const minutes = afterBreak ? Math.min(breakCredit, cap) : gap;
    prev[i] = t;
    const r = results[i]!;
    r.actions += 1;
    r.attributed += minutes;
    r.unassigned = r.minutes - r.attributed;
    out.push({ ...a, window: i, minutes, afterBreak });
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

/** Time on one record type (a Case RecordType, an Account, or nothing), inside the windows. */
export interface TargetTime {
  /** A Case RecordType DeveloperName, ON_ACCOUNT or ON_NOTHING. */
  key: string;
  minutes: number;
  actions: number;
  /** Distinct Cases (or Accounts) touched; 0 for ON_NOTHING. */
  records: number;
  /** Minutes per distinct record; null for ON_NOTHING or without records. */
  avgPerRecord: number | null;
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
  /** Time by record type of what the action sits on (every Case RecordType, Accounts, nothing), most minutes first. */
  targets: TargetTime[];
  windows: WindowResult[];
  /** Every action with its window and minutes, oldest first: the detailed timesheet. */
  actions: AttributedAction[];
  /** Actions in a window that came after a break and got BREAK_CREDIT_MIN only. */
  afterBreak: number;
}

/** Everything the dashboard shows for one employee, from their merged windows and their actions in the range. */
export function summarizeWindows(windows: readonly WorkWindow[], actions: readonly Action[], cap = ATTRIBUTION_CAP_MIN): WindowsSummary {
  const r = attribute(windows, actions, cap);
  let afterBreak = 0;
  const inWindow = zeroKinds();
  const outside = zeroKinds();
  const minutesByKind = zeroKinds();
  const categories = Object.fromEntries((Object.keys(CATEGORY_LABELS) as ActionCategory[]).map((c) => [c, { actions: 0, minutes: 0 }])) as WindowsSummary["categories"];
  const submissions = new Set<string>();
  let submissionMinutes = 0;
  const positions = new Map<string, { positionId: string | null; minutes: number; actions: number; subs: Set<string> }>();
  const targets = new Map<string, { minutes: number; actions: number; records: Set<string> }>();

  for (const a of r.actions) {
    const bucket = a.window == null ? outside : inWindow;
    bucket.total += 1;
    bucket[a.kind] += 1;
    if (a.window == null) continue;
    if (a.afterBreak) afterBreak += 1;
    minutesByKind.total += a.minutes;
    minutesByKind[a.kind] += a.minutes;
    categories[a.category].actions += 1;
    categories[a.category].minutes += a.minutes;
    const target = actionTarget(a);
    const tt = targets.get(target.key) ?? { minutes: 0, actions: 0, records: new Set<string>() };
    tt.minutes += a.minutes;
    tt.actions += 1;
    if (target.recordId) tt.records.add(target.recordId);
    targets.set(target.key, tt);
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
    targets: [...targets.entries()]
      .map(([key, t]) => ({ key, minutes: t.minutes, actions: t.actions, records: t.records.size, avgPerRecord: avg(t.minutes, t.records.size) }))
      .sort((a, b) => b.minutes - a.minutes || b.actions - a.actions),
    windows: r.windows,
    actions: r.actions,
    afterBreak,
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

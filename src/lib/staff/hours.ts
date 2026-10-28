/**
 * Staff hours: the arithmetic over the tasks an employee closed with their hours (docs/staff.md).
 * Pure functions, tested in hours.test.ts. Staff data: read only behind requireStaffManager /
 * pageAuthStaff, never from the dashboard, MCP or the API.
 */

/** A monday.com item as the API returns it (only the fields asked for). */
export interface MondayItem {
  id: string;
  name: string;
  url?: string | null;
  /** Set on a subitem: the task it belongs to. */
  parent_item?: { name: string | null } | null;
  column_values: { id: string; text: string | null; value: string | null }[];
}

/** A board's column as monday describes it. */
export interface MondayColumn {
  id: string;
  title: string;
  type: string;
  settings_str?: string | null;
}

/**
 * Every board whose tasks carry hours is read (docs/staff.md): a board takes part when it has a
 * status column titled "שעות (בחירה)" (the label is the number of hours). Each board has its own
 * column ids, so the columns are found by title and type: the done status, "תאריך ביצוע" (on a
 * subitems board, its "Date"), the assignees and Notes.
 */
export const HOURS_COLUMN = "שעות (בחירה)";
const DONE_ON_TITLES = ["תאריך ביצוע", "Date", "תאריך"];
const SUBITEMS_PREFIX = /^Subitems of\s+/i;

export interface MondayBoard {
  id: string;
  /** The board's name; for a subitems board, the name of the board its tasks belong to. */
  name: string | null;
  subitems: boolean;
  status: string;
  /** The status indexes that mean done (the column's done_colors, else the label "Done"). */
  doneIndices: number[];
  doneOn: string | null;
  hours: string;
  people: string;
  notes: string | null;
}

const norm = (t: string) => t.trim().toLowerCase();

function doneIndicesOf(settings: string | null | undefined): number[] {
  try {
    const s = JSON.parse(settings ?? "{}") as { done_colors?: number[]; labels?: Record<string, string> };
    if (s.done_colors?.length) return s.done_colors.map(Number).filter(Number.isInteger);
    const done = Object.entries(s.labels ?? {}).find(([, label]) => norm(label) === "done");
    return done ? [Number(done[0])] : [];
  } catch {
    return [];
  }
}

/** The columns hours are read from, or null when the board has no hours column (or no way to tell done tasks or their people). */
export function boardColumns(board: { id: string; name: string | null; columns: readonly MondayColumn[] }): MondayBoard | null {
  const of = (type: string) => board.columns.filter((c) => c.type === type);
  const titled = (list: MondayColumn[], titles: string[]) => titles.map((t) => list.find((c) => norm(c.title) === norm(t))).find(Boolean) ?? null;
  const statuses = of("status");
  const hours = titled(statuses, [HOURS_COLUMN]);
  if (!hours) return null;
  const status = titled(statuses, ["Status", "סטטוס"]) ?? statuses.find((c) => c !== hours && doneIndicesOf(c.settings_str).length) ?? null;
  const people = titled(of("people"), ["Assigned To", "Owner", "Person"]) ?? of("people")[0] ?? null;
  const doneIndices = status ? doneIndicesOf(status.settings_str) : [];
  if (!status || !people || !doneIndices.length) return null;
  const subitems = SUBITEMS_PREFIX.test(board.name ?? "");
  return {
    id: board.id,
    name: board.name?.replace(SUBITEMS_PREFIX, "").trim() || null,
    subitems,
    status: status.id,
    doneIndices,
    doneOn: titled(of("date"), DONE_ON_TITLES)?.id ?? null,
    hours: hours.id,
    people: people.id,
    notes: titled(of("text"), ["Notes", "הערות"])?.id ?? null,
  };
}

export interface WorkItem {
  externalId: string;
  /** The board the task is on, so tasks of different boards stay told apart. */
  boardId: string;
  boardName: string | null;
  title: string | null;
  url: string | null;
  doneOn: string | null;
  /** When the status last changed, i.e. when the task entered Done (it is Done now): the status value's changed_at. */
  doneAt: Date | null;
  hours: number | null;
  notes: string | null;
  /** monday user ids of the people assigned. */
  assigneeIds: string[];
}

const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** The people of a people column's value: {"personsAndTeams":[{"id":120173361,"kind":"person"}]}. Teams are not people. */
function personIds(value: string | null): string[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value) as { personsAndTeams?: { id: number | string; kind?: string }[] };
    return (parsed.personsAndTeams ?? []).filter((p) => p.kind !== "team").map((p) => String(p.id));
  } catch {
    return [];
  }
}

/** changed_at of a status column's value: {"index":1,"post_id":null,"changed_at":"2026-10-22T19:25:15.348Z"}. */
function changedAt(value: string | null): Date | null {
  if (!value) return null;
  try {
    const at = (JSON.parse(value) as { changed_at?: unknown }).changed_at;
    const d = typeof at === "string" ? new Date(at) : null;
    return d && Number.isFinite(d.getTime()) ? d : null;
  } catch {
    return null;
  }
}

/** Hours from the choice's label ("1.5"); anything that is not a positive number is "no hours". */
function parseHours(text: string | null): number | null {
  const n = Number((text ?? "").trim().replace(",", "."));
  return text && text.trim() && Number.isFinite(n) && n > 0 ? n : null;
}

/** One task of a board; a subitem's title leads with the task it belongs to ("parent › subitem"). */
export function parseMondayItem(item: MondayItem, board: MondayBoard): WorkItem {
  const col = new Map(item.column_values.map((c) => [c.id, c]));
  const doneOn = (board.doneOn ? col.get(board.doneOn)?.text?.trim() : "") ?? "";
  const notes = (board.notes ? col.get(board.notes)?.text?.trim() : "") ?? "";
  const name = item.name?.trim() || null;
  const parent = item.parent_item?.name?.trim();
  return {
    externalId: String(item.id),
    boardId: board.id,
    boardName: board.name,
    title: parent && name ? `${parent} › ${name}` : name,
    url: item.url ?? null,
    doneOn: DAY.test(doneOn) ? doneOn : null,
    doneAt: changedAt(col.get(board.status)?.value ?? null),
    hours: parseHours(col.get(board.hours)?.text ?? null),
    notes: notes || null,
    assigneeIds: personIds(col.get(board.people)?.value ?? null),
  };
}

export interface WorkRow extends Omit<WorkItem, "assigneeIds"> {
  id: string;
  source: "monday";
  userId: string;
  shared: boolean;
}

/**
 * The rows to keep: one per task per linked employee assigned to it. Tasks of people who are not
 * linked are dropped here, before anything is stored.
 */
export function rowsForLinked(items: readonly WorkItem[], linked: ReadonlyMap<string, string>): WorkRow[] {
  return items.flatMap(({ assigneeIds, ...item }) =>
    [...new Set(assigneeIds)]
      .filter((m) => linked.has(m))
      .map((m) => ({
        ...item,
        id: `monday:${item.externalId}:${linked.get(m)!}`,
        source: "monday" as const,
        userId: linked.get(m)!,
        shared: new Set(assigneeIds).size > 1,
      })),
  );
}

/* ------------------------------------------------------------- totals */

export interface HoursEntry {
  doneOn: string | null;
  hours: number | null;
}

/** The Sunday (Israel's week start) of a YYYY-MM-DD day. */
export function weekOf(day: string): string {
  const d = new Date(`${day}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - d.getUTCDay());
  return d.toISOString().slice(0, 10);
}

const round2 = (n: number) => Math.round(n * 100) / 100;

export interface HoursSummary {
  hours: number;
  tasks: number;
  /** Closed without hours: counted as tasks, not as hours, and listed so they can be filled in. */
  withoutHours: number;
  /** Closed without a completion date: they belong to no month or week. */
  withoutDate: number;
  byMonth: { month: string; hours: number; tasks: number }[];
  byWeek: { week: string; hours: number; tasks: number }[];
}

/** Totals overall, by month (YYYY-MM) and by week (its Sunday), newest first. */
export function summarize(entries: readonly HoursEntry[]): HoursSummary {
  const months = new Map<string, { hours: number; tasks: number }>();
  const weeks = new Map<string, { hours: number; tasks: number }>();
  let hours = 0;
  let withoutHours = 0;
  let withoutDate = 0;
  for (const e of entries) {
    const h = e.hours ?? 0;
    hours += h;
    if (e.hours == null) withoutHours++;
    if (!e.doneOn) {
      withoutDate++;
      continue;
    }
    for (const [map, key] of [
      [months, e.doneOn.slice(0, 7)],
      [weeks, weekOf(e.doneOn)],
    ] as const) {
      const cur = map.get(key) ?? { hours: 0, tasks: 0 };
      cur.hours += h;
      cur.tasks++;
      map.set(key, cur);
    }
  }
  const list = <K extends string>(map: Map<string, { hours: number; tasks: number }>, key: K) =>
    [...map.entries()]
      .sort(([a], [b]) => b.localeCompare(a))
      .map(([k, v]) => ({ [key]: k, hours: round2(v.hours), tasks: v.tasks }) as { [P in K]: string } & { hours: number; tasks: number });
  return { hours: round2(hours), tasks: entries.length, withoutHours, withoutDate, byMonth: list(months, "month"), byWeek: list(weeks, "week") };
}

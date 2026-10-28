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
  column_values: { id: string; text: string | null; value: string | null }[];
}

/** The "משימות סיילספורס" board and its columns (docs/staff.md). */
export const MONDAY_BOARD = {
  id: "5106546225",
  status: "color_mm8cnb8e",
  /** Status index of "Done". */
  doneIndex: 1,
  doneOn: "date_mm8j7f52",
  /** "שעות (בחירה)": a status column whose label is the number of hours. */
  hours: "color_mm8jcnc",
  people: "multiple_person_mm8cmxq0",
  notes: "text_mm8cqt5",
} as const;

export interface WorkItem {
  externalId: string;
  title: string | null;
  url: string | null;
  doneOn: string | null;
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

/** Hours from the choice's label ("1.5"); anything that is not a positive number is "no hours". */
function parseHours(text: string | null): number | null {
  const n = Number((text ?? "").trim().replace(",", "."));
  return text && text.trim() && Number.isFinite(n) && n > 0 ? n : null;
}

export function parseMondayItem(item: MondayItem): WorkItem {
  const col = new Map(item.column_values.map((c) => [c.id, c]));
  const doneOn = col.get(MONDAY_BOARD.doneOn)?.text?.trim() ?? "";
  const notes = col.get(MONDAY_BOARD.notes)?.text?.trim() ?? "";
  return {
    externalId: String(item.id),
    title: item.name?.trim() || null,
    url: item.url ?? null,
    doneOn: DAY.test(doneOn) ? doneOn : null,
    hours: parseHours(col.get(MONDAY_BOARD.hours)?.text ?? null),
    notes: notes || null,
    assigneeIds: personIds(col.get(MONDAY_BOARD.people)?.value ?? null),
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

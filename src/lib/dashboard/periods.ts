/**
 * Time buckets for the dashboard's line charts: daily values summed into weeks (starting on
 * Sunday, the Israeli work week), months or years. A period the range covers only in part is
 * flagged, since its sum runs low.
 */

export interface DayValue {
  day: string; // YYYY-MM-DD
  value: number;
}

const shortDay = (day: string) => `${day.slice(8, 10)}.${day.slice(5, 7)}.${day.slice(2, 4)}`;

export type Grain = "day" | "week" | "month" | "year";

export const GRAINS: { key: Grain; label: string }[] = [
  { key: "day", label: "יום" },
  { key: "week", label: "שבוע" },
  { key: "month", label: "חודש" },
  { key: "year", label: "שנה" },
];

const monthName = new Intl.DateTimeFormat("he-IL", { month: "short", year: "numeric", timeZone: "UTC" });

/** The first day of the period that holds `day`. Weeks start on Sunday, the Israeli work week. */
export function periodStart(day: string, grain: Grain): string {
  if (grain === "month") return `${day.slice(0, 7)}-01`;
  if (grain === "year") return `${day.slice(0, 4)}-01-01`;
  if (grain === "day") return day;
  const d = new Date(`${day}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - d.getUTCDay());
  return d.toISOString().slice(0, 10);
}

/** How many days the whole period has, to tell a partly covered one. */
export function periodDays(start: string, grain: Grain): number {
  const y = Number(start.slice(0, 4));
  if (grain === "day") return 1;
  if (grain === "week") return 7;
  if (grain === "month") return new Date(Date.UTC(y, Number(start.slice(5, 7)), 0)).getUTCDate();
  return y % 4 === 0 && (y % 100 !== 0 || y % 400 === 0) ? 366 : 365;
}

function periodLabel(start: string, grain: Grain): string {
  if (grain === "day") return shortDay(start);
  if (grain === "week") return `שבוע ${shortDay(start)}`;
  if (grain === "month") return monthName.format(new Date(`${start}T12:00:00Z`));
  return start.slice(0, 4);
}

export interface Bucket {
  label: string;
  start: string;
  value: number;
  /** The range covers only part of this period (its first or last), so its sum runs low. */
  partial: boolean;
}

/** Sums the days into periods of the chosen grain. */
export function bucket(points: DayValue[], grain: Grain): Bucket[] {
  const periods = new Map<string, { value: number; days: number }>();
  for (const p of points) {
    const key = periodStart(p.day, grain);
    const b = periods.get(key) ?? { value: 0, days: 0 };
    b.value += p.value;
    b.days += 1;
    periods.set(key, b);
  }
  return [...periods.entries()].map(([start, b]) => ({
    label: periodLabel(start, grain),
    start,
    value: b.value,
    partial: b.days < periodDays(start, grain),
  }));
}

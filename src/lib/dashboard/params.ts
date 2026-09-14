import type { Basis } from "@/lib/metrics/candidates";

/**
 * Dashboard filters live in the URL (?range=30d&basis=application), so a view
 * can be shared and every server render agrees on the slice. Days are Israel
 * days: a range ends at Israel midnight, not UTC midnight.
 */

const TZ = "Asia/Jerusalem";

export const PRESETS = [
  { key: "7d", label: "7 ימים" },
  { key: "30d", label: "30 יום" },
  { key: "90d", label: "90 יום" },
  { key: "mtd", label: "מתחילת החודש" },
  { key: "ytd", label: "מתחילת השנה" },
  { key: "all", label: "הכל" },
  { key: "custom", label: "טווח אחר" },
] as const;

export type PresetKey = (typeof PRESETS)[number]["key"];

export interface DashboardParams {
  preset: PresetKey;
  basis: Basis;
  /** Inclusive Israel dates, YYYY-MM-DD. */
  fromDay: string;
  toDay: string;
  /** Half-open instant range [from, to). */
  from: Date;
  to: Date;
}

/** Applications in Salesforce start in February 2025. */
const ALL_FROM_DAY = "2025-02-01";
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

export function israelDay(date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(date);
}

export function addDays(day: string, n: number): string {
  const d = new Date(`${day}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** The instant Israel's day begins — the offset is +02:00 or +03:00 depending on DST. */
export function israelMidnight(day: string): Date {
  const noon = new Date(`${day}T12:00:00Z`);
  const zone = new Intl.DateTimeFormat("en-US", { timeZone: TZ, timeZoneName: "longOffset" })
    .formatToParts(noon)
    .find((p) => p.type === "timeZoneName")?.value;
  const m = zone?.match(/GMT([+-]\d{2}):?(\d{2})?/);
  return new Date(`${day}T00:00:00${m ? `${m[1]}:${m[2] ?? "00"}` : "+02:00"}`);
}

type SearchParams = Record<string, string | string[] | undefined>;

const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

export function parseDashboardParams(search: SearchParams, now = new Date()): DashboardParams {
  const today = israelDay(now);
  const requested = first(search.range);
  const preset: PresetKey = PRESETS.some((p) => p.key === requested) ? (requested as PresetKey) : "30d";
  const basis: Basis = first(search.basis) === "event" ? "event" : "application";

  let fromDay: string;
  let toDay = today;
  switch (preset) {
    case "7d":
      fromDay = addDays(today, -6);
      break;
    case "90d":
      fromDay = addDays(today, -89);
      break;
    case "mtd":
      fromDay = `${today.slice(0, 7)}-01`;
      break;
    case "ytd":
      fromDay = `${today.slice(0, 4)}-01-01`;
      break;
    case "all":
      fromDay = ALL_FROM_DAY;
      break;
    case "custom": {
      const f = first(search.from);
      const t = first(search.to);
      fromDay = f && DAY_RE.test(f) ? f : addDays(today, -29);
      toDay = t && DAY_RE.test(t) ? t : today;
      if (fromDay > toDay) [fromDay, toDay] = [toDay, fromDay];
      break;
    }
    default:
      fromDay = addDays(today, -29);
  }

  return { preset, basis, fromDay, toDay, from: israelMidnight(fromDay), to: israelMidnight(addDays(toDay, 1)) };
}

export function formatDay(day: string): string {
  const [y, m, d] = day.split("-");
  return `${d}.${m}.${y}`;
}

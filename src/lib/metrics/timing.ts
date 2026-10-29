import type { ApplicationFacts } from "./candidates";

/**
 * How long after an application its milestones come (applications tab › לוח זמנים,
 * docs/applications-tab.md): for the applications created in the range, the days from the
 * application to the CV being sent to the employer and to the hire, as weekly histograms with
 * mean, median and 90th percentile; and from them, how many of N new applications (a campaign)
 * should reach each milestone, and by which week. Pure functions, tested in timing.test.ts.
 */

const DAY_MS = 86_400_000;

export const TIMING_EVENTS = [
  { key: "sent", label: 'קו"ח נשלחו למעסיק', short: "נשלחו למעסיק", at: (f: ApplicationFacts) => f.sentAt },
  { key: "accepted", label: "התקבלו לעבודה", short: "התקבלו", at: (f: ApplicationFacts) => f.acceptedAt },
] as const;

export type TimingEventKey = (typeof TIMING_EVENTS)[number]["key"];

/** Weekly bins: week 1 (days 0–6) … week 12, then one "more than 12 weeks" bin. */
export const WEEKS = 12;

export interface TimingBin {
  label: string;
  /** Days from the application, inclusive. */
  fromDay: number;
  /** Exclusive; null for the last, open bin. */
  toDay: number | null;
  count: number;
}

export interface EventTiming {
  key: TimingEventKey;
  label: string;
  /** Applications in the cohort. */
  applications: number;
  /** Of them, how many reached the milestone. */
  reached: number;
  meanDays: number | null;
  medianDays: number | null;
  p90Days: number | null;
  bins: TimingBin[];
}

/** The q-quantile (0–1) of sorted values, interpolated. */
export function quantile(sorted: number[], q: number): number | null {
  if (!sorted.length) return null;
  const i = (sorted.length - 1) * q;
  const lo = Math.floor(i);
  const hi = Math.ceil(i);
  return sorted[lo]! + (sorted[hi]! - sorted[lo]!) * (i - lo);
}

export const weekBins = (): TimingBin[] => [
  ...Array.from({ length: WEEKS }, (_, w) => ({ label: `שבוע ${w + 1}`, fromDay: w * 7, toDay: (w + 1) * 7, count: 0 })),
  { label: `יותר מ-${WEEKS} שבועות`, fromDay: WEEKS * 7, toDay: null, count: 0 },
];

/** Days from application to the milestone, for those that reached it. A milestone dated before its application counts as day 0. */
export function daysTo(facts: readonly ApplicationFacts[], at: (f: ApplicationFacts) => Date | null): number[] {
  return facts.flatMap((f) => {
    const t = at(f);
    return t ? [Math.max(0, (t.getTime() - f.createdAt.getTime()) / DAY_MS)] : [];
  });
}

export function eventTiming(facts: readonly ApplicationFacts[], event: (typeof TIMING_EVENTS)[number]): EventTiming {
  const days = daysTo(facts, event.at).sort((a, b) => a - b);
  const bins = weekBins();
  for (const d of days) bins[Math.min(WEEKS, Math.floor(d / 7))]!.count++;
  return {
    key: event.key,
    label: event.label,
    applications: facts.length,
    reached: days.length,
    meanDays: days.length ? days.reduce((t, d) => t + d, 0) / days.length : null,
    medianDays: quantile(days, 0.5),
    p90Days: quantile(days, 0.9),
    bins,
  };
}

export interface Forecast {
  key: TimingEventKey;
  /** Share of applications that reach the milestone, from the applications old enough to have had the time. */
  rate: number | null;
  /** Those applications: created at least `matureDays` before now. */
  basis: number;
  matureDays: number;
  /** Expected of `n` new applications: in all, and by the end of each week (cumulative), then in all. */
  expected: number;
  byWeek: number[];
  /** The week by which half / 90% of them should have arrived. */
  halfByWeek: number | null;
  mostByWeek: number | null;
}

/**
 * What to expect from `n` new applications. The rate is measured only on applications that have
 * had the time (created at least the 90th-percentile delay ago, at least 4 weeks), so a recent
 * campaign still in progress does not pull it down; the timing is the histogram's.
 */
export function forecast(facts: readonly ApplicationFacts[], timing: EventTiming, n: number, now: Date, event: (typeof TIMING_EVENTS)[number]): Forecast {
  const matureDays = Math.max(28, Math.ceil(timing.p90Days ?? 0));
  const mature = facts.filter((f) => now.getTime() - f.createdAt.getTime() >= matureDays * DAY_MS);
  const reachedMature = mature.filter((f) => event.at(f)).length;
  const rate = mature.length ? reachedMature / mature.length : null;
  const expected = rate === null ? 0 : n * rate;
  let running = 0;
  const shares = timing.bins.map((b) => (running += timing.reached ? b.count / timing.reached : 0));
  const byWeek = shares.map((s) => expected * s);
  const weekWhere = (share: number) => {
    const i = shares.findIndex((s) => s >= share - 1e-9);
    return i < 0 || !timing.reached ? null : i + 1;
  };
  return { key: timing.key, rate, basis: mature.length, matureDays, expected, byWeek, halfByWeek: weekWhere(0.5), mostByWeek: weekWhere(0.9) };
}

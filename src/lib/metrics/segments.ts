import { israelDay } from "@/lib/dashboard/params";
import { stats } from "./candidates";

/**
 * The arithmetic behind the MCP's segment and cohort tools (application_status_counts,
 * registration_cohorts, dashboard_summary's segment): who is left out as internal or as a
 * duplicate, time buckets, when a CV arrived, and which registration waves stand out.
 * Pure functions over loaded rows, so each rule is defined once and tested
 * (segments.test.ts). Definitions: docs/candidates-tab-metrics.md, "רשומים מול הגשה מהירה".
 */

/* ------------------------------------------------------------ exclusions */

export interface Person {
  candidateEmail: string | null;
  candidateName: string | null;
}

/** The staff's own domain, with any +tag and any subdomain. */
const INTERNAL_DOMAIN = /@([a-z0-9-]+\.)*skeelz\.co\.il$/i;
/** test, test1, me+test@… in the address's local part. */
const TEST_LOCAL = /(^|[+._-])test(\d|[+._-]|$)/i;
/** "test" as a word, or the Hebrew טסט / בדיקה, in the name. */
const TEST_NAME = /(^|[^a-z])test([^a-z]|$)|טסט|(^|\s)בדיקה(\s|$)/i;

/** A record made by the staff or as a test: an @skeelz.co.il address, or test in the address or name. */
export function isInternal(p: Person): boolean {
  const email = p.candidateEmail?.trim().toLowerCase() ?? "";
  if (email && (INTERNAL_DOMAIN.test(email) || TEST_LOCAL.test(email.split("@")[0] ?? ""))) return true;
  return Boolean(p.candidateName && TEST_NAME.test(p.candidateName.trim()));
}

/** Applications of one person to one job this close together are one application sent twice. */
export const DEDUPE_SECONDS = 60;

export interface ExclusionOptions {
  /** Leave out internal and test records (isInternal). */
  internal: boolean;
  /** Count once the applications of one person to one job made within DEDUPE_SECONDS of each other. */
  dedupe: boolean;
}

export interface Excluded {
  internal: number;
  duplicate: number;
}

export interface Exclusion<T> {
  kept: T[];
  excluded: Excluded;
  /** Ids of what was left out, by reason, so a caller can count them in any slice. */
  internalIds: Set<string>;
  duplicateIds: Set<string>;
}

interface ApplicationLike extends Person {
  id: string;
  contactId: string | null;
  createdAt: Date;
}

/**
 * Internal records first, then duplicates among the rest. Of a run of duplicates the earliest is
 * kept, and each later one is a duplicate when it is within DEDUPE_SECONDS of the last one kept.
 * The person is the Contact, else the address; without either, or without a job, nothing is merged.
 */
export function applyExclusions<T extends ApplicationLike>(rows: readonly T[], opts: ExclusionOptions, jobOf: (r: T) => string | null): Exclusion<T> {
  const internalIds = new Set<string>();
  const duplicateIds = new Set<string>();
  let rest: T[] = [...rows];
  if (opts.internal) {
    rest = rest.filter((r) => {
      if (!isInternal(r)) return true;
      internalIds.add(r.id);
      return false;
    });
  }
  if (opts.dedupe) {
    const groups = new Map<string, T[]>();
    for (const r of rest) {
      const person = r.contactId ?? r.candidateEmail?.trim().toLowerCase();
      const job = jobOf(r);
      if (!person || !job) continue;
      const key = `${person}|${job}`;
      const list = groups.get(key);
      if (list) list.push(r);
      else groups.set(key, [r]);
    }
    for (const list of groups.values()) {
      if (list.length < 2) continue;
      list.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime() || a.id.localeCompare(b.id));
      let kept = list[0]!;
      for (const r of list.slice(1)) {
        if (r.createdAt.getTime() - kept.createdAt.getTime() <= DEDUPE_SECONDS * 1000) duplicateIds.add(r.id);
        else kept = r;
      }
    }
    rest = rest.filter((r) => !duplicateIds.has(r.id));
  }
  return { kept: rest, excluded: { internal: internalIds.size, duplicate: duplicateIds.size }, internalIds, duplicateIds };
}

/* ---------------------------------------------------- status counts */

export const STATUS_GROUPS = ["fast", "paid", "owner", "month"] as const;
export type StatusGroup = (typeof STATUS_GROUPS)[number];

/** Applications with no status at all, as the job counts name them. */
export const NO_STATUS = "(ללא סטטוס)";

export interface StatusCountRow {
  id: string;
  status: string | null;
  createdAt: Date;
  paid: boolean;
  fast: boolean;
  ownerName: string | null;
}

/** The group an application falls in. */
export function groupOf(r: StatusCountRow, by: StatusGroup | ""): string {
  switch (by) {
    case "fast":
      return r.fast ? "fast" : "regular";
    case "paid":
      return r.paid ? "paid" : "unpaid";
    case "owner":
      return r.ownerName ?? "(ללא מטפל)";
    case "month":
      return israelDay(r.createdAt).slice(0, 7);
    default:
      return "all";
  }
}

/** Counts by current status (already normStatus-ed) in each group, and each group's total. */
export function countByStatus(rows: readonly StatusCountRow[], by: StatusGroup | "") {
  const counts = new Map<string, number>();
  const totals = new Map<string, number>();
  for (const r of rows) {
    const group = groupOf(r, by);
    const key = `${group}\u0000${r.status || NO_STATUS}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
    totals.set(group, (totals.get(group) ?? 0) + 1);
  }
  const out = [...counts.entries()].map(([key, count]) => {
    const [group, status] = key.split("\u0000") as [string, string];
    return { status, group, count };
  });
  out.sort((a, b) => a.group.localeCompare(b.group) || b.count - a.count || a.status.localeCompare(b.status));
  return { rows: out, totals: Object.fromEntries([...totals.entries()].sort(([a], [b]) => a.localeCompare(b))) };
}

/* ------------------------------------------------------------- time */

const MINUTE = 60_000;

/** Time from registration to the first application. Each bucket holds up to `max` minutes (inclusive). */
export const TIME_BUCKETS = [
  { key: "up_to_10_min", max: 10 },
  { key: "10_to_60_min", max: 60 },
  { key: "1_hour_to_1_day", max: 24 * 60 },
  { key: "1_to_7_days", max: 7 * 24 * 60 },
  { key: "7_to_30_days", max: 30 * 24 * 60 },
  { key: "over_30_days", max: Infinity },
] as const;
export type TimeBucket = (typeof TIME_BUCKETS)[number]["key"];

/** The bucket of a span in minutes; a negative span (applied the moment the Contact was made) is the first. */
export function timeBucket(minutes: number): TimeBucket {
  return TIME_BUCKETS.find((b) => minutes <= b.max)!.key;
}

export function emptyBuckets(): Record<TimeBucket, number> {
  return Object.fromEntries(TIME_BUCKETS.map((b) => [b.key, 0])) as Record<TimeBucket, number>;
}

/** The median, or null with no values (the same `stats` the dashboard uses). */
export const median = (values: number[]): number | null => stats(values).median;

/* ------------------------------------------------------------ periods */

export type Period = "month" | "quarter";

/** "2025-07" or "2025-Q3", by the Israel day. */
export function periodOf(d: Date, period: Period): string {
  const day = israelDay(d);
  if (period === "month") return day.slice(0, 7);
  return `${day.slice(0, 4)}-Q${Math.floor((Number(day.slice(5, 7)) - 1) / 3) + 1}`;
}

/** The first Israel day of a period key. */
export function periodStartDay(key: string): string {
  const q = key.match(/^(\d{4})-Q([1-4])$/);
  if (q) return `${q[1]}-${String((Number(q[2]) - 1) * 3 + 1).padStart(2, "0")}-01`;
  return `${key}-01`;
}

/** The key of the period after this one. */
export function nextPeriod(key: string): string {
  const q = key.match(/^(\d{4})-Q([1-4])$/);
  if (q) return q[2] === "4" ? `${Number(q[1]) + 1}-Q1` : `${q[1]}-Q${Number(q[2]) + 1}`;
  const [y, m] = key.split("-").map(Number) as [number, number];
  return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, "0")}`;
}

/** Every period key from the one holding `fromDay` to the one holding `toDay`. */
export function periodsBetween(fromDay: string, toDay: string, period: Period): string[] {
  const at = (day: string) => periodOf(new Date(`${day}T12:00:00Z`), period);
  const last = at(toDay);
  const out = [at(fromDay)];
  while (out[out.length - 1]! < last && out.length < 1000) out.push(nextPeriod(out[out.length - 1]!));
  return out;
}

/* --------------------------------------------------------- CV arrival */

/** A file on the Contact made this close to the Contact itself came with the registration. */
export const REGISTRATION_WINDOW_MINUTES = 30;

export const CV_ARRIVALS = ["at_registration", "later_on_site", "later_by_email", "before_registration", "none"] as const;
export type CvArrival = (typeof CV_ARRIVALS)[number];

export interface CvEvidence {
  /** The registered Contact's creation. */
  registeredAt: Date;
  /** Earliest CV file on the site side: on a Contact with the person's address, or on one of their applications. */
  siteFileAt: Date | null;
  /** Earliest CV that came by mail: on an email of one of their Cases, or on a "קורות חיים" Case. */
  mailFileAt: Date | null;
  /** CV__c on the Contact. */
  cvFlag: boolean;
}

/**
 * When the person's first CV arrived. The earliest file decides (on a tie the site's):
 *   - more than REGISTRATION_WINDOW_MINUTES before the registration → before_registration
 *     (an older Contact with the same address, or a CV mailed in before);
 *   - a site file up to REGISTRATION_WINDOW_MINUTES after it → at_registration, later → later_on_site;
 *   - a mailed file from then on → later_by_email.
 * With no file at all, a ticked CV__c counts as at_registration: the site keeps the file it was
 * given at sign-up on its own side and only ticks the box (an assumption, docs/candidates-tab-metrics.md).
 */
export function classifyCvArrival(e: CvEvidence): CvArrival {
  const site = e.siteFileAt?.getTime() ?? Infinity;
  const mail = e.mailFileAt?.getTime() ?? Infinity;
  if (site === Infinity && mail === Infinity) return e.cvFlag ? "at_registration" : "none";
  const first = Math.min(site, mail);
  const minutes = (first - e.registeredAt.getTime()) / MINUTE;
  if (minutes < -REGISTRATION_WINDOW_MINUTES) return "before_registration";
  if (site <= mail) return minutes <= REGISTRATION_WINDOW_MINUTES ? "at_registration" : "later_on_site";
  return "later_by_email";
}

/* ---------------------------------------------------------- anomalies */

/** How many periods on each side make the baseline of a registration wave. */
export const ANOMALY_WINDOW = 12;
/** A wave: this many times the baseline's registrations… */
export const ANOMALY_FACTOR = 3;
/** …with a CV share below this fraction of the baseline's. */
export const ANOMALY_CV_FRACTION = 0.5;

export interface PeriodVolume {
  registered: number;
  withCv: number;
}

/**
 * For each period, whether it is a registration wave: at least ANOMALY_FACTOR times the median of
 * the up to ANOMALY_WINDOW periods on either side (itself excluded), and a CV share under
 * ANOMALY_CV_FRACTION of theirs — the shape of a bulk import rather than people signing up.
 */
export function flagAnomalies(periods: readonly PeriodVolume[], window = ANOMALY_WINDOW) {
  return periods.map((p, i) => {
    const around = [...periods.slice(Math.max(0, i - window), i), ...periods.slice(i + 1, i + 1 + window)];
    const baseline = median(around.map((x) => x.registered));
    const baselineCv = median(around.filter((x) => x.registered > 0).map((x) => x.withCv / x.registered));
    const share = p.registered ? p.withCv / p.registered : null;
    const anomaly =
      baseline !== null &&
      p.registered >= ANOMALY_FACTOR * Math.max(baseline, 1) &&
      share !== null &&
      baselineCv !== null &&
      share < ANOMALY_CV_FRACTION * baselineCv;
    return { anomaly, baseline_registered: baseline, baseline_cv_share: baselineCv === null ? null : round3(baselineCv) };
  });
}

export const round3 = (v: number | null) => (v == null || !Number.isFinite(v) ? null : Math.round(v * 1000) / 1000);
export const rate = (part: number, whole: number) => (whole ? round3(part / whole) : null);

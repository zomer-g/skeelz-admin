import { sql } from "drizzle-orm";
import { cached } from "@/lib/cache";
import { addDays, israelDay } from "@/lib/dashboard/params";
import { getDb } from "@/lib/db/client";
import { EMPLOYER_RESPONSE_STATUSES, RECORD_TYPES, STATUS, STATUS_HISTORY_START, type ApplicationFacts } from "./candidates";
import { JOB_EVENTS, type Position } from "./jobs";
import type { Scope } from "./paid";

/**
 * The applications tab's funnel: from exposure on the site to a hire, with a
 * movable anchor. Definitions live in docs/applications-tab.md.
 *
 * Two kinds of stage live in one funnel:
 * - Site stages (GA4): sessions, job opens, apply clicks, apply confirmations.
 *   GA has no person, only a job key and a day, so these are counted in the
 *   range and can never be followed case by case.
 * - Salesforce stages: one application each, from creation to hire. The anchor
 *   picks the cohort — the applications that reached the anchor stage in the
 *   range — and every later stage counts what became of that cohort, whenever
 *   it happened. Stages before the anchor are shown as context: what happened in
 *   the same range, not necessarily to the same cases.
 *
 * A stage counts as reached when the application reached it or any later stage
 * (a hire whose CV status was never set still passed "CV sent"), so the funnel
 * never widens.
 */

export const STAGES = [
  { key: "sessions", label: "כניסות לאתר", short: "כניסות", source: "ga" },
  { key: "opens", label: "פתיחות של דפי משרות", short: "פתיחות", source: "ga" },
  { key: "clicks", label: 'לחיצות "הגש מועמדות"', short: "לחיצות", source: "ga" },
  { key: "confirms", label: "אישורי הגשה באתר", short: "אישורים", source: "ga" },
  { key: "applied", label: "הגשות ב-Salesforce", short: "הגשות", source: "sf" },
  { key: "handled", label: "טופלו (מגע ראשון)", short: "טופלו", source: "sf" },
  { key: "sent", label: 'קו"ח נשלחו למעסיק', short: 'קו"ח נשלחו', source: "sf" },
  { key: "responded", label: "המעסיק הגיב", short: "תגובה", source: "sf" },
  { key: "interview", label: "זומנו לראיון", short: "ראיון", source: "sf" },
  { key: "hired", label: "התקבלו לעבודה", short: "התקבלו", source: "sf" },
] as const;

export type StageKey = (typeof STAGES)[number]["key"];
type GaStage = "sessions" | "opens" | "clicks" | "confirms";

/** Salesforce stages in order; an application's level is an index into this. */
export const SF_STAGES = ["applied", "handled", "sent", "responded", "interview", "hired"] as const;
const HIRED = SF_STAGES.length - 1;

export const DEFAULT_ANCHOR: StageKey = "applied";
/** Any stage but the last can anchor the funnel. */
export const ANCHORS = STAGES.filter((s) => s.key !== "hired");

export const parseAnchor = (v: string | undefined): StageKey => (ANCHORS.some((s) => s.key === v) ? (v as StageKey) : DEFAULT_ANCHOR);

/** An open application that has not moved for this long is counted as stuck, not in progress. */
export const STALE_DAYS = 60;
/** Applications at least this old make the reference for historical rates: their story is mostly over. */
export const MATURE_DAYS = 120;
/** Groups smaller than this do not get a "weakest step": a rate over 3 cases says nothing. */
export const MIN_STEP_BASE = 5;

const DAY = 86_400_000;

/* ----------------------------------------------------------------- filters */

export interface FunnelFilters {
  /** Company name contains. */
  company: string;
  /** Job title, Case number or id contains. */
  job: string;
  /** Application owner, exact. */
  owner: string;
  /** Job location contains. */
  loc: string;
  ptime: "" | "full" | "part";
  fast: "" | "yes" | "no";
  cv: "" | "yes" | "no";
}

export const FILTER_KEYS = ["company", "job", "owner", "loc", "ptime", "fast", "cv"] as const;

type SearchParams = Record<string, string | string[] | undefined>;
const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v)?.trim().slice(0, 100) ?? "";
const oneOf = <T extends string>(v: string, allowed: readonly T[]): T | "" => ((allowed as readonly string[]).includes(v) ? (v as T) : "");

export function parseFunnelFilters(search: SearchParams): FunnelFilters {
  return {
    company: first(search.company),
    job: first(search.job),
    owner: first(search.owner),
    loc: first(search.loc),
    ptime: oneOf(first(search.ptime), ["full", "part"] as const),
    fast: oneOf(first(search.fast), ["yes", "no"] as const),
    cv: oneOf(first(search.cv), ["yes", "no"] as const),
  };
}

/** Filters on the job narrow the site figures too; filters on the application or candidate cannot. */
export const hasJobFilters = (f: FunnelFilters) => Boolean(f.company || f.job || f.loc || f.ptime);
export const hasAppFilters = (f: FunnelFilters) => Boolean(f.owner || f.fast || f.cv);

/* ----------------------------------------------------------------- loaders */

export interface AppAttrs {
  fast: boolean;
  /** The candidate's "יש קו"ח" checkbox; null when there is no contact. */
  hasCv: boolean | null;
  closed: boolean;
  /** Last change of status or record type. */
  lastChangeAt: Date | null;
}

export interface JobAttrs {
  location: string | null;
  /** Raw `PTime_cambium__c`: FullTime, PartialTime or both. */
  time: string | null;
}

type Row = Record<string, unknown>;
const run = async (query: ReturnType<typeof sql>) => (await getDb().execute<Row>(query)).rows;
const asDate = (v: unknown) => (v == null ? null : v instanceof Date ? v : new Date(String(v)));
const str = (v: unknown) => (typeof v === "string" && v.trim() !== "" ? v.trim() : null);

/** What the funnel filters on besides the application facts. Cached briefly, like the facts. */
export function loadFunnelAttrs(): Promise<{ apps: Map<string, AppAttrs>; jobs: Map<string, JobAttrs> }> {
  return cached("funnel-attrs", async () => {
    const [apps, jobs] = await Promise.all([
      run(sql`
        WITH apps AS (
          SELECT c.id, c.contact_id, c.closed_date, c.data
            FROM sf_case c JOIN sf_record_type rt ON rt.id = c.record_type_id
           WHERE rt.developer_name IN (${RECORD_TYPES.application}, ${RECORD_TYPES.accepted}) AND NOT c.is_deleted
        ),
        lc AS (
          SELECT h.case_id, max(h.created_date) AS at
            FROM sf_case_history h JOIN apps a ON a.id = h.case_id
           WHERE h.field IN ('Status', 'RecordType')
           GROUP BY h.case_id
        )
        SELECT a.id,
               coalesce((a.data->>'fast_applied__c') = 'true', false) AS fast,
               ct.data->>'CV__c' AS cv,
               coalesce((a.data->>'IsClosed') = 'true', a.closed_date IS NOT NULL) AS closed,
               lc.at AS last_change_at
          FROM apps a
          LEFT JOIN sf_contact ct ON ct.id = a.contact_id
          LEFT JOIN lc ON lc.case_id = a.id`),
      run(sql`
        SELECT c.id, c.data->>'PLocation_cambium__c' AS location, c.data->>'PTime_cambium__c' AS time
          FROM sf_case c JOIN sf_record_type rt ON rt.id = c.record_type_id
         WHERE rt.developer_name = ${RECORD_TYPES.position} AND NOT c.is_deleted`),
    ]);
    return {
      apps: new Map(
        apps.map((r) => [
          String(r.id),
          { fast: r.fast === true, hasCv: r.cv == null ? null : r.cv === "true", closed: r.closed === true, lastChangeAt: asDate(r.last_change_at) },
        ]),
      ),
      jobs: new Map(jobs.map((r) => [String(r.id), { location: str(r.location), time: str(r.time) }])),
    };
  });
}

export interface GaDay {
  day: string;
  key: string | null;
  stage: Exclude<GaStage, "sessions">;
  n: number;
}

const GA_STAGE_OF: Record<string, GaDay["stage"]> = {
  [JOB_EVENTS.opens]: "opens",
  [JOB_EVENTS.applyClicks]: "clicks",
  [JOB_EVENTS.applyYes]: "confirms",
};

/** The job events per day and job key, and site sessions per day, over all time (a few tens of thousands of rows). */
export function loadFunnelGa(): Promise<{ events: GaDay[]; sessions: Map<string, number>; syncedAt: Date | null }> {
  return cached("funnel-ga", async () => {
    const [events, sessions, state] = await Promise.all([
      run(sql`
        SELECT date::text AS day, site_job_key AS key, event_name, sum(event_count) AS n FROM ga_event_daily
         WHERE event_name IN ${Object.values(JOB_EVENTS)} GROUP BY 1, 2, 3`),
      run(sql`SELECT date::text AS day, sum(sessions) AS n FROM ga_channel_daily GROUP BY 1`),
      run(sql`SELECT last_success_at FROM sync_state WHERE object = 'GA4'`),
    ]);
    return {
      events: events.map((r) => ({ day: String(r.day), key: str(r.key), stage: GA_STAGE_OF[String(r.event_name)]!, n: Number(r.n ?? 0) })),
      sessions: new Map(sessions.map((r) => [String(r.day), Number(r.n ?? 0)])),
      syncedAt: asDate(state[0]?.last_success_at),
    };
  });
}

/* ------------------------------------------------------------- application */

export type Outcome = "hired" | "closed" | "active" | "stuck";

export interface FunnelApp {
  fact: ApplicationFacts;
  job: JobContext | null;
  attrs: AppAttrs | null;
  /** Highest Salesforce stage reached (index into SF_STAGES). */
  level: number;
  /** When each stage was reached, or null (see reachedAt). */
  times: (Date | null)[];
  outcome: Outcome;
  /** Where it stands: its status, as Salesforce spells it (normalised). */
  status: string | null;
}

export interface JobContext {
  id: string;
  key: string | null;
  title: string | null;
  company: string | null;
  caseNumber: string | null;
  paid: boolean;
  location: string | null;
  time: string | null;
}

function levelOf(f: ApplicationFacts, times: (Date | null)[]): number {
  let level = 0;
  times.forEach((t, i) => {
    if (t) level = Math.max(level, i);
  });
  // Applications from before status history was kept only have their current status.
  if (f.status && f.status !== STATUS.new) level = Math.max(level, 1);
  if (f.status === STATUS.sent) level = Math.max(level, 2);
  if (f.status && EMPLOYER_RESPONSE_STATUSES.includes(f.status)) level = Math.max(level, 3);
  if (f.status === STATUS.interview) level = Math.max(level, 4);
  return level;
}

/**
 * When the application reached SF stage `i`: its own time, or — when the stage
 * was skipped on the way (a hire without "CV sent") — the earliest later one.
 */
export function reachedAt(app: FunnelApp, i: number): Date | null {
  if (app.level < i) return null;
  if (app.times[i]) return app.times[i];
  const later = app.times.slice(i + 1).filter((t): t is Date => t !== null);
  return later.length ? new Date(Math.min(...later.map((t) => t.getTime()))) : null;
}

export function buildFunnelApps(
  facts: ApplicationFacts[],
  attrs: Map<string, AppAttrs>,
  jobs: Map<string, JobContext>,
  now = new Date(),
): FunnelApp[] {
  return facts.map((fact) => {
    const a = attrs.get(fact.id) ?? null;
    const times = [fact.createdAt, fact.firstTouchAt, fact.sentAt, fact.employerResponseAt, fact.interviewAt, fact.acceptedAt];
    const level = levelOf(fact, times);
    const lastMove = Math.max(fact.createdAt.getTime(), a?.lastChangeAt?.getTime() ?? 0, fact.firstTouchAt?.getTime() ?? 0);
    const outcome: Outcome =
      level === HIRED ? "hired" : a?.closed || fact.closedAt ? "closed" : now.getTime() - lastMove <= STALE_DAYS * DAY ? "active" : "stuck";
    return { fact, job: (fact.parentId && jobs.get(fact.parentId)) || null, attrs: a, level, times, outcome, status: fact.status };
  });
}

export function buildJobContexts(positions: Position[], attrs: Map<string, JobAttrs>): Map<string, JobContext> {
  return new Map(
    positions.map((p) => {
      const a = attrs.get(p.id);
      return [
        p.id,
        { id: p.id, key: p.siteJobKey, title: p.title, company: p.company, caseNumber: p.caseNumber, paid: p.paid, location: a?.location ?? null, time: a?.time ?? null },
      ];
    }),
  );
}

/**
 * Text folded for matching, as companyKeySql does in SQL: no quotes or
 * punctuation, no legal-form words, single spaces — so "רב-בריח" and "רב בריח בע"מ" meet.
 */
export function foldName(value: string | null | undefined): string {
  return ` ${(value ?? "").toLowerCase().replace(/["״׳']/g, "").replace(/[^a-z0-9א-ת]+/g, " ")} `
    .replace(/ (בעמ|ער|עמותת|עמותה|חברת|ltd|inc) /g, " ")
    .replace(/ +/g, " ")
    .trim();
}

const contains = (value: string | null | undefined, needle: string) => !needle || foldName(value).includes(foldName(needle));

const timeMatches = (time: string | null, want: FunnelFilters["ptime"]) =>
  !want || (time ?? "").includes(want === "full" ? "FullTime" : "PartialTime");

/** The job-level filters (company, job, location, hours); the paid scope is checked separately. */
export function jobMatches(j: JobContext, f: FunnelFilters): boolean {
  return (
    contains(j.company, f.company) &&
    (!f.job || [j.title, j.caseNumber, j.id, j.key].some((v) => contains(v, f.job))) &&
    contains(j.location, f.loc) &&
    timeMatches(j.time, f.ptime)
  );
}

function appMatches(a: FunnelApp, scope: Scope, f: FunnelFilters): boolean {
  if (scope === "paid" && !a.fact.paid) return false;
  if (!contains(a.fact.company, f.company)) return false;
  if (f.job && ![a.fact.jobTitle, a.job?.caseNumber, a.job?.id, a.job?.key].some((v) => contains(v, f.job))) return false;
  if (f.loc && !contains(a.job?.location, f.loc)) return false;
  if (f.ptime && !timeMatches(a.job?.time ?? null, f.ptime)) return false;
  if (f.owner && a.fact.ownerName !== f.owner) return false;
  if (f.fast && (a.attrs?.fast ?? false) !== (f.fast === "yes")) return false;
  if (f.cv && a.attrs?.hasCv !== (f.cv === "yes")) return false;
  return true;
}

/* ------------------------------------------------------------- aggregation */

export interface StoppedHere {
  active: number;
  stuck: number;
  closed: number;
  /** Closed here, by final status. */
  reasons: { status: string; count: number }[];
}

export interface StageRow {
  key: StageKey;
  label: string;
  source: "ga" | "sf";
  count: number;
  /**
   * "cohort": the anchored cases (the anchor itself, and SF stages after it).
   * "context": counted in the range, not the same cases — site stages, and SF stages before the anchor.
   */
  kind: "cohort" | "context";
  isAnchor: boolean;
  /** Share of the anchor's count; for stages after the anchor only. */
  ofAnchor: number | null;
  /** Share of the stage above; for stages after the anchor only. */
  ofPrev: number | null;
  /** Cohort stages: how many reached this stage and went no further, by where they stand. */
  stopped: StoppedHere | null;
  /** Expected further hires from the in-progress cases stopped here, at historical rates. */
  expected: number;
}

export interface Leak {
  from: string;
  to: string;
  closed: number;
  topReason: string | null;
}

export interface Maturity {
  /** Days from the anchor stage to a hire: median and 80th percentile over past hires. */
  median: number | null;
  p80: number | null;
  /** Past hires behind those figures. */
  sample: number;
  /** Cohort cases that reached the anchor within the last p80 days: their story is likely still being written. */
  young: number;
}

export interface FunnelResult {
  anchor: StageKey;
  rows: StageRow[];
  anchorCount: number;
  /** The Salesforce cohort (anchored at the anchor, or at "applied" when the anchor is a site stage). */
  cohortSize: number;
  hired: number;
  active: number;
  stuck: number;
  closed: number;
  expected: number;
  /** P(hire | reached stage) per SF stage, from mature applications in the scope. */
  rates: { stage: StageKey; rate: number | null; base: number }[];
  maturity: Maturity;
  leak: Leak | null;
  /** Distinct jobs opened on the site in the range, and distinct jobs the cohort applied to. */
  jobsOpened: number;
  jobsApplied: number;
  /** The site figures could not take every filter (owner, fast apply, CV apply to applications only). */
  gaPartial: boolean;
  hasGa: boolean;
}

export interface TimelineWeek {
  start: string;
  /** SF anchors: [hired, active, stuck, closed]. Site anchors: [count]. */
  values: number[];
}

export interface BreakdownRow {
  label: string;
  size: number;
  /** Cohort cases reaching each SF stage from the cohort's start, in SF_STAGES order from there. */
  reached: number[];
  hired: number;
  active: number;
  stuck: number;
  expected: number;
  opens: number | null;
  weakest: { from: string; to: string; rate: number } | null;
}

export const DIMENSIONS = [
  { key: "company", label: "חברה", jobLevel: true },
  { key: "job", label: "משרה", jobLevel: true },
  { key: "owner", label: "מטפל", jobLevel: false },
  { key: "loc", label: "מיקום המשרה", jobLevel: true },
  { key: "ptime", label: "היקף משרה", jobLevel: true },
  { key: "fast", label: "הגשה מהירה", jobLevel: false },
  { key: "cv", label: 'קו"ח במאגר', jobLevel: false },
  { key: "month", label: "חודש", jobLevel: false },
] as const;

export type Dimension = (typeof DIMENSIONS)[number]["key"];
export const parseDimension = (v: string | undefined): Dimension => (DIMENSIONS.some((d) => d.key === v) ? (v as Dimension) : "company");

const TIME_LABEL = (t: string | null) =>
  !t ? "לא צוין" : t.includes("FullTime") && t.includes("PartialTime") ? "מלאה או חלקית" : t.includes("FullTime") ? "מלאה" : t.includes("PartialTime") ? "חלקית" : t;

function groupOf(a: FunnelApp, dim: Dimension, anchorAt: Date): string {
  switch (dim) {
    case "company":
      return a.fact.company ?? "לא ידוע";
    case "job":
      return a.fact.jobTitle ? `${a.fact.jobTitle}${a.fact.company ? ` · ${a.fact.company}` : ""}` : "לא ידוע";
    case "owner":
      return a.fact.ownerName ?? "לא ידוע";
    case "loc":
      return a.job?.location ?? "לא ידוע";
    case "ptime":
      return TIME_LABEL(a.job?.time ?? null);
    case "fast":
      return a.attrs?.fast ? "הגשה מהירה" : "הגשה רגילה";
    case "cv":
      return a.attrs?.hasCv == null ? "לא ידוע" : a.attrs.hasCv ? 'יש קו"ח' : 'אין קו"ח';
    case "month":
      return israelDay(anchorAt).slice(0, 7);
  }
}

function jobGroupOf(j: JobContext, dim: Dimension): string | null {
  switch (dim) {
    case "company":
      return j.company ?? "לא ידוע";
    case "job":
      return j.title ? `${j.title}${j.company ? ` · ${j.company}` : ""}` : "לא ידוע";
    case "loc":
      return j.location ?? "לא ידוע";
    case "ptime":
      return TIME_LABEL(j.time);
    default:
      return null;
  }
}

function percentile(sorted: number[], p: number): number | null {
  if (!sorted.length) return null;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil(p * sorted.length) - 1));
  return sorted[idx]!;
}

/** Sunday that starts the Israel week containing `day`. */
export function weekStart(day: string): string {
  const d = new Date(`${day}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - d.getUTCDay());
  return d.toISOString().slice(0, 10);
}

export interface FunnelInput {
  apps: FunnelApp[];
  jobs: Map<string, JobContext>;
  ga: { events: GaDay[]; sessions: Map<string, number>; syncedAt: Date | null };
  scope: Scope;
  filters: FunnelFilters;
  anchor: StageKey;
  dimension: Dimension;
  from: Date;
  to: Date;
  fromDay: string;
  toDay: string;
  /** First week the timeline shows. */
  timelineFromDay: string;
  now?: Date;
}

export interface FunnelOutput {
  funnel: FunnelResult;
  timeline: TimelineWeek[];
  breakdown: BreakdownRow[];
  /** The filtered applications, for the pipeline figures below the funnel. */
  filtered: FunnelApp[];
  /** Filter choices seen in the data. */
  options: { owners: string[]; locations: string[]; companies: string[] };
}

export function computeFunnel(input: FunnelInput): FunnelOutput {
  const { apps, jobs, ga, scope, filters, anchor, dimension, from, to, fromDay, toDay } = input;
  const now = input.now ?? new Date();
  const stageIndex = STAGES.findIndex((s) => s.key === anchor);
  const anchorIsSite = STAGES[stageIndex]!.source === "ga";
  // The SF stage the cohort is anchored at: the anchor itself, or creation when the anchor is on the site.
  const sfAnchor = anchorIsSite ? 0 : SF_STAGES.indexOf(anchor as (typeof SF_STAGES)[number]);
  const inRange = (d: Date | null): d is Date => d !== null && d >= from && d < to;

  const filtered = apps.filter((a) => appMatches(a, scope, filters));
  const cohort = filtered.filter((a) => inRange(reachedAt(a, sfAnchor)));

  /* -- site figures: the jobs the filters allow, or the whole site when nothing narrows it. */
  const narrowJobs = scope === "paid" || hasJobFilters(filters);
  const allowedKeys = new Set<string>();
  if (narrowJobs) for (const j of jobs.values()) if (j.key && (scope === "all" || j.paid) && jobMatches(j, filters)) allowedKeys.add(j.key);
  const keyAllowed = (key: string | null) => (narrowJobs ? key !== null && allowedKeys.has(key) : true);

  const gaTotals: Record<GaStage, number> = { sessions: 0, opens: 0, clicks: 0, confirms: 0 };
  const openedKeys = new Set<string>();
  const opensByKey = new Map<string, number>();
  for (const e of ga.events) {
    if (e.day < fromDay || e.day > toDay || !keyAllowed(e.key)) continue;
    gaTotals[e.stage] += e.n;
    if (e.stage === "opens" && e.key && e.n > 0) {
      openedKeys.add(e.key);
      opensByKey.set(e.key, (opensByKey.get(e.key) ?? 0) + e.n);
    }
  }
  for (const [day, n] of ga.sessions) if (day >= fromDay && day <= toDay) gaTotals.sessions += n;
  const hasGa = Boolean(ga.syncedAt) || ga.events.length > 0;

  /* -- historical rates and timing, from the scope's mature applications. */
  const scoped = apps.filter((a) => scope === "all" || a.fact.paid);
  const matureBefore = now.getTime() - MATURE_DAYS * DAY;
  const reference = scoped.filter((a) => a.fact.createdAt >= STATUS_HISTORY_START && a.fact.createdAt.getTime() < matureBefore);
  const rates = SF_STAGES.map((stage, i) => {
    const reached = reference.filter((a) => a.level >= i);
    const hired = reached.filter((a) => a.level === HIRED).length;
    return { stage: stage as StageKey, rate: reached.length ? hired / reached.length : null, base: reached.length };
  });
  const toHire = scoped
    .filter((a) => a.level === HIRED)
    .map((a) => {
      const start = reachedAt(a, sfAnchor);
      const end = reachedAt(a, HIRED);
      return start && end ? (end.getTime() - start.getTime()) / DAY : null;
    })
    .filter((d): d is number => d !== null && d >= 0)
    .sort((a, b) => a - b);
  const p80 = percentile(toHire, 0.8);
  const maturity: Maturity = {
    median: percentile(toHire, 0.5),
    p80,
    sample: toHire.length,
    young: p80 == null ? 0 : cohort.filter((a) => now.getTime() - reachedAt(a, sfAnchor)!.getTime() < p80 * DAY).length,
  };

  /* -- the funnel rows. */
  const expectedOf = (list: FunnelApp[]) => list.reduce((s, a) => s + (a.outcome === "active" ? (rates[a.level]?.rate ?? 0) : 0), 0);
  const rows: StageRow[] = [];
  STAGES.forEach((s, idx) => {
    if (s.source === "ga") {
      if (!hasGa) return;
      rows.push({ key: s.key, label: s.label, source: "ga", count: gaTotals[s.key as GaStage], kind: "context", isAnchor: idx === stageIndex, ofAnchor: null, ofPrev: null, stopped: null, expected: 0 });
      return;
    }
    const i = SF_STAGES.indexOf(s.key as (typeof SF_STAGES)[number]);
    if (i < sfAnchor) {
      // Before the anchor: the same stage, counted by when it happened in the range.
      rows.push({ key: s.key, label: s.label, source: "sf", count: filtered.filter((a) => inRange(reachedAt(a, i))).length, kind: "context", isAnchor: false, ofAnchor: null, ofPrev: null, stopped: null, expected: 0 });
      return;
    }
    const here = cohort.filter((a) => a.level === i);
    const reasons = new Map<string, number>();
    for (const a of here) if (a.outcome === "closed") reasons.set(a.status ?? "לא ידוע", (reasons.get(a.status ?? "לא ידוע") ?? 0) + 1);
    rows.push({
      key: s.key,
      label: s.label,
      source: "sf",
      count: cohort.filter((a) => a.level >= i).length,
      kind: "cohort",
      isAnchor: idx === stageIndex,
      ofAnchor: null,
      ofPrev: null,
      stopped:
        i === HIRED
          ? null
          : {
              active: here.filter((a) => a.outcome === "active").length,
              stuck: here.filter((a) => a.outcome === "stuck").length,
              closed: here.filter((a) => a.outcome === "closed").length,
              reasons: [...reasons].map(([status, count]) => ({ status, count })).sort((a, b) => b.count - a.count),
            },
      expected: expectedOf(here),
    });
  });

  // Rates from the anchor down. Site stages after a site anchor are ratios of totals, not of the same people.
  const anchorRow = rows.findIndex((r) => r.isAnchor);
  const anchorCount = anchorRow >= 0 ? rows[anchorRow]!.count : cohort.length;
  if (anchorRow >= 0) {
    for (let r = anchorRow + 1; r < rows.length; r++) {
      const row = rows[r]!;
      if (anchorIsSite && row.source === "sf" && row.kind === "context") continue;
      row.ofAnchor = anchorCount ? row.count / anchorCount : null;
      const prev = rows[r - 1]!;
      row.ofPrev = prev.count ? row.count / prev.count : null;
    }
  }

  // The biggest leak: the cohort stage where the most cases closed without moving on.
  let leak: Leak | null = null;
  for (let i = sfAnchor; i < HIRED; i++) {
    const row = rows.find((r) => r.key === SF_STAGES[i]);
    if (!row?.stopped || row.stopped.closed === 0) continue;
    if (!leak || row.stopped.closed > leak.closed) {
      leak = { from: row.label, to: STAGES.find((s) => s.key === SF_STAGES[i + 1])!.label, closed: row.stopped.closed, topReason: row.stopped.reasons[0]?.status ?? null };
    }
  }

  const count = (o: Outcome) => cohort.filter((a) => a.outcome === o).length;
  const funnel: FunnelResult = {
    anchor,
    rows,
    anchorCount,
    cohortSize: cohort.length,
    hired: count("hired"),
    active: count("active"),
    stuck: count("stuck"),
    closed: count("closed"),
    expected: expectedOf(cohort),
    rates,
    maturity,
    leak,
    jobsOpened: openedKeys.size,
    jobsApplied: new Set(cohort.map((a) => a.fact.parentId).filter(Boolean)).size,
    gaPartial: hasAppFilters(filters),
    hasGa,
  };

  /* -- the timeline: the anchor stage per week, over all time. */
  const weeks = new Map<string, number[]>();
  const todayWeek = weekStart(israelDay(now));
  for (let w = weekStart(input.timelineFromDay); w <= todayWeek; w = addDays(w, 7)) weeks.set(w, anchorIsSite ? [0] : [0, 0, 0, 0]);
  if (anchorIsSite) {
    const add = (day: string, n: number) => {
      const bucket = weeks.get(weekStart(day));
      if (bucket) bucket[0]! += n;
    };
    if (anchor === "sessions") for (const [day, n] of ga.sessions) add(day, n);
    else for (const e of ga.events) if (e.stage === anchor && keyAllowed(e.key)) add(e.day, e.n);
  } else {
    const slot: Record<Outcome, number> = { hired: 0, active: 1, stuck: 2, closed: 3 };
    for (const a of filtered) {
      const at = reachedAt(a, sfAnchor);
      if (!at) continue;
      const bucket = weeks.get(weekStart(israelDay(at)));
      if (bucket) bucket[slot[a.outcome]]! += 1;
    }
  }
  const timeline = [...weeks].map(([start, values]) => ({ start, values }));

  /* -- the breakdown: the same cohort, split by one dimension. */
  // Companies are grouped by their folded name, so spelling variants share a row (shown as the first seen).
  const groupKey = (label: string) => (dimension === "company" ? foldName(label) || label : label);
  const groups = new Map<string, FunnelApp[]>();
  const groupLabels = new Map<string, string>();
  for (const a of cohort) {
    const label = groupOf(a, dimension, reachedAt(a, sfAnchor)!);
    const g = groupKey(label);
    if (!groupLabels.has(g)) groupLabels.set(g, label);
    const list = groups.get(g);
    if (list) list.push(a);
    else groups.set(g, [a]);
  }
  const groupOpens = new Map<string, number>();
  const dimIsJob = DIMENSIONS.find((d) => d.key === dimension)!.jobLevel;
  if (dimIsJob && hasGa) {
    for (const j of jobs.values()) {
      const n = j.key ? opensByKey.get(j.key) : undefined;
      const label = n ? jobGroupOf(j, dimension) : null;
      if (label && n) groupOpens.set(groupKey(label), (groupOpens.get(groupKey(label)) ?? 0) + n);
    }
  }
  const sfLabels = SF_STAGES.map((k) => STAGES.find((s) => s.key === k)!.short);
  const breakdown: BreakdownRow[] = [...groups]
    .map(([key, list]) => {
      const label = groupLabels.get(key) ?? key;
      const reached = SF_STAGES.slice(sfAnchor).map((_, j) => list.filter((a) => a.level >= sfAnchor + j).length);
      let weakest: BreakdownRow["weakest"] = null;
      for (let j = 1; j < reached.length; j++) {
        if (reached[j - 1]! < MIN_STEP_BASE) break;
        const rate = reached[j]! / reached[j - 1]!;
        if (!weakest || rate < weakest.rate) weakest = { from: sfLabels[sfAnchor + j - 1]!, to: sfLabels[sfAnchor + j]!, rate };
      }
      return {
        label,
        size: list.length,
        reached,
        hired: list.filter((a) => a.outcome === "hired").length,
        active: list.filter((a) => a.outcome === "active").length,
        stuck: list.filter((a) => a.outcome === "stuck").length,
        expected: expectedOf(list),
        opens: dimIsJob && hasGa ? (groupOpens.get(key) ?? 0) : null,
        weakest,
      };
    })
    .sort((a, b) => (dimension === "month" ? b.label.localeCompare(a.label) : b.size - a.size || a.label.localeCompare(b.label, "he")));

  /* -- filter choices, from what the scope actually holds. */
  const tally = (values: (string | null | undefined)[]) => {
    const m = new Map<string, number>();
    for (const v of values) if (v) m.set(v, (m.get(v) ?? 0) + 1);
    return [...m].sort((a, b) => b[1] - a[1]).map(([v]) => v);
  };
  const recent = scoped.filter((a) => a.fact.createdAt.getTime() > now.getTime() - 365 * DAY);
  const options = {
    owners: tally(scoped.map((a) => a.fact.ownerName)).sort((a, b) => a.localeCompare(b, "he")),
    locations: tally([...jobs.values()].filter((j) => scope === "all" || j.paid).map((j) => j.location)).slice(0, 80),
    companies: tally(recent.map((a) => a.fact.company)).slice(0, 150),
  };

  return { funnel, timeline, breakdown, filtered, options };
}

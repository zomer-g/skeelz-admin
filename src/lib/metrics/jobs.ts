import { sql } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { EMPLOYER_RESPONSE_STATUSES, RECORD_TYPES, STATUS, type ApplicationFacts } from "./candidates";

/**
 * Jobs tab: everything about one job in one place — its exposure on the site
 * (GA4, keyed by the public job id) and the fate of its applications
 * (Salesforce Cases whose ParentId is the job).
 *
 * On the site a job opens in a modal, so "page views" of /job/<id> undercount
 * badly; the open_job_page event is the real exposure measure.
 */

export const JOB_EVENTS = {
  opens: "open_job_page",
  applyClicks: "Job_application_click_1",
  applyYes: "Job_application_yes",
} as const;

export interface Position {
  id: string;
  caseNumber: string | null;
  title: string | null;
  company: string | null;
  createdAt: Date | null;
  status: string | null;
  manageStatus: string | null;
  siteJobKey: string | null;
}

export interface JobGa {
  pageViews: number;
  opens: number;
  applyClicks: number;
  applyYes: number;
}

export interface ApplicationFunnel {
  applications: number;
  requestedCv: number;
  cvReceived: number;
  sent: number;
  responded: number;
  interview: number;
  accepted: number;
}

export interface JobRow {
  position: Position;
  ga: JobGa;
  funnel: ApplicationFunnel;
}

type Row = Record<string, unknown>;

const run = async <T extends Row>(query: ReturnType<typeof sql>) => (await getDb().execute<T>(query)).rows;
const num = (v: unknown) => Number(v ?? 0);
const str = (v: unknown) => (typeof v === "string" && v !== "" ? v : null);
const asDate = (v: unknown) => (v == null ? null : v instanceof Date ? v : new Date(String(v)));

const EMPTY_GA: JobGa = { pageViews: 0, opens: 0, applyClicks: 0, applyYes: 0 };

function positionsSql(extra: ReturnType<typeof sql>) {
  return sql`
    SELECT c.id,
           c.data->>'CaseNumber' AS case_number,
           coalesce(nullif(c.data->>'Position_cambium__c', ''), nullif(c.data->>'Position_Name__c', ''), nullif(c.data->>'Subject', '')) AS title,
           coalesce(nullif(c.data->>'company_cambium__c', ''), acc.name) AS company,
           c.created_date,
           c.status,
           c.data->>'new_pos_status__c' AS manage_status,
           c.site_job_key
      FROM sf_case c
      JOIN sf_record_type rt ON rt.id = c.record_type_id
      LEFT JOIN sf_account acc ON acc.id = c.account_id
     WHERE rt.developer_name = ${RECORD_TYPES.position} AND NOT c.is_deleted ${extra}`;
}

function toPosition(r: Row): Position {
  return {
    id: String(r.id),
    caseNumber: str(r.case_number),
    title: str(r.title),
    company: str(r.company),
    createdAt: asDate(r.created_date),
    status: str(r.status),
    manageStatus: str(r.manage_status),
    siteJobKey: str(r.site_job_key),
  };
}

export async function loadPositions(): Promise<Position[]> {
  return (await run(positionsSql(sql.raw("")))).map(toPosition);
}

export async function loadPosition(id: string): Promise<Position | null> {
  const [row] = await run(positionsSql(sql`AND c.id = ${id}`));
  return row ? toPosition(row) : null;
}

/** GA exposure per job key over an inclusive day range; one key or all. */
export async function loadJobGa(fromDay: string, toDay: string, key?: string): Promise<Map<string, JobGa>> {
  const keyFilter = key ? sql`AND site_job_key = ${key}` : sql.raw("");
  const [pages, events] = await Promise.all([
    run(sql`
      SELECT site_job_key, sum(views) AS views FROM ga_page_daily
       WHERE site_job_key IS NOT NULL AND date >= ${fromDay}::date AND date <= ${toDay}::date ${keyFilter}
       GROUP BY 1`),
    run(sql`
      SELECT site_job_key, event_name, sum(event_count) AS n FROM ga_event_daily
       WHERE site_job_key IS NOT NULL AND event_name IN ${Object.values(JOB_EVENTS)}
         AND date >= ${fromDay}::date AND date <= ${toDay}::date ${keyFilter}
       GROUP BY 1, 2`),
  ]);

  const out = new Map<string, JobGa>();
  const entry = (k: string) => {
    let e = out.get(k);
    if (!e) out.set(k, (e = { ...EMPTY_GA }));
    return e;
  };
  for (const r of pages) entry(String(r.site_job_key)).pageViews = num(r.views);
  for (const r of events) {
    const e = entry(String(r.site_job_key));
    if (r.event_name === JOB_EVENTS.opens) e.opens = num(r.n);
    else if (r.event_name === JOB_EVENTS.applyClicks) e.applyClicks = num(r.n);
    else if (r.event_name === JOB_EVENTS.applyYes) e.applyYes = num(r.n);
  }
  return out;
}

export async function loadJobDailyOpens(key: string, fromDay: string, toDay: string): Promise<Map<string, number>> {
  const r = await run(sql`
    SELECT date::text AS day, sum(event_count) AS n FROM ga_event_daily
     WHERE site_job_key = ${key} AND event_name = ${JOB_EVENTS.opens}
       AND date >= ${fromDay}::date AND date <= ${toDay}::date
     GROUP BY 1`);
  return new Map(r.map((x) => [String(x.day), num(x.n)]));
}

export async function loadJobEvents(key: string, fromDay: string, toDay: string): Promise<{ event: string; count: number }[]> {
  const r = await run(sql`
    SELECT event_name, sum(event_count) AS n FROM ga_event_daily
     WHERE site_job_key = ${key} AND date >= ${fromDay}::date AND date <= ${toDay}::date
     GROUP BY 1 ORDER BY 2 DESC`);
  return r.map((x) => ({ event: String(x.event_name), count: num(x.n) }));
}

/** Stages reached by these applications, whenever they were reached. */
export function applicationFunnel(apps: ApplicationFacts[]): ApplicationFunnel {
  return {
    applications: apps.length,
    requestedCv: apps.filter((a) => a.requestedCvAt).length,
    cvReceived: apps.filter((a) => a.cvReceivedAt).length,
    sent: apps.filter((a) => a.sentAt || a.status === STATUS.sent).length,
    responded: apps.filter((a) => a.employerResponseAt || (a.status !== null && EMPLOYER_RESPONSE_STATUSES.includes(a.status))).length,
    interview: apps.filter((a) => a.interviewAt || a.status === STATUS.interview).length,
    accepted: apps.filter((a) => a.acceptedAt).length,
  };
}

/** One row per job: GA exposure in the range, and the applications created in the range. */
export function buildJobRows(positions: Position[], ga: Map<string, JobGa>, facts: ApplicationFacts[], from: Date, to: Date): JobRow[] {
  const byJob = new Map<string, ApplicationFacts[]>();
  for (const f of facts) {
    if (!f.parentId || f.createdAt < from || f.createdAt >= to) continue;
    const list = byJob.get(f.parentId);
    if (list) list.push(f);
    else byJob.set(f.parentId, [f]);
  }
  return positions.map((position) => ({
    position,
    ga: (position.siteJobKey && ga.get(position.siteJobKey)) || EMPTY_GA,
    funnel: applicationFunnel(byJob.get(position.id) ?? []),
  }));
}

/** Positions by id, in the order given; unknown ids are skipped. */
export async function loadPositionsByIds(ids: string[]): Promise<Position[]> {
  if (!ids.length) return [];
  const rows = (await run(positionsSql(sql`AND c.id IN ${ids}`))).map(toPosition);
  const byId = new Map(rows.map((p) => [p.id, p]));
  return ids.map((id) => byId.get(id)).filter((p): p is Position => Boolean(p));
}

/** Positions whose public job key is one of these. */
export async function loadPositionsByJobKeys(keys: string[]): Promise<Position[]> {
  if (!keys.length) return [];
  return (await run(positionsSql(sql`AND c.site_job_key IN ${keys}`))).map(toPosition);
}

export async function searchPositions(q: string, limit = 8): Promise<Position[]> {
  const needle = `%${q.trim()}%`;
  if (needle === "%%") return [];
  return (
    await run(
      positionsSql(sql`
        AND (c.data->>'Position_cambium__c' ILIKE ${needle} OR c.data->>'Position_Name__c' ILIKE ${needle}
             OR c.data->>'Subject' ILIKE ${needle} OR c.data->>'company_cambium__c' ILIKE ${needle}
             OR c.data->>'CaseNumber' ILIKE ${needle} OR c.site_job_key ILIKE ${needle} OR c.id = ${q.trim()})
        ORDER BY c.created_date DESC LIMIT ${limit}`),
    )
  ).map(toPosition);
}

export function matchesSearch(p: Position, q: string): boolean {
  const needle = q.trim().toLowerCase();
  if (!needle) return true;
  return [p.title, p.company, p.caseNumber, p.siteJobKey, p.id].some((v) => v?.toLowerCase().includes(needle));
}

export const siteJobUrl = (key: string) => `https://jobs.skeelz.co.il/job/${key}`;

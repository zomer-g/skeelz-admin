import { sql } from "drizzle-orm";
import { addDays, israelMidnight } from "@/lib/dashboard/params";
import { getDb } from "@/lib/db/client";
import { countNewJobs, loadApplicationFacts, normStatus, RECORD_TYPES, type ApplicationFacts } from "@/lib/metrics/candidates";
import { JOB_EVENTS, siteJobUrl, type Position } from "@/lib/metrics/jobs";
import { applicationPaidSql, jobPaidSql, paidJobKeysSql, type Scope } from "@/lib/metrics/paid";

/**
 * What the external API and the webhooks may show. Jobs and aggregate figures only:
 * no candidate names, emails, phones or files ever leave through here.
 */

type Row = Record<string, unknown>;
const run = async (query: ReturnType<typeof sql>) => (await getDb().execute<Row>(query)).rows;
const num = (v: unknown) => Number(v ?? 0);

export function jobJson(p: Position) {
  return {
    id: p.id,
    case_number: p.caseNumber,
    title: p.title,
    company: p.company,
    site_job_key: p.siteJobKey,
    url: p.siteJobKey ? siteJobUrl(p.siteJobKey) : null,
    paid: p.paid,
    active: p.active,
    manage_status: p.manageStatus,
    created_at: p.createdAt?.toISOString() ?? null,
    updated_at: p.updatedAt?.toISOString() ?? null,
  };
}

export type JobJson = ReturnType<typeof jobJson>;

/** A job's applications (placements included), counted by current status. */
export async function applicationCounts(jobId: string): Promise<{ total: number; paid: number; by_status: Record<string, number> }> {
  const rows = await run(sql`
    SELECT c.status, count(*)::int AS n, (count(*) FILTER (WHERE ${applicationPaidSql("c", "j")}))::int AS paid
      FROM sf_case c
      JOIN sf_record_type rt ON rt.id = c.record_type_id
      LEFT JOIN sf_case j ON j.id = c.parent_id
     WHERE rt.developer_name IN (${RECORD_TYPES.application}, ${RECORD_TYPES.accepted})
       AND NOT c.is_deleted AND c.parent_id = ${jobId}
     GROUP BY c.status`);
  const byStatus: Record<string, number> = {};
  let total = 0;
  let paid = 0;
  for (const r of rows) {
    const status = normStatus(typeof r.status === "string" ? r.status : null) || "(ללא סטטוס)";
    byStatus[status] = (byStatus[status] ?? 0) + num(r.n);
    total += num(r.n);
    paid += num(r.paid);
  }
  return { total, paid, by_status: byStatus };
}

/** Jobs live on the site right now (`PStatus__c` = Active). */
export async function countActiveJobs(): Promise<{ all: number; paid: number }> {
  const [row] = await run(sql`
    SELECT count(*)::int AS total, (count(*) FILTER (WHERE ${jobPaidSql("c")}))::int AS paid
      FROM sf_case c
      JOIN sf_record_type rt ON rt.id = c.record_type_id
     WHERE rt.developer_name = ${RECORD_TYPES.position} AND NOT c.is_deleted AND (c.data->>'PStatus__c') = 'Active'`);
  return { all: num(row?.total), paid: num(row?.paid) };
}

/** Site traffic over inclusive Israel days. Sessions are site-wide; job events follow the paid scope. */
export async function siteTotals(fromDay: string, toDay: string, scope: Scope) {
  const keyFilter = scope === "paid" ? sql`AND site_job_key IN (${paidJobKeysSql})` : sql.raw("");
  const [[sessions], events] = await Promise.all([
    run(sql`SELECT coalesce(sum(sessions), 0) AS n FROM ga_channel_daily WHERE date >= ${fromDay}::date AND date <= ${toDay}::date`),
    run(sql`
      SELECT event_name, coalesce(sum(event_count), 0) AS n FROM ga_event_daily
       WHERE event_name IN ${Object.values(JOB_EVENTS)} AND date >= ${fromDay}::date AND date <= ${toDay}::date ${keyFilter}
       GROUP BY 1`),
  ]);
  const event = (name: string) => num(events.find((e) => e.event_name === name)?.n);
  return {
    sessions: num(sessions?.n),
    job_opens: event(JOB_EVENTS.opens),
    apply_clicks: event(JOB_EVENTS.applyClicks),
    apply_confirmations: event(JOB_EVENTS.applyYes),
  };
}

const FACTS_TTL_MS = 5 * 60_000;
const cache = globalThis as typeof globalThis & { __skeelzApiFacts?: { at: number; facts: Promise<ApplicationFacts[]> } };

/** Application facts are the heaviest load in the app; API calls share one copy for five minutes. */
export function cachedApplicationFacts(): Promise<ApplicationFacts[]> {
  const hit = cache.__skeelzApiFacts;
  if (hit && Date.now() - hit.at < FACTS_TTL_MS) return hit.facts;
  const facts = loadApplicationFacts();
  cache.__skeelzApiFacts = { at: Date.now(), facts };
  facts.catch(() => {
    if (cache.__skeelzApiFacts?.facts === facts) cache.__skeelzApiFacts = undefined;
  });
  return facts;
}

/** Yesterday (or any Israel day) in numbers, split paid / all, for the daily webhook. */
export async function dailySummary(day: string) {
  const from = israelMidnight(day);
  const to = israelMidnight(addDays(day, 1));
  const within = (d: Date | null) => d !== null && d >= from && d < to;
  const [facts, newJobs, active, site] = await Promise.all([loadApplicationFacts(), countNewJobs(from, to), countActiveJobs(), siteTotals(day, day, "all")]);
  const split = (list: ApplicationFacts[]) => ({ all: list.length, paid: list.filter((f) => f.paid).length });
  return {
    day,
    applications: split(facts.filter((f) => within(f.createdAt))),
    sent_to_employer: split(facts.filter((f) => within(f.sentAt))),
    interviews: split(facts.filter((f) => within(f.interviewAt))),
    accepted: split(facts.filter((f) => within(f.acceptedAt))),
    jobs: { new: newJobs, active },
    site: { sessions: site.sessions },
  };
}

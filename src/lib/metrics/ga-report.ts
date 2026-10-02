import { eq, sql, type SQL } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { syncState } from "@/lib/db/schema";
import { containsPattern } from "@/lib/entities/search";
import { paidJobKeysSql } from "@/lib/metrics/paid";
import { ArgError } from "@/lib/mcp/args";

/**
 * Every Google Analytics figure the platform keeps, queryable from the MCP (ga_report). The sync
 * (lib/integrations/marketing-sync.ts) mirrors six GA4 reports per day; this groups and sums them
 * over any range, by any of their dimensions. Column names come only from the whitelists below.
 */

interface ReportDef {
  table: string;
  /** Dimension name (as the tool takes it) → column. */
  dims: Record<string, string>;
  /** Metric name → aggregate. */
  metrics: Record<string, string>;
  /** Dimensions matched by "contains" rather than equality. */
  contains?: string[];
  about: string;
}

export const GA_REPORTS: Record<string, ReportDef> = {
  pages: {
    table: "ga_page_daily",
    dims: { page_path: "page_path", site_job_key: "site_job_key" },
    metrics: { views: "sum(views)", active_users: "sum(active_users)", sessions: "sum(sessions)" },
    contains: ["page_path"],
    about: "page views, users and sessions per page path (job pages carry site_job_key)",
  },
  events: {
    table: "ga_event_daily",
    dims: { event_name: "event_name", page_path: "page_path", site_job_key: "site_job_key" },
    metrics: { event_count: "sum(event_count)", total_users: "sum(total_users)" },
    contains: ["page_path"],
    about: "every GA event, per name and page",
  },
  channels: {
    table: "ga_channel_daily",
    dims: { channel_group: "channel_group", source: "source", medium: "medium" },
    metrics: { sessions: "sum(sessions)", active_users: "sum(active_users)", new_users: "sum(new_users)", engaged_sessions: "sum(engaged_sessions)" },
    about: "site traffic by default channel group, source and medium",
  },
  campaigns: {
    table: "ga_campaign_daily",
    dims: { campaign: "campaign", source: "source", medium: "medium" },
    metrics: { sessions: "sum(sessions)", new_users: "sum(new_users)", engaged_sessions: "sum(engaged_sessions)" },
    about: "sessions by UTM campaign (tagged campaigns only), source and medium",
  },
  campaign_events: {
    table: "ga_campaign_event_daily",
    dims: { campaign: "campaign", event_name: "event_name" },
    metrics: { event_count: "sum(event_count)" },
    about: "key site events (job opens, apply clicks/confirmations, sign-ups) by the session's UTM campaign",
  },
  campaign_landing_pages: {
    table: "ga_campaign_landing_daily",
    dims: { campaign: "campaign", landing_page: "landing_page", site_job_key: "site_job_key" },
    metrics: { sessions: "sum(sessions)" },
    contains: ["landing_page"],
    about: "where each campaign's sessions landed",
  },
};

export const GA_REPORT_NAMES = Object.keys(GA_REPORTS) as [string, ...string[]];
// As text: a Postgres date read into a JS Date can shift a day with the server's time zone.
const TIME_GRAINS: Record<string, string> = {
  date: "date::text",
  week: "date_trunc('week', date)::date::text",
  month: "to_char(date, 'YYYY-MM')",
};

/** Every dimension any report has, for the tool's filter arguments. */
export const GA_FILTER_DIMS = [...new Set(Object.values(GA_REPORTS).flatMap((r) => Object.keys(r.dims)))];

/** Narrow the reports that carry a job key: "jobs" = job pages only, "paid" = pages of paid jobs only. */
export const JOB_SCOPES = ["jobs", "paid"] as const;
export type JobScope = (typeof JOB_SCOPES)[number];

export interface GaQuery {
  report: string;
  jobScope?: JobScope;
  fromDay: string;
  toDay: string;
  groupBy: string[];
  filters: Record<string, string>;
  orderBy?: string;
  limit: number;
}

type Row = Record<string, unknown>;
const run = async (q: SQL) => (await getDb().execute<Row>(q)).rows;

export async function runGaReport(q: GaQuery) {
  const def = GA_REPORTS[q.report];
  if (!def) throw new ArgError(`report must be one of: ${GA_REPORT_NAMES.join(", ")}`);

  const groups = q.groupBy.map((g) => {
    const col = TIME_GRAINS[g] ?? def.dims[g];
    if (!col) throw new ArgError(`${q.report} can be grouped by: ${[...Object.keys(TIME_GRAINS), ...Object.keys(def.dims)].join(", ")}`);
    return { name: g, col };
  });
  if (q.groupBy.filter((g) => g in TIME_GRAINS).length > 1) throw new ArgError("group by at most one of date, week, month");

  const where: SQL[] = [sql`date >= ${q.fromDay}::date`, sql`date <= ${q.toDay}::date`];
  for (const [name, value] of Object.entries(q.filters)) {
    const col = def.dims[name];
    if (!col) throw new ArgError(`${q.report} has no ${name} to filter on; its dimensions: ${Object.keys(def.dims).join(", ")}`);
    where.push(def.contains?.includes(name) ? sql`${sql.raw(col)} ILIKE ${containsPattern(value)}` : sql`${sql.raw(col)} = ${value}`);
  }
  if (q.jobScope) {
    if (!def.dims.site_job_key) throw new ArgError(`${q.report} has no job key; job_scope works on: ${Object.entries(GA_REPORTS).filter(([, d]) => d.dims.site_job_key).map(([k]) => k).join(", ")}`);
    where.push(q.jobScope === "paid" ? sql`site_job_key IN (${paidJobKeysSql})` : sql`site_job_key IS NOT NULL AND site_job_key <> ''`);
  }
  const whereSql = sql.join(where, sql` AND `);
  const metricSql = sql.raw(Object.entries(def.metrics).map(([m, agg]) => `coalesce(${agg}, 0)::bigint AS ${m}`).join(", "));
  const metricNames = Object.keys(def.metrics);
  const order = q.orderBy ?? (groups.some((g) => g.name in TIME_GRAINS) ? groups.find((g) => g.name in TIME_GRAINS)!.name : metricNames[0]!);
  if (![...metricNames, ...q.groupBy].includes(order)) throw new ArgError(`order_by must be one of: ${[...metricNames, ...q.groupBy].join(", ")}`);
  const direction = order in TIME_GRAINS ? "ASC" : "DESC";
  const table = sql.raw(def.table);

  const [rows, [totals], [count], freshness] = await Promise.all([
    groups.length
      ? run(sql`
          SELECT ${sql.raw(groups.map((g) => `${g.col} AS ${g.name}`).join(", "))}, ${metricSql}
            FROM ${table} WHERE ${whereSql}
           GROUP BY ${sql.raw(groups.map((_, i) => String(i + 1)).join(", "))}
           ORDER BY ${sql.raw(`${order} ${direction} NULLS LAST`)}
           LIMIT ${q.limit}`)
      : Promise.resolve([]),
    run(sql`SELECT ${metricSql} FROM ${table} WHERE ${whereSql}`),
    groups.length
      ? run(sql`SELECT count(*)::int AS n FROM (SELECT 1 FROM ${table} WHERE ${whereSql} GROUP BY ${sql.raw(groups.map((g) => g.col).join(", "))}) g`)
      : Promise.resolve([{ n: 0 }]),
    getDb().select({ at: syncState.lastSuccessAt }).from(syncState).where(eq(syncState.object, "GA4")).limit(1),
  ]);

  const numbers = (r: Row) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, metricNames.includes(k) ? Number(v ?? 0) : v instanceof Date ? v.toISOString().slice(0, 10) : v]));
  return {
    report: q.report,
    about: def.about,
    range: { from: q.fromDay, to: q.toDay },
    group_by: q.groupBy,
    filters: q.filters,
    job_scope: q.jobScope ?? null,
    totals: numbers(totals ?? {}),
    groups_total: Number(count?.n ?? 0),
    rows: rows.map(numbers),
    truncated: Number(count?.n ?? 0) > rows.length,
    ga_synced_at: freshness[0]?.at?.toISOString() ?? null,
  };
}

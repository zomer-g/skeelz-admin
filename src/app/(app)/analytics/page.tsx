import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import { BarList } from "@/components/dashboard/BarList";
import { DashboardShell } from "@/components/dashboard/DashboardShell";
import { DashboardTabs } from "@/components/dashboard/DashboardTabs";
import { LineChart } from "@/components/dashboard/LineChart";
import { MarkedBadge } from "@/components/entities/JobFields";
import { Badge, Card, smallFieldClass, StatCard, Table } from "@/components/ui";
import { pageAuth } from "@/lib/auth/guard";
import { EXPLAIN } from "@/lib/dashboard/explain";
import { eachDay, formatDay, parseDashboardParams, rangeQuery, viewPath } from "@/lib/dashboard/params";
import { fmtInt, fmtPercent, fmtRelative } from "@/lib/format";
import { ArgError } from "@/lib/mcp/args";
import { GA_DIM_LABELS, GA_EVENT_LABELS, GA_METRIC_LABELS, GA_REPORT_LABELS, gaEventLabel } from "@/lib/metrics/ga-labels";
import { GA_REPORTS, JOB_SCOPES, runGaReport, type GaQuery, type JobScope } from "@/lib/metrics/ga-report";
import { JOB_EVENTS, loadJobGa, loadPositions, type Position } from "@/lib/metrics/jobs";
import { CHANNEL_LABELS } from "@/lib/metrics/marketing";

export const metadata: Metadata = { title: "Google Analytics" };
export const dynamic = "force-dynamic";

const PATH = "/analytics";
/** The tab's own filters, kept in the URL next to the range. */
const FILTERS = ["channel_group", "source", "medium", "campaign", "event_name", "page_path"] as const;
const EXPLORER = ["x", "xg1", "xg2", "xl"] as const;
const KEYS = ["range", "from", "to", "scope", "jobs", ...FILTERS, ...EXPLORER];
const GRAINS = ["date", "week", "month"];
const JOB_LEVELS: Record<"" | JobScope, string> = { "": "כל האתר", jobs: "דפי משרות בלבד", paid: "דפי משרות בתשלום בלבד" };
const MAX_JOBS = 50;

type Search = Record<string, string | string[] | undefined>;
type Row = Record<string, unknown>;
const first = (v: string | string[] | undefined) => (typeof v === "string" ? v.trim().slice(0, 300) : Array.isArray(v) ? (v[0] ?? "").trim().slice(0, 300) : "");
const num = (v: unknown) => Number(v ?? 0);

function SectionTitle({ children, hint }: { children: string; hint?: string }) {
  return (
    <div className="mb-4 mt-10 flex flex-wrap items-baseline gap-3">
      <h2 className="text-xl font-bold">{children}</h2>
      {hint ? <span className="text-sm text-muted">{hint}</span> : null}
    </div>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="flex flex-col gap-1 text-sm font-medium text-muted">
      {label}
      {children}
    </label>
  );
}

/**
 * Google Analytics tab: every figure the GA sync keeps (lib/integrations/marketing-sync.ts), with
 * filters, the site-wide breakdowns, the job-level view, and an explorer for any other cut.
 * GA keeps separate reports, not single visits, so a filter applies to the reports that carry it.
 */
export default async function AnalyticsPage({ searchParams }: { searchParams: Promise<Search> }) {
  const search = await searchParams;
  const auth = await pageAuth("viewer", viewPath(PATH, search, KEYS));
  if (!auth.ok) return auth.render;

  const params = parseDashboardParams(search, new Date(), "30d");
  const { fromDay, toDay } = params;
  const filters = Object.fromEntries(FILTERS.map((k) => [k, first(search[k])]).filter(([, v]) => v)) as Partial<Record<(typeof FILTERS)[number], string>>;
  const jobLevel = (JOB_SCOPES as readonly string[]).includes(first(search.jobs)) ? (first(search.jobs) as JobScope) : undefined;

  /** The page's filters that this report has; the others do not apply to it. */
  const forReport = (report: string, extra: Record<string, string> = {}) => {
    const dims = GA_REPORTS[report]!.dims;
    return { ...Object.fromEntries(Object.entries(filters).filter(([k]) => k in dims)), ...extra };
  };
  const q = (report: string, groupBy: string[], limit: number, extra: Record<string, string> = {}, job = true): GaQuery => ({
    report,
    fromDay,
    toDay,
    groupBy,
    limit,
    filters: forReport(report, extra),
    jobScope: job && GA_REPORTS[report]!.dims.site_job_key ? jobLevel : undefined,
  });
  const allTime = { fromDay: "2025-01-01", toDay, filters: {}, limit: 300 };

  const [
    traffic,
    trafficDaily,
    channels,
    sources,
    pages,
    topPages,
    events,
    opensDaily,
    yesDaily,
    campaigns,
    campaignEvents,
    landing,
    channelOptions,
    eventOptions,
    jobGa,
    positions,
  ] = await Promise.all([
    runGaReport(q("channels", [], 1)),
    runGaReport(q("channels", ["date"], 400)),
    runGaReport(q("channels", ["channel_group"], 20)),
    runGaReport(q("channels", ["source", "medium"], 30)),
    runGaReport(q("pages", [], 1)),
    runGaReport(q("pages", ["page_path"], 30)),
    runGaReport(q("events", ["event_name"], 100)),
    runGaReport(q("events", ["date"], 400, { event_name: JOB_EVENTS.opens })),
    runGaReport(q("events", ["date"], 400, { event_name: JOB_EVENTS.applyYes })),
    runGaReport(q("campaigns", ["campaign"], 30)),
    runGaReport(q("campaign_events", ["campaign", "event_name"], 300)),
    runGaReport(q("campaign_landing_pages", ["campaign", "landing_page"], 30)),
    runGaReport({ ...allTime, report: "channels", groupBy: ["channel_group"] }),
    runGaReport({ ...allTime, report: "events", groupBy: ["event_name"] }),
    loadJobGa(fromDay, toDay),
    loadPositions(),
  ]);

  const byKey = new Map(positions.filter((p) => p.siteJobKey).map((p) => [p.siteJobKey!, p]));
  const t = traffic.totals as Row;
  const eventCount = (name: string) => num((events.rows as Row[]).find((r) => r.event_name === name)?.event_count);
  const sessions = num(t.sessions);

  // The tab's explorer: any report, grouped by up to two dimensions.
  const xReport = first(search.x);
  const xGroups = [first(search.xg1), first(search.xg2)].filter(Boolean);
  const xLimit = [25, 100, 500].includes(Number(first(search.xl))) ? Number(first(search.xl)) : 100;
  let explorer: Awaited<ReturnType<typeof runGaReport>> | null = null;
  let explorerError = "";
  if (xReport && !(xReport in GA_REPORTS)) explorerError = "דוח לא מוכר";
  else if (xReport) {
    try {
      explorer = await runGaReport(q(xReport, xGroups, xLimit));
    } catch (err) {
      if (!(err instanceof ArgError)) throw err;
      const allowed = [...GRAINS, ...Object.keys(GA_REPORTS[xReport]!.dims)].map((d) => GA_DIM_LABELS[d] ?? d).join(", ");
      explorerError = `בדוח "${GA_REPORT_LABELS[xReport] ?? xReport}" אפשר לקבץ לפי: ${allowed} (ושני שדות זמן לא יחד).`;
    }
  }

  // Jobs on the site in the range, by GA exposure, in the selected paid scope.
  const jobRows = [...jobGa.entries()]
    .map(([key, ga]) => ({ key, ga, position: byKey.get(key) ?? null }))
    .filter((j) => params.scope === "all" || j.position?.paid)
    .sort((a, b) => b.ga.opens - a.ga.opens || b.ga.pageViews - a.ga.pageViews);
  const jobTotals = jobRows.reduce((s, j) => ({ opens: s.opens + j.ga.opens, clicks: s.clicks + j.ga.applyClicks, yes: s.yes + j.ga.applyYes }), { opens: 0, clicks: 0, yes: 0 });

  const daily = (r: Row[]) => new Map(r.map((x) => [String(x.date), num(x.sessions ?? x.event_count)]));
  const sessionsByDay = daily(trafficDaily.rows as Row[]);
  const opensByDay = daily(opensDaily.rows as Row[]);
  const yesByDay = daily(yesDaily.rows as Row[]);
  const days = eachDay(fromDay, toDay);

  const keep = Object.fromEntries(KEYS.filter((k) => !["range", "from", "to", "scope"].includes(k)).flatMap((k) => (first(search[k]) ? [[k, first(search[k])]] : [])));
  const current = new URLSearchParams({ ...Object.fromEntries(["range", "from", "to", "scope"].flatMap((k) => (first(search[k]) ? [[k, first(search[k])]] : []))), ...keep });
  const hrefWith = (over: Record<string, string | null>) => {
    const next = new URLSearchParams(current);
    for (const [k, v] of Object.entries(over)) (v ? next.set(k, v) : next.delete(k));
    const s = next.toString();
    return s ? `${PATH}?${s}` : PATH;
  };
  const activeFilters = [...FILTERS.filter((k) => filters[k]), ...(jobLevel ? (["jobs"] as const) : [])];

  const dimCell = (dim: string, value: unknown): ReactNode => {
    const v = value == null || value === "" ? null : String(value);
    if (!v) return <span className="text-muted">(ריק)</span>;
    if (dim === "event_name") return <span title={v}>{gaEventLabel(v)}</span>;
    if (dim === "channel_group") return CHANNEL_LABELS[v] ?? v;
    if (dim === "page_path" || dim === "landing_page") return <span dir="ltr" className="break-all">{v}</span>;
    if (dim === "date") return formatDay(v);
    if (dim === "week") return `שבוע ${formatDay(v)}`;
    if (dim === "site_job_key") {
      const p = byKey.get(v);
      return p ? <Link href={`/jobs/${p.id}`} className="underline-offset-4 hover:underline">{p.title ?? v}</Link> : <span dir="ltr">{v}</span>;
    }
    return <span dir="auto">{v}</span>;
  };

  return (
    <>
      <DashboardTabs active="analytics" query={rangeQuery(params)} />
      <DashboardShell preset={params.preset} scope={params.scope} fromDay={fromDay} toDay={toDay} showBasis={false} keep={keep}>
        <form method="get" action={PATH} className="mb-6 flex flex-col gap-3 rounded-card border-2 border-line bg-surface p-4" aria-label="מסנני Google Analytics">
          {["range", "from", "to", "scope", ...EXPLORER].map((k) => (current.get(k) ? <input key={k} type="hidden" name={k} value={current.get(k)!} /> : null))}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Field label="ערוץ">
              <select name="channel_group" defaultValue={filters.channel_group ?? ""} className={smallFieldClass}>
                <option value="">כל הערוצים</option>
                {(channelOptions.rows as Row[]).map((r) => (
                  <option key={String(r.channel_group)} value={String(r.channel_group)}>
                    {CHANNEL_LABELS[String(r.channel_group)] ?? String(r.channel_group)}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="מקור (source)">
              <input name="source" defaultValue={filters.source} list="ga-sources" placeholder="למשל google" dir="ltr" className={smallFieldClass} />
              <datalist id="ga-sources">
                {(sources.rows as Row[]).map((r) => (
                  <option key={`${r.source}/${r.medium}`} value={String(r.source)} />
                ))}
              </datalist>
            </Field>
            <Field label="מדיום (medium)">
              <input name="medium" defaultValue={filters.medium} placeholder="למשל organic, email" dir="ltr" className={smallFieldClass} />
            </Field>
            <Field label="קמפיין (UTM)">
              <input name="campaign" defaultValue={filters.campaign} list="ga-campaigns" dir="ltr" className={smallFieldClass} />
              <datalist id="ga-campaigns">
                {(campaigns.rows as Row[]).map((r) => (
                  <option key={String(r.campaign)} value={String(r.campaign)} />
                ))}
              </datalist>
            </Field>
            <Field label="אירוע">
              <select name="event_name" defaultValue={filters.event_name ?? ""} className={smallFieldClass}>
                <option value="">כל האירועים</option>
                {(eventOptions.rows as Row[]).map((r) => (
                  <option key={String(r.event_name)} value={String(r.event_name)}>
                    {gaEventLabel(String(r.event_name))}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="דף (מכיל)">
              <input name="page_path" defaultValue={filters.page_path} placeholder="למשל /job/" dir="ltr" className={smallFieldClass} />
            </Field>
            <Field label="רמת משרות">
              <select name="jobs" defaultValue={jobLevel ?? ""} className={smallFieldClass}>
                {Object.entries(JOB_LEVELS).map(([k, label]) => (
                  <option key={k} value={k}>
                    {label}
                  </option>
                ))}
              </select>
            </Field>
            <div className="flex items-end gap-3">
              <button type="submit" className="rounded-full bg-brand px-5 py-2 text-sm font-medium text-white hover:bg-brand-hover">
                סינון
              </button>
              {activeFilters.length ? (
                <Link href={hrefWith(Object.fromEntries([...FILTERS, "jobs"].map((k) => [k, null])))} className="text-sm font-medium text-accent-dark underline underline-offset-4">
                  ניקוי
                </Link>
              ) : null}
            </div>
          </div>
          <p className="text-xs text-muted">
            Google Analytics שומר דוחות נפרדים ולא ביקורים בודדים, ולכן כל מסנן חל על הנתונים שיש בהם את השדה שלו: ערוץ, מקור ומדיום על התנועה
            והקמפיינים; אירוע, דף ורמת המשרות על הדפים והאירועים; קמפיין על הקמפיינים. סוג המשרות (בתשלום / כל המשרות) חל על טבלת המשרות.
          </p>
        </form>

        <p className="mb-6 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted">
          <span>
            {formatDay(fromDay)} – {formatDay(toDay)}
          </span>
          {traffic.ga_synced_at ? <span>Google Analytics עודכן {fmtRelative(new Date(traffic.ga_synced_at))}</span> : null}
        </p>

        <SectionTitle hint="לפי המסננים">במבט אחד</SectionTitle>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard label="כניסות לאתר" value={fmtInt(sessions)} info={EXPLAIN.gaSessions} />
          <StatCard label="משתמשים פעילים" value={fmtInt(num(t.active_users))} hint="סכום יומי" info={EXPLAIN.gaUsers} />
          <StatCard label="משתמשים חדשים" value={fmtInt(num(t.new_users))} info={EXPLAIN.gaNewUsers} />
          <StatCard label="כניסות מעורבות" value={fmtInt(num(t.engaged_sessions))} hint={`${fmtPercent(num(t.engaged_sessions), sessions)} מהכניסות`} info={EXPLAIN.gaEngaged} />
          <StatCard label="צפיות בדפים" value={fmtInt(num((pages.totals as Row).views))} info={EXPLAIN.gaPageViews} />
          <StatCard label="פתיחות דפי משרות" value={fmtInt(eventCount(JOB_EVENTS.opens))} info={EXPLAIN.gaJobOpens} />
          <StatCard label='לחיצות "הגש מועמדות"' value={fmtInt(eventCount(JOB_EVENTS.applyClicks))} info={EXPLAIN.gaApplyClicks} />
          <StatCard
            label="אישורי הגשה"
            value={fmtInt(eventCount(JOB_EVENTS.applyYes))}
            hint={`${fmtPercent(eventCount(JOB_EVENTS.applyYes), eventCount(JOB_EVENTS.opens))} מהפתיחות`}
            info={EXPLAIN.gaApplyYes}
          />
        </div>

        <Card level={3} title="לאורך זמן" className="mt-4">
          <LineChart
            unit="אירועים"
            series={[
              { label: "כניסות לאתר", color: "var(--color-series-1)", points: days.map((day) => ({ day, value: sessionsByDay.get(day) ?? 0 })) },
              { label: "פתיחות דפי משרות", color: "var(--color-series-2)", points: days.map((day) => ({ day, value: opensByDay.get(day) ?? 0 })) },
              { label: "אישורי הגשה", color: "var(--color-series-3)", points: days.map((day) => ({ day, value: yesByDay.get(day) ?? 0 })) },
            ]}
          />
        </Card>

        <SectionTitle hint="מאיפה הגיעו הכניסות">מקורות תנועה</SectionTitle>
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <Card level={3} title="לפי ערוץ">
            <BarList
              caption="כניסות לפי ערוץ"
              showShareOf={sessions}
              items={(channels.rows as Row[]).map((r) => ({ label: CHANNEL_LABELS[String(r.channel_group)] ?? String(r.channel_group), value: num(r.sessions) }))}
            />
          </Card>
          <Card level={3} title="לפי מקור ומדיום" tone="accent-light">
            <Table head={["מקור", "מדיום", "כניסות", "חדשים", "מעורבות"]} empty={sources.rows.length ? undefined : "אין נתונים"} caption="כניסות לפי מקור ומדיום">
              {(sources.rows as Row[]).map((r) => (
                <tr key={`${r.source}/${r.medium}`}>
                  <td className="px-3 py-2" dir="ltr">{String(r.source)}</td>
                  <td className="px-3 py-2" dir="ltr">{String(r.medium)}</td>
                  <td className="px-3 py-2 font-medium tabular-nums">{fmtInt(num(r.sessions))}</td>
                  <td className="px-3 py-2 tabular-nums">{fmtInt(num(r.new_users))}</td>
                  <td className="px-3 py-2 tabular-nums">{fmtPercent(num(r.engaged_sessions), num(r.sessions))}</td>
                </tr>
              ))}
            </Table>
          </Card>
        </div>

        <SectionTitle hint={jobLevel ? JOB_LEVELS[jobLevel] : "כל האתר"}>אירועים ודפים</SectionTitle>
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <Card level={3} title={`כל האירועים · ${fmtInt(events.groups_total)}`}>
            <Table head={["אירוע", "שם ב-GA", "כמות", "משתמשים"]} empty={events.rows.length ? undefined : "אין אירועים"} caption="אירועים">
              {(events.rows as Row[]).map((r) => (
                <tr key={String(r.event_name)}>
                  <td className="px-3 py-2">
                    <Link href={hrefWith({ event_name: String(r.event_name) })} scroll={false} className="underline-offset-4 hover:underline">
                      {gaEventLabel(String(r.event_name))}
                    </Link>
                  </td>
                  <td className="px-3 py-2 text-xs text-muted" dir="ltr">
                    {GA_EVENT_LABELS[String(r.event_name)] ? String(r.event_name) : ""}
                  </td>
                  <td className="px-3 py-2 font-medium tabular-nums">{fmtInt(num(r.event_count))}</td>
                  <td className="px-3 py-2 tabular-nums">{fmtInt(num(r.total_users))}</td>
                </tr>
              ))}
            </Table>
          </Card>
          <Card level={3} title="הדפים הנצפים" tone="accent-light">
            <Table head={["דף", "צפיות", "כניסות"]} empty={topPages.rows.length ? undefined : "אין נתונים"} caption="הדפים הנצפים">
              {(topPages.rows as Row[]).map((r) => {
                const key = /\/job\/([0-9a-f]{24})/i.exec(String(r.page_path))?.[1]?.toLowerCase();
                const job = key ? byKey.get(key) : undefined;
                return (
                  <tr key={String(r.page_path)}>
                    <td className="px-3 py-2">
                      <span dir="ltr" className="break-all text-sm">{String(r.page_path)}</span>
                      {job ? (
                        <Link href={`/jobs/${job.id}`} className="block text-xs text-accent-dark underline underline-offset-4">
                          {job.title ?? "משרה"}
                        </Link>
                      ) : null}
                    </td>
                    <td className="px-3 py-2 font-medium tabular-nums">{fmtInt(num(r.views))}</td>
                    <td className="px-3 py-2 tabular-nums">{fmtInt(num(r.sessions))}</td>
                  </tr>
                );
              })}
            </Table>
          </Card>
        </div>

        <SectionTitle hint="תגיות UTM: כניסות, ומה עשו באתר">קמפיינים</SectionTitle>
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <Card level={3} title={`קמפיינים · ${fmtInt(campaigns.groups_total)}`}>
            <Table head={["קמפיין", "כניסות", "חדשים", "פתיחות משרות", "לחיצות הגשה", "אישורים"]} empty={campaigns.rows.length ? undefined : "אין קמפיינים"} caption="קמפיינים">
              {(campaigns.rows as Row[]).map((r) => {
                const ev = (name: string) => num((campaignEvents.rows as Row[]).find((e) => e.campaign === r.campaign && e.event_name === name)?.event_count);
                return (
                  <tr key={String(r.campaign)}>
                    <td className="px-3 py-2">
                      <Link href={`/campaigns/${encodeURIComponent(String(r.campaign))}`} className="underline-offset-4 hover:underline" dir="auto">
                        {String(r.campaign)}
                      </Link>
                    </td>
                    <td className="px-3 py-2 font-medium tabular-nums">{fmtInt(num(r.sessions))}</td>
                    <td className="px-3 py-2 tabular-nums">{fmtInt(num(r.new_users))}</td>
                    <td className="px-3 py-2 tabular-nums">{fmtInt(ev(JOB_EVENTS.opens))}</td>
                    <td className="px-3 py-2 tabular-nums">{fmtInt(ev(JOB_EVENTS.applyClicks))}</td>
                    <td className="px-3 py-2 tabular-nums">{fmtInt(ev(JOB_EVENTS.applyYes))}</td>
                  </tr>
                );
              })}
            </Table>
          </Card>
          <Card level={3} title="דפי נחיתה של קמפיינים" tone="accent-light">
            <Table head={["קמפיין", "דף נחיתה", "כניסות"]} empty={landing.rows.length ? undefined : "אין נתונים"} caption="דפי נחיתה של קמפיינים">
              {(landing.rows as Row[]).map((r) => (
                <tr key={`${r.campaign}|${r.landing_page}`}>
                  <td className="px-3 py-2" dir="auto">{String(r.campaign)}</td>
                  <td className="px-3 py-2">{dimCell("landing_page", r.landing_page)}</td>
                  <td className="px-3 py-2 font-medium tabular-nums">{fmtInt(num(r.sessions))}</td>
                </tr>
              ))}
            </Table>
          </Card>
        </div>

        <SectionTitle hint={params.scope === "all" ? "כל המשרות" : "משרות בתשלום בלבד"}>ברמת המשרה</SectionTitle>
        <Card level={3} title={`משרות שנפתחו באתר בטווח · ${fmtInt(jobRows.length)}`}>
          <Table
            head={["משרה", "צפיות", "פתיחות", "לחיצות הגשה", "אישורים", "מפתיחה לאישור"]}
            empty={jobRows.length ? undefined : "אין משרות עם פעילות באתר בטווח"}
            caption="Google Analytics לפי משרה"
          >
            {jobRows.slice(0, MAX_JOBS).map(({ key, ga, position: p }) => (
              <tr key={key}>
                <td className="px-3 py-2">
                  <JobName position={p} jobKey={key} />
                </td>
                <td className="px-3 py-2 tabular-nums">{fmtInt(ga.pageViews)}</td>
                <td className="px-3 py-2 font-medium tabular-nums">{fmtInt(ga.opens)}</td>
                <td className="px-3 py-2 tabular-nums">{fmtInt(ga.applyClicks)}</td>
                <td className="px-3 py-2 tabular-nums">{fmtInt(ga.applyYes)}</td>
                <td className="px-3 py-2 tabular-nums">{fmtPercent(ga.applyYes, ga.opens)}</td>
              </tr>
            ))}
            {jobRows.length > 1 ? (
              <tr className="border-t-2 border-line font-bold">
                <td className="px-3 py-2">סה״כ ({fmtInt(jobRows.length)} משרות)</td>
                <td />
                <td className="px-3 py-2 tabular-nums">{fmtInt(jobTotals.opens)}</td>
                <td className="px-3 py-2 tabular-nums">{fmtInt(jobTotals.clicks)}</td>
                <td className="px-3 py-2 tabular-nums">{fmtInt(jobTotals.yes)}</td>
                <td className="px-3 py-2 tabular-nums">{fmtPercent(jobTotals.yes, jobTotals.opens)}</td>
              </tr>
            ) : null}
          </Table>
          {jobRows.length > MAX_JOBS ? <p className="mt-3 text-xs text-muted">מוצגות {MAX_JOBS} המשרות עם הכי הרבה פתיחות; הסה״כ כולל את כולן.</p> : null}
        </Card>

        <SectionTitle hint="כל דוח, בכל חיתוך, עם המסננים שלמעלה">חיתוך חופשי</SectionTitle>
        <Card level={3} title="בונה דוחות">
          <form method="get" action={`${PATH}#explorer`} id="explorer" className="mb-4 grid scroll-mt-4 grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5" aria-label="בונה דוחות">
            {KEYS.filter((k) => !(EXPLORER as readonly string[]).includes(k)).map((k) =>
              current.get(k) ? <input key={k} type="hidden" name={k} value={current.get(k)!} /> : null,
            )}
            <Field label="דוח">
              <select name="x" defaultValue={xReport || "events"} className={smallFieldClass}>
                {Object.keys(GA_REPORTS).map((r) => (
                  <option key={r} value={r}>
                    {GA_REPORT_LABELS[r] ?? r}
                  </option>
                ))}
              </select>
            </Field>
            {(["xg1", "xg2"] as const).map((k, i) => (
              <Field key={k} label={i ? "ואחר כך לפי" : "קיבוץ לפי"}>
                <select name={k} defaultValue={first(search[k]) || (i ? "" : "event_name")} className={smallFieldClass}>
                  <option value="">{i ? "—" : "בלי (סה״כ בלבד)"}</option>
                  {[...GRAINS, ...Object.keys(GA_DIM_LABELS).filter((d) => !GRAINS.includes(d))].map((d) => (
                    <option key={d} value={d}>
                      {GA_DIM_LABELS[d]}
                    </option>
                  ))}
                </select>
              </Field>
            ))}
            <Field label="שורות">
              <select name="xl" defaultValue={String(xLimit)} className={smallFieldClass}>
                {[25, 100, 500].map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </select>
            </Field>
            <div className="flex items-end">
              <button type="submit" className="rounded-full bg-brand px-5 py-2 text-sm font-medium text-white hover:bg-brand-hover">
                הפקת דוח
              </button>
            </div>
          </form>
          <p role="status" className="mb-3 min-h-5 text-sm font-medium text-danger">
            {explorerError ? `לא ניתן להפיק את הדוח: ${explorerError}` : ""}
          </p>
          {explorer ? (
            <>
              <p className="mb-3 flex flex-wrap gap-2 text-sm">
                {Object.entries(explorer.totals as Row).map(([m, v]) => (
                  <Badge key={m} tone="accent">
                    {GA_METRIC_LABELS[m] ?? m}: {fmtInt(num(v))}
                  </Badge>
                ))}
                {Object.keys(explorer.filters).length || explorer.job_scope ? <Badge>מסונן</Badge> : null}
              </p>
              {explorer.group_by.length ? (
                <Table
                  head={[...explorer.group_by.map((g) => GA_DIM_LABELS[g] ?? g), ...Object.keys(explorer.totals).map((m) => GA_METRIC_LABELS[m] ?? m)]}
                  empty={explorer.rows.length ? undefined : "אין נתונים"}
                  caption={`דוח ${GA_REPORT_LABELS[explorer.report] ?? explorer.report}`}
                >
                  {(explorer.rows as Row[]).map((r, i) => (
                    <tr key={i}>
                      {explorer!.group_by.map((g) => (
                        <td key={g} className="px-3 py-2">
                          {dimCell(g, r[g])}
                        </td>
                      ))}
                      {Object.keys(explorer!.totals).map((m) => (
                        <td key={m} className="px-3 py-2 tabular-nums">
                          {fmtInt(num(r[m]))}
                        </td>
                      ))}
                    </tr>
                  ))}
                </Table>
              ) : null}
              {explorer.truncated ? (
                <p className="mt-3 text-xs text-muted">
                  מוצגות {fmtInt(explorer.rows.length)} מתוך {fmtInt(explorer.groups_total)} שורות. אפשר להגדיל את מספר השורות או לסנן.
                </p>
              ) : null}
            </>
          ) : (
            <p className="text-sm text-muted">בחרו דוח וקיבוץ. לכל דוח יש את השדות שלו; קיבוץ לפי שדה שאין בדוח יחזיר הסבר.</p>
          )}
        </Card>
      </DashboardShell>
    </>
  );
}

function JobName({ position: p, jobKey }: { position: Position | null; jobKey: string }) {
  if (!p) return <span className="text-sm text-muted" dir="ltr">{jobKey}</span>;
  return (
    <>
      <Link href={`/jobs/${p.id}`} className="font-medium underline-offset-4 hover:underline">
        {p.title ?? "(ללא שם)"}
      </Link>{" "}
      {p.paid ? <Badge tone="brand">בתשלום</Badge> : null} {p.marked ? <MarkedBadge /> : null}
      <span className="block text-xs text-muted">{p.company ?? "—"}</span>
    </>
  );
}

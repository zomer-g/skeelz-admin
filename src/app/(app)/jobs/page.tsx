import type { Metadata } from "next";
import Link from "next/link";
import { ApplicationPipeline, SectionTitle } from "@/components/dashboard/ApplicationPipeline";
import { DashboardShell } from "@/components/dashboard/DashboardShell";
import { DashboardTabs } from "@/components/dashboard/DashboardTabs";
import { PaidSplit } from "@/components/dashboard/PaidSplit";
import { Badge, Card, StatCard, Table } from "@/components/ui";
import { pageAuth } from "@/lib/auth/guard";
import { EXPLAIN } from "@/lib/dashboard/explain";
import { formatDay, parseDashboardParams, rangeQuery, viewPath } from "@/lib/dashboard/params";
import { fmtDate, fmtInt, fmtRelative } from "@/lib/format";
import { computeCandidateMetrics, countNewJobs, loadApplicationFacts, syncFreshness } from "@/lib/metrics/candidates";
import { buildJobRows, loadJobGa, loadPositions, matchesSearch, type JobRow } from "@/lib/metrics/jobs";
import { inScope } from "@/lib/metrics/paid";

export const metadata: Metadata = { title: "משרות" };
export const dynamic = "force-dynamic";

const MAX_ROWS = 150;

/** Jobs tab: every job-side figure — the jobs themselves, and the pipeline their applications go through. */
export default async function JobsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const search = await searchParams;
  const auth = await pageAuth("viewer", viewPath("/jobs", search));
  if (!auth.ok) return auth.render;

  const params = parseDashboardParams(search, new Date(), "90d");
  const query = rangeQuery(params);
  const q = typeof search.q === "string" ? search.q.trim() : "";

  const [positions, ga, facts, newJobs, freshness] = await Promise.all([
    loadPositions(),
    loadJobGa(params.fromDay, params.toDay),
    loadApplicationFacts(),
    countNewJobs(params.from, params.to),
    syncFreshness(),
  ]);
  const pipeline = computeCandidateMetrics(facts.filter(inScope(params.scope)), params.scope === "paid" ? newJobs.paid : newJobs.all, params);

  const all = buildJobRows(positions, ga, facts, params.from, params.to);
  const inView = (r: JobRow) => inScope(params.scope)(r.position);
  const activeAll = all.filter((r) => r.ga.opens > 0 || r.ga.pageViews > 0 || r.funnel.applications > 0);
  const active = activeAll.filter(inView);
  const found = q ? all.filter((r) => matchesSearch(r.position, q)) : [];
  const matched = q ? found.filter(inView) : active;
  // A search that finds only unpaid jobs should say so rather than look empty.
  const hiddenMatches = found.length - matched.length;
  const applicationsOf = (list: JobRow[]) => list.reduce((s, r) => s + r.funnel.applications, 0);
  const rows = [...matched]
    .sort((a, b) => b.funnel.applications - a.funnel.applications || b.ga.opens - a.ga.opens || (b.position.createdAt?.getTime() ?? 0) - (a.position.createdAt?.getTime() ?? 0))
    .slice(0, MAX_ROWS);

  const totals = active.reduce(
    (t, r) => ({ opens: t.opens + r.ga.opens, clicks: t.clicks + r.ga.applyClicks, applications: t.applications + r.funnel.applications }),
    { opens: 0, clicks: 0, applications: 0 },
  );
  const detailQuery = query ? `?${query}` : "";
  const hired = facts.filter((f) => f.acceptedAt && f.acceptedAt >= params.from && f.acceptedAt < params.to);

  return (
    <>
      <DashboardTabs active="jobs" query={query} />
      <DashboardShell
        preset={params.preset}
        basis={params.basis}
        scope={params.scope}
        fromDay={params.fromDay}
        toDay={params.toDay}
        search={{ value: q, placeholder: "חיפוש משרה: שם, חברה או מספר Case" }}
      >
        <PaidSplit
          scope={params.scope}
          items={[
            { label: "משרות חדשות", paid: newJobs.paid, total: newJobs.all },
            { label: "משרות עם פעילות", paid: activeAll.filter((r) => r.position.paid).length, total: activeAll.length },
            { label: "הגשות", paid: applicationsOf(activeAll.filter((r) => r.position.paid)), total: applicationsOf(activeAll) },
            { label: "התקבלו לעבודה", paid: hired.filter((f) => f.paid).length, total: hired.length },
          ]}
        />
        <p className="mb-6 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted">
          <span>
            {formatDay(params.fromDay)} – {formatDay(params.toDay)} · פתיחות ולחיצות מ-Google Analytics, הגשות מ-Salesforce
          </span>
          {freshness.casesSyncedAt ? <span>נתונים מ-Salesforce עודכנו {fmtRelative(freshness.casesSyncedAt)}</span> : null}
        </p>

        <SectionTitle hint="נפתחו באתר או קיבלו הגשות בטווח">משרות באתר</SectionTitle>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard label="משרות עם פעילות" value={fmtInt(active.length)} hint="נפתחו באתר או קיבלו הגשות" info={EXPLAIN.jobsWithActivity} />
          <StatCard label="פתיחות משרה" value={fmtInt(totals.opens)} hint="של משרות שמזוהות ב-Salesforce" info={EXPLAIN.jobOpensKnown} />
          <StatCard label='לחיצות "הגש מועמדות"' value={fmtInt(totals.clicks)} hint="של משרות שמזוהות ב-Salesforce" info={EXPLAIN.applyClicksKnown} />
          <StatCard label="הגשות" value={fmtInt(totals.applications)} info={EXPLAIN.applicationsOfJobs} />
        </div>

        <ApplicationPipeline m={pipeline} basis={params.basis} callsAvailable={freshness.callsAvailable} />

        <SectionTitle hint="פתיחות, לחיצות ושלבי ההגשה לכל משרה">כל המשרות</SectionTitle>
        <Card level={3} title={q ? `תוצאות עבור "${q}" · ${fmtInt(matched.length)}` : `משרות עם פעילות בטווח · ${fmtInt(active.length)}`}>
          <Table
            head={["משרה", "נפתחה", "פתיחות", "לחיצות הגשה", "הגשות", "נשלחו", "ראיון", "התקבלו"]}
            empty={rows.length === 0 ? (q ? "לא נמצאו משרות" : "אין משרות עם פעילות בטווח") : undefined}
          >
            {rows.map(({ position: p, ga: g, funnel: f }) => (
              <tr key={p.id} className="hover:bg-white">
                <td className="px-3 py-2">
                  <Link href={`/jobs/${p.id}${detailQuery}`} className="font-medium text-ink underline-offset-4 hover:underline">
                    {p.title ?? "(ללא שם)"}
                  </Link>{" "}
                  {p.paid ? <Badge tone="brand">בתשלום</Badge> : null}
                  <p className="text-xs text-muted">
                    {p.company ?? "—"}
                    {p.caseNumber ? ` · ${p.caseNumber}` : ""}
                  </p>
                </td>
                <td className="whitespace-nowrap px-3 py-2 tabular-nums">{fmtDate(p.createdAt)}</td>
                <td className="px-3 py-2 tabular-nums">{p.siteJobKey ? fmtInt(g.opens) : <span className="text-muted">לא באתר</span>}</td>
                <td className="px-3 py-2 tabular-nums">{p.siteJobKey ? fmtInt(g.applyClicks) : "—"}</td>
                <td className="px-3 py-2 font-medium tabular-nums">{fmtInt(f.applications)}</td>
                <td className="px-3 py-2 tabular-nums">{fmtInt(f.sent)}</td>
                <td className="px-3 py-2 tabular-nums">{fmtInt(f.interview)}</td>
                <td className="px-3 py-2 tabular-nums">{fmtInt(f.accepted)}</td>
              </tr>
            ))}
          </Table>
          {matched.length > MAX_ROWS ? <p className="mt-3 text-xs text-muted">מוצגות {MAX_ROWS} הראשונות. אפשר לצמצם בחיפוש.</p> : null}
          {hiddenMatches > 0 ? (
            <p className="mt-3 text-sm text-muted">
              עוד {fmtInt(hiddenMatches)} משרות שלא בתשלום תואמות לחיפוש. הן מוצגות במצב &quot;כל המשרות&quot;.
            </p>
          ) : null}
        </Card>
      </DashboardShell>
    </>
  );
}

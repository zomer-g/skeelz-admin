import type { Metadata } from "next";
import Link from "next/link";
import { DashboardShell } from "@/components/dashboard/DashboardShell";
import { DashboardTabs } from "@/components/dashboard/DashboardTabs";
import { Card, StatCard, Table } from "@/components/ui";
import { pageAuth } from "@/lib/auth/guard";
import { formatDay, parseDashboardParams, rangeQuery, viewPath } from "@/lib/dashboard/params";
import { fmtDate, fmtInt } from "@/lib/format";
import { loadApplicationFacts } from "@/lib/metrics/candidates";
import { buildJobRows, loadJobGa, loadPositions, matchesSearch } from "@/lib/metrics/jobs";

export const metadata: Metadata = { title: "משרות" };
export const dynamic = "force-dynamic";

const MAX_ROWS = 150;

export default async function JobsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const search = await searchParams;
  const auth = await pageAuth("viewer", viewPath("/jobs", search));
  if (!auth.ok) return auth.render;

  const params = parseDashboardParams(search, new Date(), "90d");
  const query = rangeQuery(params);
  const q = typeof search.q === "string" ? search.q.trim() : "";

  const [positions, ga, facts] = await Promise.all([loadPositions(), loadJobGa(params.fromDay, params.toDay), loadApplicationFacts()]);
  const all = buildJobRows(positions, ga, facts, params.from, params.to);
  const active = all.filter((r) => r.ga.opens > 0 || r.ga.pageViews > 0 || r.funnel.applications > 0);
  const matched = q ? all.filter((r) => matchesSearch(r.position, q)) : active;
  const rows = [...matched]
    .sort((a, b) => b.funnel.applications - a.funnel.applications || b.ga.opens - a.ga.opens || (b.position.createdAt?.getTime() ?? 0) - (a.position.createdAt?.getTime() ?? 0))
    .slice(0, MAX_ROWS);

  const totals = active.reduce(
    (t, r) => ({ opens: t.opens + r.ga.opens, clicks: t.clicks + r.ga.applyClicks, applications: t.applications + r.funnel.applications }),
    { opens: 0, clicks: 0, applications: 0 },
  );
  const detailQuery = query ? `?${query}` : "";

  return (
    <>
      <DashboardTabs active="jobs" query={query} />
      <DashboardShell
        preset={params.preset}
        fromDay={params.fromDay}
        toDay={params.toDay}
        showBasis={false}
        search={{ value: q, placeholder: "חיפוש משרה: שם, חברה או מספר Case" }}
      >
        <p className="mb-6 text-sm text-muted">
          {formatDay(params.fromDay)} – {formatDay(params.toDay)} · פתיחות ולחיצות מ-Google Analytics, הגשות שנוצרו בטווח מ-Salesforce
        </p>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard label="משרות עם פעילות" value={fmtInt(active.length)} hint="נפתחו באתר או קיבלו הגשות" />
          <StatCard label="פתיחות משרה" value={fmtInt(totals.opens)} hint="של משרות שמזוהות ב-Salesforce" />
          <StatCard label='לחיצות "הגש מועמדות"' value={fmtInt(totals.clicks)} hint="של משרות שמזוהות ב-Salesforce" />
          <StatCard label="הגשות" value={fmtInt(totals.applications)} />
        </div>

        <Card
          title={q ? `תוצאות עבור "${q}" · ${fmtInt(matched.length)}` : `משרות עם פעילות בטווח · ${fmtInt(active.length)}`}
          className="mt-8"
        >
          <Table
            head={["משרה", "נפתחה", "פתיחות", "לחיצות הגשה", "הגשות", "נשלחו", "ראיון", "התקבלו"]}
            empty={rows.length === 0 ? (q ? "לא נמצאו משרות" : "אין משרות עם פעילות בטווח") : undefined}
          >
            {rows.map(({ position: p, ga: g, funnel: f }) => (
              <tr key={p.id} className="hover:bg-white">
                <td className="px-3 py-2">
                  <Link href={`/jobs/${p.id}${detailQuery}`} className="font-medium text-ink underline-offset-4 hover:underline">
                    {p.title ?? "(ללא שם)"}
                  </Link>
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
        </Card>
      </DashboardShell>
    </>
  );
}

import type { Metadata } from "next";
import Link from "next/link";
import { ApplicationPipeline, SectionTitle } from "@/components/dashboard/ApplicationPipeline";
import { DashboardTabs } from "@/components/dashboard/DashboardTabs";
import { Card, Exportable } from "@/components/ui";
import { pageAuth } from "@/lib/auth/guard";
import { formatDay, rangeQuery, viewPath } from "@/lib/dashboard/params";
import { fmtInt, fmtRelative } from "@/lib/format";
import { computeCandidateMetrics } from "@/lib/metrics/candidates";
import { FILTER_KEYS, jobMatches } from "@/lib/metrics/funnel";
import { loadStatusHistories, statusSummary } from "@/lib/metrics/statuses";
import { linkBuilder, loadPipeline, PipelineFilters, PipelineNav } from "../shared";

export const metadata: Metadata = { title: "הגשות · מדדי הגשות" };
export const dynamic = "force-dynamic";

const PATH = "/pipeline/metrics";
const PARAM_KEYS = ["range", "from", "to", "scope", "anchor", "basis", ...FILTER_KEYS];

type Search = Record<string, string | string[] | undefined>;

const BASES = [
  { key: "application", label: "לפי תאריך הגשה", hint: "ההגשות שנוצרו בטווח, ומה קרה איתן" },
  { key: "event", label: "לפי תאריך אירוע", hint: "כל מה שקרה בטווח, לא משנה מתי הוגשה ההגשה" },
] as const;

/**
 * Applications tab, the figures view: how many applications are in each status now, how many
 * moved into each status in the range (event date) or, of those created in the range, how many
 * passed through it (application date) — and every application figure, under the same filters.
 */
export default async function MetricsPage({ searchParams }: { searchParams: Promise<Search> }) {
  const search = await searchParams;
  const auth = await pageAuth("viewer", viewPath(PATH, search, PARAM_KEYS));
  if (!auth.ok) return auth.render;

  const [p, histories] = await Promise.all([loadPipeline(search, "90d"), loadStatusHistories()]);
  const { params, filters, filtered, positions, jobs, freshness, anchorStage, anchorIsSite, timeline, options } = p;
  const basis = params.basis;
  const { current, hrefWith } = linkBuilder(PATH, search, PARAM_KEYS);

  const facts = filtered.map((a) => a.fact);
  const newJobs = positions.filter(
    (j) => j.createdAt && j.createdAt >= params.from && j.createdAt < params.to && (params.scope === "all" || j.paid) && jobMatches(jobs.get(j.id)!, filters),
  ).length;
  const pipeline = computeCandidateMetrics(facts, newJobs, { ...params, basis });
  const statuses = statusSummary(facts, histories, { basis, from: params.from, to: params.to });

  return (
    <>
      <DashboardTabs active="pipeline" query={rangeQuery(params)} />
      <PipelineNav active="metrics" current={current} />
      <PipelineFilters
        path={PATH}
        current={current}
        hrefWith={hrefWith}
        params={params}
        filters={filters}
        options={options}
        timeline={timeline}
        anchorStage={anchorStage}
        anchorIsSite={anchorIsSite}
        hidden={["basis"]}
      >
        <div className="flex flex-wrap items-center gap-2 border-t border-line pt-4" role="group" aria-label="בסיס התאריך">
          <span className="text-sm font-medium text-muted">הטווח נספר</span>
          {BASES.map((b) => (
            <Link
              key={b.key}
              href={hrefWith({ basis: b.key === "application" ? null : b.key })}
              scroll={false}
              aria-current={basis === b.key ? "true" : undefined}
              title={b.hint}
              className={`rounded-full px-4 py-2 text-sm font-medium ${basis === b.key ? "bg-ink text-white" : "bg-white text-ink ring-1 ring-line hover:bg-surface"}`}
            >
              {b.label}
            </Link>
          ))}
        </div>
      </PipelineFilters>
      <p className="mb-6 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted">
        <span>
          {formatDay(params.fromDay)} – {formatDay(params.toDay)} · {BASES.find((b) => b.key === basis)!.hint}
        </span>
        {freshness.casesSyncedAt ? <span>Salesforce עודכן {fmtRelative(freshness.casesSyncedAt)}</span> : null}
      </p>

      <SectionTitle
        hint={basis === "event" ? "כמה הגשות עברו לכל סטטוס בטווח, וכמה מהן עדיין בו" : "מתוך ההגשות שנוצרו בטווח: כמה נמצאות בכל סטטוס עכשיו, וכמה עברו בו"}
      >
        הגשות לפי סטטוס
      </SectionTitle>
      <Card
        level={3}
        title={basis === "event" ? `סטטוסים · ${fmtInt(statuses.total)} הגשות שהסטטוס שלהן השתנה בטווח` : `סטטוסים · ${fmtInt(statuses.total)} הגשות שנוצרו בטווח`}
      >
        <Exportable name="הגשות לפי סטטוס">
          <div className="relative overflow-x-auto">
            <table className="w-full text-start text-sm">
              <caption className="sr-only">הגשות לפי סטטוס</caption>
              <thead>
                <tr className="border-b border-line text-muted">
                  <th scope="col" className="px-3 py-2 text-start font-medium">
                    סטטוס
                  </th>
                  <th scope="col" className="px-3 py-2 text-start font-medium">
                    {basis === "event" ? "עברו אליו בטווח" : "נמצאות בו כרגע"}
                  </th>
                  <th scope="col" className="px-3 py-2 text-start font-medium">
                    {basis === "event" ? "מהן עדיין בו" : "עברו בו (גם אם המשיכו)"}
                  </th>
                </tr>
              </thead>
              <tbody>
                {statuses.rows.map((s) => (
                  <tr key={s.status} className="border-b border-line/60">
                    <th scope="row" className="px-3 py-2 text-start font-medium">
                      {s.status}
                    </th>
                    <td className="px-3 py-2 font-bold tabular-nums">{fmtInt(basis === "event" ? s.entered : s.current)}</td>
                    <td className="px-3 py-2 tabular-nums">{fmtInt(basis === "event" ? s.current : s.entered)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {statuses.rows.length === 0 ? <p className="py-4 text-center text-sm text-muted">אין הגשות בטווח ובמסננים</p> : null}
          </div>
        </Exportable>
        <ul className="mt-3 flex flex-col gap-1 text-xs text-muted">
          {basis === "event" ? (
            <li>הגשה נספרת בכל סטטוס שעברה אליו בטווח (או שנוצרה בו בטווח), לפי היסטוריית הסטטוסים. &quot;מהן עדיין בו&quot;: הסטטוס שלהן עכשיו.</li>
          ) : (
            <li>&quot;נמצאות בו כרגע&quot; מסתכם במספר ההגשות שנוצרו בטווח. &quot;עברו בו&quot;: כל סטטוס שההגשה הייתה בו אי-פעם, ולכן הגשה נספרת בכמה שורות.</li>
          )}
          <li>לתמונת מצב של כל ההגשות בוחרים בטווח &quot;הכל&quot;. היסטוריית הסטטוסים נשמרת ב-Salesforce מ-13.3.2025; להגשות מלפני כן ידוע רק הסטטוס הנוכחי.</li>
        </ul>
      </Card>


      <ApplicationPipeline m={pipeline} basis={basis} callsAvailable={freshness.callsAvailable} />
    </>
  );
}

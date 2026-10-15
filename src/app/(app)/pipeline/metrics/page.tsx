import type { Metadata } from "next";
import Link from "next/link";
import { ApplicationPipeline, SectionTitle } from "@/components/dashboard/ApplicationPipeline";
import { DashboardTabs } from "@/components/dashboard/DashboardTabs";
import { Card } from "@/components/ui";
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
  const cohort = basis === "application" ? facts.filter((f) => f.createdAt >= params.from && f.createdAt < params.to).length : null;

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

      <SectionTitle hint={basis === "event" ? "כמה הגשות נמצאות בכל סטטוס עכשיו, וכמה עברו אליו בטווח" : "כמה הגשות נמצאות בכל סטטוס עכשיו, ומה קרה עם ההגשות שנוצרו בטווח"}>
        הגשות לפי סטטוס
      </SectionTitle>
      <Card level={3} title={`סטטוסים · ${fmtInt(facts.length)} הגשות במסננים`}>
        <div className="relative overflow-x-auto">
          <table className="w-full text-start text-sm">
            <caption className="sr-only">הגשות לפי סטטוס</caption>
            <thead>
              <tr className="border-b border-line text-muted">
                <th scope="col" className="px-3 py-2 text-start font-medium">
                  סטטוס
                </th>
                <th scope="col" className="px-3 py-2 text-start font-medium">
                  כרגע
                </th>
                {basis === "event" ? (
                  <th scope="col" className="px-3 py-2 text-start font-medium">
                    עברו אליו בטווח
                  </th>
                ) : (
                  <>
                    <th scope="col" className="px-3 py-2 text-start font-medium">
                      מההגשות בטווח: נמצאות בו כרגע
                    </th>
                    <th scope="col" className="px-3 py-2 text-start font-medium">
                      מההגשות בטווח: עברו בו
                    </th>
                  </>
                )}
              </tr>
            </thead>
            <tbody>
              {statuses.map((s) => (
                <tr key={s.status} className="border-b border-line/60">
                  <th scope="row" className="px-3 py-2 text-start font-medium">
                    {s.status}
                  </th>
                  <td className="px-3 py-2 tabular-nums">{fmtInt(s.now)}</td>
                  {basis === "event" ? (
                    <td className="px-3 py-2 font-bold tabular-nums">{fmtInt(s.entered)}</td>
                  ) : (
                    <>
                      <td className="px-3 py-2 tabular-nums">{fmtInt(s.nowOfCohort)}</td>
                      <td className="px-3 py-2 font-bold tabular-nums">{fmtInt(s.entered)}</td>
                    </>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <ul className="mt-3 flex flex-col gap-1 text-xs text-muted">
          <li>&quot;כרגע&quot;: כל ההגשות במסננים לפי הסטטוס שלהן עכשיו, בלי קשר לטווח.</li>
          {basis === "event" ? (
            <li>&quot;עברו אליו בטווח&quot;: הגשות שהסטטוס שלהן השתנה אליו בטווח (או שנוצרו בו בטווח), לפי היסטוריית הסטטוסים. הגשה שעברה לכמה סטטוסים נספרת בכל אחד.</li>
          ) : (
            <li>
              מתוך {fmtInt(cohort ?? 0)} ההגשות שנוצרו בטווח: כמה נמצאות בכל סטטוס עכשיו, וכמה עברו בו אי-פעם (גם אם המשיכו הלאה).
            </li>
          )}
          <li>היסטוריית הסטטוסים נשמרת ב-Salesforce מ-13.3.2025; להגשות מלפני כן ידוע רק הסטטוס הנוכחי.</li>
        </ul>
      </Card>

      <ApplicationPipeline m={pipeline} basis={basis} callsAvailable={freshness.callsAvailable} />
    </>
  );
}

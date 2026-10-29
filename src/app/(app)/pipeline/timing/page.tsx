import type { Metadata } from "next";
import { SectionTitle } from "@/components/dashboard/ApplicationPipeline";
import { DashboardTabs } from "@/components/dashboard/DashboardTabs";
import { Histogram } from "@/components/dashboard/Histogram";
import { Card, StatCard, smallFieldClass } from "@/components/ui";
import { pageAuth } from "@/lib/auth/guard";
import { EXPLAIN } from "@/lib/dashboard/explain";
import { formatDay, rangeQuery, viewPath } from "@/lib/dashboard/params";
import { fmtInt, fmtPercent, fmtRelative } from "@/lib/format";
import { STATUS_HISTORY_START } from "@/lib/metrics/candidates";
import { FILTER_KEYS } from "@/lib/metrics/funnel";
import { eventTiming, forecast, TIMING_EVENTS, WEEKS, type EventTiming, type Forecast } from "@/lib/metrics/timing";
import { linkBuilder, loadPipeline, PipelineFilters, PipelineNav } from "../shared";

export const metadata: Metadata = { title: "הגשות · לוח זמנים" };
export const dynamic = "force-dynamic";

const PATH = "/pipeline/timing";
const PARAM_KEYS = ["range", "from", "to", "scope", "anchor", "n", ...FILTER_KEYS];
const DEFAULT_N = 300;
const COLORS = { sent: "var(--color-series-1)", accepted: "var(--color-series-3)" } as const;

type Search = Record<string, string | string[] | undefined>;

const days = (d: number | null) => (d === null ? "—" : d < 1 ? "פחות מיום" : `${new Intl.NumberFormat("he-IL", { maximumFractionDigits: 1 }).format(d)} ימים`);
const about = (n: number) => (n >= 10 ? fmtInt(Math.round(n)) : new Intl.NumberFormat("he-IL", { maximumFractionDigits: 1 }).format(n));

/**
 * Applications tab, the timing view: of the applications created in the range (under the shared
 * filters), how long until the CV was sent to the employer and until the hire — a weekly histogram
 * of each with its mean, median and 90th percentile — and what N new applications (a campaign)
 * should bring, week by week. Definitions in docs/applications-tab.md, code in lib/metrics/timing.ts.
 */
export default async function TimingPage({ searchParams }: { searchParams: Promise<Search> }) {
  const search = await searchParams;
  const auth = await pageAuth("viewer", viewPath(PATH, search, PARAM_KEYS));
  if (!auth.ok) return auth.render;

  const p = await loadPipeline(search, "ytd");
  const { params, filters, filtered, freshness, anchorStage, anchorIsSite, timeline, options, now } = p;
  const { current, hrefWith } = linkBuilder(PATH, search, PARAM_KEYS);
  const rawN = Number(typeof search.n === "string" ? search.n : "");
  const n = Number.isInteger(rawN) && rawN > 0 && rawN <= 100_000 ? rawN : DEFAULT_N;

  const cohort = filtered.map((a) => a.fact).filter((f) => f.createdAt >= params.from && f.createdAt < params.to);
  const beforeHistory = cohort.filter((f) => f.createdAt < STATUS_HISTORY_START).length;
  const timings = TIMING_EVENTS.map((e) => ({ event: e, timing: eventTiming(cohort, e) }));
  const forecasts = timings.map(({ event, timing }) => forecast(cohort, timing, n, now, event));

  return (
    <>
      <DashboardTabs active="pipeline" query={rangeQuery(params)} />
      <PipelineNav active="timing" current={current} />
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
        hidden={["n"]}
      />
      <p className="mb-6 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted">
        <span>
          {formatDay(params.fromDay)} – {formatDay(params.toDay)} · {fmtInt(cohort.length)} הגשות שנוצרו בטווח, והזמן מיום ההגשה עד כל שלב
        </span>
        {freshness.casesSyncedAt ? <span>Salesforce עודכן {fmtRelative(freshness.casesSyncedAt)}</span> : null}
      </p>
      {beforeHistory ? (
        <p className="mb-6 rounded-card bg-panel px-4 py-3 text-sm" role="status">
          {fmtInt(beforeHistory)} מההגשות נוצרו לפני {formatDay(STATUS_HISTORY_START.toISOString().slice(0, 10))}, לפני ש-Salesforce התחיל לשמור היסטוריית סטטוסים, ולכן
          מועדי השלבים שלהן פחות מדויקים.
        </p>
      ) : null}

      {timings.map(({ event, timing }) => (
        <TimingSection key={event.key} timing={timing} color={COLORS[event.key]} />
      ))}

      <SectionTitle id="forecast" hint="כמה מההגשות צפויות להגיע לכל שלב, ומתי">
        מה לצפות מקמפיין
      </SectionTitle>
      <Card level={3} title={`${fmtInt(n)} הגשות חדשות`}>
        <form method="get" action={PATH} className="mb-6 flex flex-wrap items-end gap-3">
          {[...current.entries()]
            .filter(([k]) => k !== "n")
            .map(([k, v]) => (
              <input key={k} type="hidden" name={k} value={v} />
            ))}
          <label className="flex flex-col gap-1 text-sm font-medium text-muted">
            מספר ההגשות בקמפיין
            <input name="n" type="number" min={1} max={100000} defaultValue={n} className={`${smallFieldClass} w-36`} />
          </label>
          <button type="submit" className="rounded-full bg-brand px-5 py-2 text-sm font-medium text-white hover:bg-brand-hover">
            חישוב
          </button>
        </form>
        <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2">
          {forecasts.map((f) => (
            <ForecastCard key={f.key} f={f} n={n} />
          ))}
        </div>
        <ForecastTable forecasts={forecasts} />
        <p className="mt-3 text-xs text-muted">
          השיעור נמדד על ההגשות מהטווח שכבר עבר מהן מספיק זמן, והחלוקה לשבועות לפי ההיסטוגרמות שלמעלה, לפי אותם מסננים. זו הערכה לפי מה שקרה בעבר, לא התחייבות: משרות,
          עונות וקמפיינים שונים מתנהגים אחרת.
        </p>
      </Card>
    </>
  );
}

function TimingSection({ timing, color }: { timing: EventTiming; color: string }) {
  return (
    <>
      <SectionTitle hint={`כמה זמן מיום ההגשה עד ש${timing.label === "התקבלו לעבודה" ? "המועמד התקבל לעבודה" : 'קורות החיים נשלחו למעסיק'}`}>{timing.label}</SectionTitle>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_16rem]">
        <Card level={3} title={`${fmtInt(timing.reached)} הגשות הגיעו לשלב, לפי שבוע מיום ההגשה`}>
          <Histogram
            bins={timing.bins.map((b, i) => ({
              tick: i < WEEKS ? String(i + 1) : `${WEEKS}+`,
              label: b.toDay === null ? `${b.label} (יום ${b.fromDay} ואילך)` : `${b.label} (ימים ${b.fromDay}–${b.toDay - 1})`,
              value: b.count,
            }))}
            caption={`${timing.label}: הגשות לפי שבוע מיום ההגשה`}
            axis="שבועות מיום ההגשה"
            color={color}
          />
        </Card>
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-1">
          <StatCard label="זמן ממוצע" value={days(timing.meanDays)} info={EXPLAIN.timingMean} />
          <StatCard label="חציון" value={days(timing.medianDays)} info={EXPLAIN.timingMedian} />
          <StatCard label="90% עד" value={days(timing.p90Days)} info={EXPLAIN.timingP90} />
          <StatCard label="הגיעו לשלב" value={fmtPercent(timing.reached, timing.applications)} hint={`${fmtInt(timing.reached)} מתוך ${fmtInt(timing.applications)}, כולל הגשות שעוד בתהליך`} />
        </div>
      </div>
    </>
  );
}

const FORECAST_LABEL = { sent: 'קו"ח שיישלחו למעסיק', accepted: "השמות צפויות" } as const;

function ForecastCard({ f, n }: { f: Forecast; n: number }) {
  if (f.rate === null)
    return (
      <StatCard
        label={FORECAST_LABEL[f.key]}
        value="—"
        hint={`אין בטווח הגשות שעבר מהן מספיק זמן (${f.matureDays} ימים) כדי למדוד שיעור`}
        info={EXPLAIN.forecastExpected}
      />
    );
  const when =
    f.halfByWeek && f.mostByWeek ? `חצי עד שבוע ${f.halfByWeek}, 90% עד שבוע ${f.mostByWeek > WEEKS ? `${WEEKS}+` : f.mostByWeek}` : "";
  return (
    <StatCard
      label={FORECAST_LABEL[f.key]}
      value={`כ-${about(f.expected)}`}
      hint={`${fmtPercent(f.rate * 1000, 1000)} מתוך ${fmtInt(n)} (לפי ${fmtInt(f.basis)} הגשות ותיקות)${when ? ` · ${when}` : ""}`}
      info={`${EXPLAIN.forecastExpected} ${EXPLAIN.timingRate}`}
    />
  );
}

function ForecastTable({ forecasts }: { forecasts: Forecast[] }) {
  const weeks = forecasts[0]?.byWeek.length ?? 0;
  return (
    <div className="relative overflow-x-auto">
      <table className="w-full text-start text-sm">
        <caption className="sr-only">כמה צפויים להגיע לכל שלב עד סוף כל שבוע</caption>
        <thead>
          <tr className="border-b border-line text-muted">
            <th scope="col" className="px-3 py-2 text-start font-medium">
              עד סוף
            </th>
            {forecasts.map((f) => (
              <th key={f.key} scope="col" className="px-3 py-2 text-start font-medium">
                {FORECAST_LABEL[f.key]} (מצטבר)
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {Array.from({ length: weeks }, (_, w) => (
            <tr key={w} className="border-b border-line/60">
              <th scope="row" className="px-3 py-2 text-start font-normal">
                {w < WEEKS ? `שבוע ${w + 1}` : `אחרי ${WEEKS} שבועות`}
              </th>
              {forecasts.map((f) => (
                <td key={f.key} className="px-3 py-2 tabular-nums">
                  {f.rate === null ? "—" : about(f.byWeek[w]!)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

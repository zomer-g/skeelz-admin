import type { Metadata } from "next";
import Link from "next/link";
import { AnchoredFunnel } from "@/components/dashboard/AnchoredFunnel";
import { SectionTitle } from "@/components/dashboard/ApplicationPipeline";
import { CompareFunnels } from "@/components/dashboard/CompareFunnels";
import { DashboardTabs } from "@/components/dashboard/DashboardTabs";
import { PaidSplit } from "@/components/dashboard/PaidSplit";
import { Badge, Card, Exportable, smallFieldClass, StatCard, Table } from "@/components/ui";
import { pageAuth } from "@/lib/auth/guard";
import { EXPLAIN } from "@/lib/dashboard/explain";
import { addDays, formatDay, israelMidnight, rangeQuery, viewPath } from "@/lib/dashboard/params";
import { fmtDecimal, fmtInt, fmtPercent, fmtRelative } from "@/lib/format";
import { ANCHORS, computeFunnel, DEFAULT_ANCHOR, DIMENSIONS, FILTER_KEYS, hasJobFilters, MIN_STEP_BASE, reachedAt, SF_STAGES, STAGES, STALE_DAYS } from "@/lib/metrics/funnel";
import { Field, linkBuilder, loadPipeline, PipelineFilters, PipelineNav, TIMELINE_FROM } from "./shared";

export const metadata: Metadata = { title: "הגשות · המשפך" };
export const dynamic = "force-dynamic";

const MAX_GROUPS = 30;
const PATH = "/pipeline";
const PARAM_KEYS = ["range", "from", "to", "scope", "anchor", "by", "cmp", "cfrom", "cto", ...FILTER_KEYS];
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const daysBetween = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / 86_400_000);

type Search = Record<string, string | string[] | undefined>;

/**
 * Applications tab, the funnel view: the anchored funnel from site exposure to a hire, how much of
 * the range is still open, a comparison with another period, and where the funnel leaks.
 * The cases in progress and the figures by status are the other two views (./shared.tsx).
 */
export default async function PipelinePage({ searchParams }: { searchParams: Promise<Search> }) {
  const search = await searchParams;
  const auth = await pageAuth("viewer", viewPath(PATH, search, PARAM_KEYS));
  if (!auth.ok) return auth.render;

  const p = await loadPipeline(search, "90d");
  const { params, filters, dimension, now, apps, jobs, ga, freshness, hasGa, anchor, anchorStage, anchorIsSite, funnel, timeline, breakdown, options } = p;

  // Comparison: period B defaults to the same length right before the selected range.
  const comparing = search.cmp === "1";
  const span = daysBetween(params.fromDay, params.toDay);
  let cmpTo = typeof search.cto === "string" && DAY_RE.test(search.cto) ? search.cto : addDays(params.fromDay, -1);
  let cmpFrom = typeof search.cfrom === "string" && DAY_RE.test(search.cfrom) ? search.cfrom : addDays(cmpTo, -span);
  if (cmpFrom > cmpTo) [cmpFrom, cmpTo] = [cmpTo, cmpFrom];
  const compareFunnel = comparing
    ? computeFunnel({
        apps,
        jobs,
        ga,
        scope: params.scope,
        filters,
        anchor,
        dimension,
        from: israelMidnight(cmpFrom),
        to: israelMidnight(addDays(cmpTo, 1)),
        fromDay: cmpFrom,
        toDay: cmpTo,
        timelineFromDay: TIMELINE_FROM,
        now,
      }).funnel
    : null;

  const { current, hrefWith } = linkBuilder(PATH, search, PARAM_KEYS);
  const anchorHrefs = Object.fromEntries(
    ANCHORS.filter((s) => hasGa || s.source === "sf").map((s) => [s.key, hrefWith({ anchor: s.key === DEFAULT_ANCHOR ? null : s.key })]),
  );
  const createdInRange = apps.filter((a) => a.fact.createdAt >= params.from && a.fact.createdAt < params.to);
  const hiredInRange = apps.filter((a) => {
    const at = reachedAt(a, SF_STAGES.length - 1);
    return at && at >= params.from && at < params.to;
  });
  const sfAnchorLabel = anchorIsSite ? STAGES.find((s) => s.key === "applied")!.label : anchorStage.label;
  const open = funnel.active + funnel.stuck;
  const m = funnel.maturity;
  const youngShare = funnel.cohortSize ? m.young / funnel.cohortSize : 0;
  const projected = funnel.hired + funnel.expected;
  const dim = DIMENSIONS.find((d) => d.key === dimension)!;
  const sfStart = anchorIsSite ? 0 : SF_STAGES.indexOf(anchor as (typeof SF_STAGES)[number]);
  const laterStages = SF_STAGES.slice(sfStart + 1).map((k) => STAGES.find((s) => s.key === k)!.short);

  return (
    <>
      <DashboardTabs active="pipeline" query={rangeQuery(params)} />
      <PipelineNav active="funnel" current={current} />
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
        hidden={["by", "cmp", "cfrom", "cto"]}
      />

      <PaidSplit
        scope={params.scope}
        items={[
          { label: "הגשות שנוצרו בטווח", paid: createdInRange.filter((a) => a.fact.paid).length, total: createdInRange.length },
          { label: "התקבלו לעבודה בטווח", paid: hiredInRange.filter((a) => a.fact.paid).length, total: hiredInRange.length },
        ]}
      />
      <p className="mb-6 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted">
        <span>
          {formatDay(params.fromDay)} – {formatDay(params.toDay)}
        </span>
        {freshness.casesSyncedAt ? <span>Salesforce עודכן {fmtRelative(freshness.casesSyncedAt)}</span> : null}
        {ga.syncedAt ? <span>Google Analytics עודכן {fmtRelative(ga.syncedAt)}</span> : null}
      </p>

      <SectionTitle hint={`העוגן: ${anchorStage.label} · אפשר להזיז אותו בכל שורה במשפך`}>מהחשיפה ועד ההשמה</SectionTitle>
      <p className="mb-4">
        <Link
          href={comparing ? hrefWith({ cmp: null, cfrom: null, cto: null }) : `${hrefWith({ cmp: "1" })}#compare`}
          scroll={false}
          aria-pressed={comparing}
          className={`inline-flex items-center gap-2 rounded-full px-5 py-2 text-sm font-medium ${comparing ? "bg-ink text-white" : "bg-white text-ink ring-1 ring-line hover:bg-surface"}`}
        >
          <span aria-hidden>⇄</span>
          {comparing ? "סגירת ההשוואה" : "השוואה לתקופה אחרת"}
        </Link>
      </p>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label={`העוגן: ${anchorStage.label}`}
          value={fmtInt(funnel.anchorCount)}
          hint={anchorIsSite ? `${fmtInt(funnel.cohortSize)} הגשות ב-Salesforce באותו טווח` : "הגיעו לשלב הזה בטווח"}
          info={EXPLAIN.funnelAnchor}
        />
        <StatCard
          label="התקבלו לעבודה"
          value={fmtInt(funnel.hired)}
          hint={`${fmtPercent(funnel.hired, funnel.anchorCount)} מהעוגן`}
          info={EXPLAIN.funnelHired}
        />
        <StatCard
          label="עדיין פתוחים"
          value={fmtInt(open)}
          hint={`${fmtInt(funnel.active)} בתהליך · ${fmtInt(funnel.stuck)} תקועים · ${fmtInt(funnel.closed)} נסגרו`}
          info={EXPLAIN.funnelOpen}
        />
        <StatCard
          label="פוטנציאל מהפתוחים"
          value={funnel.expected >= 0.05 ? `≈ ${fmtDecimal(funnel.expected)}` : "0"}
          hint={`השמות נוספות צפויות · סה״כ צפוי ${fmtDecimal(projected)} (${funnel.anchorCount ? `${fmtDecimal((projected / funnel.anchorCount) * 100)}%` : "—"} מהעוגן)`}
          info={EXPLAIN.funnelPotential}
        />
      </div>

      <MaturityNote
        anchorLabel={sfAnchorLabel}
        median={m.median}
        p80={m.p80}
        sample={m.sample}
        young={m.young}
        cohort={funnel.cohortSize}
        youngShare={youngShare}
        active={funnel.active}
        stuck={funnel.stuck}
      />

      <div className="mt-4 grid grid-cols-1 gap-4 xl:grid-cols-3">
        <Card level={3} title="המשפך" className="xl:col-span-2">
          <AnchoredFunnel download="משפך ההגשות" funnel={funnel} anchorHrefs={anchorHrefs} />
          <ul className="mt-4 flex flex-col gap-1 text-xs text-muted">
            <li>
              מתחת לעוגן: אותם מקרים בדיוק, עד היום, גם אם התקדמו אחרי הטווח. מעליו: מה שקרה באותו טווח, לא בהכרח לאותם אנשים.
              {anchorIsSite ? " Google Analytics לא מזהה אנשים, ולכן ההגשות שמתחת לעוגן הן ההגשות שנוצרו בטווח, והאחוזים הם יחס בין סכומים." : ""}
            </li>
            <li>שלב נחשב כעבר גם כשדילגו עליו (מי שהתקבל עבר גם את שליחת הקו״ח), ולכן המשפך לא מתרחב אף פעם.</li>
            {funnel.gaPartial ? <li>המסננים מטפל, הגשה מהירה וקו״ח חלים על ההגשות בלבד. נתוני האתר מסוננים רק לפי המשרה.</li> : null}
            {!hasJobFilters(filters) && params.scope === "all" ? <li>נתוני האתר כוללים גם פתיחות מדף הרשימה, בלי מזהה משרה.</li> : null}
            <li>כניסות לאתר הן של כל האתר, בלי קשר למסננים.</li>
          </ul>
        </Card>
        <div className="flex flex-col gap-4">
          <Card level={3} title="איפה הכי הרבה נושרים" tone="accent-light">
            {funnel.leak ? (
              <>
                <p className="text-sm">
                  בשלב <span className="font-bold">{funnel.leak.from}</span> נסגרו <span className="font-bold tabular-nums">{fmtInt(funnel.leak.closed)}</span> מקרים בלי להגיע ל
                  {funnel.leak.to}.
                </p>
                {funnel.leak.topReason ? <p className="mt-2 text-sm text-muted">הסטטוס הנפוץ בסגירה: {funnel.leak.topReason}</p> : null}
              </>
            ) : (
              <p className="text-sm text-muted">אין מקרים שנסגרו בטווח הזה.</p>
            )}
            <p className="mt-3 text-xs text-muted">הפילוח למטה מראה לכל חברה, משרה או מטפל את המעבר החלש ביותר שלו.</p>
          </Card>
          <Card level={3} title="שיעורי השמה היסטוריים">
            <Exportable name="שיעורי השמה היסטוריים">
              <table className="w-full text-start text-sm">
                <caption className="sr-only">שיעור ההשמה לפי השלב שהמקרה הגיע אליו</caption>
                <thead>
                  <tr className="border-b border-line text-muted">
                    <th scope="col" className="py-1 text-start font-medium">הגיעו ל…</th>
                    <th scope="col" className="py-1 text-start font-medium">התקבלו</th>
                    <th scope="col" className="py-1 text-start font-medium">מתוך</th>
                  </tr>
                </thead>
                <tbody>
                  {funnel.rates.slice(0, -1).map((r) => (
                    <tr key={r.stage} className="border-b border-line/60">
                      <th scope="row" className="py-1 text-start font-normal">
                        {STAGES.find((s) => s.key === r.stage)!.label}
                      </th>
                      <td className="py-1 tabular-nums">{r.rate == null ? "—" : `${fmtDecimal(r.rate * 100)}%`}</td>
                      <td className="py-1 tabular-nums">{fmtInt(r.base)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Exportable>
            <p className="mt-2 text-xs text-muted">
              מהגשות בנות 120 יום ומעלה ({params.scope === "paid" ? "בתשלום" : "כל המשרות"}, בלי שאר המסננים). מהם מחושב הפוטנציאל של המקרים שבתהליך.
            </p>
          </Card>
        </div>
      </div>

      {compareFunnel ? (
        <section id="compare" aria-label="השוואה בין תקופות" className="scroll-mt-4">
          <SectionTitle hint="אותו עוגן ואותם מסננים, בשתי תקופות זו לצד זו">השוואה בין תקופות</SectionTitle>
          <form method="get" action={`${PATH}#compare`} className="mb-4 flex flex-wrap items-end gap-3 rounded-card bg-surface p-4 ring-1 ring-line" aria-label="תקופה ב׳ להשוואה">
            {PARAM_KEYS.filter((k) => k !== "cfrom" && k !== "cto").map((k) =>
              current.get(k) ? <input key={k} type="hidden" name={k} value={current.get(k)!} /> : null,
            )}
            <p className="w-full text-sm">
              תקופה א׳ (הטווח שנבחר למעלה):{" "}
              <span className="font-medium">
                {formatDay(params.fromDay)} – {formatDay(params.toDay)}
              </span>
            </p>
            <Field label="תקופה ב׳ · מתאריך">
              <input type="date" name="cfrom" defaultValue={cmpFrom} required className={smallFieldClass} />
            </Field>
            <Field label="עד תאריך">
              <input type="date" name="cto" defaultValue={cmpTo} required className={smallFieldClass} />
            </Field>
            <button type="submit" className="rounded-full bg-brand px-5 py-2 text-sm font-medium text-white hover:bg-brand-hover">
              השוואה
            </button>
            <Link
              href={`${hrefWith({ cfrom: addDays(params.fromDay, -365), cto: addDays(params.toDay, -365) })}#compare`}
              scroll={false}
              className="text-sm font-medium text-accent-dark underline underline-offset-4"
            >
              אותה תקופה אשתקד
            </Link>
            <Link href={`${hrefWith({ cfrom: null, cto: null })}#compare`} scroll={false} className="text-sm font-medium text-accent-dark underline underline-offset-4">
              התקופה הקודמת
            </Link>
          </form>
          <CompareFunnels
            a={{ fromDay: params.fromDay, toDay: params.toDay, funnel }}
            b={{ fromDay: cmpFrom, toDay: cmpTo, funnel: compareFunnel }}
            anchorHrefs={anchorHrefs}
          />
        </section>
      ) : null}

      <SectionTitle hint={`אותם מקרים מהעוגן, לפי ${dim.label}`}>איפה המשפך דולף</SectionTitle>
      <nav className="mb-4 flex flex-wrap gap-2" aria-label="פילוח לפי">
        {DIMENSIONS.map((d) => (
          <Link
            key={d.key}
            href={hrefWith({ by: d.key === "company" ? null : d.key })}
            scroll={false}
            aria-current={d.key === dimension ? "true" : undefined}
            className={`rounded-full px-4 py-2 text-sm font-medium ${d.key === dimension ? "bg-ink text-white" : "bg-white text-ink ring-1 ring-line hover:bg-surface"}`}
          >
            {d.label}
          </Link>
        ))}
      </nav>
      <Card level={3} title={`${dim.label} · ${fmtInt(breakdown.length)} קבוצות`}>
        <Table download={{ name: "הגשות לפי קבוצה" }}
          caption={`המשפך לפי ${dim.label}`}
          head={[
            dim.label,
            ...(breakdown[0]?.opens != null ? ["פתיחות"] : []),
            anchorIsSite ? "הגשות" : "בעוגן",
            ...laterStages,
            "שיעור השמה",
            "בתהליך",
            "צפי",
            "המעבר החלש",
          ]}
          empty={breakdown.length === 0 ? "אין מקרים בעוגן בטווח הזה" : undefined}
        >
          {breakdown.slice(0, MAX_GROUPS).map((g) => (
            <tr key={g.label} className="hover:bg-white">
              <td className="px-3 py-2 font-medium">{dimension === "month" ? formatDay(`${g.label}-01`).slice(3) : g.label}</td>
              {g.opens != null ? <td className="px-3 py-2 tabular-nums">{fmtInt(g.opens)}</td> : null}
              <td className="px-3 py-2 font-medium tabular-nums">{fmtInt(g.size)}</td>
              {g.reached.slice(1).map((v, i) => (
                <td key={i} className="px-3 py-2 tabular-nums">
                  {fmtInt(v)}
                </td>
              ))}
              <td className="px-3 py-2 tabular-nums">{fmtPercent(g.hired, g.size)}</td>
              <td className="px-3 py-2 tabular-nums">{fmtInt(g.active)}</td>
              <td className="px-3 py-2 tabular-nums">{g.expected >= 0.05 ? fmtDecimal(g.expected) : "—"}</td>
              <td className="px-3 py-2">
                {g.weakest ? (
                  <Badge tone={g.weakest.rate < 0.2 ? "brand" : "warning"}>
                    {g.weakest.from} ← {g.weakest.to} · {Math.round(g.weakest.rate * 100)}%
                  </Badge>
                ) : (
                  <span className="text-muted">—</span>
                )}
              </td>
            </tr>
          ))}
        </Table>
        <p className="mt-3 text-xs text-muted">
          המספרים בכל עמודת שלב: כמה מהקבוצה הגיעו אליו. &quot;המעבר החלש&quot;: המעבר עם השיעור הנמוך ביותר בין שני שלבים, רק כשבשלב שלפניו לפחות {MIN_STEP_BASE}{" "}
          מקרים.
          {breakdown.length > MAX_GROUPS ? ` מוצגות ${MAX_GROUPS} הקבוצות הגדולות.` : ""}
          {breakdown[0]?.opens != null ? " פתיחות: של המשרות בקבוצה, בטווח." : ""}
        </p>
      </Card>

      <p className="mt-8 text-sm text-muted">
        המקרים שבתהליך נמצאים ב
        <Link href={`/pipeline/active?${new URLSearchParams([...current].filter(([k]) => !["by", "cmp", "cfrom", "cto"].includes(k))).toString()}`} className="font-medium text-accent-dark underline underline-offset-4">
          פעילות כרגע
        </Link>
        , ודיוורים עד ההגשה בלשונית{" "}
        <Link href={`/campaigns?${rangeQuery(params)}#funnel`} className="font-medium text-accent-dark underline underline-offset-4">
          דיוורים
        </Link>
        .
      </p>
    </>
  );
}

function MaturityNote({
  anchorLabel,
  median,
  p80,
  sample,
  young,
  cohort,
  youngShare,
  active,
  stuck,
}: {
  anchorLabel: string;
  median: number | null;
  p80: number | null;
  sample: number;
  young: number;
  cohort: number;
  youngShare: number;
  active: number;
  stuck: number;
}) {
  if (!cohort) return null;
  const fresh = youngShare >= 0.25;
  return (
    <div
      className={`mt-4 flex flex-col gap-2 rounded-card px-5 py-4 text-sm ring-1 ${fresh ? "bg-hot/20 ring-hot" : "bg-white ring-line"}`}
      role="note"
      aria-label="עד כמה הטווח בשל"
    >
      <p className="font-bold">
        {fresh ? <span aria-hidden>⏳ </span> : null}
        {fresh ? "הטווח עוד צעיר: חלק גדול מהמקרים עוד באמצע הדרך" : "רוב המקרים בטווח כבר הספיקו להבשיל"}
      </p>
      {p80 != null ? (
        <p>
          80% מההשמות קרו תוך <span className="font-bold tabular-nums">{fmtInt(Math.ceil(p80))}</span> ימים מהשלב &quot;{anchorLabel}&quot; (חציון{" "}
          {fmtInt(Math.round(median ?? 0))} ימים, לפי {fmtInt(sample)} השמות).{" "}
          {young ? (
            <>
              <span className="font-bold tabular-nums">{fmtInt(young)}</span> מתוך {fmtInt(cohort)} המקרים בעוגן ({fmtPercent(young, cohort)}) הגיעו אליו בתוך פרק הזמן
              הזה, ולכן שיעור ההשמה של הטווח צפוי עוד לעלות.
            </>
          ) : (
            "כל המקרים בעוגן כבר עברו את פרק הזמן הזה, ולכן המספרים כמעט סופיים."
          )}
        </p>
      ) : (
        <p>אין עדיין מספיק השמות כדי לדעת כמה זמן לוקחת השמה.</p>
      )}
      {active || stuck ? (
        <p className="text-muted">
          {fmtInt(active)} מקרים פתוחים עדיין זזים, ו-{fmtInt(stuck)} פתוחים בלי תזוזה מעל {STALE_DAYS} יום.
          {stuck ? " מקרים תקועים כדאי לקדם או לסגור ב-Salesforce, כדי שהמשפך ישקף את המציאות." : ""}
        </p>
      ) : (
        <p className="text-muted">כל המקרים בעוגן כבר הסתיימו: התקבלו או נסגרו.</p>
      )}
    </div>
  );
}

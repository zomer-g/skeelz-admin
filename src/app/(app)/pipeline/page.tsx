import type { Metadata } from "next";
import Link from "next/link";
import { AnchoredFunnel, OUTCOME_COLORS } from "@/components/dashboard/AnchoredFunnel";
import { ApplicationPipeline, SectionTitle } from "@/components/dashboard/ApplicationPipeline";
import { DashboardTabs } from "@/components/dashboard/DashboardTabs";
import { PaidSplit } from "@/components/dashboard/PaidSplit";
import { RangeTimeline } from "@/components/dashboard/RangeTimeline";
import { Badge, Card, smallFieldClass, StatCard, Table } from "@/components/ui";
import { pageAuth } from "@/lib/auth/guard";
import { EXPLAIN } from "@/lib/dashboard/explain";
import { formatDay, israelDay, parseDashboardParams, rangeQuery, viewPath } from "@/lib/dashboard/params";
import { fmtDecimal, fmtInt, fmtPercent, fmtRelative } from "@/lib/format";
import { computeCandidateMetrics, loadApplicationFacts, syncFreshness } from "@/lib/metrics/candidates";
import {
  ANCHORS,
  buildFunnelApps,
  buildJobContexts,
  computeFunnel,
  DEFAULT_ANCHOR,
  DIMENSIONS,
  FILTER_KEYS,
  hasJobFilters,
  jobMatches,
  loadFunnelAttrs,
  loadFunnelGa,
  MIN_STEP_BASE,
  parseAnchor,
  parseDimension,
  parseFunnelFilters,
  reachedAt,
  SF_STAGES,
  STAGES,
  STALE_DAYS,
  type FunnelFilters,
} from "@/lib/metrics/funnel";
import { loadPositions } from "@/lib/metrics/jobs";

export const metadata: Metadata = { title: "הגשות" };
export const dynamic = "force-dynamic";

/** Applications in Salesforce start in early 2025; the timeline starts with that year so whole months can be picked. */
const TIMELINE_FROM = "2025-01-01";
const MAX_GROUPS = 30;
const MAX_OPEN = 50;
const PATH = "/pipeline";
const PARAM_KEYS = ["range", "from", "to", "scope", "anchor", "by", "basis", ...FILTER_KEYS];

type Search = Record<string, string | string[] | undefined>;

const FILTER_LABELS: Record<keyof FunnelFilters, string> = {
  company: "חברה",
  job: "משרה",
  owner: "מטפל",
  loc: "מיקום",
  ptime: "היקף",
  fast: "הגשה מהירה",
  cv: 'קו"ח במאגר',
};
const VALUE_LABELS: Record<string, string> = { full: "מלאה", part: "חלקית", yes: "כן", no: "לא" };

/**
 * Applications tab: the anchored funnel from site exposure to a hire, where it
 * leaks, how much of the range is still open — and every application figure
 * from the pipeline. Definitions in docs/applications-tab.md.
 */
export default async function PipelinePage({ searchParams }: { searchParams: Promise<Search> }) {
  const search = await searchParams;
  const auth = await pageAuth("viewer", viewPath(PATH, search, PARAM_KEYS));
  if (!auth.ok) return auth.render;

  const params = parseDashboardParams(search, new Date(), "90d");
  const filters = parseFunnelFilters(search);
  const dimension = parseDimension(typeof search.by === "string" ? search.by : undefined);
  const now = new Date();

  const [facts, attrs, positions, ga, freshness] = await Promise.all([
    loadApplicationFacts(),
    loadFunnelAttrs(),
    loadPositions(),
    loadFunnelGa(),
    syncFreshness(),
  ]);
  const hasGa = Boolean(ga.syncedAt) || ga.events.length > 0;
  let anchor = parseAnchor(typeof search.anchor === "string" ? search.anchor : undefined);
  if (!hasGa && STAGES.find((s) => s.key === anchor)?.source === "ga") anchor = DEFAULT_ANCHOR;
  const anchorStage = STAGES.find((s) => s.key === anchor)!;
  const anchorIsSite = anchorStage.source === "ga";

  const jobs = buildJobContexts(positions, attrs.jobs);
  const apps = buildFunnelApps(facts, attrs.apps, jobs, now);
  const { funnel, timeline, breakdown, filtered, options } = computeFunnel({
    apps,
    jobs,
    ga,
    scope: params.scope,
    filters,
    anchor,
    dimension,
    from: params.from,
    to: params.to,
    fromDay: params.fromDay,
    toDay: params.toDay,
    timelineFromDay: TIMELINE_FROM,
    now,
  });

  // Every link on the page keeps the current slice and changes one thing.
  const current = new URLSearchParams(
    Object.entries(search).flatMap(([k, v]) => (typeof v === "string" && v && PARAM_KEYS.includes(k) ? [[k, v]] : [])),
  );
  const hrefWith = (over: Record<string, string | null>) => {
    const q = new URLSearchParams(current);
    for (const [k, v] of Object.entries(over)) {
      if (v) q.set(k, v);
      else q.delete(k);
    }
    const s = q.toString();
    return s ? `${PATH}?${s}` : PATH;
  };
  const withoutRange = new URLSearchParams(current);
  for (const k of ["range", "from", "to"]) withoutRange.delete(k);

  const anchorHrefs = Object.fromEntries(
    ANCHORS.filter((s) => hasGa || s.source === "sf").map((s) => [s.key, hrefWith({ anchor: s.key === DEFAULT_ANCHOR ? null : s.key })]),
  );
  const basis = params.basis;
  const newJobs = positions.filter(
    (p) => p.createdAt && p.createdAt >= params.from && p.createdAt < params.to && (params.scope === "all" || p.paid) && jobMatches(jobs.get(p.id)!, filters),
  ).length;
  const pipeline = computeCandidateMetrics(
    filtered.map((a) => a.fact),
    newJobs,
    { ...params, basis },
  );

  const createdInRange = apps.filter((a) => a.fact.createdAt >= params.from && a.fact.createdAt < params.to);
  const hiredInRange = apps.filter((a) => {
    const at = reachedAt(a, SF_STAGES.length - 1);
    return at && at >= params.from && at < params.to;
  });
  const activeFilters = FILTER_KEYS.filter((k) => filters[k]);
  const sfAnchorLabel = anchorIsSite ? STAGES.find((s) => s.key === "applied")!.label : anchorStage.label;
  const open = funnel.active + funnel.stuck;
  const m = funnel.maturity;
  const youngShare = funnel.cohortSize ? m.young / funnel.cohortSize : 0;
  const projected = funnel.hired + funnel.expected;
  const dim = DIMENSIONS.find((d) => d.key === dimension)!;
  const sfStart = anchorIsSite ? 0 : SF_STAGES.indexOf(anchor as (typeof SF_STAGES)[number]);
  const laterStages = SF_STAGES.slice(sfStart + 1).map((k) => STAGES.find((s) => s.key === k)!.short);
  const openCases = filtered
    .filter((a) => {
      const at = reachedAt(a, sfStart);
      return a.outcome === "active" && at !== null && at >= params.from && at < params.to;
    })
    .sort((a, b) => b.level - a.level || b.fact.createdAt.getTime() - a.fact.createdAt.getTime());

  return (
    <>
      <DashboardTabs active="pipeline" query={rangeQuery(params)} />

      <div className="mb-6 flex flex-col gap-5 rounded-card border-2 border-line bg-surface p-4">
        <RangeTimeline
          days={timeline}
          segments={
            anchorIsSite
              ? [{ label: anchorStage.short, color: "var(--color-accent)" }]
              : [
                  { label: "התקבלו", color: OUTCOME_COLORS.hired },
                  { label: "בתהליך", color: OUTCOME_COLORS.active },
                  { label: "תקועים", color: OUTCOME_COLORS.stuck },
                  { label: "נסגרו", color: OUTCOME_COLORS.closed },
                ]
          }
          unit={anchorStage.short}
          preset={params.preset}
          fromDay={params.fromDay}
          toDay={params.toDay}
          query={withoutRange.toString()}
        />

        <form method="get" action={PATH} className="flex flex-col gap-3" aria-label="מסננים">
          {["range", "from", "to", "anchor", "by", "basis"].map((k) =>
            current.get(k) ? <input key={k} type="hidden" name={k} value={current.get(k)!} /> : null,
          )}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Field label="סוג המשרות">
              <select name="scope" defaultValue={params.scope === "all" ? "all" : ""} className={smallFieldClass}>
                <option value="">בתשלום בלבד</option>
                <option value="all">כל המשרות</option>
              </select>
            </Field>
            <Field label="חברה">
              <input name="company" defaultValue={filters.company} list="funnel-companies" placeholder="שם החברה או חלק ממנו" className={smallFieldClass} />
              <datalist id="funnel-companies">
                {options.companies.map((c) => (
                  <option key={c} value={c} />
                ))}
              </datalist>
            </Field>
            <Field label="משרה">
              <input name="job" defaultValue={filters.job} placeholder="שם משרה או מספר Case" className={smallFieldClass} />
            </Field>
            <Field label="מיקום המשרה">
              <input name="loc" defaultValue={filters.loc} list="funnel-locations" placeholder="עיר" className={smallFieldClass} />
              <datalist id="funnel-locations">
                {options.locations.map((l) => (
                  <option key={l} value={l} />
                ))}
              </datalist>
            </Field>
            <Field label="היקף משרה">
              <select name="ptime" defaultValue={filters.ptime} className={smallFieldClass}>
                <option value="">הכל</option>
                <option value="full">מלאה</option>
                <option value="part">חלקית</option>
              </select>
            </Field>
            <Field label="מטפל">
              <select name="owner" defaultValue={filters.owner} className={smallFieldClass}>
                <option value="">הכל</option>
                {options.owners.map((o) => (
                  <option key={o} value={o}>
                    {o}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="הגשה מהירה">
              <select name="fast" defaultValue={filters.fast} className={smallFieldClass}>
                <option value="">הכל</option>
                <option value="yes">כן</option>
                <option value="no">לא</option>
              </select>
            </Field>
            <Field label='למועמד יש קו"ח במאגר'>
              <select name="cv" defaultValue={filters.cv} className={smallFieldClass}>
                <option value="">הכל</option>
                <option value="yes">כן</option>
                <option value="no">לא</option>
              </select>
            </Field>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <button type="submit" className="rounded-full bg-brand px-5 py-2 text-sm font-medium text-white hover:bg-brand-hover">
              סינון
            </button>
            {activeFilters.length || params.scope === "all" ? (
              <Link href={hrefWith(Object.fromEntries([...FILTER_KEYS, "scope"].map((k) => [k, null])))} className="text-sm font-medium text-accent-dark underline underline-offset-4">
                ניקוי המסננים
              </Link>
            ) : null}
            {activeFilters.map((k) => (
              <Link
                key={k}
                href={hrefWith({ [k]: null })}
                className="inline-flex items-center gap-1 rounded-full bg-accent/10 px-3 py-1 text-xs font-medium text-accent-dark hover:bg-accent/20"
              >
                {FILTER_LABELS[k]}: {VALUE_LABELS[filters[k]] ?? filters[k]}
                <span aria-hidden> ✕</span>
                <span className="sr-only"> (הסרת המסנן)</span>
              </Link>
            ))}
          </div>
        </form>
      </div>

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
          <AnchoredFunnel funnel={funnel} anchorHrefs={anchorHrefs} />
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
            <p className="mt-2 text-xs text-muted">
              מהגשות בנות 120 יום ומעלה ({params.scope === "paid" ? "בתשלום" : "כל המשרות"}, בלי שאר המסננים). מהם מחושב הפוטנציאל של המקרים שבתהליך.
            </p>
          </Card>
        </div>
      </div>

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
        <Table
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

      <SectionTitle hint={`בעוגן, עדיין זזים (שינוי ב-${STALE_DAYS} הימים האחרונים) · הקרובים להשמה קודם`}>המקרים שבתהליך</SectionTitle>
      <Card level={3} title={`${fmtInt(openCases.length)} מקרים בתהליך`} tone="accent-light">
        <Table head={["מועמד", "משרה", "חברה", "הגיע עד", "סטטוס", "מטפל"]} empty={openCases.length === 0 ? "אין מקרים בתהליך בעוגן" : undefined}>
          {openCases.slice(0, MAX_OPEN).map((a) => (
            <tr key={a.fact.id}>
              <td className="px-3 py-2 font-medium">
                <Link href={`/applications/${a.fact.id}`} className="underline-offset-4 hover:underline">
                  {a.fact.candidateName ?? "(ללא שם)"}
                </Link>
              </td>
              <td className="px-3 py-2">{a.fact.jobTitle ?? "—"}</td>
              <td className="px-3 py-2">{a.fact.company ?? "—"}</td>
              <td className="px-3 py-2">
                <Badge tone={a.level >= 2 ? "success" : "accent"}>{STAGES.find((s) => s.key === SF_STAGES[a.level])!.short}</Badge>
              </td>
              <td className="px-3 py-2">{a.status ?? "—"}</td>
              <td className="px-3 py-2">{a.fact.ownerName ?? "—"}</td>
            </tr>
          ))}
        </Table>
        {openCases.length > MAX_OPEN ? <p className="mt-3 text-xs text-muted">מוצגים {MAX_OPEN} הראשונים. אפשר לצמצם במסננים.</p> : null}
      </Card>

      <SectionTitle hint="כל מדדי ההגשות, לפי אותו טווח ואותם מסננים">מדדי ההגשות</SectionTitle>
      <div className="mb-2 flex flex-wrap items-center gap-2" role="group" aria-label="בסיס התאריך">
        {[
          { key: "application", label: "לפי תאריך הגשה", hint: "ההגשות שנוצרו בטווח, ומה קרה איתן" },
          { key: "event", label: "לפי תאריך אירוע", hint: "כל מה שקרה בטווח, לא משנה מתי הוגשה ההגשה" },
        ].map((b) => (
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
      <ApplicationPipeline m={pipeline} basis={basis} callsAvailable={freshness.callsAvailable} />
    </>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1 text-sm font-medium text-muted">
      {label}
      {children}
    </label>
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

import Link from "next/link";
import type { ReactNode } from "react";
import { OUTCOME_COLORS } from "@/components/dashboard/AnchoredFunnel";
import { RangeTimeline } from "@/components/dashboard/RangeTimeline";
import { smallFieldClass } from "@/components/ui";
import { parseDashboardParams, type DashboardParams, type PresetKey } from "@/lib/dashboard/params";
import { loadApplicationFacts, syncFreshness } from "@/lib/metrics/candidates";
import {
  buildFunnelApps,
  buildJobContexts,
  computeFunnel,
  DEFAULT_ANCHOR,
  FILTER_KEYS,
  loadFunnelAttrs,
  loadFunnelGa,
  parseAnchor,
  parseDimension,
  parseFunnelFilters,
  STAGES,
  type FunnelFilters,
} from "@/lib/metrics/funnel";
import { loadPositions } from "@/lib/metrics/jobs";

/**
 * The applications tab (הגשות) is four views over the same applications and the same filter box:
 * the funnel (/pipeline), the cases in progress (/pipeline/active), the application figures by
 * status (/pipeline/metrics) and how long after an application its milestones come (/pipeline/timing). Definitions in docs/applications-tab.md.
 */

/** Applications in Salesforce start in early 2025; the timeline starts with that year so whole months can be picked. */
export const TIMELINE_FROM = "2025-01-01";

/** The parameters every view shares, carried when switching between them. */
export const SHARED_KEYS = ["range", "from", "to", "scope", "anchor", ...FILTER_KEYS];

type Search = Record<string, string | string[] | undefined>;

export const VIEWS = [
  { key: "funnel", label: "המשפך", href: "/pipeline" },
  { key: "active", label: "פעילות כרגע", href: "/pipeline/active" },
  { key: "metrics", label: "מדדי הגשות", href: "/pipeline/metrics" },
  { key: "timing", label: "לוח זמנים", href: "/pipeline/timing" },
] as const;

export type View = (typeof VIEWS)[number]["key"];

/** Loads the applications and the funnel for the page's filters and range. */
export async function loadPipeline(search: Search, fallbackPreset: PresetKey) {
  const params = parseDashboardParams(search, new Date(), fallbackPreset);
  const filters = parseFunnelFilters(search);
  const dimension = parseDimension(typeof search.by === "string" ? search.by : undefined);
  const now = new Date();

  const [facts, attrs, positions, ga, freshness] = await Promise.all([loadApplicationFacts(), loadFunnelAttrs(), loadPositions(), loadFunnelGa(), syncFreshness()]);
  const hasGa = Boolean(ga.syncedAt) || ga.events.length > 0;
  let anchor = parseAnchor(typeof search.anchor === "string" ? search.anchor : undefined);
  if (!hasGa && STAGES.find((s) => s.key === anchor)?.source === "ga") anchor = DEFAULT_ANCHOR;
  const anchorStage = STAGES.find((s) => s.key === anchor)!;

  const jobs = buildJobContexts(positions, attrs.jobs);
  const apps = buildFunnelApps(facts, attrs.apps, jobs, now);
  const result = computeFunnel({
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
  return { params, filters, dimension, now, facts, attrs, positions, ga, freshness, hasGa, anchor, anchorStage, anchorIsSite: anchorStage.source === "ga", jobs, apps, ...result };
}

/** Links that keep the page's slice and change one thing. `keys` are the parameters the page reads. */
export function linkBuilder(path: string, search: Search, keys: string[]) {
  const current = new URLSearchParams(Object.entries(search).flatMap(([k, v]) => (typeof v === "string" && v && keys.includes(k) ? [[k, v]] : [])));
  const hrefWith = (over: Record<string, string | null>) => {
    const q = new URLSearchParams(current);
    for (const [k, v] of Object.entries(over)) {
      if (v) q.set(k, v);
      else q.delete(k);
    }
    const s = q.toString();
    return s ? `${path}?${s}` : path;
  };
  return { current, hrefWith };
}

/** The three views, as a pill switch under the dashboard tabs; the shared filters go along. */
export function PipelineNav({ active, current }: { active: View; current: URLSearchParams }) {
  const shared = new URLSearchParams([...current].filter(([k]) => SHARED_KEYS.includes(k))).toString();
  return (
    <nav aria-label="תצוגות ההגשות" className="mb-4 flex w-fit max-w-full gap-1 overflow-x-auto rounded-full bg-panel p-1 text-sm [scrollbar-width:none]">
      {VIEWS.map((v) => (
        <Link
          key={v.key}
          href={shared ? `${v.href}?${shared}` : v.href}
          aria-current={v.key === active ? "page" : undefined}
          className={`shrink-0 whitespace-nowrap rounded-full px-4 py-1.5 ${v.key === active ? "bg-white font-bold text-accent-dark shadow-sm" : "text-ink hover:bg-white/70"}`}
        >
          {v.label}
        </Link>
      ))}
    </nav>
  );
}

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

/** The filter box: the range timeline and the application filters. `hidden` are the page's own parameters, kept on submit. */
export function PipelineFilters({
  path,
  current,
  hrefWith,
  params,
  filters,
  options,
  timeline,
  anchorStage,
  anchorIsSite,
  hidden,
  children,
  fields,
}: {
  path: string;
  current: URLSearchParams;
  hrefWith: (over: Record<string, string | null>) => string;
  params: DashboardParams;
  filters: FunnelFilters;
  options: { companies: string[]; locations: string[]; owners: string[] };
  timeline: Parameters<typeof RangeTimeline>[0]["days"];
  anchorStage: (typeof STAGES)[number];
  anchorIsSite: boolean;
  hidden: string[];
  /** Extra controls under the filters (e.g. the date basis). */
  children?: ReactNode;
  /** Extra form fields, after the shared ones (e.g. the status filters of the cases view). */
  fields?: ReactNode;
}) {
  const withoutRange = new URLSearchParams(current);
  for (const k of ["range", "from", "to"]) withoutRange.delete(k);
  const activeFilters = FILTER_KEYS.filter((k) => filters[k]);

  return (
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

      <form method="get" action={path} className="flex flex-col gap-3" aria-label="מסננים">
        {["range", "from", "to", "anchor", ...hidden].map((k) => (current.get(k) ? <input key={k} type="hidden" name={k} value={current.get(k)!} /> : null))}
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
          {fields}
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
      {children}
    </div>
  );
}

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="flex flex-col gap-1 text-sm font-medium text-muted">
      {label}
      {children}
    </label>
  );
}

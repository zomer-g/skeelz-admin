import type { Metadata } from "next";
import Link from "next/link";
import { SectionTitle } from "@/components/dashboard/ApplicationPipeline";
import { DashboardTabs } from "@/components/dashboard/DashboardTabs";
import { Badge, Card, smallFieldClass, Table } from "@/components/ui";
import { pageAuth } from "@/lib/auth/guard";
import { formatDay, rangeQuery, viewPath } from "@/lib/dashboard/params";
import { fmtDate, fmtInt, fmtRelative } from "@/lib/format";
import { FILTER_KEYS, reachedAt, SF_STAGES, STAGES, STALE_DAYS, type FunnelApp } from "@/lib/metrics/funnel";
import { loadStatusHistories, statusEvents, statusRank, type StatusEvent } from "@/lib/metrics/statuses";
import { Field, linkBuilder, loadPipeline, PipelineFilters, PipelineNav } from "../shared";

export const metadata: Metadata = { title: "הגשות · פעילות כרגע" };
export const dynamic = "force-dynamic";

const PATH = "/pipeline/active";
const PARAM_KEYS = ["range", "from", "to", "scope", "anchor", "state", "basis", "now", "moved", ...FILTER_KEYS];
const MAX_ROWS = 200;
const NO_STATUS = "ללא סטטוס";

type Search = Record<string, string | string[] | undefined>;
type State = "active" | "stuck" | "all" | "any";

const STATES: { key: State; label: string; title: string }[] = [
  { key: "active", label: "בתהליך", title: "מקרים בתהליך" },
  { key: "stuck", label: "תקועים", title: "מקרים תקועים" },
  { key: "all", label: "כל הפתוחים", title: "מקרים פתוחים" },
  { key: "any", label: "הכל (גם השמות וסגורים)", title: "כל ההגשות" },
];

const BASES = [
  { key: "application", label: "לפי תאריך הגשה", hint: "הגשות שהגיעו לשלב שנבחר בטווח" },
  { key: "event", label: "לפי תאריך אירוע", hint: "הגשות שהסטטוס שלהן השתנה בטווח (או שנוצרו בו), לא משנה מתי הוגשו" },
] as const;

/** When the case last moved: its last change in Salesforce, its first contact or its creation. */
function lastMove(a: FunnelApp): Date {
  return new Date(Math.max(a.fact.createdAt.getTime(), a.attrs?.lastChangeAt?.getTime() ?? 0, a.fact.firstTouchAt?.getTime() ?? 0));
}

const one = (v: string | string[] | undefined) => (typeof v === "string" ? v : "");

/**
 * Applications tab, the cases view. Application basis: the cases that reached the anchor stage in
 * the range; event basis: the ones whose status changed in the range (or that were created in it).
 * Both narrow by the status a case is in now (`now`) and by a status it moved into in the range
 * (`moved`, from the status history). "In progress" moved in the last STALE_DAYS days, "stuck" did
 * not; "any" adds hired and closed cases — the default once a status or the event basis is chosen.
 */
export default async function ActivePage({ searchParams }: { searchParams: Promise<Search> }) {
  const search = await searchParams;
  const auth = await pageAuth("viewer", viewPath(PATH, search, PARAM_KEYS));
  if (!auth.ok) return auth.render;

  const [p, histories] = await Promise.all([loadPipeline(search, "all"), loadStatusHistories()]);
  const { params, filters, filtered, freshness, anchor, anchorStage, anchorIsSite, timeline, options } = p;
  const basis = params.basis;
  const { current, hrefWith } = linkBuilder(PATH, search, PARAM_KEYS);
  const inRange = (d: Date) => d >= params.from && d < params.to;

  // Every status an application is or was in, for the two status selects.
  const known = new Set<string>();
  const withEvents = filtered.map((a) => {
    const events = statusEvents(a.fact, histories.get(a.fact.id));
    for (const e of events) known.add(e.status);
    known.add(a.status ?? NO_STATUS);
    return { a, events };
  });
  const statusOptions = [...known].sort((x, y) => statusRank(x) - statusRank(y) || x.localeCompare(y, "he"));
  const nowStatus = known.has(one(search.now)) ? one(search.now) : "";
  const moved = known.has(one(search.moved)) ? one(search.moved) : "";

  const sfStart = anchorIsSite ? 0 : SF_STAGES.indexOf(anchor as (typeof SF_STAGES)[number]);
  const base = withEvents.flatMap(({ a, events }) => {
    const inPeriod = events.filter((e) => inRange(e.at));
    if (basis === "event") {
      if (!inPeriod.length) return [];
    } else {
      const at = reachedAt(a, sfStart);
      if (at === null || !inRange(at)) return [];
    }
    if (nowStatus && (a.status ?? NO_STATUS) !== nowStatus) return [];
    if (moved && !inPeriod.some((e) => e.status === moved)) return [];
    // The change to show: the last one into the chosen status, else the last one in the range.
    const shown: StatusEvent | null = (moved ? inPeriod.filter((e) => e.status === moved) : inPeriod).at(-1) ?? null;
    return [{ a, shown, moved: lastMove(a) }];
  });

  const isOpen = (o: FunnelApp["outcome"]) => o === "active" || o === "stuck";
  const counts: Record<State, number> = {
    active: base.filter((r) => r.a.outcome === "active").length,
    stuck: base.filter((r) => r.a.outcome === "stuck").length,
    all: base.filter((r) => isOpen(r.a.outcome)).length,
    any: base.length,
  };
  const defaultState: State = nowStatus || moved || basis === "event" ? "any" : "active";
  const asked = one(search.state);
  const state: State = STATES.some((s) => s.key === asked) ? (asked as State) : defaultState;
  const showChange = basis === "event" || Boolean(moved);
  const rows = base
    .filter((r) => (state === "any" ? true : state === "all" ? isOpen(r.a.outcome) : r.a.outcome === state))
    .sort((x, y) =>
      showChange
        ? (y.shown?.at.getTime() ?? 0) - (x.shown?.at.getTime() ?? 0)
        : y.a.level - x.a.level || y.moved.getTime() - x.moved.getTime(),
    );

  const statusSelect = (name: string, label: string, value: string) => (
    <Field label={label}>
      <select name={name} defaultValue={value} className={smallFieldClass}>
        <option value="">הכל</option>
        {statusOptions.map((s) => (
          <option key={s} value={s}>
            {s}
          </option>
        ))}
      </select>
    </Field>
  );

  return (
    <>
      <DashboardTabs active="pipeline" query={rangeQuery(params)} />
      <PipelineNav active="active" current={current} />
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
        hidden={["state", "basis"]}
        fields={
          <>
            {statusSelect("now", "סטטוס כרגע", nowStatus)}
            {statusSelect("moved", "עבר לסטטוס בטווח", moved)}
          </>
        }
      >
        <div className="flex flex-wrap items-center gap-2 border-t border-line pt-4" role="group" aria-label="בסיס התאריך">
          <span className="text-sm font-medium text-muted">הטווח נספר</span>
          {BASES.map((b) => (
            <Link
              key={b.key}
              href={hrefWith({ basis: b.key === "application" ? null : b.key, state: null })}
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
          {basis === "event"
            ? `הגשות שהסטטוס שלהן השתנה בין ${formatDay(params.fromDay)} ל-${formatDay(params.toDay)}`
            : `הגשות שהגיעו לשלב "${anchorIsSite ? "הגשה" : anchorStage.label}" בין ${formatDay(params.fromDay)} ל-${formatDay(params.toDay)}`}
          {nowStatus ? ` · כרגע ב"${nowStatus}"` : ""}
          {moved ? ` · עברו בטווח ל"${moved}"` : ""}
        </span>
        {freshness.casesSyncedAt ? <span>Salesforce עודכן {fmtRelative(freshness.casesSyncedAt)}</span> : null}
      </p>

      <SectionTitle hint={`בתהליך: זזו ב-${STALE_DAYS} הימים האחרונים · תקועים: בלי תזוזה מעל ${STALE_DAYS} יום · ${showChange ? "השינוי האחרון קודם" : "הקרובים להשמה קודם"}`}>
        ההגשות
      </SectionTitle>
      <nav aria-label="איזה מקרים" className="mb-4 flex w-fit max-w-full flex-wrap gap-1 rounded-[20px] bg-panel p-1 text-sm">
        {STATES.map((s) => (
          <Link
            key={s.key}
            href={hrefWith({ state: s.key === defaultState ? null : s.key })}
            scroll={false}
            aria-current={s.key === state ? "true" : undefined}
            className={`rounded-full px-4 py-1.5 ${s.key === state ? "bg-white font-bold text-accent-dark shadow-sm" : "text-ink hover:bg-white/70"}`}
          >
            {s.label} <span className="tabular-nums text-muted">({fmtInt(counts[s.key])})</span>
          </Link>
        ))}
      </nav>
      <Card level={3} title={`${STATES.find((s) => s.key === state)!.title} · ${fmtInt(rows.length)}`} tone="accent-light">
        <Table
          head={["מועמד", "משרה", "חברה", "הגיע עד", "סטטוס כרגע", ...(showChange ? [moved ? `עבר ל"${moved}"` : "שינוי אחרון בטווח"] : []), "מטפל", "הוגשה", "תזוזה אחרונה"]}
          empty={rows.length === 0 ? "אין מקרים כאלה בטווח ובמסננים" : undefined}
        >
          {rows.slice(0, MAX_ROWS).map(({ a, shown, moved: movedAt }) => (
            <tr key={a.fact.id}>
              <td className="px-3 py-2 font-medium">
                <Link href={`/applications/${a.fact.id}`} className="underline-offset-4 hover:underline">
                  {a.fact.candidateName ?? "(ללא שם)"}
                </Link>
              </td>
              <td className="px-3 py-2">
                {a.fact.parentId ? (
                  <Link href={`/positions/${a.fact.parentId}`} className="underline-offset-4 hover:underline">
                    {a.fact.jobTitle ?? "—"}
                  </Link>
                ) : (
                  (a.fact.jobTitle ?? "—")
                )}
              </td>
              <td className="px-3 py-2">{a.fact.company ?? "—"}</td>
              <td className="px-3 py-2">
                <Badge tone={a.level >= 2 ? "success" : "accent"}>{STAGES.find((s) => s.key === SF_STAGES[a.level])!.short}</Badge>
              </td>
              <td className="px-3 py-2">{a.status ?? "—"}</td>
              {showChange ? (
                <td className="whitespace-nowrap px-3 py-2 tabular-nums">
                  {shown ? (
                    <>
                      {moved ? null : <span className="font-medium">{shown.status} · </span>}
                      {fmtDate(shown.at)}
                    </>
                  ) : (
                    "—"
                  )}
                </td>
              ) : null}
              <td className="px-3 py-2">{a.fact.ownerName ?? "—"}</td>
              <td className="whitespace-nowrap px-3 py-2 tabular-nums">{fmtDate(a.fact.createdAt)}</td>
              <td className="whitespace-nowrap px-3 py-2 tabular-nums">
                {fmtDate(movedAt)}
                {a.outcome === "stuck" ? (
                  <>
                    {" "}
                    <Badge tone="warning">תקוע</Badge>
                  </>
                ) : null}
              </td>
            </tr>
          ))}
        </Table>
        {rows.length > MAX_ROWS ? <p className="mt-3 text-xs text-muted">מוצגים {MAX_ROWS} הראשונים. אפשר לצמצם במסננים או בטווח.</p> : null}
        {showChange ? (
          <p className="mt-3 text-xs text-muted">
            השינויים לפי היסטוריית הסטטוסים ב-Salesforce, שנשמרת מ-13.3.2025; הגשה נחשבת גם כמי שעברה לסטטוס שבו נוצרה, ביום שנוצרה.
          </p>
        ) : null}
      </Card>
    </>
  );
}

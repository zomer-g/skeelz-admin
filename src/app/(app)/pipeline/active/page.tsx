import type { Metadata } from "next";
import Link from "next/link";
import { SectionTitle } from "@/components/dashboard/ApplicationPipeline";
import { DashboardTabs } from "@/components/dashboard/DashboardTabs";
import { Badge, Card, Table } from "@/components/ui";
import { pageAuth } from "@/lib/auth/guard";
import { formatDay, rangeQuery, viewPath } from "@/lib/dashboard/params";
import { fmtDate, fmtInt, fmtRelative } from "@/lib/format";
import { FILTER_KEYS, reachedAt, SF_STAGES, STAGES, STALE_DAYS, type FunnelApp } from "@/lib/metrics/funnel";
import { linkBuilder, loadPipeline, PipelineFilters, PipelineNav } from "../shared";

export const metadata: Metadata = { title: "הגשות · פעילות כרגע" };
export const dynamic = "force-dynamic";

const PATH = "/pipeline/active";
const PARAM_KEYS = ["range", "from", "to", "scope", "anchor", "state", ...FILTER_KEYS];
const MAX_ROWS = 200;

type Search = Record<string, string | string[] | undefined>;
type State = "active" | "stuck" | "all";

const STATES: { key: State; label: string; title: string }[] = [
  { key: "active", label: "בתהליך", title: "מקרים בתהליך" },
  { key: "stuck", label: "תקועים", title: "מקרים תקועים" },
  { key: "all", label: "כל הפתוחים", title: "מקרים פתוחים" },
];

/** When the case last moved: its last change in Salesforce, its first contact or its creation. */
function lastMove(a: FunnelApp): Date {
  return new Date(Math.max(a.fact.createdAt.getTime(), a.attrs?.lastChangeAt?.getTime() ?? 0, a.fact.firstTouchAt?.getTime() ?? 0));
}

/**
 * Applications tab, the cases view: every open case (not hired, not closed) that reached the
 * anchor stage in the range, with the same filters as the funnel. "In progress" moved in the
 * last STALE_DAYS days; "stuck" did not. The range defaults to everything, so the list is the
 * whole of what is open now.
 */
export default async function ActivePage({ searchParams }: { searchParams: Promise<Search> }) {
  const search = await searchParams;
  const auth = await pageAuth("viewer", viewPath(PATH, search, PARAM_KEYS));
  if (!auth.ok) return auth.render;

  const { params, filters, filtered, freshness, anchor, anchorStage, anchorIsSite, timeline, options } = await loadPipeline(search, "all");
  const state: State = search.state === "stuck" || search.state === "all" ? search.state : "active";
  const { current, hrefWith } = linkBuilder(PATH, search, PARAM_KEYS);

  const sfStart = anchorIsSite ? 0 : SF_STAGES.indexOf(anchor as (typeof SF_STAGES)[number]);
  const open = filtered.filter((a) => {
    const at = reachedAt(a, sfStart);
    return (a.outcome === "active" || a.outcome === "stuck") && at !== null && at >= params.from && at < params.to;
  });
  const counts = { active: open.filter((a) => a.outcome === "active").length, stuck: open.filter((a) => a.outcome === "stuck").length, all: open.length };
  const rows = open
    .filter((a) => state === "all" || a.outcome === state)
    .map((a) => ({ a, moved: lastMove(a) }))
    .sort((x, y) => y.a.level - x.a.level || y.moved.getTime() - x.moved.getTime());

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
        hidden={["state"]}
      />
      <p className="mb-6 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted">
        <span>
          מקרים פתוחים שהגיעו לשלב &quot;{anchorIsSite ? "הגשה" : anchorStage.label}&quot; בין {formatDay(params.fromDay)} ל-{formatDay(params.toDay)}
        </span>
        {freshness.casesSyncedAt ? <span>Salesforce עודכן {fmtRelative(freshness.casesSyncedAt)}</span> : null}
      </p>

      <SectionTitle hint={`בתהליך: זזו ב-${STALE_DAYS} הימים האחרונים · תקועים: בלי תזוזה מעל ${STALE_DAYS} יום · הקרובים להשמה קודם`}>המקרים שבתהליך</SectionTitle>
      <nav aria-label="איזה מקרים" className="mb-4 flex w-fit flex-wrap gap-1 rounded-full bg-panel p-1 text-sm">
        {STATES.map((s) => (
          <Link
            key={s.key}
            href={hrefWith({ state: s.key === "active" ? null : s.key })}
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
          head={["מועמד", "משרה", "חברה", "הגיע עד", "סטטוס", "מטפל", "הוגשה", "תזוזה אחרונה"]}
          empty={rows.length === 0 ? "אין מקרים כאלה בטווח ובמסננים" : undefined}
        >
          {rows.slice(0, MAX_ROWS).map(({ a, moved }) => (
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
              <td className="px-3 py-2">{a.fact.ownerName ?? "—"}</td>
              <td className="whitespace-nowrap px-3 py-2 tabular-nums">{fmtDate(a.fact.createdAt)}</td>
              <td className="whitespace-nowrap px-3 py-2 tabular-nums">
                {fmtDate(moved)}
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
      </Card>
    </>
  );
}

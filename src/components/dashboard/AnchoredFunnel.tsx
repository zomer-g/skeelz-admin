import Link from "next/link";
import { fmtDecimal, fmtInt } from "@/lib/format";
import type { FunnelResult, StageKey, StageRow } from "@/lib/metrics/funnel";

// Ordinal ramp for the stages; context rows (not the anchored cases) take the lightest step.
const RAMP = ["var(--color-funnel-2)", "var(--color-funnel-3)", "var(--color-funnel-4)", "var(--color-funnel-5)", "var(--color-funnel-6)", "var(--color-outcome-hired)"];

export const OUTCOME_COLORS = {
  hired: "var(--color-outcome-hired)",
  active: "var(--color-outcome-active)",
  stuck: "var(--color-outcome-stuck)",
  closed: "var(--color-outcome-closed)",
} as const;

const pct = (v: number | null) => (v == null ? "—" : `${v >= 0.1 || v === 0 ? Math.round(v * 100) : (v * 100).toFixed(1)}%`);

function Bar({ row, max, color, next }: { row: StageRow; max: number; color: string; next: number | null }) {
  const width = row.count ? `max(${(row.count / max) * 100}%, 3px)` : "0";
  const s = row.stopped;
  // A cohort row splits into: moved on, still moving here, stuck here, closed here.
  const parts =
    s && row.count
      ? [
          { v: next ?? 0, c: color },
          { v: s.active, c: OUTCOME_COLORS.active },
          { v: s.stuck, c: OUTCOME_COLORS.stuck },
          { v: s.closed, c: OUTCOME_COLORS.closed },
        ]
      : [{ v: row.count, c: color }];
  return (
    <div className="h-6 w-full" aria-hidden>
      <div className={`flex h-full overflow-hidden rounded-e-[4px] ${row.kind === "context" ? "opacity-60" : ""}`} style={{ width }}>
        {parts.map((p, i) =>
          p.v ? <div key={i} className="h-full" style={{ width: `${(p.v / Math.max(1, row.count)) * 100}%`, background: p.c }} /> : null,
        )}
      </div>
    </div>
  );
}

/**
 * The funnel, top to bottom, with the anchor on the vertical axis: every stage
 * but the last can take it (the ⚓ link on its row). Site stages and Salesforce
 * stages each get their own scale, so a few dozen hires are not flattened under
 * thousands of visits. Rows below the anchor follow the same cases and split
 * into moved on / in progress / stuck / closed; rows above it are context.
 */
export function AnchoredFunnel({ funnel, anchorHrefs }: { funnel: FunnelResult; anchorHrefs: Partial<Record<StageKey, string>> }) {
  const ga = funnel.rows.filter((r) => r.source === "ga");
  const sf = funnel.rows.filter((r) => r.source === "sf");
  const maxGa = Math.max(1, ...ga.map((r) => r.count));
  const maxSf = Math.max(1, ...sf.map((r) => r.count));

  const renderRow = (row: StageRow, i: number, list: StageRow[], max: number, rampOffset: number) => {
    const next = row.stopped ? (list[i + 1]?.count ?? 0) : null;
    const color = row.kind === "context" ? "var(--color-funnel-1)" : RAMP[Math.min(RAMP.length - 1, i + rampOffset)]!;
    const href = anchorHrefs[row.key];
    const s = row.stopped;
    return (
      <li
        key={row.key}
        className={`flex flex-col gap-1.5 rounded-[12px] px-3 py-2.5 ${row.isAnchor ? "bg-brand/5 ring-2 ring-brand" : ""}`}
        aria-current={row.isAnchor ? "step" : undefined}
      >
        <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 text-sm">
          <span className="flex flex-wrap items-center gap-2">
            <span className={`font-medium ${row.kind === "context" && !row.isAnchor ? "text-muted" : "text-ink"}`}>{row.label}</span>
            {row.isAnchor ? (
              <span className="rounded-full bg-brand px-2.5 py-0.5 text-xs font-medium text-white">
                <span aria-hidden>⚓ </span>העוגן
              </span>
            ) : href ? (
              <Link
                href={href}
                scroll={false}
                className="rounded-full px-2 py-0.5 text-xs font-medium text-accent-dark ring-1 ring-accent/40 hover:bg-accent/10"
              >
                <span aria-hidden>⚓ </span>עוגן כאן<span className="sr-only">: {row.label}</span>
              </Link>
            ) : null}
            {row.kind === "context" && !row.isAnchor ? <span className="text-xs text-muted">בטווח · לא בהכרח אותם מקרים</span> : null}
          </span>
          {/* Flex, not inline spans: adjacent number runs would otherwise merge under bidi ("53 36%" → "5336%"). */}
          <span className="flex shrink-0 flex-wrap items-baseline gap-x-2 text-muted">
            <span className="text-base font-bold text-ink tabular-nums">{fmtInt(row.count)}</span>
            {row.ofAnchor != null ? <span className="tabular-nums">{pct(row.ofAnchor)} מהעוגן</span> : null}
            {row.ofPrev != null ? <span className="tabular-nums">· {pct(row.ofPrev)} מהשלב הקודם</span> : null}
          </span>
        </div>
        <Bar row={row} max={max} color={color} next={next} />
        {s && row.count ? (
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted">
            <span>
              המשיכו <span className="font-medium text-ink tabular-nums">{fmtInt(next ?? 0)}</span>
            </span>
            <Dot color={OUTCOME_COLORS.active}>
              בתהליך כאן <span className="font-medium text-ink tabular-nums">{fmtInt(s.active)}</span>
            </Dot>
            <Dot color={OUTCOME_COLORS.stuck}>
              תקועים כאן <span className="font-medium text-ink tabular-nums">{fmtInt(s.stuck)}</span>
            </Dot>
            {s.closed ? (
              <details className="group">
                <summary className="inline-flex cursor-pointer list-none items-center gap-1 underline-offset-4 hover:underline">
                  <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: OUTCOME_COLORS.closed }} aria-hidden />
                  נסגרו כאן <span className="font-medium text-ink tabular-nums">{fmtInt(s.closed)}</span>
                  <span className="text-accent-dark">(סיבות)</span>
                </summary>
                <ul className="mt-1 flex flex-col gap-0.5 ps-4">
                  {s.reasons.map((r) => (
                    <li key={r.status}>
                      {r.status}: <span className="font-medium text-ink tabular-nums">{fmtInt(r.count)}</span>
                    </li>
                  ))}
                </ul>
              </details>
            ) : (
              <Dot color={OUTCOME_COLORS.closed}>
                נסגרו כאן <span className="font-medium text-ink tabular-nums">0</span>
              </Dot>
            )}
            {row.expected >= 0.05 ? (
              <span>
                צפי: עוד כ-<span className="font-medium text-ink tabular-nums">{fmtDecimal(row.expected)}</span> השמות מהמקרים שבתהליך כאן
              </span>
            ) : null}
          </div>
        ) : null}
      </li>
    );
  };

  return (
    <figure className="flex flex-col gap-4">
      {ga.length ? (
        <div>
          <p className="mb-2 text-sm font-bold text-muted">באתר · Google Analytics</p>
          <ol className="flex flex-col gap-1" aria-label="שלבי האתר">
            {ga.map((r, i) => renderRow(r, i, ga, maxGa, 0))}
          </ol>
          {funnel.jobsOpened ? <p className="mt-1 px-3 text-xs text-muted">נפתחו {fmtInt(funnel.jobsOpened)} משרות שונות בטווח.</p> : null}
        </div>
      ) : null}
      <div>
        <p className="mb-2 text-sm font-bold text-muted">ב-Salesforce · כל הגשה במעקב</p>
        <ol className="flex flex-col gap-1" aria-label="שלבי ההגשה">
          {sf.map((r, i) => renderRow(r, i, sf, maxSf, 0))}
        </ol>
        {funnel.jobsApplied ? <p className="mt-1 px-3 text-xs text-muted">ההגשות בעוגן הן ל-{fmtInt(funnel.jobsApplied)} משרות שונות.</p> : null}
      </div>
      <details className="text-sm">
        <summary className="cursor-pointer text-accent-dark underline-offset-4 hover:underline">הצגה כטבלה</summary>
        <div className="relative mt-2 overflow-x-auto" tabIndex={0} role="region" aria-label="המשפך כטבלה">
          <table className="w-full min-w-[36rem] text-start">
            <caption className="sr-only">משפך ההגשות מהעוגן</caption>
            <thead>
              <tr className="border-b border-line text-muted">
                {["שלב", "כמות", "מהעוגן", "מהשלב הקודם", "בתהליך כאן", "תקועים כאן", "נסגרו כאן", "צפי השמות"].map((h) => (
                  <th key={h} scope="col" className="px-1 py-1 text-start font-medium">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {funnel.rows.map((r) => (
                <tr key={r.key} className="border-b border-line/60">
                  <th scope="row" className="px-1 py-1 text-start font-normal">
                    {r.label}
                    {r.isAnchor ? " (העוגן)" : r.kind === "context" ? " (הקשר)" : ""}
                  </th>
                  <td className="px-1 py-1 tabular-nums">{fmtInt(r.count)}</td>
                  <td className="px-1 py-1 tabular-nums">{pct(r.ofAnchor)}</td>
                  <td className="px-1 py-1 tabular-nums">{pct(r.ofPrev)}</td>
                  <td className="px-1 py-1 tabular-nums">{r.stopped ? fmtInt(r.stopped.active) : "—"}</td>
                  <td className="px-1 py-1 tabular-nums">{r.stopped ? fmtInt(r.stopped.stuck) : "—"}</td>
                  <td className="px-1 py-1 tabular-nums">{r.stopped ? fmtInt(r.stopped.closed) : "—"}</td>
                  <td className="px-1 py-1 tabular-nums">{r.stopped ? fmtDecimal(r.expected) : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </figure>
  );
}

function Dot({ color, children }: { color: string; children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1">
      <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: color }} aria-hidden />
      {children}
    </span>
  );
}

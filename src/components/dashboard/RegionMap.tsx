import Link from "next/link";
import { Download } from "@/components/Download";
import type { ReactNode } from "react";
import { fmtInt } from "@/lib/format";
import { DISTRICT_OUTLINES, SUBDISTRICT_OUTLINES, type Outline } from "@/lib/geo/map";
import type { Level } from "@/lib/metrics/geo";

/**
 * Israel by CBS district or sub-district, each region shaded by its value: a count (teal, darker
 * is more) or a balance (magenta where demand outruns supply, teal where supply outruns it).
 * Gush Dan's sub-districts are a few kilometres across, so they are repeated enlarged in an
 * inset over the sea. Regions link to `href(code)` when given. The table is the accessible twin
 * and holds every figure; the map itself only restates it.
 */

export interface RegionValue {
  code: number;
  name: string;
  /** What shades the region: a count, or a log2 balance for mode "balance"; null leaves it blank. */
  value: number | null;
  /** The region's tooltip and the link's accessible name. */
  title: string;
}

type Mode = "count" | "balance";

/** No value: white, apart from the light grey of "balanced". */
const BLANK = "white";

function countFill(value: number | null, max: number): string {
  if (!value || !max) return BLANK;
  const steps = [14, 30, 48, 70, 92];
  const i = Math.min(steps.length - 1, Math.floor((value / max) * steps.length));
  return `color-mix(in srgb, var(--color-accent) ${steps[i]}%, white)`;
}

function balanceFill(value: number | null): string {
  if (value == null) return BLANK;
  const v = Math.max(-2, Math.min(2, value));
  if (Math.abs(v) < 0.3) return "#e4e7ec";
  const strength = Math.round(25 + (Math.abs(v) / 2) * 65);
  return `color-mix(in srgb, var(${v < 0 ? "--color-brand" : "--color-accent"}) ${strength}%, white)`;
}

/** The inset: Gush Dan (sub-districts 51–53 and their neighbours), enlarged over the sea. */
const INSET = { x: 132, y: 352, width: 52, height: 78, scale: 2.4, at: [-150, 330] as const };

export function RegionMap({
  id,
  level,
  values,
  mode = "count",
  href,
  selected = null,
  caption,
  table,
  download,
}: {
  /** Unique on the page: names the inset's clip path. */
  id: string;
  level: Level;
  values: RegionValue[];
  mode?: Mode;
  href?: (code: number) => string;
  selected?: number | null;
  caption: string;
  table: { head: string[]; rows: { code: number; cells: ReactNode[] }[] };
  /** Offers the table and the map (as an image) for download under this name. Only where there is no personal data (docs/exports.md). */
  download?: string;
}) {
  const outlines = level === "district" ? DISTRICT_OUTLINES : SUBDISTRICT_OUTLINES;
  const byCode = new Map(values.map((v) => [v.code, v]));
  const max = Math.max(0, ...values.map((v) => v.value ?? 0));
  const fill = (code: number) => {
    const v = byCode.get(code)?.value ?? null;
    return mode === "balance" ? balanceFill(v) : countFill(v, max);
  };

  const shape = (o: Outline, key: string, focusable: boolean) => {
    const v = byCode.get(o.code);
    const path = (
      <path
        d={o.path}
        style={{ fill: fill(o.code) }}
        stroke={selected === o.code ? "var(--color-ink)" : "white"}
        strokeWidth={selected === o.code ? 2.2 : 0.8}
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
        className="transition-opacity hover:opacity-80"
      >
        <title>{v?.title ?? ""}</title>
      </path>
    );
    if (!href || !v) return <g key={key}>{path}</g>;
    return (
      <a key={key} href={href(o.code)} aria-label={v.title} tabIndex={focusable ? undefined : -1} aria-hidden={focusable ? undefined : true} className="focus:outline-none [&:focus-visible>path]:stroke-[var(--color-ink)]">
        {path}
      </a>
    );
  };

  return (
    <figure data-export={download ? "" : undefined} className="flex flex-col gap-3">
      <div className="relative mx-auto w-full max-w-[460px]">
        <svg viewBox="-160 60 585 860" className="h-auto w-full" role="img" aria-label={caption}>
          <rect x={-160} y={60} width={585} height={860} fill="transparent" />
          {outlines.map((o) => shape(o, `m${o.code}`, true))}
          {level === "district"
            ? outlines.map((o) => {
                const v = byCode.get(o.code);
                if (!v || o.code === 5) return null;
                return (
                  <text
                    key={`l${o.code}`}
                    x={o.label[0]}
                    y={o.label[1]}
                    textAnchor="middle"
                    className="pointer-events-none fill-ink text-[15px] font-bold"
                    style={{ paintOrder: "stroke", stroke: "white", strokeWidth: 4 }}
                    aria-hidden
                  >
                    {v.name}
                  </text>
                );
              })
            : null}
          {/* Inset: the same shapes, enlarged; links here are duplicates and stay out of the tab order. */}
          <g aria-hidden>
            <rect
              x={INSET.at[0] - 4}
              y={INSET.at[1] - 4}
              width={INSET.width * INSET.scale + 8}
              height={INSET.height * INSET.scale + 8}
              rx={10}
              fill="white"
              stroke="var(--color-line)"
            />
            <clipPath id={`inset-${id}`}>
              <rect x={INSET.x} y={INSET.y} width={INSET.width} height={INSET.height} />
            </clipPath>
            <g transform={`translate(${INSET.at[0]} ${INSET.at[1]}) scale(${INSET.scale}) translate(${-INSET.x} ${-INSET.y})`} clipPath={`url(#inset-${id})`}>
              {outlines.map((o) => shape(o, `i${o.code}`, false))}
            </g>
            <text x={INSET.at[0] + (INSET.width * INSET.scale) / 2} y={INSET.at[1] + INSET.height * INSET.scale + 24} className="fill-muted text-[14px]" textAnchor="middle">
              גוש דן, מוגדל
            </text>
            <rect x={INSET.x} y={INSET.y} width={INSET.width} height={INSET.height} fill="none" stroke="var(--color-muted)" strokeDasharray="3 2" strokeWidth={0.8} />
          </g>
        </svg>
      </div>
      <Legend mode={mode} max={max} />
      <details className="text-sm">
        <summary className="cursor-pointer text-accent-dark underline-offset-4 hover:underline">הצגה כטבלה</summary>
        <div className="relative mt-2 overflow-x-auto">
          <table className="w-full text-start">
            <caption className="sr-only">{caption}</caption>
            <thead>
              <tr className="border-b border-line text-muted">
                {table.head.map((h) => (
                  <th key={h} scope="col" className="px-2 py-1 text-start font-medium">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {table.rows.map((r) => (
                <tr key={r.code} className={`border-b border-line/60 ${selected === r.code ? "bg-accent/10" : ""}`}>
                  {r.cells.map((c, i) =>
                    i === 0 ? (
                      <th key={i} scope="row" className="px-2 py-1 text-start font-medium">
                        {href ? (
                          <Link href={href(r.code)} className="underline-offset-4 hover:underline">
                            {c}
                          </Link>
                        ) : (
                          c
                        )}
                      </th>
                    ) : (
                      <td key={i} className="px-2 py-1 tabular-nums">
                        {c}
                      </td>
                    ),
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
      {download ? <Download name={download} image={{}} /> : null}
    </figure>
  );
}

function Legend({ mode, max }: { mode: Mode; max: number }) {
  if (mode === "balance") {
    const stops = [-2, -1, 0, 1, 2];
    return (
      <div className="flex flex-col items-center gap-1 text-xs text-muted">
        <div className="flex w-full max-w-[320px]" aria-hidden>
          {stops.map((s) => (
            <span key={s} className="h-3 flex-1 first:rounded-s-full last:rounded-e-full" style={{ background: balanceFill(s) }} />
          ))}
        </div>
        <div className="flex w-full max-w-[320px] justify-between">
          <span>חסרים מועמדים</span>
          <span>מאוזן</span>
          <span>עודף מועמדים</span>
        </div>
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-3 w-5 rounded-full bg-white ring-1 ring-line" aria-hidden /> אין משרות פעילות
        </span>
      </div>
    );
  }
  return (
    <div className="flex items-center justify-center gap-2 text-xs text-muted">
      <span className="tabular-nums">0</span>
      <span className="flex w-40" aria-hidden>
        {[14, 30, 48, 70, 92].map((p) => (
          <span key={p} className="h-3 flex-1 first:rounded-s-full last:rounded-e-full" style={{ background: `color-mix(in srgb, var(--color-accent) ${p}%, white)` }} />
        ))}
      </span>
      <span className="tabular-nums">{fmtInt(max)}</span>
    </div>
  );
}

/** The pill switch between districts and sub-districts; `hrefFor` keeps the page's other parameters. */
export function LevelSwitch({ level, hrefFor }: { level: Level; hrefFor: (level: Level) => string }) {
  const options: { key: Level; label: string }[] = [
    { key: "district", label: "מחוזות" },
    { key: "subdistrict", label: "נפות" },
  ];
  return (
    <nav aria-label="רמת המפה" className="flex gap-1 rounded-full bg-panel p-1 text-sm">
      {options.map((o) => (
        <Link
          key={o.key}
          href={hrefFor(o.key)}
          scroll={false}
          aria-current={o.key === level ? "true" : undefined}
          className={`rounded-full px-3 py-1 ${o.key === level ? "bg-white font-bold text-accent-dark shadow-sm" : "text-ink hover:bg-white/70"}`}
        >
          {o.label}
        </Link>
      ))}
    </nav>
  );
}

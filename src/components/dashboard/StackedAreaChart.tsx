"use client";

import { useEffect, useId, useRef, useState } from "react";

export interface AreaLayer {
  /** Shown in the legend, the tooltip and the table. */
  label: string;
  /** CSS color of the layer's fill. */
  color: string;
  /** 1 by default; a lighter shade of the same hue (e.g. calls under emails) takes less. */
  opacity?: number;
  /** One value per column, in the order of `columns`. */
  values: number[];
}

const W = 800;
const fmt = (n: number) => new Intl.NumberFormat("he-IL").format(Math.round(n));

/** A round top for the axis, close above the peak so the stack fills the height. */
function niceMax(v: number): number {
  if (v <= 0) return 1;
  const exp = 10 ** Math.floor(Math.log10(v));
  const f = v / exp;
  return ([1, 1.2, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10].find((s) => f <= s) ?? 10) * exp;
}

/**
 * Stacked areas over a few columns (months): the layers pile up from the baseline in the order
 * given, with a 2px surface gap between them, so the top edge is the total. The crosshair snaps to
 * a column and the tooltip lists every layer there with the total; arrow keys move it, a live
 * region reads it out. A legend is always shown; the table view holds every value.
 */
export function StackedAreaChart({ columns, layers, unit, height = 260 }: { columns: string[]; layers: AreaLayer[]; unit: string; height?: number }) {
  const svgRef = useRef<SVGSVGElement>(null);
  const liveId = useId();
  const [hover, setHover] = useState<number | null>(null);

  useEffect(() => {
    if (hover === null) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setHover(null);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [hover]);

  const n = columns.length;
  const totals = columns.map((_, i) => layers.reduce((t, l) => t + (l.values[i] ?? 0), 0));
  if (!n || !layers.length || totals.every((t) => t === 0)) return <p className="py-8 text-center text-sm text-muted">אין נתונים בטווח הזה</p>;

  const max = niceMax(Math.max(...totals));
  const top = 16;
  const bottom = 30;
  const innerH = height - top - bottom;
  const pad = { left: 52, right: 16 };
  const innerW = W - pad.left - pad.right;
  const step = n > 1 ? innerW / (n - 1) : 0;
  const x = (i: number) => pad.left + (n > 1 ? i * step : innerW / 2);
  const y = (v: number) => top + innerH - (v / max) * innerH;

  // Running sums: layer k sits on the sum of layers 0..k-1.
  const stacks: { lower: number[]; upper: number[] }[] = [];
  const running = new Array<number>(n).fill(0);
  for (const l of layers) {
    const lower = [...running];
    for (let i = 0; i < n; i++) running[i] = running[i]! + (l.values[i] ?? 0);
    stacks.push({ lower, upper: [...running] });
  }
  const area = ({ lower, upper }: { lower: number[]; upper: number[] }) => {
    const up = upper.map((v, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
    const down = lower
      .map((v, i) => [i, v] as const)
      .reverse()
      .map(([i, v]) => `L${x(i).toFixed(1)},${y(v).toFixed(1)}`)
      .join(" ");
    return `${up} ${down} Z`;
  };
  const ticks = [0, max / 2, max];
  const every = Math.max(1, Math.ceil(n / 6));
  const xLabels = columns.map((c, i) => ({ c, i })).filter(({ i }) => i % every === (n - 1) % every);

  const onMove = (clientX: number) => {
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect) return;
    const px = ((clientX - rect.left) / rect.width) * W;
    const i = step ? Math.round((px - pad.left) / step) : 0;
    setHover(Math.max(0, Math.min(n - 1, i)));
  };

  const shown = hover === null ? [] : layers.map((l) => ({ ...l, v: l.values[hover] ?? 0 })).filter((l) => l.v > 0);
  const spoken = hover === null ? "" : `${columns[hover]}: סה״כ ${fmt(totals[hover]!)} ${unit}${shown.map((l) => `, ${l.label} ${fmt(l.v)}`).join("")}`;

  return (
    <figure className="flex flex-col gap-2">
      <ul className="flex flex-wrap gap-x-5 gap-y-1 text-sm text-ink" aria-label="מקרא">
        {layers.map((l) => (
          <li key={l.label} className="flex items-center gap-2">
            <span className="inline-block size-3 rounded-[3px]" style={{ background: l.color, opacity: l.opacity ?? 1 }} aria-hidden />
            {l.label}
          </li>
        ))}
      </ul>
      <div className="relative" dir="ltr" onPointerLeave={() => setHover(null)}>
        <svg
          ref={svgRef}
          viewBox={`0 0 ${W} ${height}`}
          className="h-auto w-full touch-pan-y select-none"
          role="img"
          tabIndex={0}
          aria-label={`${unit} לפי חודש, ${columns[0]} עד ${columns[n - 1]}, שיא ${fmt(Math.max(...totals))}. מקשי החצים עוברים בין החודשים; כל הנתונים בטבלה שמתחת.`}
          aria-describedby={liveId}
          onPointerDown={(e) => onMove(e.clientX)}
          onPointerMove={(e) => onMove(e.clientX)}
          onFocus={() => setHover((h) => h ?? n - 1)}
          onBlur={() => setHover(null)}
          onKeyDown={(e) => {
            // The chart runs left to right, so ArrowRight is later in time.
            const moves: Record<string, (h: number | null) => number> = {
              ArrowRight: (h) => Math.min(n - 1, (h ?? -1) + 1),
              ArrowLeft: (h) => Math.max(0, (h ?? n) - 1),
              Home: () => 0,
              End: () => n - 1,
            };
            const move = moves[e.key];
            if (!move) return;
            e.preventDefault();
            setHover((h) => move(h));
          }}
        >
          {ticks.map((t) => (
            <g key={t}>
              <line x1={pad.left} x2={W - pad.right} y1={y(t)} y2={y(t)} stroke="var(--color-line)" strokeWidth={1} />
              <text x={pad.left - 8} y={y(t) + 4} textAnchor="end" fontSize={12} fill="var(--color-muted)" className="tabular-nums">
                {fmt(t)}
              </text>
            </g>
          ))}
          {xLabels.map(({ c, i }) => (
            <text key={c} x={x(i)} y={height - 8} textAnchor={i === 0 ? "start" : i === n - 1 ? "end" : "middle"} fontSize={12} fill="var(--color-muted)">
              {c}
            </text>
          ))}
          {layers.map((l, k) => (
            // The surface stroke is the 2px gap between neighbouring layers.
            <path key={l.label} d={area(stacks[k]!)} fill={l.color} fillOpacity={l.opacity ?? 1} stroke="var(--color-surface)" strokeWidth={2} strokeLinejoin="round" />
          ))}
          {hover !== null ? (
            <g>
              <line x1={x(hover)} x2={x(hover)} y1={top} y2={top + innerH} stroke="var(--color-ink)" strokeWidth={1} />
              <circle cx={x(hover)} cy={y(totals[hover]!)} r={4.5} fill="var(--color-ink)" stroke="#ffffff" strokeWidth={2} />
            </g>
          ) : null}
        </svg>
        {hover !== null ? (
          <div
            className="absolute top-2 z-10 -translate-x-1/2 rounded-card bg-ink px-3 py-2 text-xs text-white shadow-field"
            style={{ left: `${Math.min(85, Math.max(15, (x(hover) / W) * 100))}%` }}
            dir="rtl"
            aria-hidden
          >
            <p className="mb-1 text-white/80">
              {columns[hover]} · סה״כ <span className="font-bold text-white tabular-nums">{fmt(totals[hover]!)}</span>
            </p>
            {[...shown].reverse().map((l) => (
              <p key={l.label} className="flex items-center gap-2">
                {/* On white, so a light shade reads light on the dark tooltip too. */}
                <span className="inline-block size-2.5 rounded-[2px] bg-white">
                  <span className="block size-full rounded-[2px]" style={{ background: l.color, opacity: l.opacity ?? 1 }} />
                </span>
                <span className="text-sm font-bold tabular-nums">{fmt(l.v)}</span>
                <span className="text-white/80">{l.label}</span>
              </p>
            ))}
          </div>
        ) : null}
        <p id={liveId} aria-live="polite" className="sr-only">
          {spoken}
        </p>
      </div>
      <details className="text-sm">
        <summary className="cursor-pointer text-accent-dark underline-offset-4 hover:underline">הצגה כטבלה</summary>
        <div className="relative mt-2 max-h-80 overflow-auto" tabIndex={0}>
          <table className="w-full text-start">
            <caption className="sr-only">{`${unit} לפי חודש`}</caption>
            <thead>
              <tr className="border-b border-line text-muted">
                <th scope="col" className="py-1 pe-3 text-start font-medium">
                  חודש
                </th>
                {layers.map((l) => (
                  <th key={l.label} scope="col" className="py-1 pe-3 text-start font-medium">
                    {l.label}
                  </th>
                ))}
                <th scope="col" className="py-1 text-start font-medium">
                  סה״כ
                </th>
              </tr>
            </thead>
            <tbody>
              {columns.map((c, i) => (
                <tr key={c} className="border-b border-line/60">
                  <th scope="row" className="py-1 pe-3 text-start font-normal whitespace-nowrap">
                    {c}
                  </th>
                  {layers.map((l) => (
                    <td key={l.label} className="py-1 pe-3 tabular-nums">
                      {fmt(l.values[i] ?? 0)}
                    </td>
                  ))}
                  <td className="py-1 font-medium tabular-nums">{fmt(totals[i]!)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </figure>
  );
}

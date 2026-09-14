"use client";

import { useMemo, useRef, useState } from "react";

export interface SeriesPoint {
  day: string; // YYYY-MM-DD
  value: number;
}

export interface ChartSeries {
  label: string;
  /** CSS color. One series: the accent. Several: --color-series-1.. in order. */
  color: string;
  /** Every series must cover the same days. */
  points: SeriesPoint[];
}

const W = 800;
const WEEKLY_AFTER_DAYS = 120;
const LABEL_MIN_GAP = 16;

const fmt = (n: number) => new Intl.NumberFormat("he-IL").format(Math.round(n));
const shortDay = (day: string) => `${day.slice(8, 10)}.${day.slice(5, 7)}.${day.slice(2, 4)}`;

function niceMax(v: number): number {
  if (v <= 0) return 1;
  const exp = 10 ** Math.floor(Math.log10(v));
  const f = v / exp;
  return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * exp;
}

/** Long ranges are summed into weeks starting on Sunday, the Israeli work week. */
function bucket(points: SeriesPoint[], weekly: boolean): { label: string; start: string; value: number }[] {
  if (!weekly) return points.map((p) => ({ label: shortDay(p.day), start: p.day, value: p.value }));
  const weeks = new Map<string, number>();
  for (const p of points) {
    const d = new Date(`${p.day}T12:00:00Z`);
    d.setUTCDate(d.getUTCDate() - d.getUTCDay());
    const key = d.toISOString().slice(0, 10);
    weeks.set(key, (weeks.get(key) ?? 0) + p.value);
  }
  return [...weeks.entries()].map(([start, value]) => ({ label: `שבוע ${shortDay(start)}`, start, value }));
}

/**
 * Line chart for one to four series on one axis: 2px strokes, a 10% wash under
 * a single series, hairline grid. The crosshair snaps to the nearest date and
 * the tooltip lists every series there. Two or more series get a legend, plus
 * end labels when those don't collide. The table view holds every value.
 */
export function LineChart({ series, unit, height = 240 }: { series: ChartSeries[]; unit: string; height?: number }) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [hover, setHover] = useState<number | null>(null);
  const weekly = (series[0]?.points.length ?? 0) > WEEKLY_AFTER_DAYS;
  const data = useMemo(() => series.map((s) => ({ ...s, buckets: bucket(s.points, weekly) })), [series, weekly]);

  const n = data[0]?.buckets.length ?? 0;
  const allValues = data.flatMap((s) => s.buckets.map((b) => b.value));
  if (!n || allValues.every((v) => v === 0)) {
    return <p className="py-8 text-center text-sm text-muted">אין נתונים בטווח הזה</p>;
  }

  const multi = data.length > 1;
  const max = niceMax(Math.max(...allValues));
  const top = 16;
  const bottom = 30;
  const innerH = height - top - bottom;
  const y = (v: number) => top + innerH - (v / max) * innerH;

  // End labels ride the lines only when they clear each other; otherwise the legend carries identity.
  const ends = data.map((s) => ({ label: s.label, y: y(s.buckets[n - 1]!.value) })).sort((a, b) => a.y - b.y);
  const labelsFit = multi && data.length <= 4 && ends.every((e, i) => i === 0 || e.y - ends[i - 1]!.y >= LABEL_MIN_GAP);
  const pad = { left: 52, right: labelsFit ? 132 : 16 };
  const innerW = W - pad.left - pad.right;
  const step = n > 1 ? innerW / (n - 1) : 0;
  const x = (i: number) => pad.left + (n > 1 ? i * step : innerW / 2);
  const pathFor = (values: number[]) => values.map((v, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
  const ticks = [0, max / 2, max];
  const xLabels = [...new Set([0, Math.floor((n - 1) / 2), n - 1])];

  const onMove = (clientX: number) => {
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect) return;
    const px = ((clientX - rect.left) / rect.width) * W;
    const i = step ? Math.round((px - pad.left) / step) : 0;
    setHover(Math.max(0, Math.min(n - 1, i)));
  };

  return (
    <figure className="flex flex-col gap-2">
      {multi ? (
        <ul className="flex flex-wrap gap-x-5 gap-y-1 text-sm text-ink" aria-label="מקרא">
          {data.map((s) => (
            <li key={s.label} className="flex items-center gap-2">
              <span className="inline-block h-0.5 w-5 rounded-full" style={{ background: s.color }} aria-hidden />
              {s.label}
            </li>
          ))}
        </ul>
      ) : null}
      <div className="relative" dir="ltr">
        <svg
          ref={svgRef}
          viewBox={`0 0 ${W} ${height}`}
          className="h-auto w-full touch-none select-none"
          role="img"
          aria-label={`${unit} לאורך זמן`}
          onPointerMove={(e) => onMove(e.clientX)}
          onPointerLeave={() => setHover(null)}
        >
          {ticks.map((t) => (
            <g key={t}>
              <line x1={pad.left} x2={W - pad.right} y1={y(t)} y2={y(t)} stroke="var(--color-line)" strokeWidth={1} />
              <text x={pad.left - 8} y={y(t) + 4} textAnchor="end" fontSize={12} fill="var(--color-muted)" className="tabular-nums">
                {fmt(t)}
              </text>
            </g>
          ))}
          {xLabels.map((i) => (
            <text key={i} x={x(i)} y={height - 8} textAnchor={i === 0 ? "start" : i === n - 1 ? "end" : "middle"} fontSize={12} fill="var(--color-muted)">
              {data[0]!.buckets[i]!.label}
            </text>
          ))}
          {!multi ? (
            <path
              d={`${pathFor(data[0]!.buckets.map((b) => b.value))} L${x(n - 1).toFixed(1)},${y(0)} L${x(0).toFixed(1)},${y(0)} Z`}
              fill={data[0]!.color}
              opacity={0.1}
            />
          ) : null}
          {data.map((s) => (
            <path
              key={s.label}
              d={pathFor(s.buckets.map((b) => b.value))}
              fill="none"
              stroke={s.color}
              strokeWidth={2}
              strokeLinejoin="round"
              strokeLinecap="round"
            />
          ))}
          {labelsFit
            ? data.map((s) => (
                <text key={s.label} x={x(n - 1) + 8} y={y(s.buckets[n - 1]!.value) + 4} fontSize={12} fill="var(--color-ink)" textAnchor="start">
                  {s.label}
                </text>
              ))
            : null}
          {hover !== null ? (
            <g>
              <line x1={x(hover)} x2={x(hover)} y1={top} y2={top + innerH} stroke="var(--color-field)" strokeWidth={1} />
              {data.map((s) => (
                <circle key={s.label} cx={x(hover)} cy={y(s.buckets[hover]!.value)} r={4.5} fill={s.color} stroke="#ffffff" strokeWidth={2} />
              ))}
            </g>
          ) : null}
        </svg>
        {hover !== null ? (
          <div
            className="pointer-events-none absolute top-2 z-10 -translate-x-1/2 rounded-card bg-ink px-3 py-2 text-xs text-white shadow-field"
            style={{ left: `${Math.min(85, Math.max(15, (x(hover) / W) * 100))}%` }}
            dir="rtl"
          >
            <p className="mb-1 text-white/80">{data[0]!.buckets[hover]!.label}</p>
            {data.map((s) => (
              <p key={s.label} className="flex items-center gap-2">
                {multi ? <span className="inline-block h-0.5 w-3 rounded-full" style={{ background: s.color }} aria-hidden /> : null}
                <span className="text-sm font-bold tabular-nums">{fmt(s.buckets[hover]!.value)}</span>
                <span className="text-white/80">{multi ? s.label : unit}</span>
              </p>
            ))}
          </div>
        ) : null}
      </div>
      <details className="text-sm">
        <summary className="cursor-pointer text-accent-dark underline-offset-4 hover:underline">הצגה כטבלה</summary>
        <div className="mt-2 max-h-64 overflow-auto">
          <table className="w-full text-start">
            <thead>
              <tr className="border-b border-line text-muted">
                <th className="py-1 text-start font-medium">{weekly ? "שבוע" : "יום"}</th>
                {data.map((s) => (
                  <th key={s.label} className="py-1 text-start font-medium">
                    {multi ? s.label : unit}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data[0]!.buckets.map((b, i) => (
                <tr key={b.start} className="border-b border-line/60">
                  <td className="py-1">{b.label}</td>
                  {data.map((s) => (
                    <td key={s.label} className="py-1 tabular-nums">
                      {fmt(s.buckets[i]!.value)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </figure>
  );
}

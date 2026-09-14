"use client";

import { useMemo, useRef, useState } from "react";

export interface SeriesPoint {
  day: string; // YYYY-MM-DD
  value: number;
}

const W = 800;
const PAD = { left: 52, right: 16, top: 16, bottom: 30 };
const WEEKLY_AFTER_DAYS = 120;

const fmt = (n: number) => new Intl.NumberFormat("he-IL").format(Math.round(n));
const shortDay = (day: string) => `${day.slice(8, 10)}.${day.slice(5, 7)}.${day.slice(2, 4)}`;

function niceMax(v: number): number {
  if (v <= 0) return 1;
  const exp = 10 ** Math.floor(Math.log10(v));
  const f = v / exp;
  return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * exp;
}

/** Long ranges are summed into weeks starting on Sunday, the Israeli work week. */
function bucket(points: SeriesPoint[]): { label: string; start: string; value: number }[] {
  if (points.length <= WEEKLY_AFTER_DAYS) return points.map((p) => ({ label: shortDay(p.day), start: p.day, value: p.value }));
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
 * A single-series line: 2px stroke, a 10% wash under it, hairline grid. The
 * crosshair snaps to the nearest point so the reader aims at a date, not at the
 * line; the table view carries every value without hovering.
 */
export function LineChart({ points, unit, height = 220 }: { points: SeriesPoint[]; unit: string; height?: number }) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [hover, setHover] = useState<number | null>(null);
  const data = useMemo(() => bucket(points), [points]);

  if (!data.length || data.every((d) => d.value === 0)) {
    return <p className="py-8 text-center text-sm text-muted">אין נתונים בטווח הזה</p>;
  }

  const max = niceMax(Math.max(...data.map((d) => d.value)));
  const innerW = W - PAD.left - PAD.right;
  const innerH = height - PAD.top - PAD.bottom;
  const step = data.length > 1 ? innerW / (data.length - 1) : 0;
  const x = (i: number) => PAD.left + (data.length > 1 ? i * step : innerW / 2);
  const y = (v: number) => PAD.top + innerH - (v / max) * innerH;
  const line = data.map((d, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(d.value).toFixed(1)}`).join(" ");
  const area = `${line} L${x(data.length - 1).toFixed(1)},${y(0)} L${x(0).toFixed(1)},${y(0)} Z`;
  const ticks = [0, max / 2, max];
  const xLabels = [...new Set([0, Math.floor((data.length - 1) / 2), data.length - 1])];

  const onMove = (clientX: number) => {
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect) return;
    const px = ((clientX - rect.left) / rect.width) * W;
    const i = step ? Math.round((px - PAD.left) / step) : 0;
    setHover(Math.max(0, Math.min(data.length - 1, i)));
  };

  const h = hover === null ? null : data[hover]!;

  return (
    <figure className="flex flex-col gap-2">
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
              <line x1={PAD.left} x2={W - PAD.right} y1={y(t)} y2={y(t)} stroke="var(--color-line)" strokeWidth={1} />
              <text x={PAD.left - 8} y={y(t) + 4} textAnchor="end" fontSize={12} fill="var(--color-muted)" className="tabular-nums">
                {fmt(t)}
              </text>
            </g>
          ))}
          {xLabels.map((i) => (
            <text
              key={i}
              x={x(i)}
              y={height - 8}
              textAnchor={i === 0 ? "start" : i === data.length - 1 ? "end" : "middle"}
              fontSize={12}
              fill="var(--color-muted)"
            >
              {data[i]!.label}
            </text>
          ))}
          <path d={area} fill="var(--color-accent)" opacity={0.1} />
          <path d={line} fill="none" stroke="var(--color-accent)" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
          {h && hover !== null ? (
            <g>
              <line x1={x(hover)} x2={x(hover)} y1={PAD.top} y2={PAD.top + innerH} stroke="var(--color-field)" strokeWidth={1} />
              <circle cx={x(hover)} cy={y(h.value)} r={5} fill="var(--color-accent)" stroke="#ffffff" strokeWidth={2} />
            </g>
          ) : null}
        </svg>
        {h && hover !== null ? (
          <div
            className="pointer-events-none absolute top-2 z-10 -translate-x-1/2 rounded-card bg-ink px-3 py-2 text-xs text-white shadow-field"
            style={{ left: `${Math.min(88, Math.max(12, (x(hover) / W) * 100))}%` }}
            dir="rtl"
          >
            <p className="text-base font-bold tabular-nums">{fmt(h.value)}</p>
            <p className="text-white/80">
              {unit} · {h.label}
            </p>
          </div>
        ) : null}
      </div>
      <details className="text-sm">
        <summary className="cursor-pointer text-accent-dark underline-offset-4 hover:underline">הצגה כטבלה</summary>
        <div className="mt-2 max-h-64 overflow-auto">
          <table className="w-full text-start">
            <thead>
              <tr className="border-b border-line text-muted">
                <th className="py-1 text-start font-medium">{points.length > WEEKLY_AFTER_DAYS ? "שבוע" : "יום"}</th>
                <th className="py-1 text-start font-medium">{unit}</th>
              </tr>
            </thead>
            <tbody>
              {data.map((d) => (
                <tr key={d.start} className="border-b border-line/60">
                  <td className="py-1">{d.label}</td>
                  <td className="py-1 tabular-nums">{fmt(d.value)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </figure>
  );
}

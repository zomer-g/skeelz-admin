"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { PRESETS, type PresetKey } from "@/lib/dashboard/params";

export interface TimelineSegment {
  label: string;
  /** CSS color of the bar segment; text never takes it. */
  color: string;
}

const W = 800;
const H = 132;
const PAD = { top: 10, bottom: 24, x: 6 };

const fmt = (n: number) => new Intl.NumberFormat("he-IL").format(Math.round(n));
const shortDay = (day: string) => `${day.slice(8, 10)}.${day.slice(5, 7)}.${day.slice(2, 4)}`;

function addDays(day: string, n: number): string {
  const d = new Date(`${day}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

const segment = (active: boolean) =>
  `rounded-full px-4 py-2 text-sm font-medium transition-colors ${active ? "bg-ink text-white" : "bg-white text-ink ring-1 ring-line hover:bg-surface"}`;

/**
 * The anchor stage per week over all time, with the selected range drawn over
 * it. Drag across the bars (or tap a week) to pick a new range; the presets and
 * the two date fields do the same from the keyboard. Stacked segments show
 * where the weeks' cases stand today, so young weeks read as "still open".
 * Time runs left to right, as on every chart here.
 */
export function RangeTimeline({
  weeks,
  segments,
  unit,
  preset,
  fromDay,
  toDay,
  today,
  query,
}: {
  weeks: { start: string; values: number[] }[];
  segments: TimelineSegment[];
  unit: string;
  preset: PresetKey;
  fromDay: string;
  toDay: string;
  today: string;
  /** The page's other parameters (filters, anchor …), kept when the range changes. */
  query: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [pending, startTransition] = useTransition();
  const svgRef = useRef<SVGSVGElement>(null);
  const [drag, setDrag] = useState<{ a: number; b: number } | null>(null);
  const [hover, setHover] = useState<number | null>(null);
  const [custom, setCustom] = useState({ from: fromDay, to: toDay });

  useEffect(() => setCustom({ from: fromDay, to: toDay }), [fromDay, toDay]);

  function go(next: { range: PresetKey; from?: string; to?: string }) {
    const q = new URLSearchParams(query);
    q.set("range", next.range);
    q.delete("from");
    q.delete("to");
    if (next.range === "custom" && next.from && next.to) {
      q.set("from", next.from);
      q.set("to", next.to);
    }
    startTransition(() => router.push(`${pathname}?${q.toString()}`, { scroll: false }));
  }

  const n = weeks.length;
  const totals = weeks.map((w) => w.values.reduce((s, v) => s + v, 0));
  const max = Math.max(1, ...totals);
  const innerW = W - PAD.x * 2;
  const slot = n ? innerW / n : innerW;
  const barW = Math.max(1, slot * 0.72);
  const innerH = H - PAD.top - PAD.bottom;
  const x = (i: number) => PAD.x + i * slot;

  const indexAt = (clientX: number) => {
    const box = svgRef.current?.getBoundingClientRect();
    if (!box || !n) return 0;
    const vx = ((clientX - box.left) / box.width) * W;
    return Math.max(0, Math.min(n - 1, Math.floor((vx - PAD.x) / slot)));
  };

  // The selected range, in week slots (partial weeks included).
  const selStart = weeks.findIndex((w) => addDays(w.start, 6) >= fromDay);
  let selEnd = -1;
  weeks.forEach((w, i) => {
    if (w.start <= toDay) selEnd = i;
  });
  const shown = drag ? { a: Math.min(drag.a, drag.b), b: Math.max(drag.a, drag.b) } : selStart >= 0 && selEnd >= selStart ? { a: selStart, b: selEnd } : null;

  const commit = (a: number, b: number) => {
    const lo = Math.min(a, b);
    const hi = Math.max(a, b);
    const from = weeks[lo]!.start;
    const end = addDays(weeks[hi]!.start, 6);
    go({ range: "custom", from, to: end > today ? today : end });
  };

  const hovered = hover !== null ? weeks[hover] : null;
  const years = weeks.map((w, i) => ({ i, y: w.start.slice(0, 4) })).filter((w, i, all) => i === 0 || all[i - 1]!.y !== w.y);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2" role="group" aria-label="טווח תאריכים">
        {PRESETS.filter((p) => p.key !== "custom").map((p) => (
          <button key={p.key} type="button" aria-pressed={preset === p.key} className={segment(preset === p.key)} onClick={() => go({ range: p.key })}>
            {p.label}
          </button>
        ))}
        <span className="flex flex-wrap items-center gap-2">
          <input
            type="date"
            aria-label="מתאריך"
            value={custom.from}
            max={today}
            onChange={(e) => setCustom((c) => ({ ...c, from: e.target.value }))}
            className="h-9 rounded-full border border-field bg-white px-3 text-sm"
          />
          <span className="text-muted">עד</span>
          <input
            type="date"
            aria-label="עד תאריך"
            value={custom.to}
            max={today}
            onChange={(e) => setCustom((c) => ({ ...c, to: e.target.value }))}
            className="h-9 rounded-full border border-field bg-white px-3 text-sm"
          />
          <button
            type="button"
            aria-pressed={preset === "custom"}
            className={segment(preset === "custom")}
            onClick={() => custom.from && custom.to && go({ range: "custom", from: custom.from, to: custom.to })}
          >
            הצגה
          </button>
        </span>
      </div>

      {n ? (
        <figure className="flex flex-col gap-1">
          <svg
            ref={svgRef}
            viewBox={`0 0 ${W} ${H}`}
            className="h-auto w-full cursor-crosshair select-none"
            style={{ touchAction: "pan-y" }}
            role="img"
            aria-label={`${unit} לפי שבוע. הטווח הנבחר מסומן. אפשר לגרור על הגרף כדי לבחור טווח אחר, או להשתמש בשדות התאריך.`}
            onPointerDown={(e) => {
              const i = indexAt(e.clientX);
              setDrag({ a: i, b: i });
              e.currentTarget.setPointerCapture(e.pointerId);
            }}
            onPointerMove={(e) => {
              const i = indexAt(e.clientX);
              setHover(i);
              if (drag) setDrag({ ...drag, b: i });
            }}
            onPointerUp={() => {
              if (drag) commit(drag.a, drag.b);
              setDrag(null);
            }}
            onPointerCancel={() => setDrag(null)}
            onPointerLeave={() => setHover(null)}
          >
            {shown ? (
              <rect
                x={x(shown.a) - 1}
                y={PAD.top - 6}
                width={(shown.b - shown.a + 1) * slot + 2}
                height={innerH + 6}
                rx={4}
                fill="var(--color-brand)"
                fillOpacity={0.08}
                stroke="var(--color-brand)"
                strokeWidth={1.5}
              />
            ) : null}
            {weeks.map((w, i) => {
              let y = PAD.top + innerH;
              return (
                <g key={w.start} opacity={shown && (i < shown.a || i > shown.b) ? 0.45 : 1}>
                  {w.values.map((v, s) => {
                    if (!v) return null;
                    const h = (v / max) * innerH;
                    y -= h;
                    return <rect key={s} x={x(i) + (slot - barW) / 2} y={y} width={barW} height={h} fill={segments[s]?.color ?? "var(--color-accent)"} />;
                  })}
                </g>
              );
            })}
            <line x1={PAD.x} x2={W - PAD.x} y1={PAD.top + innerH + 0.5} y2={PAD.top + innerH + 0.5} stroke="var(--color-line)" />
            {years.map(({ i, y }) => (
              <g key={y}>
                <line x1={x(i)} x2={x(i)} y1={PAD.top + innerH} y2={PAD.top + innerH + 6} stroke="var(--color-field)" />
                <text x={x(i) + 3} y={H - 6} fontSize={12} fill="var(--color-muted)" textAnchor="start" direction="ltr">
                  {y}
                </text>
              </g>
            ))}
            {hover !== null ? (
              <rect x={x(hover)} y={PAD.top} width={slot} height={innerH} fill="var(--color-ink)" fillOpacity={0.06} pointerEvents="none" />
            ) : null}
          </svg>
          <figcaption className="flex min-h-5 flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted">
            {segments.length > 1
              ? segments.map((s) => (
                  <span key={s.label} className="inline-flex items-center gap-1">
                    <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: s.color }} aria-hidden />
                    {s.label}
                  </span>
                ))
              : null}
            <span className="ms-auto tabular-nums" aria-live="polite">
              {hovered
                ? `שבוע ${shortDay(hovered.start)}: ${fmt(hovered.values.reduce((s, v) => s + v, 0))} ${unit}${
                    segments.length > 1 ? ` (${hovered.values.map((v, s) => `${segments[s]!.label} ${fmt(v)}`).join(" · ")})` : ""
                  }`
                : pending
                  ? "טוען…"
                  : "גררו על הגרף לבחירת טווח"}
            </span>
          </figcaption>
          <details className="text-sm">
            <summary className="cursor-pointer text-accent-dark underline-offset-4 hover:underline">הצגה כטבלה</summary>
            <div className="relative mt-2 max-h-72 overflow-y-auto" tabIndex={0} role="region" aria-label={`${unit} לפי שבוע`}>
              <table className="w-full text-start">
                <caption className="sr-only">{unit} לפי שבוע</caption>
                <thead>
                  <tr className="border-b border-line text-muted">
                    <th scope="col" className="py-1 text-start font-medium">שבוע</th>
                    <th scope="col" className="py-1 text-start font-medium">סה״כ</th>
                    {segments.length > 1
                      ? segments.map((s) => (
                          <th key={s.label} scope="col" className="py-1 text-start font-medium">
                            {s.label}
                          </th>
                        ))
                      : null}
                  </tr>
                </thead>
                <tbody>
                  {[...weeks].reverse().map((w, i) => (
                    <tr key={w.start} className="border-b border-line/60">
                      <th scope="row" className="py-1 text-start font-normal tabular-nums">
                        {shortDay(w.start)}
                      </th>
                      <td className="py-1 tabular-nums">{fmt(totals[n - 1 - i]!)}</td>
                      {segments.length > 1
                        ? w.values.map((v, s) => (
                            <td key={s} className="py-1 tabular-nums">
                              {fmt(v)}
                            </td>
                          ))
                        : null}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>
        </figure>
      ) : null}
    </div>
  );
}

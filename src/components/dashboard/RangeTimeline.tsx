"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect, useLayoutEffect, useMemo, useRef, useState, useTransition, type KeyboardEvent, type PointerEvent } from "react";
import { PRESETS, type PresetKey } from "@/lib/dashboard/params";

export interface TimelineSegment {
  label: string;
  /** CSS color of the bar segment; text never takes it. */
  color: string;
}

/** Pixels per day on the strip. */
const PX = 5;
const BARS_H = 96;
/** Within this many days of a month boundary, an edge snaps to it. */
const MAGNET = 4;

const fmt = (n: number) => new Intl.NumberFormat("he-IL").format(Math.round(n));
const monthFmt = new Intl.DateTimeFormat("he-IL", { month: "short", timeZone: "UTC" });
const dotted = (day: string) => `${day.slice(8, 10)}.${day.slice(5, 7)}.${day.slice(0, 4)}`;

const dayMs = (day: string) => Date.parse(`${day}T12:00:00Z`);

const segment = (active: boolean) =>
  `rounded-full px-4 py-2 text-sm font-medium transition-colors ${active ? "bg-ink text-white" : "bg-white text-ink ring-1 ring-line hover:bg-surface"}`;

interface Range {
  from: number;
  to: number;
}

type DragMode = "start" | "end" | "move";

/**
 * The range picker: every day since the first application on one horizontal
 * strip, bars of the anchor stage per day, months marked underneath. The chosen
 * range is a window on the strip —
 * - drag its right or left edge to widen or narrow it (edges snap to month starts and ends),
 * - drag its middle to slide the whole range and keep its length (a whole-month
 *   range slides by whole months: January–June becomes February–July),
 * - click a month to take just that month; shift-click to stretch the range to it.
 * While dragging, the page follows along: the funnel is re-read as fast as the
 * server answers, never more than one request at a time. The edges and the
 * window take the keyboard too (arrows: a day, Page Up/Down: a month).
 * Time runs left to right, as on every chart here.
 */
export function RangeTimeline({
  days,
  segments,
  unit,
  preset,
  fromDay,
  toDay: toDayProp,
  query,
}: {
  days: { day: string; values: number[] }[];
  segments: TimelineSegment[];
  unit: string;
  preset: PresetKey;
  fromDay: string;
  toDay: string;
  /** The page's other parameters (filters, anchor …), kept when the range changes. */
  query: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [pending, startTransition] = useTransition();
  const scrollRef = useRef<HTMLDivElement>(null);
  const n = days.length;
  const first = days[0]?.day ?? fromDay;
  const indexOf = (day: string) => Math.max(0, Math.min(n - 1, Math.round((dayMs(day) - dayMs(first)) / 86_400_000)));
  const dayAt = (i: number) => days[Math.max(0, Math.min(n - 1, i))]?.day ?? first;

  const fromProps = (): Range => ({ from: indexOf(fromDay), to: indexOf(toDayProp) });
  const [draft, setDraft] = useState<Range>(fromProps);
  const [hover, setHover] = useState<number | null>(null);
  const [custom, setCustom] = useState({ from: fromDay, to: toDayProp });
  const drag = useRef<{ mode: DragMode; x: number; scroll: number; orig: Range } | null>(null);
  const [dragging, setDragging] = useState(false);
  // The URL the page should be showing, and the last one actually requested.
  const [wanted, setWanted] = useState<string | null>(null);
  const requested = useRef<string | null>(null);

  const months = useMemo(() => {
    const out: { key: string; start: number; end: number; label: string; year: string }[] = [];
    days.forEach((d, i) => {
      const key = d.day.slice(0, 7);
      const last = out[out.length - 1];
      if (last?.key === key) last.end = i;
      else out.push({ key, start: i, end: i, label: monthFmt.format(new Date(`${d.day}T12:00:00Z`)), year: d.day.slice(0, 4) });
    });
    return out;
  }, [days]);
  const monthStarts = useMemo(() => months.map((m) => m.start), [months]);
  const monthEnds = useMemo(() => months.map((m) => m.end), [months]);
  const monthOf = (i: number) => months.findIndex((m) => i >= m.start && i <= m.end);

  const snap = (i: number, marks: number[]) => {
    let best = i;
    let dist = MAGNET + 1;
    for (const m of marks) {
      const d = Math.abs(m - i);
      if (d < dist) {
        dist = d;
        best = m;
      }
    }
    return dist <= MAGNET ? best : i;
  };
  const aligned = (r: Range) => monthStarts.includes(r.from) && monthEnds.includes(r.to);

  /** Slide a range by `days` (or, when it is whole months, by the nearest whole number of months), keeping its length. */
  const slide = (orig: Range, deltaDays: number, byMonths?: number): Range => {
    if (aligned(orig)) {
      const a = monthOf(orig.from);
      const b = monthOf(orig.to);
      let shift = byMonths ?? Math.round(deltaDays / 30.44);
      shift = Math.max(-a, Math.min(months.length - 1 - b, shift));
      return { from: months[a + shift]!.start, to: months[b + shift]!.end };
    }
    const len = orig.to - orig.from;
    const from = Math.max(0, Math.min(n - 1 - len, orig.from + (byMonths ? byMonths * 30 : deltaDays)));
    return { from, to: from + len };
  };

  // Follow the URL when it changes from outside (presets, back button), not mid-drag.
  useEffect(() => {
    if (drag.current) return;
    setDraft(fromProps());
    setCustom({ from: fromDay, to: toDayProp });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fromDay, toDayProp, first, n]);

  // Keep the chosen window in view: its end near the right edge of the strip.
  useLayoutEffect(() => {
    const box = scrollRef.current;
    if (!box) return;
    const r = fromProps();
    const left = r.from * PX;
    const right = (r.to + 1) * PX;
    if (left < box.scrollLeft || right > box.scrollLeft + box.clientWidth) box.scrollLeft = Math.max(0, right - box.clientWidth + 48);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fromDay, toDayProp]);

  const urlFor = (next: { range: PresetKey; from?: string; to?: string }) => {
    const q = new URLSearchParams(query);
    q.set("range", next.range);
    q.delete("from");
    q.delete("to");
    if (next.range === "custom" && next.from && next.to) {
      q.set("from", next.from);
      q.set("to", next.to);
    }
    return `${pathname}?${q.toString()}`;
  };

  // One request in flight at a time; when it lands, ask for whatever the window shows now.
  useEffect(() => {
    if (pending || !wanted || wanted === requested.current) return;
    requested.current = wanted;
    startTransition(() => router.replace(wanted, { scroll: false }));
  }, [wanted, pending, router]);

  const request = (r: Range) => setWanted(urlFor({ range: "custom", from: dayAt(r.from), to: dayAt(r.to) }));
  const change = (r: Range) => {
    setDraft(r);
    request(r);
  };

  // Where the pointer is, so the strip can keep scrolling while it rests near an edge.
  const lastX = useRef(0);
  const autoScroll = useRef<number | null>(null);
  const draftRef = useRef(draft);
  draftRef.current = draft;

  const apply = (clientX: number) => {
    const d = drag.current;
    const box = scrollRef.current;
    if (!d || !box) return;
    // Scrolling moves the strip under the pointer, so it counts as movement too.
    const delta = Math.round((clientX - d.x + box.scrollLeft - d.scroll) / PX);
    let next: Range;
    if (d.mode === "move") next = slide(d.orig, delta);
    else if (d.mode === "start") next = { from: Math.min(d.orig.to, Math.max(0, snap(d.orig.from + delta, monthStarts))), to: d.orig.to };
    else next = { from: d.orig.from, to: Math.max(d.orig.from, Math.min(n - 1, snap(d.orig.to + delta, monthEnds))) };
    const cur = draftRef.current;
    if (next.from !== cur.from || next.to !== cur.to) change(next);
  };

  const stopAutoScroll = () => {
    if (autoScroll.current !== null) window.clearInterval(autoScroll.current);
    autoScroll.current = null;
  };

  const onPointerDown = (mode: DragMode) => (e: PointerEvent<HTMLElement>) => {
    e.preventDefault();
    e.stopPropagation();
    drag.current = { mode, x: e.clientX, scroll: scrollRef.current?.scrollLeft ?? 0, orig: draft };
    lastX.current = e.clientX;
    setDragging(true);
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e: PointerEvent<HTMLElement>) => {
    if (!drag.current) return;
    lastX.current = e.clientX;
    apply(e.clientX);
    const box = scrollRef.current?.getBoundingClientRect();
    const edge = box ? (e.clientX < box.left + 48 ? -1 : e.clientX > box.right - 48 ? 1 : 0) : 0;
    stopAutoScroll();
    if (edge) {
      autoScroll.current = window.setInterval(() => {
        scrollRef.current?.scrollBy({ left: edge * PX * 3 });
        apply(lastX.current);
      }, 40);
    }
  };
  const onPointerUp = () => {
    stopAutoScroll();
    drag.current = null;
    setDragging(false);
  };
  useEffect(() => stopAutoScroll, []);

  const onKey = (mode: DragMode) => (e: KeyboardEvent<HTMLElement>) => {
    const step = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : e.key === "PageDown" ? 30 : e.key === "PageUp" ? -30 : 0;
    if (!step) return;
    e.preventDefault();
    const months = Math.abs(step) === 30 ? Math.sign(step) : undefined;
    let next: Range;
    if (mode === "move") next = slide(draft, step, months);
    else if (mode === "start") {
      const target = months ? (monthStarts.find((m) => (step > 0 ? m > draft.from : false)) ?? [...monthStarts].reverse().find((m) => m < draft.from) ?? draft.from) : draft.from + step;
      next = { from: Math.max(0, Math.min(draft.to, target)), to: draft.to };
    } else {
      const target = months ? (step > 0 ? monthEnds.find((m) => m > draft.to) : [...monthEnds].reverse().find((m) => m < draft.to)) ?? draft.to : draft.to + step;
      next = { from: draft.from, to: Math.max(draft.from, Math.min(n - 1, target)) };
    }
    change(next);
  };

  const pickMonth = (m: (typeof months)[number], extend: boolean) => {
    const next = extend ? { from: Math.min(draft.from, m.start), to: Math.max(draft.to, m.end) } : { from: m.start, to: m.end };
    change(next);
  };

  // Scale to the 98th percentile, so one spike day does not flatten the rest; taller days are clipped at the top.
  const max = useMemo(() => {
    const totals = days.map((d) => d.values.reduce((s, v) => s + v, 0)).sort((a, b) => a - b);
    return Math.max(1, totals[Math.floor(totals.length * 0.98)] ?? 1);
  }, [days]);
  const width = n * PX;
  const hovered = hover !== null ? days[hover] : null;
  const len = draft.to - draft.from + 1;
  const monthsLong = aligned(draft) ? monthOf(draft.to) - monthOf(draft.from) + 1 : null;
  const selectedTotal = days.slice(draft.from, draft.to + 1).reduce((s, d) => s + d.values.reduce((a, v) => a + v, 0), 0);
  const updating = pending || (wanted !== null && wanted !== requested.current);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2" role="group" aria-label="טווחים מוכנים">
        {PRESETS.filter((p) => p.key !== "custom").map((p) => (
          <button
            key={p.key}
            type="button"
            aria-pressed={preset === p.key}
            className={segment(preset === p.key)}
            onClick={() => startTransition(() => router.push(urlFor({ range: p.key }), { scroll: false }))}
          >
            {p.label}
          </button>
        ))}
        <span className="flex flex-wrap items-center gap-2">
          <input type="date" aria-label="מתאריך" value={custom.from} min={first} max={dayAt(n - 1)} onChange={(e) => setCustom((c) => ({ ...c, from: e.target.value }))} className="h-9 rounded-full border border-field bg-white px-3 text-sm" />
          <span className="text-muted">עד</span>
          <input type="date" aria-label="עד תאריך" value={custom.to} min={first} max={dayAt(n - 1)} onChange={(e) => setCustom((c) => ({ ...c, to: e.target.value }))} className="h-9 rounded-full border border-field bg-white px-3 text-sm" />
          <button
            type="button"
            className={segment(false)}
            onClick={() => custom.from && custom.to && change({ from: indexOf(custom.from < custom.to ? custom.from : custom.to), to: indexOf(custom.from < custom.to ? custom.to : custom.from) })}
          >
            הצגה
          </button>
        </span>
      </div>

      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className="text-base font-bold tabular-nums">
          {dotted(dayAt(draft.from))} – {dotted(dayAt(draft.to))}
        </span>
        <span className="text-sm text-muted">
          {monthsLong ? `${fmt(monthsLong)} ${monthsLong === 1 ? "חודש" : "חודשים"} · ` : ""}
          {fmt(len)} ימים · {fmt(selectedTotal)} {unit}
        </span>
        <span className="ms-auto text-xs text-muted" role="status">
          {updating ? "מעדכן את המשפך…" : ""}
        </span>
      </div>

      {n ? (
        <figure className="flex flex-col gap-1">
          {/* The strip keeps its own left-to-right direction, and scrolls sideways inside itself. */}
          <div ref={scrollRef} dir="ltr" className="relative overflow-x-auto overscroll-x-contain rounded-[12px] bg-white pb-1 ring-1 ring-line" tabIndex={-1}>
            <div className="relative select-none" style={{ width }} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerUp}>
              <svg
                width={width}
                height={BARS_H}
                className="block"
                aria-hidden
                onPointerMove={(e) => {
                  if (drag.current) return;
                  const box = e.currentTarget.getBoundingClientRect();
                  setHover(Math.max(0, Math.min(n - 1, Math.floor((e.clientX - box.left) / PX))));
                }}
                onPointerLeave={() => setHover(null)}
              >
                {months.map((m, i) => (
                  <rect key={m.key} x={m.start * PX} y={0} width={(m.end - m.start + 1) * PX} height={BARS_H} fill={i % 2 ? "var(--color-surface)" : "transparent"} />
                ))}
                {days.map((d, i) => {
                  let y = BARS_H;
                  const outside = i < draft.from || i > draft.to;
                  return (
                    <g key={d.day} opacity={outside ? 0.35 : 1}>
                      {d.values.map((v, s) => {
                        if (!v) return null;
                        const h = Math.max(1, (v / max) * (BARS_H - 8));
                        y -= h;
                        return <rect key={s} x={i * PX} y={y} width={PX - 1} height={h} fill={segments[s]?.color ?? "var(--color-accent)"} />;
                      })}
                    </g>
                  );
                })}
                {hover !== null ? <rect x={hover * PX} y={0} width={PX} height={BARS_H} fill="var(--color-ink)" fillOpacity={0.12} /> : null}
              </svg>

              {/* The chosen range: drag the middle to slide it, the edges to resize it. */}
              <div
                className={`absolute top-0 border-y-2 border-brand bg-brand/10 ${dragging && drag.current?.mode === "move" ? "cursor-grabbing" : "cursor-grab"}`}
                style={{ left: draft.from * PX, width: len * PX, height: BARS_H, touchAction: "none" }}
                role="slider"
                tabIndex={0}
                aria-label="הזזת הטווח כולו, באותו אורך"
                aria-valuemin={0}
                aria-valuemax={n - 1}
                aria-valuenow={draft.from}
                aria-valuetext={`${dotted(dayAt(draft.from))} עד ${dotted(dayAt(draft.to))}`}
                onPointerDown={onPointerDown("move")}
                onKeyDown={onKey("move")}
              />
              {(["start", "end"] as const).map((edge) => {
                const at = edge === "start" ? draft.from * PX : (draft.to + 1) * PX;
                return (
                  <div
                    key={edge}
                    className="absolute top-0 flex cursor-ew-resize items-center justify-center focus-visible:outline-2"
                    style={{ left: at - 9, width: 18, height: BARS_H, touchAction: "none" }}
                    role="slider"
                    tabIndex={0}
                    aria-label={edge === "start" ? "תחילת הטווח" : "סוף הטווח"}
                    aria-valuemin={0}
                    aria-valuemax={n - 1}
                    aria-valuenow={edge === "start" ? draft.from : draft.to}
                    aria-valuetext={dotted(dayAt(edge === "start" ? draft.from : draft.to))}
                    onPointerDown={onPointerDown(edge)}
                    onKeyDown={onKey(edge)}
                  >
                    <span className="h-full w-[3px] bg-brand" aria-hidden />
                    <span className="absolute h-8 w-3 rounded-full border-2 border-brand bg-white shadow-sm" aria-hidden />
                  </div>
                );
              })}

              {/* Months: the anchors. A click takes the month; shift-click stretches the range to it. */}
              <div className="relative h-11 border-t border-line" style={{ width }}>
                {months.map((m) => {
                  const inRange = m.start >= draft.from && m.end <= draft.to;
                  return (
                    <button
                      key={m.key}
                      type="button"
                      className={`absolute top-0 flex h-full flex-col items-start justify-center border-s border-line ps-1 text-start text-xs leading-tight hover:bg-accent/10 ${inRange ? "font-bold text-brand-hover" : "text-muted"}`}
                      style={{ left: m.start * PX, width: (m.end - m.start + 1) * PX }}
                      title={`${m.label} ${m.year} · לחיצה: החודש הזה · Shift+לחיצה: הרחבת הטווח עד אליו`}
                      onClick={(e) => pickMonth(m, e.shiftKey)}
                    >
                      <span>{m.label}</span>
                      {m.key.endsWith("-01") || m === months[0] ? <span className="font-bold text-ink">{m.year}</span> : null}
                      <span className="sr-only"> {m.year}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
          <figcaption className="flex min-h-5 flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted">
            {segments.length > 1
              ? segments.map((s) => (
                  <span key={s.label} className="inline-flex items-center gap-1">
                    <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: s.color }} aria-hidden />
                    {s.label}
                  </span>
                ))
              : null}
            <span className="ms-auto tabular-nums">
              {hovered
                ? `${dotted(hovered.day)}: ${fmt(hovered.values.reduce((s, v) => s + v, 0))} ${unit}${
                    segments.length > 1 ? ` (${hovered.values.map((v, s) => `${segments[s]!.label} ${fmt(v)}`).join(" · ")})` : ""
                  }`
                : "גוררים את הקצוות להרחבה, את האמצע להזזה · לחיצה על חודש בוחרת אותו"}
            </span>
          </figcaption>
          <details className="text-sm">
            <summary className="cursor-pointer text-accent-dark underline-offset-4 hover:underline">הצגה כטבלה</summary>
            <div className="relative mt-2 max-h-72 overflow-y-auto" tabIndex={0} role="region" aria-label={`${unit} לפי חודש`}>
              <table className="w-full text-start">
                <caption className="sr-only">{unit} לפי חודש</caption>
                <thead>
                  <tr className="border-b border-line text-muted">
                    <th scope="col" className="py-1 text-start font-medium">חודש</th>
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
                  {[...months].reverse().map((m) => {
                    const sums = segments.map((_, s) => days.slice(m.start, m.end + 1).reduce((a, d) => a + (d.values[s] ?? 0), 0));
                    return (
                      <tr key={m.key} className="border-b border-line/60">
                        <th scope="row" className="py-1 text-start font-normal">
                          {m.label} {m.year}
                        </th>
                        <td className="py-1 tabular-nums">{fmt(sums.reduce((a, v) => a + v, 0))}</td>
                        {segments.length > 1
                          ? sums.map((v, s) => (
                              <td key={s} className="py-1 tabular-nums">
                                {fmt(v)}
                              </td>
                            ))
                          : null}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </details>
        </figure>
      ) : null}
    </div>
  );
}

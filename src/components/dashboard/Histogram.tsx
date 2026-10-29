import { fmtInt, fmtPercent } from "@/lib/format";

export interface HistogramBin {
  /** Under the column (short: "1", "2", … "12+"). */
  tick: string;
  /** In the tooltip and the table ("שבוע 1 (ימים 0–6)"). */
  label: string;
  value: number;
}

/**
 * Columns from a shared baseline, one per bin, the value over each and the share of the total in
 * its tooltip; data ends rounded (4px), a 2px gap between columns. The table view holds every bin.
 */
export function Histogram({ bins, caption, axis, color = "var(--color-accent)" }: { bins: HistogramBin[]; caption: string; axis: string; color?: string }) {
  const total = bins.reduce((t, b) => t + b.value, 0);
  if (!total) return <p className="py-8 text-center text-sm text-muted">אין נתונים בטווח הזה</p>;
  const max = Math.max(...bins.map((b) => b.value));
  return (
    <figure className="flex flex-col gap-2">
      {/* Time runs left to right, as on the other charts. */}
      <div dir="ltr" className="flex h-48 items-end gap-[2px] border-b border-line" role="list" aria-label={caption}>
        {bins.map((b) => (
          <div
            key={b.label}
            role="listitem"
            className="group flex h-full min-w-0 flex-1 flex-col items-center justify-end"
            title={`${b.label}: ${fmtInt(b.value)} (${fmtPercent(b.value, total)})`}
          >
            <span className="mb-1 text-[11px] font-bold text-ink tabular-nums">{b.value ? fmtInt(b.value) : ""}</span>
            <div
              className="w-full rounded-t-[4px] transition-opacity group-hover:opacity-80"
              style={{ height: b.value ? `max(${(b.value / max) * 85}%, 2px)` : 0, background: color }}
            />
            <span className="sr-only">
              {b.label}: {fmtInt(b.value)}
            </span>
          </div>
        ))}
      </div>
      <div dir="ltr" className="flex gap-[2px] text-[11px] text-muted" aria-hidden>
        {bins.map((b) => (
          <span key={b.label} className="min-w-0 flex-1 text-center tabular-nums">
            {b.tick}
          </span>
        ))}
      </div>
      <p className="text-center text-xs text-muted">{axis}</p>
      <details className="text-sm">
        <summary className="cursor-pointer text-accent-dark underline-offset-4 hover:underline">הצגה כטבלה</summary>
        <table className="mt-2 w-full text-start">
          <caption className="sr-only">{caption}</caption>
          <thead>
            <tr className="border-b border-line text-muted">
              <th scope="col" className="py-1 text-start font-medium">
                טווח
              </th>
              <th scope="col" className="py-1 text-start font-medium">
                הגשות
              </th>
              <th scope="col" className="py-1 text-start font-medium">
                שיעור
              </th>
            </tr>
          </thead>
          <tbody>
            {bins.map((b) => (
              <tr key={b.label} className="border-b border-line/60">
                <th scope="row" className="py-1 text-start font-normal">
                  {b.label}
                </th>
                <td className="py-1 tabular-nums">{fmtInt(b.value)}</td>
                <td className="py-1 tabular-nums">{fmtPercent(b.value, total)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </figure>
  );
}

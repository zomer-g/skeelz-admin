import { fmtInt, fmtPercent } from "@/lib/format";

export interface BarItem {
  label: string;
  value: number;
  /** CSS color for the bar; defaults to the accent. Text never takes it. */
  color?: string;
  /** Optional secondary note shown after the value (e.g. share of the first stage). */
  note?: string;
}

/**
 * Horizontal bars growing from the start edge (the right, in RTL). Every bar is
 * labelled and valued in text, so the tooltip only restates what is visible; the
 * table view is the accessible twin.
 */
export function BarList({ items, caption, showShareOf }: { items: BarItem[]; caption: string; showShareOf?: number }) {
  const max = Math.max(1, ...items.map((i) => i.value));

  if (!items.length) return <p className="py-4 text-center text-sm text-muted">אין נתונים בטווח הזה</p>;

  return (
    <figure className="flex flex-col gap-3">
      <ul className="flex flex-col gap-3" aria-label={caption}>
        {items.map((item) => {
          const share = showShareOf ? fmtPercent(item.value, showShareOf) : null;
          const tooltip = `${item.label}: ${fmtInt(item.value)}${share ? ` (${share})` : ""}`;
          return (
            <li key={item.label} className="group flex flex-col gap-1" title={tooltip}>
              <div className="flex items-baseline justify-between gap-3 text-sm">
                <span className="text-ink">{item.label}</span>
                <span className="shrink-0 text-muted">
                  <span className="font-bold text-ink tabular-nums">{fmtInt(item.value)}</span>
                  {share ? <span className="ms-1 tabular-nums">· {share}</span> : null}
                  {item.note ? <span className="ms-1">· {item.note}</span> : null}
                </span>
              </div>
              <div className="h-5 w-full rounded-e-[4px]">
                <div
                  className="h-full rounded-e-[4px] transition-opacity group-hover:opacity-80"
                  style={{
                    width: item.value ? `max(${(item.value / max) * 100}%, 3px)` : "0",
                    background: item.color ?? "var(--color-accent)",
                  }}
                />
              </div>
            </li>
          );
        })}
      </ul>
      <details className="text-sm">
        <summary className="cursor-pointer text-accent-dark underline-offset-4 hover:underline">הצגה כטבלה</summary>
        <table className="mt-2 w-full text-start">
          <caption className="sr-only">{caption}</caption>
          <thead>
            <tr className="border-b border-line text-muted">
              <th scope="col" className="py-1 text-start font-medium">פריט</th>
              <th scope="col" className="py-1 text-start font-medium">כמות</th>
              {showShareOf ? <th scope="col" className="py-1 text-start font-medium">שיעור</th> : null}
            </tr>
          </thead>
          <tbody>
            {items.map((item) => (
              <tr key={item.label} className="border-b border-line/60">
                <th scope="row" className="py-1 text-start font-normal">
                  {item.label}
                </th>
                <td className="py-1 tabular-nums">{fmtInt(item.value)}</td>
                {showShareOf ? <td className="py-1 tabular-nums">{fmtPercent(item.value, showShareOf)}</td> : null}
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </figure>
  );
}

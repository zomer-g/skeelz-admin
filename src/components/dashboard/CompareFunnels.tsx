import { AnchoredFunnel } from "@/components/dashboard/AnchoredFunnel";
import { Card } from "@/components/ui";
import { formatDay } from "@/lib/dashboard/params";
import { fmtDecimal, fmtInt } from "@/lib/format";
import type { FunnelResult, StageKey } from "@/lib/metrics/funnel";

export interface Period {
  fromDay: string;
  toDay: string;
  funnel: FunnelResult;
}

const rangeLabel = (p: Period) => `${formatDay(p.fromDay)} – ${formatDay(p.toDay)}`;
const pct = (v: number | null) => (v == null ? "—" : `${fmtDecimal(v * 100)}%`);

/** Change from B (the comparison period) to A (the selected one), as text; colour never carries it alone. */
function Change({ a, b }: { a: number; b: number }) {
  if (!a && !b) return <span className="text-muted">—</span>;
  const diff = a - b;
  const rel = b ? `${diff >= 0 ? "+" : "−"}${fmtDecimal(Math.abs(diff / b) * 100)}%` : "חדש";
  const tone = diff > 0 ? "text-success" : diff < 0 ? "text-danger" : "text-muted";
  return (
    <span className={`tabular-nums ${tone}`}>
      <span aria-hidden>{diff > 0 ? "▲ " : diff < 0 ? "▼ " : ""}</span>
      {diff >= 0 ? "+" : "−"}
      {fmtInt(Math.abs(diff))} ({rel})
    </span>
  );
}

/**
 * Two periods side by side: the same anchor and filters, each funnel in full, and a table of the
 * differences. A is the selected range, B the comparison range.
 */
export function CompareFunnels({ a, b, anchorHrefs }: { a: Period; b: Period; anchorHrefs: Partial<Record<StageKey, string>> }) {
  const rowsB = new Map(b.funnel.rows.map((r) => [r.key, r]));
  const summary: [string, number, number][] = [
    ["בעוגן", a.funnel.anchorCount, b.funnel.anchorCount],
    ["התקבלו לעבודה", a.funnel.hired, b.funnel.hired],
    ["בתהליך", a.funnel.active, b.funnel.active],
    ["תקועים", a.funnel.stuck, b.funnel.stuck],
    ["נסגרו", a.funnel.closed, b.funnel.closed],
  ];

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card level={3} title={`תקופה א׳ · ${rangeLabel(a)}`}>
          <AnchoredFunnel funnel={a.funnel} anchorHrefs={anchorHrefs} />
        </Card>
        <Card level={3} title={`תקופה ב׳ · ${rangeLabel(b)}`} tone="accent-light">
          <AnchoredFunnel funnel={b.funnel} anchorHrefs={anchorHrefs} />
        </Card>
      </div>

      <Card level={3} title="ההבדלים בין התקופות">
        <div className="relative overflow-x-auto">
          <table className="w-full min-w-[40rem] text-start text-sm">
            <caption className="sr-only">
              השוואת המשפך: תקופה א׳ {rangeLabel(a)} מול תקופה ב׳ {rangeLabel(b)}
            </caption>
            <thead>
              <tr className="border-b-2 border-line text-muted">
                <th scope="col" className="px-3 py-2 text-start font-medium">שלב</th>
                <th scope="col" className="px-3 py-2 text-start font-medium">תקופה א׳</th>
                <th scope="col" className="px-3 py-2 text-start font-medium">מהעוגן</th>
                <th scope="col" className="px-3 py-2 text-start font-medium">תקופה ב׳</th>
                <th scope="col" className="px-3 py-2 text-start font-medium">מהעוגן</th>
                <th scope="col" className="px-3 py-2 text-start font-medium">שינוי (א׳ מול ב׳)</th>
              </tr>
            </thead>
            <tbody>
              {a.funnel.rows.map((ra) => {
                const rb = rowsB.get(ra.key);
                return (
                  <tr key={ra.key} className={`border-b border-line/60 ${ra.isAnchor ? "bg-accent/10 font-medium" : ""}`}>
                    <th scope="row" className="px-3 py-2 text-start font-normal">
                      {ra.label}
                      {ra.isAnchor ? <span className="ms-2 text-xs text-muted">(עוגן)</span> : null}
                    </th>
                    <td className="px-3 py-2 tabular-nums">{fmtInt(ra.count)}</td>
                    <td className="px-3 py-2 tabular-nums text-muted">{pct(ra.ofAnchor)}</td>
                    <td className="px-3 py-2 tabular-nums">{rb ? fmtInt(rb.count) : "—"}</td>
                    <td className="px-3 py-2 tabular-nums text-muted">{pct(rb?.ofAnchor ?? null)}</td>
                    <td className="px-3 py-2">{rb ? <Change a={ra.count} b={rb.count} /> : "—"}</td>
                  </tr>
                );
              })}
              {summary.map(([label, va, vb]) => (
                <tr key={label} className="border-b border-line/60">
                  <th scope="row" className="px-3 py-2 text-start font-normal text-muted">
                    {label}
                  </th>
                  <td className="px-3 py-2 tabular-nums">{fmtInt(va)}</td>
                  <td />
                  <td className="px-3 py-2 tabular-nums">{fmtInt(vb)}</td>
                  <td />
                  <td className="px-3 py-2">
                    <Change a={va} b={vb} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <ul className="mt-3 flex flex-col gap-1 text-xs text-muted">
          <li>שתי התקופות עם אותו עוגן ואותם מסננים. &quot;מהעוגן&quot;: איזה חלק מהמקרים בעוגן הגיע לשלב.</li>
          <li>
            תקופה ותיקה יותר הספיקה להבשיל: למקרים שלה היה יותר זמן להגיע לראיון ולהשמה. כשתקופה א׳ צעירה, שלבי הסוף בה צפויים עוד לעלות.
          </li>
        </ul>
      </Card>
    </div>
  );
}

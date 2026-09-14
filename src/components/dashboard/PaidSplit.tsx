import { fmtInt, fmtPercent } from "@/lib/format";
import type { Scope } from "@/lib/metrics/paid";

export interface SplitItem {
  label: string;
  paid: number;
  total: number;
}

/** The paid share of each headline count, shown in both scopes so neither side of the picture is lost. */
export function PaidSplit({ scope, items }: { scope: Scope; items: SplitItem[] }) {
  return (
    <div className="mb-6 flex flex-wrap items-center gap-x-6 gap-y-2 rounded-card bg-white px-4 py-3 text-sm ring-1 ring-line">
      <span className="font-medium">{scope === "paid" ? "מוצגת פעילות בתשלום בלבד" : "מוצגת כל הפעילות, כולל משרות שלא בתשלום"}</span>
      {items.map((i) => (
        <span key={i.label}>
          {i.label}: <span className="font-bold tabular-nums">{fmtInt(i.paid)}</span> בתשלום מתוך <span className="tabular-nums">{fmtInt(i.total)}</span>
          <span className="text-muted"> ({fmtPercent(i.paid, i.total)})</span>
        </span>
      ))}
    </div>
  );
}

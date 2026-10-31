"use client";

import { useId, useState } from "react";
import { Table } from "@/components/ui";

const fmt = new Intl.NumberFormat("he-IL", { maximumFractionDigits: 1 });

export interface RateRow {
  id: string;
  name: string;
  /** Actions in windows per hour worked, by kind. */
  perHour: { total: number; email: number; call: number; task: number };
}

/** "In N hours: X emails, Y calls", from each employee's rate in the range. N is picked here, in the browser. */
export function ExpectedRates({ rows }: { rows: RateRow[] }) {
  const id = useId();
  const [hours, setHours] = useState(5);
  const n = Number.isFinite(hours) && hours > 0 ? hours : 0;
  return (
    <div className="flex flex-col gap-4">
      <label htmlFor={id} className="flex flex-wrap items-center gap-2 text-sm">
        <span>צפי בעוד</span>
        <input
          id={id}
          type="number"
          min={0.5}
          max={200}
          step={0.5}
          value={hours}
          onChange={(e) => setHours(Number(e.target.value))}
          className="h-9 w-24 rounded-full border border-field bg-white px-3 text-sm text-ink focus:outline-hidden focus:ring-2 focus:ring-accent"
        />
        <span>שעות עבודה</span>
      </label>
      <Table caption={`צפי פעולות בעוד ${n} שעות עבודה`} head={["עובד", "פעולות", "מיילים", "שיחות", "משימות אחרות"]} empty={rows.length ? undefined : "אין לאף עובד שעות בטווח"}>
        {rows.map((r) => (
          <tr key={r.id}>
            <td className="px-3 py-2">{r.name}</td>
            <td className="px-3 py-2 font-medium tabular-nums">{fmt.format(r.perHour.total * n)}</td>
            <td className="px-3 py-2 tabular-nums">{fmt.format(r.perHour.email * n)}</td>
            <td className="px-3 py-2 tabular-nums">{fmt.format(r.perHour.call * n)}</td>
            <td className="px-3 py-2 tabular-nums">{fmt.format(r.perHour.task * n)}</td>
          </tr>
        ))}
      </Table>
    </div>
  );
}

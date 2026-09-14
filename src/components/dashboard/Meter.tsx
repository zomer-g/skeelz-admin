import { fmtInt, fmtPercent } from "@/lib/format";

/**
 * A single ratio against its whole. The track is a lighter step of the fill's
 * own ramp, so the unfilled part still reads as "the rest of the same thing".
 */
export function Meter({ label, part, whole, partLabel, restLabel }: {
  label: string;
  part: number;
  whole: number;
  partLabel: string;
  restLabel: string;
}) {
  const pct = whole ? Math.min(100, (part / whole) * 100) : 0;
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-sm font-medium text-muted">{label}</span>
        <span className="text-2xl font-bold text-ink">{fmtPercent(part, whole)}</span>
      </div>
      <div
        className="h-3 w-full overflow-hidden rounded-full bg-accent-light/35"
        role="meter"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={Math.max(whole, 1)}
        aria-valuenow={Math.min(part, Math.max(whole, 1))}
        aria-valuetext={`${fmtPercent(part, whole)}: ${partLabel} ${fmtInt(part)} מתוך ${fmtInt(whole)}`}
      >
        <div className="h-full rounded-full bg-accent" style={{ width: `${pct}%` }} />
      </div>
      <div className="flex justify-between gap-3 text-xs text-muted">
        <span>
          {partLabel}: <span className="font-medium text-ink">{fmtInt(part)}</span>
        </span>
        <span>
          {restLabel}: <span className="font-medium text-ink">{fmtInt(Math.max(0, whole - part))}</span>
        </span>
      </div>
    </div>
  );
}

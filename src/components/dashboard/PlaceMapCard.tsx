import { BarList } from "@/components/dashboard/BarList";
import { LevelSwitch, RegionMap } from "@/components/dashboard/RegionMap";
import { Card } from "@/components/ui";
import { fmtInt, fmtPercent } from "@/lib/format";
import { PLACE_KIND_LABELS } from "@/lib/geo/localities";
import { countByRegion, regionsOf, topLocalities, unplaced, type Level, type PlaceFact } from "@/lib/metrics/geo";

/**
 * One population (open jobs, candidates) on the map: shaded by region, with the largest regions
 * and localities beside it, and what could not be placed. `extra` adds a second column to the
 * table (e.g. new in the range) without shading the map.
 */
export function PlaceMapCard({
  id,
  title,
  unit,
  level,
  levelHref,
  facts,
  extra,
  regionHref,
  note,
}: {
  id: string;
  title: string;
  /** What is counted, in the plural: "משרות פעילות", "מועמדים". */
  unit: string;
  level: Level;
  levelHref: (level: Level) => string;
  facts: PlaceFact[];
  extra?: { label: string; facts: PlaceFact[] };
  regionHref: (code: number, level: Level) => string;
  note?: string;
}) {
  const counts = countByRegion(facts, level);
  const extraCounts = extra ? countByRegion(extra.facts, level) : null;
  const regions = regionsOf(level).filter((r) => counts.get(r.code) || extraCounts?.get(r.code));
  const placed = facts.filter((f) => f.napa != null).length;
  const missing = unplaced(facts);
  const localities = topLocalities(facts, 8);

  return (
    <Card level={3} title={title}>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted">
          {fmtInt(placed)} מתוך {fmtInt(facts.length)} {unit} משויכים לאזור ({fmtPercent(placed, facts.length)}). לחיצה על אזור פותחת את הרשימה שלו.
        </p>
        <LevelSwitch level={level} hrefFor={levelHref} />
      </div>
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <RegionMap
          id={id}
          level={level}
          caption={`${title} לפי ${level === "district" ? "מחוז" : "נפה"}`}
          values={regionsOf(level).map((r) => ({
            code: r.code,
            name: r.name,
            value: counts.get(r.code) ?? 0,
            title: `${level === "district" ? "מחוז" : "נפת"} ${r.name}: ${fmtInt(counts.get(r.code) ?? 0)} ${unit}`,
          }))}
          href={(code) => regionHref(code, level)}
          table={{
            head: [level === "district" ? "מחוז" : "נפה", unit, "שיעור", ...(extra ? [extra.label] : [])],
            rows: regions.map((r) => ({
              code: r.code,
              cells: [r.name, fmtInt(counts.get(r.code) ?? 0), fmtPercent(counts.get(r.code) ?? 0, placed), ...(extraCounts ? [fmtInt(extraCounts.get(r.code) ?? 0)] : [])],
            })),
          }}
        />
        <div className="flex flex-col gap-6">
          <div>
            <h4 className="mb-3 text-sm font-bold">{level === "district" ? "המחוזות" : "הנפות"} הגדולים</h4>
            <BarList
              caption={`${unit} לפי ${level === "district" ? "מחוז" : "נפה"}`}
              items={[...regions]
                .sort((a, b) => (counts.get(b.code) ?? 0) - (counts.get(a.code) ?? 0))
                .slice(0, 8)
                .map((r) => ({ label: r.name, value: counts.get(r.code) ?? 0 }))}
              showShareOf={placed || undefined}
            />
          </div>
          {localities.length ? (
            <div>
              <h4 className="mb-2 text-sm font-bold">יישובים מובילים</h4>
              <ul className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
                {localities.map((l) => (
                  <li key={l.code}>
                    {l.name} <span className="tabular-nums text-muted">{fmtInt(l.count)}</span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          <div>
            <h4 className="mb-2 text-sm font-bold">בלי אזור</h4>
            <ul className="flex flex-col gap-1 text-sm">
              {(["national", "remote", "unknown"] as const)
                .filter((k) => missing[k])
                .map((k) => (
                  <li key={k}>
                    {PLACE_KIND_LABELS[k]}: <span className="font-bold tabular-nums">{fmtInt(missing[k])}</span>
                  </li>
                ))}
            </ul>
            {note ? <p className="mt-2 text-xs text-muted">{note}</p> : null}
          </div>
        </div>
      </div>
    </Card>
  );
}

/** The record list for a region: `/positions` or `/candidates`, narrowed to it, plus `extra` filters. */
export function regionListHref(base: string, code: number, level: Level, extra: Record<string, string> = {}) {
  const q = new URLSearchParams(extra);
  if (level === "district") q.set("area", String(code));
  else {
    q.set("area", String(Math.floor(code / 10)));
    q.set("napa", String(code));
  }
  return `${base}?${q.toString()}`;
}

/** A dashboard URL with `level` set and the other parameters kept. */
export function withLevel(base: string, search: Record<string, string | string[] | undefined>, level: Level, hash = "") {
  const q = new URLSearchParams(Object.entries(search).flatMap(([k, v]) => (typeof v === "string" && k !== "level" ? [[k, v]] : [])));
  if (level === "district") q.set("level", "district");
  const s = q.toString();
  return `${base}${s ? `?${s}` : ""}${hash}`;
}


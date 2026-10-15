import { sql, type SQL } from "drizzle-orm";
import { districtName, DISTRICTS, districtOf, subdistrictName, SUBDISTRICTS } from "./map";
import { localityByCode, PLACE_KIND_LABELS, type PlaceKind } from "./localities";

/**
 * The place filters shared by the job and candidate lists: `area` is a CBS district (1–7) or a
 * kind of place with no district (nationwide, from home, unknown); `napa` a CBS sub-district.
 * The list's row alias carries `napa` and `place_kind` columns (see geoPlaceSql).
 */

const KIND_VALUES = ["national", "remote", "unknown"] as const;
export const AREA_VALUES = [...DISTRICTS.map((d) => String(d.code)), ...KIND_VALUES] as const;
export const NAPA_VALUES = SUBDISTRICTS.map((s) => String(s.code));

/** Options for the area select; jobs also have nationwide and from-home. */
export function areaOptions(kinds: readonly (typeof KIND_VALUES)[number][]) {
  return [...DISTRICTS.map((d) => ({ value: String(d.code), label: `מחוז ${d.name}` })), ...kinds.map((k) => ({ value: k, label: PLACE_KIND_LABELS[k] }))];
}

/** Sub-district options, narrowed to one district when it is chosen. */
export function napaOptions(area: string) {
  const district = Number(area);
  return SUBDISTRICTS.filter((s) => !district || districtOf(s.code) === district).map((s) => ({
    value: String(s.code),
    label: district ? s.name : `${s.name} (${districtName(districtOf(s.code))})`,
  }));
}

/** WHERE parts for the place filters; `a` is the row alias, written in code. */
export function placeFilterSql(a: string, area: string, napa: string): SQL[] {
  const parts: SQL[] = [];
  const t = sql.raw(a);
  // A sub-district settles the place; the district select may still hold another district.
  if (/^\d{2}$/.test(napa)) return [sql`${t}.napa = ${Number(napa)}`];
  if (/^[1-7]$/.test(area)) parts.push(sql`${t}.napa / 10 = ${Number(area)}`);
  else if (area === "unknown") parts.push(sql`${t}.napa IS NULL AND ${t}.place_kind NOT IN ('national', 'remote')`);
  else if (area === "national" || area === "remote") parts.push(sql`${t}.place_kind = ${area}`);
  return parts;
}

export interface PlaceLabel {
  kind: PlaceKind;
  /** CBS name of the locality, when known. */
  locality: string | null;
  subdistrict: string | null;
  district: string | null;
}

/** Names for a row's place columns (`place_kind`, `napa`, `locality`). */
export function placeLabel(r: Record<string, unknown>): PlaceLabel {
  const napa = r.napa == null ? null : Number(r.napa);
  const kind = (["locality", "national", "remote"] as const).find((k) => k === r.place_kind) ?? "unknown";
  return {
    kind,
    locality: r.locality == null ? null : (localityByCode(Number(r.locality))?.name ?? null),
    subdistrict: napa == null ? null : subdistrictName(napa),
    district: napa == null ? null : districtName(districtOf(napa)),
  };
}

/** "נפת רמת גן · מחוז תל אביב" ("נפת רמת גן" when `short`), or the kind of place when it has no district. */
export function placeText(p: PlaceLabel, short = false): string | null {
  if (p.subdistrict) return short ? `נפת ${p.subdistrict}` : `נפת ${p.subdistrict} · מחוז ${p.district}`;
  return p.kind === "locality" ? null : PLACE_KIND_LABELS[p.kind];
}

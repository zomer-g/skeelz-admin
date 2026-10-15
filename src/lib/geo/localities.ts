import { sql, type SQL } from "drizzle-orm";
import rows from "./localities.json";
import { districtOf } from "./map";

/**
 * Where a job or a candidate is, in CBS terms. Salesforce keeps the CBS locality code
 * (`citySymbol_cambium__c`) on site records, and a city name on most others; the code wins,
 * then the name is matched to the CBS list. Special codes: -1 nationwide (פריסה ארצית),
 * -2 work from home, 0 the site could not tell.
 */

export interface Locality {
  code: number;
  name: string;
  subdistrict: number;
  district: number;
  /** Map position (projection.ts); null for industrial / council areas. */
  x: number | null;
  y: number | null;
  population: number;
}

export const LOCALITIES: Locality[] = (rows as [number, string, number, number | null, number | null, number][]).map(([code, name, subdistrict, x, y, population]) => ({
  code,
  name,
  subdistrict,
  district: districtOf(subdistrict),
  x,
  y,
  population,
}));

const BY_CODE = new Map(LOCALITIES.map((l) => [l.code, l]));
export const localityByCode = (code: number) => BY_CODE.get(code) ?? null;

/**
 * A city name reduced to its Hebrew letters, with doubled vav/yod collapsed, so the spellings in
 * Salesforce meet CBS's: "תל אביב-יפו, ישראל" and "תל אביב -יפו", "פתח תקוה" and "פתח תקווה",
 * "קרית אונו" and "קריית אונו". Mirrored in SQL by `normalizedNameSql`.
 */
export function normalizeCityName(name: string): string {
  return name
    .replace(/,\s*ישראל\s*$/, "")
    .replace(/[^א-ת]/g, "")
    .replace(/וו/g, "ו")
    .replace(/יי/g, "י");
}

/** Common names that are not CBS's name for the place. */
const ALIASES: [name: string, code: number][] = [
  ["תל אביב", 5000],
  ["יפו", 5000],
  ["מודיעין", 1200],
  ["מודיעין מכבים רעות", 1200],
  ["נצרת עילית", 1061],
  ["פרדס חנה", 7800],
  ["כרכור", 7800],
  ["מכבים רעות", 1200],
  ["הרצליה פיתוח", 6400],
  ["יהוד", 9400],
  ["צור יגאל", 1224],
  ["כוכב יאיר צור יגאל", 1224],
  ["יוקנעם עילית", 240],
  ["יוקנעם", 240],
  ["טירת הכרמל", 2100],
  ["א סייד", 1359],
  ["קרית חיים", 4000],
  ["בית אריה", 3652],
  ["גבעת עדה", 9800],
  ["בנימינה", 9800],
  ["סדום", 1775],
  ["ראשלצ", 8300],
  ["פת", 7900],
];

/** Normalized name → code. On a clash the larger place wins (a city over a hamlet of the same name). */
const BY_NAME = new Map<string, number>();
for (const l of [...LOCALITIES].sort((a, b) => a.population - b.population)) BY_NAME.set(normalizeCityName(l.name), l.code);
for (const [name, code] of ALIASES) if (BY_CODE.has(code)) BY_NAME.set(normalizeCityName(name), code);

export type PlaceKind = "locality" | "national" | "remote" | "unknown";

export interface Place {
  kind: PlaceKind;
  locality: Locality | null;
}

const NATIONAL = /פריסה ארצית|כל הארץ/;
const REMOTE = /מהבית|מרחוק|היברידי|remote/i;

/** Resolve a record's place from its CBS code and/or city name. */
export function resolvePlace(code: string | number | null | undefined, name: string | null | undefined): Place {
  const n = Number(code);
  if (n === -1 || (name && NATIONAL.test(name))) return { kind: "national", locality: null };
  if (n === -2 || (name && REMOTE.test(name))) return { kind: "remote", locality: null };
  const byCode = Number.isInteger(n) && n > 0 ? localityByCode(n) : null;
  if (byCode) return { kind: "locality", locality: byCode };
  const byName = name ? BY_NAME.get(normalizeCityName(name)) : undefined;
  const loc = byName != null ? localityByCode(byName) : null;
  return loc ? { kind: "locality", locality: loc } : { kind: "unknown", locality: null };
}

export const PLACE_KIND_LABELS: Record<Exclude<PlaceKind, "locality">, string> = {
  national: "פריסה ארצית",
  remote: "עבודה מהבית",
  unknown: "מיקום לא ידוע",
};

/* ------------------------------------------------------------------ SQL */

const CODE_ROWS = JSON.stringify(LOCALITIES.map((l) => [l.code, l.subdistrict]));
const NAME_ROWS = JSON.stringify([...BY_NAME].map(([k, code]) => [k, code, BY_CODE.get(code)!.subdistrict]));

/**
 * CTEs for `geoPlaceSql`: `geo_code(code, napa)` and `geo_name(k, code, napa)`, built from the
 * locality list passed as one JSON parameter. Put them in the query's WITH list.
 */
export const GEO_CTES = sql`
  geo_code AS (SELECT (r->>0)::int AS code, (r->>1)::int AS napa FROM jsonb_array_elements(${CODE_ROWS}::jsonb) r),
  geo_name AS (SELECT r->>0 AS k, (r->>1)::int AS code, (r->>2)::int AS napa FROM jsonb_array_elements(${NAME_ROWS}::jsonb) r)`;

/** `normalizeCityName` in SQL. */
export function normalizedNameSql(name: SQL) {
  return sql`regexp_replace(regexp_replace(regexp_replace(regexp_replace(${name}, ',\\s*ישראל\\s*$', ''), '[^א-ת]', '', 'g'), 'וו', 'ו', 'g'), 'יי', 'י', 'g')`;
}

/**
 * Joins that place a row: adds `<p>_code.code/napa` and `<p>_name.code/napa`, and returns the
 * columns to select. `code` and `name` are SQL expressions over the row; `p` is an alias prefix
 * written in code.
 */
export function geoPlaceSql(p: string, code: SQL, name: SQL) {
  const gc = sql.raw(`${p}_gc`);
  const gn = sql.raw(`${p}_gn`);
  return {
    joins: sql`
      LEFT JOIN geo_code ${gc} ON ${gc}.code = (CASE WHEN ${code} ~ '^[1-9][0-9]{0,4}$' THEN (${code})::int END)
      LEFT JOIN geo_name ${gn} ON ${gn}.k = ${normalizedNameSql(sql`coalesce(${name}, '')`)}`,
    /** CBS locality code, or null. */
    locality: sql`coalesce(${gc}.code, ${gn}.code)`,
    /** CBS sub-district code, or null. */
    napa: sql`coalesce(${gc}.napa, ${gn}.napa)`,
    /** 'national' | 'remote' | 'locality' | 'unknown', as resolvePlace. */
    kind: sql`CASE WHEN ${code} = '-1' OR coalesce(${name}, '') ~ 'פריסה ארצית|כל הארץ' THEN 'national'
                   WHEN ${code} = '-2' OR coalesce(${name}, '') ~* 'מהבית|מרחוק|היברידי|remote' THEN 'remote'
                   WHEN coalesce(${gc}.code, ${gn}.code) IS NOT NULL THEN 'locality' ELSE 'unknown' END`,
  };
}

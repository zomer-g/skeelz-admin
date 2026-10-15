/**
 * Regenerates src/lib/geo/localities.json from the CBS localities file (קובץ היישובים) on
 * data.gov.il: every locality code (סמל יישוב) with its name, sub-district (נפה), population
 * and its position on the dashboard map. Salesforce keeps the CBS code on jobs and candidates
 * (`citySymbol_cambium__c`), so this is what places them in a district and sub-district.
 *
 *   node --import tsx scripts/build-localities.ts
 *
 * Run it when CBS publishes a newer file (update RESOURCE_ID). The map outlines in
 * src/lib/geo/map.ts use the same projection (`project` below).
 */
import { writeFileSync } from "node:fs";
import { project } from "../src/lib/geo/projection";

/** "קובץ היישובים 2023" in https://data.gov.il/dataset/localities-in-israel */
const RESOURCE_ID = "d47a54ff-87f0-44b3-b33a-f284c0c38e5a";
const OUT = "src/lib/geo/localities.json";

/** Israeli Transverse Mercator (EPSG:2039) → WGS84 degrees. The datum shift (a few tens of metres) is below the map's resolution. */
function itmToLonLat(e: number, n: number): [number, number] {
  const a = 6378137;
  const f = 1 / 298.257222101;
  const k0 = 1.0000067;
  const lat0 = ((31 + 44 / 60 + 3.817 / 3600) * Math.PI) / 180;
  const lon0 = ((35 + 12 / 60 + 16.261 / 3600) * Math.PI) / 180;
  const fe = 219529.584;
  const fn = 626907.39;
  const e2 = 2 * f - f * f;
  const ep2 = e2 / (1 - e2);
  const meridian = (phi: number) =>
    a *
    ((1 - e2 / 4 - (3 * e2 ** 2) / 64 - (5 * e2 ** 3) / 256) * phi -
      ((3 * e2) / 8 + (3 * e2 ** 2) / 32 + (45 * e2 ** 3) / 1024) * Math.sin(2 * phi) +
      ((15 * e2 ** 2) / 256 + (45 * e2 ** 3) / 1024) * Math.sin(4 * phi) -
      ((35 * e2 ** 3) / 3072) * Math.sin(6 * phi));
  const m = meridian(lat0) + (n - fn) / k0;
  const mu = m / (a * (1 - e2 / 4 - (3 * e2 ** 2) / 64 - (5 * e2 ** 3) / 256));
  const e1 = (1 - Math.sqrt(1 - e2)) / (1 + Math.sqrt(1 - e2));
  const phi1 =
    mu +
    ((3 * e1) / 2 - (27 * e1 ** 3) / 32) * Math.sin(2 * mu) +
    ((21 * e1 ** 2) / 16 - (55 * e1 ** 4) / 32) * Math.sin(4 * mu) +
    ((151 * e1 ** 3) / 96) * Math.sin(6 * mu);
  const c1 = ep2 * Math.cos(phi1) ** 2;
  const t1 = Math.tan(phi1) ** 2;
  const n1 = a / Math.sqrt(1 - e2 * Math.sin(phi1) ** 2);
  const r1 = (a * (1 - e2)) / (1 - e2 * Math.sin(phi1) ** 2) ** 1.5;
  const d = (e - fe) / (n1 * k0);
  const lat =
    phi1 -
    ((n1 * Math.tan(phi1)) / r1) *
      (d ** 2 / 2 - ((5 + 3 * t1 + 10 * c1 - 4 * c1 ** 2 - 9 * ep2) * d ** 4) / 24 + ((61 + 90 * t1 + 298 * c1 + 45 * t1 ** 2 - 252 * ep2 - 3 * c1 ** 2) * d ** 6) / 720);
  const lon = lon0 + (d - ((1 + 2 * t1 + c1) * d ** 3) / 6 + ((5 - 2 * c1 + 28 * t1 - 3 * c1 ** 2 + 8 * ep2 + 24 * t1 ** 2) * d ** 5) / 120) / Math.cos(phi1);
  return [(lon * 180) / Math.PI, (lat * 180) / Math.PI];
}

/** CBS writes the ITM point as one number: 6+6 digits in metres, or (older rows) 5+5 digits in tens of metres. */
function parseCoordinates(v: string): [number, number] | null {
  const s = v.trim();
  if (/^\d{12}$/.test(s)) return [Number(s.slice(0, 6)), Number(s.slice(6))];
  if (/^\d{10}$/.test(s)) return [Number(s.slice(0, 5)) * 10, Number(s.slice(5)) * 10];
  return null;
}

async function main() {
  const res = await fetch(`https://data.gov.il/api/3/action/datastore_search?resource_id=${RESOURCE_ID}&limit=5000`, {
    headers: { "user-agent": "skeelz-admin build-localities" },
  });
  if (!res.ok) throw new Error(`data.gov.il ${res.status}`);
  const body = (await res.json()) as { result: { records: Record<string, string | number | null>[] } };
  const rows: [number, string, number, number | null, number | null, number][] = [];
  for (const r of body.result.records) {
    const code = Number(r["סמל יישוב"]);
    const napa = Number(r["סמל נפה"]);
    const name = String(r["שם יישוב"] ?? "").trim();
    if (!code || !napa || !name) continue;
    const popKey = Object.keys(r).find((k) => k.startsWith("סך הכל אוכלוסייה"));
    const pop = Number(popKey ? r[popKey] : 0) || 0;
    // Industrial / regional-council areas (מ"א, של"ש) carry unreliable points: keep their sub-district, not their place on the map.
    const synthetic = /מ"א|של"ש/.test(name);
    const itm = synthetic ? null : parseCoordinates(String(r["קואורדינטות"] ?? ""));
    const xy = itm ? project(...itmToLonLat(...itm)) : null;
    rows.push([code, name, napa, xy ? Math.round(xy[0] * 10) / 10 : null, xy ? Math.round(xy[1] * 10) / 10 : null, pop]);
  }
  rows.sort((p, q) => p[0] - q[0]);
  writeFileSync(OUT, `${JSON.stringify(rows).replace(/\],\[/g, "],\n[")}\n`);
  console.log(`[build-localities] ${rows.length} localities → ${OUT}`);
}

main().catch((err: Error) => {
  console.error("[build-localities] FAILED:", err.message);
  process.exitCode = 1;
});

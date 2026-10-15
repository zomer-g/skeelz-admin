import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { skillGaps, type PlaceFact } from "@/lib/metrics/geo";
import { skillNames } from "@/lib/skills";
import { normalizeCityName, resolvePlace } from "./localities";
import { districtOf, DISTRICT_OUTLINES, SUBDISTRICT_OUTLINES, SUBDISTRICTS } from "./map";

describe("resolvePlace", () => {
  it("prefers the CBS code", () => {
    const p = resolvePlace("8600", "תל אביב");
    assert.equal(p.locality?.name, "רמת גן");
    assert.equal(p.locality?.subdistrict, 52);
  });

  it("matches Salesforce spellings of a city to CBS's", () => {
    assert.equal(resolvePlace(null, "תל אביב-יפו, ישראל").locality?.code, 5000);
    assert.equal(resolvePlace(null, "תל-אביב").locality?.code, 5000);
    assert.equal(resolvePlace(null, "פתח תקוה").locality?.code, 7900);
    assert.equal(resolvePlace(null, "קרית אונו, ישראל").locality?.code, 2620);
    assert.equal(resolvePlace(null, "הרצליה").locality?.code, 6400);
    assert.equal(resolvePlace("0", "מודיעין").locality?.code, 1200);
  });

  it("knows nationwide, from home and unknown", () => {
    assert.equal(resolvePlace("-1", "פריסה ארצית").kind, "national");
    assert.equal(resolvePlace("-2", null).kind, "remote");
    assert.equal(resolvePlace("0", "עיר- חסר/לא זוהתה").kind, "unknown");
    assert.equal(resolvePlace(null, "אודסה, אוקראינה").kind, "unknown");
  });

  it("normalizes the way the SQL does", () => {
    assert.equal(normalizeCityName("קריית   ביאליק"), normalizeCityName("קרית ביאליק, ישראל"));
  });
});

describe("map", () => {
  it("has an outline for every sub-district outside Judea and Samaria", () => {
    const drawn = new Set(SUBDISTRICT_OUTLINES.map((o) => o.code));
    for (const s of SUBDISTRICTS) if (districtOf(s.code) !== 7) assert.ok(drawn.has(s.code), `נפה ${s.code}`);
    assert.equal(DISTRICT_OUTLINES.length, 6);
  });
});

describe("skills", () => {
  it("names the site's ids and drops the duplicate checkbox", () => {
    assert.deepEqual(skillNames("677e68ea063529e50d3e9822,677e68ea063529e50d3e9824", { administration__c: true }), ["עבודה בצוות", "אדמיניסטרציה"]);
  });

  it("keeps an id it does not know, last", () => {
    assert.deepEqual(skillNames("aaaaaaaaaaaaaaaaaaaaaaaa,677e68ea063529e50d3e9820"), ["שיווק ומכירות", "aaaaaaaaaaaaaaaaaaaaaaaa"]);
  });

  it("compares a skill's share of all named skills, not raw counts", () => {
    const fact = (skills: string[]): PlaceFact => ({ kind: "locality", napa: 51, locality: 5000, skills });
    // Candidates name every skill; one job in two asks for שירותיות. It is short relative to the others.
    const jobs = [fact(["שירותיות"]), fact(["אדמיניסטרציה"])];
    const cands = [fact(["אדמיניסטרציה", "עבודה בצוות", "חשיבה יצירתית"]), fact(["אדמיניסטרציה", "שירותיות", "עבודה בצוות"])];
    const gaps = skillGaps(jobs, cands);
    assert.equal(gaps[0].skill, "שירותיות");
    assert.ok((gaps[0].balance ?? 0) < 0);
    assert.equal(gaps.find((g) => g.skill === "עבודה בצוות")?.balance, null);
  });
});

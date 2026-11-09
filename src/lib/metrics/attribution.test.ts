import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { gaMinuteToUtc, matchApplications, type GaApplyRow, type SiteApplication } from "./attribution";

const KEY = "6adf3539ef1875fea1429e7e";
const attrs = { source: "facebook", medium: "paid", campaign: "jobs_nov", channelGroup: "Paid Social", deviceCategory: "mobile" };
const row = (minute: string, over: Partial<GaApplyRow> = {}): GaApplyRow => ({ minute: new Date(minute), key: KEY, type: "guest", count: 1, ...attrs, ...over });
const app = (id: string, createdAt: string, over: Partial<SiteApplication> = {}): SiteApplication => ({ id, key: KEY, type: "guest", createdAt: new Date(createdAt), ...over });

describe("GA minute to UTC", () => {
  it("reads the property's Israel time, summer and winter", () => {
    assert.equal(gaMinuteToUtc("202611091235").toISOString(), "2026-11-09T10:35:00.000Z");
    assert.equal(gaMinuteToUtc("202607011200").toISOString(), "2026-07-01T09:00:00.000Z");
  });
});

describe("matching applications to GA events", () => {
  it("matches the event of the same job, type and minute", () => {
    const [m] = matchApplications([app("a", "2026-11-09T10:35:18Z")], [row("2026-11-09T10:35:00Z")]);
    assert.equal(m?.caseId, "a");
    assert.equal(m?.channelGroup, "Paid Social");
    assert.equal(m?.ambiguous, false);
  });

  it("accepts the next minute, when the event came just after the Case", () => {
    const [m] = matchApplications([app("a", "2026-11-09T10:35:58Z")], [row("2026-11-09T10:36:00Z")]);
    assert.equal(m?.caseId, "a");
  });

  it("ignores another job, another applicant type, or an event too far away", () => {
    const apps = [app("a", "2026-11-09T10:35:18Z")];
    assert.equal(matchApplications(apps, [row("2026-11-09T10:35:00Z", { key: "0".repeat(24) })]).length, 0);
    assert.equal(matchApplications(apps, [row("2026-11-09T10:35:00Z", { type: "registered" })]).length, 0);
    assert.equal(matchApplications(apps, [row("2026-11-09T10:40:00Z")]).length, 0);
  });

  it("uses each event once, and gives it to the nearest application", () => {
    const apps = [app("far", "2026-11-09T10:34:20Z"), app("near", "2026-11-09T10:35:20Z")];
    const out = matchApplications(apps, [row("2026-11-09T10:35:00Z")]);
    assert.deepEqual(out.map((m) => m.caseId), ["near"]);
  });

  it("spreads a minute's count over that many applications", () => {
    const apps = [app("a", "2026-11-09T10:35:10Z"), app("b", "2026-11-09T10:35:40Z")];
    assert.equal(matchApplications(apps, [row("2026-11-09T10:35:00Z", { count: 2 })]).length, 2);
  });

  it("marks a match ambiguous when an event with other attributes was a candidate too", () => {
    const apps = [app("a", "2026-11-09T10:35:20Z"), app("b", "2026-11-09T10:35:40Z")];
    const out = matchApplications(apps, [row("2026-11-09T10:35:00Z"), row("2026-11-09T10:35:00Z", { channelGroup: "Organic Search", source: "google", medium: "organic" })]);
    assert.equal(out.length, 2);
    assert.ok(out.every((m) => m.ambiguous));
  });
});

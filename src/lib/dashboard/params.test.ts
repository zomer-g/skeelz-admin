import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseDashboardParams } from "./params";

const now = new Date("2026-11-16T12:00:00Z");

describe("parseDashboardParams", () => {
  it("dates without a range are a custom range, not the default", () => {
    const p = parseDashboardParams({ from: "2026-10-01", to: "2026-10-31" }, now);
    assert.deepEqual([p.preset, p.fromDay, p.toDay], ["custom", "2026-10-01", "2026-10-31"]);
  });

  it("an explicit range still wins over dates, and no dates keep the fallback", () => {
    assert.equal(parseDashboardParams({ range: "7d", from: "2026-10-01" }, now).preset, "7d");
    assert.equal(parseDashboardParams({}, now).preset, "30d");
    assert.equal(parseDashboardParams({ from: "garbage" }, now).preset, "30d");
  });
});

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { groupRuns, sourceOf, sourcesOfRequest, triggerLabel, type RunRow } from "./sources";

let id = 0;
function run(object: string, start: string, seconds: number, extra: Partial<RunRow> = {}): RunRow {
  const startedAt = new Date(`2026-11-03T${start}Z`);
  return {
    id: ++id,
    object,
    mode: "incremental",
    trigger: "schedule",
    startedAt,
    finishedAt: new Date(startedAt.getTime() + seconds * 1000),
    upserted: 1,
    deleted: 0,
    error: null,
    note: null,
    ...extra,
  };
}

describe("sync sources", () => {
  it("puts each object under its source", () => {
    assert.equal(sourceOf("Case"), "salesforce");
    assert.equal(sourceOf("SMOOV_PUSH"), "smoov");
    assert.equal(sourceOf("GA4"), "ga");
    assert.equal(sourceOf("monday"), "monday");
    assert.deepEqual(sourcesOfRequest("marketing:SMOOV"), ["smoov"]);
    assert.deepEqual(sourcesOfRequest("full"), ["salesforce"]);
  });

  it("makes one log entry of a run's objects, and a new one ten minutes later", () => {
    // Newest first, as the page reads them.
    const rows = [
      run("Contact", "12:10:02", 1),
      run("Account", "12:10:01", 1, { error: "boom" }),
      run("Contact", "12:00:02", 1),
      run("Account", "12:00:01", 1),
    ];
    const groups = groupRuns(rows, 10);
    assert.equal(groups.length, 2);
    assert.deepEqual(groups[0]!.runs.map((r) => r.object), ["Account", "Contact"]);
    assert.deepEqual(groups[0]!.failed, ["Account"]);
    assert.equal(groups[0]!.upserted, 2);
    assert.equal(groups[0]!.startedAt.toISOString(), "2026-11-03T12:10:01.000Z");
  });

  it("keeps sources and triggers apart, and stops at the limit", () => {
    const rows = [
      run("SMOOV_PUSH", "12:07:00", 300, { mode: "marketing", trigger: "manual:a@b.co" }),
      run("SMOOV", "12:06:50", 5, { mode: "marketing", trigger: "manual:a@b.co" }),
      run("GA4", "12:06:00", 40, { mode: "marketing", trigger: "manual:a@b.co" }),
      run("Contact", "12:05:00", 1),
    ];
    const groups = groupRuns(rows, 2);
    assert.deepEqual(groups.map((g) => g.source), ["smoov", "ga"]);
    assert.equal(groups[0]!.runs.length, 2);
    assert.equal(triggerLabel(groups[0]!.trigger), "a@b.co");
    assert.equal(triggerLabel("schedule"), "אוטומטי");
  });

  it("shows a run still going as unfinished", () => {
    const groups = groupRuns([run("Contact", "12:00:02", 0, { finishedAt: null }), run("Account", "12:00:01", 1)], 5);
    assert.equal(groups.length, 1);
    assert.equal(groups[0]!.finishedAt, null);
  });
});

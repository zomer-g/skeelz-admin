import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { ApplicationFacts } from "./candidates";
import { statusSummary, type StatusHistory } from "./statuses";

const app = (id: string, created: string, status: string): ApplicationFacts =>
  ({ id, status, createdAt: new Date(`${created}T10:00:00Z`) }) as unknown as ApplicationFacts;
const change = (at: string, status: string) => ({ at: new Date(`${at}T10:00:00Z`), status });

describe("statusSummary", () => {
  // a: created 1.9 in New, CV sent 10.9, interview 20.9. b: created 15.9 in New, still New. c: created 1.8, CV sent 5.9.
  const facts = [app("a", "2026-09-01", "זומן לראיון"), app("b", "2026-09-15", "New"), app("c", "2026-08-01", 'נשלחו קו"ח')];
  const histories = new Map<string, StatusHistory>([
    ["a", { initial: "New", changes: [change("2026-09-10", 'נשלחו קו"ח'), change("2026-09-20", "זומן לראיון")] }],
    ["c", { initial: "New", changes: [change("2026-09-05", 'נשלחו קו"ח')] }],
  ]);
  const range = { from: new Date("2026-09-08T00:00:00Z"), to: new Date("2026-10-01T00:00:00Z") };
  const get = (rows: ReturnType<typeof statusSummary>, s: string) => rows.find((r) => r.status === s)!;

  it("counts where each application is now, whatever the range", () => {
    const rows = statusSummary(facts, histories, { basis: "event", ...range });
    assert.equal(get(rows, 'נשלחו קו"ח').now, 1);
    assert.equal(get(rows, "New").now, 1);
  });

  it("by event date: moves into the status inside the range", () => {
    const rows = statusSummary(facts, histories, { basis: "event", ...range });
    // a moved to CV sent on 10.9 (in range); c on 5.9 (before it).
    assert.equal(get(rows, 'נשלחו קו"ח').entered, 1);
    // b was created in New inside the range.
    assert.equal(get(rows, "New").entered, 1);
  });

  it("by application date: of those created in the range, where they are and what they passed", () => {
    const rows = statusSummary(facts, histories, { basis: "application", from: new Date("2026-08-25T00:00:00Z"), to: range.to });
    // a and b were created in the range; c was not.
    assert.equal(get(rows, 'נשלחו קו"ח').entered, 1);
    assert.equal(get(rows, 'נשלחו קו"ח').nowOfCohort, 0);
    assert.equal(get(rows, "זומן לראיון").nowOfCohort, 1);
    assert.equal(get(rows, "New").entered, 2);
  });
});

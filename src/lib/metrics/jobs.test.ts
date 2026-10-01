import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ageInDays } from "@/lib/entities/search";
import { filterPositions, type Position } from "./jobs";

const job = (id: string, flags: Partial<Position> = {}, created = "2026-09-01"): Position => ({
  id,
  caseNumber: id,
  title: `job ${id}`,
  company: "Acme",
  createdAt: new Date(`${created}T00:00:00Z`),
  status: null,
  manageStatus: null,
  siteJobKey: null,
  paid: false,
  active: false,
  marked: false,
  updatedAt: null,
  ...flags,
});

// Every combination of the three flags, once.
const JOBS = [
  job("none"),
  job("active", { active: true }),
  job("paid", { paid: true }),
  job("marked", { marked: true }),
  job("active-paid", { active: true, paid: true }),
  job("active-marked", { active: true, marked: true }),
  job("paid-marked", { paid: true, marked: true }),
  job("all", { active: true, paid: true, marked: true }),
];
const ids = (list: Position[]) => list.map((p) => p.id).sort();

describe("filterPositions", () => {
  it("returns everything without filters", () => {
    assert.equal(filterPositions(JOBS, {}).length, 8);
  });

  it("marked_only keeps only marked jobs", () => {
    assert.deepEqual(ids(filterPositions(JOBS, { markedOnly: true })), ["active-marked", "all", "marked", "paid-marked"]);
  });

  it("combines marked with active", () => {
    assert.deepEqual(ids(filterPositions(JOBS, { markedOnly: true, activeOnly: true })), ["active-marked", "all"]);
  });

  it("combines marked with paid", () => {
    assert.deepEqual(ids(filterPositions(JOBS, { markedOnly: true, paidOnly: true })), ["all", "paid-marked"]);
  });

  it("combines all three", () => {
    assert.deepEqual(ids(filterPositions(JOBS, { markedOnly: true, paidOnly: true, activeOnly: true })), ["all"]);
  });

  it("leaves active and paid filtering as before", () => {
    assert.deepEqual(ids(filterPositions(JOBS, { activeOnly: true })), ["active", "active-marked", "active-paid", "all"]);
    assert.deepEqual(ids(filterPositions(JOBS, { paidOnly: true })), ["active-paid", "all", "paid", "paid-marked"]);
  });

  it("applies free text together with the flags", () => {
    assert.deepEqual(ids(filterPositions(JOBS, { q: "paid-marked", markedOnly: true })), ["paid-marked"]);
    assert.deepEqual(ids(filterPositions(JOBS, { q: "active-paid", markedOnly: true })), []);
  });

  it("sorts newest first", () => {
    const list = [job("old", {}, "2026-01-01"), job("new", {}, "2026-09-01"), job("mid", {}, "2026-05-01")];
    assert.deepEqual(
      filterPositions(list, {}).map((p) => p.id),
      ["new", "mid", "old"],
    );
  });
});

describe("ageInDays", () => {
  it("counts calendar days in Israel while open, as Salesforce does", () => {
    // 22:08 Israel time, read the next afternoon: 1 day, though under 24 hours passed.
    assert.equal(ageInDays(new Date("2026-09-30T19:08:09Z"), null, new Date("2026-10-01T13:00:00Z")), 1);
    assert.equal(ageInDays(new Date("2026-09-29T10:39:07Z"), null, new Date("2026-10-01T13:00:00Z")), 2);
  });
  it("uses the Israel date, not UTC", () => {
    // 23:30 UTC on Sep 30 is already Oct 1 in Israel.
    assert.equal(ageInDays(new Date("2026-09-30T23:30:00Z"), null, new Date("2026-10-01T09:00:00Z")), 0);
  });
  it("counts to the closing date once closed", () => {
    assert.equal(ageInDays(new Date("2026-09-01T10:00:00Z"), new Date("2026-09-11T10:00:00Z"), new Date("2027-01-01T00:00:00Z")), 10);
  });
  it("is null without a creation date", () => {
    assert.equal(ageInDays(null, null), null);
  });
});

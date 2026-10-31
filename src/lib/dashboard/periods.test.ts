import assert from "node:assert/strict";
import { test } from "node:test";
import { bucket, periodDays, periodStart } from "./periods";

const days = (from: string, n: number, value = 1) =>
  Array.from({ length: n }, (_, i) => {
    const d = new Date(`${from}T12:00:00Z`);
    d.setUTCDate(d.getUTCDate() + i);
    return { day: d.toISOString().slice(0, 10), value };
  });

test("periodStart: weeks start on Sunday, months and years on their first day", () => {
  assert.equal(periodStart("2026-10-31", "week"), "2026-10-25"); // Saturday → the Sunday before
  assert.equal(periodStart("2026-10-25", "week"), "2026-10-25");
  assert.equal(periodStart("2026-10-31", "month"), "2026-10-01");
  assert.equal(periodStart("2026-10-31", "year"), "2026-01-01");
  assert.equal(periodStart("2026-10-31", "day"), "2026-10-31");
});

test("periodDays: month lengths and leap years", () => {
  assert.equal(periodDays("2028-02-01", "month"), 29);
  assert.equal(periodDays("2026-02-01", "month"), 28);
  assert.equal(periodDays("2026-12-01", "month"), 31);
  assert.equal(periodDays("2028-01-01", "year"), 366);
  assert.equal(periodDays("2100-01-01", "year"), 365);
});

test("bucket: sums by month and flags the partly covered edges", () => {
  // 15.9 – 15.11: half of September, all of October, half of November.
  const b = bucket(days("2026-09-15", 62), "month");
  assert.deepEqual(
    b.map((x) => [x.start, x.value, x.partial]),
    [
      ["2026-09-01", 16, true],
      ["2026-10-01", 31, false],
      ["2026-11-01", 15, true],
    ],
  );
});

test("bucket: by year and by day", () => {
  const y = bucket(days("2025-01-01", 730), "year");
  assert.deepEqual(y.map((x) => [x.label, x.value, x.partial]), [["2025", 365, false], ["2026", 365, false]]);
  const d = bucket(days("2026-10-30", 2, 3), "day");
  assert.deepEqual(d.map((x) => [x.label, x.value, x.partial]), [["30.10.26", 3, false], ["31.10.26", 3, false]]);
});

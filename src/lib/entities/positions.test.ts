import assert from "node:assert/strict";
import { test } from "node:test";
import { positionFilters, positionFilterValues } from "./positions";

test("jobs list defaults to paid jobs live on the site", () => {
  const f = positionFilters({});
  assert.equal(f.status, "Active");
  assert.equal(f.paid, "paid");
  assert.deepEqual(positionFilterValues(f), { q: "", status: "", paid: "", area: "", napa: "", skill: "", from: "", to: "" });
});

test("explicit all lifts each default and stays all in the URL", () => {
  const f = positionFilters({ status: "all", paid: "all" });
  assert.equal(f.status, "");
  assert.equal(f.paid, "");
  const v = positionFilterValues(f);
  assert.equal(v.status, "all");
  assert.equal(v.paid, "all");
  assert.deepEqual(positionFilters(v), f);
});

test("other choices round-trip; unknown values fall back to the defaults", () => {
  const f = positionFilters({ status: "none", paid: "free" });
  assert.deepEqual([f.status, f.paid], ["none", "free"]);
  assert.deepEqual(positionFilters(positionFilterValues(f)), f);
  const g = positionFilters({ status: "bogus", paid: "x" });
  assert.deepEqual([g.status, g.paid], ["Active", "paid"]);
});

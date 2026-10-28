import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { nextValidUntil, RENEW_WINDOW_DAYS, REVIEW_DAYS, reviewState, validUntilOf } from "./reviews";

const DAY = 86_400_000;
const now = new Date("2026-10-28T12:00:00Z");
const inDays = (n: number) => new Date(now.getTime() + n * DAY);

describe("access review periods", () => {
  it("holds for 60 days, the last 10 of them renewable", () => {
    assert.equal(REVIEW_DAYS, 60);
    assert.equal(RENEW_WINDOW_DAYS, 10);
    assert.deepEqual(reviewState(inDays(30), false, now), { state: "valid", daysLeft: 30 });
    assert.deepEqual(reviewState(inDays(10), false, now), { state: "valid", daysLeft: 10 });
    assert.deepEqual(reviewState(inDays(9.5), false, now), { state: "soon", daysLeft: 9 });
    assert.deepEqual(reviewState(inDays(0.2), false, now), { state: "soon", daysLeft: 0 });
    assert.deepEqual(reviewState(inDays(0), false, now), { state: "due", daysLeft: null });
    assert.deepEqual(reviewState(null, false, now), { state: "due", daysLeft: null });
  });

  it("a role change makes it due at once", () => {
    assert.equal(reviewState(inDays(50), true, now).state, "due");
  });

  it("an early renewal adds 60 days to the period, so nothing is lost", () => {
    assert.equal(nextValidUntil({ validUntil: inDays(4), state: "soon" }, now).getTime(), inDays(64).getTime());
    assert.equal(nextValidUntil({ validUntil: inDays(-3), state: "due" }, now).getTime(), inDays(60).getTime());
    assert.equal(nextValidUntil({ validUntil: null, state: "due" }, now).getTime(), inDays(60).getTime());
  });

  it("rows from before valid_until hold 60 days from when they were made", () => {
    assert.equal(validUntilOf({ reviewedAt: now, validUntil: null }).getTime(), inDays(60).getTime());
    assert.equal(validUntilOf({ reviewedAt: now, validUntil: inDays(5) }).getTime(), inDays(5).getTime());
  });
});

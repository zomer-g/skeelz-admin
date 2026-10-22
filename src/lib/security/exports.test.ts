import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { crossesAlert, EXPORT_LIMITS, exportAllowance } from "./exports";

describe("export budget", () => {
  it("hands over everything while the day's budget covers it", () => {
    assert.deepEqual(exportAllowance({ exported: 0, allowed: EXPORT_LIMITS.daily }, 5_000), { take: 5_000, limited: false });
    assert.deepEqual(exportAllowance({ exported: 4_000, allowed: 10_000 }, 6_000), { take: 6_000, limited: false });
  });

  it("cuts a request to what is left, then refuses", () => {
    assert.deepEqual(exportAllowance({ exported: 8_000, allowed: 10_000 }, 5_000), { take: 2_000, limited: true });
    assert.deepEqual(exportAllowance({ exported: 10_000, allowed: 10_000 }, 50), { take: 0, limited: true });
    // Over the limit (parallel requests, or a grant that was later counted): never negative.
    assert.deepEqual(exportAllowance({ exported: 10_200, allowed: 10_000 }, 50), { take: 0, limited: true });
  });

  it("an admin's grant raises what is allowed", () => {
    assert.deepEqual(exportAllowance({ exported: 10_000, allowed: 10_000 + EXPORT_LIMITS.grant }, 50), { take: 50, limited: false });
  });

  it("alerts once, when the threshold is crossed", () => {
    assert.equal(crossesAlert(0, 4_999), false);
    assert.equal(crossesAlert(0, 5_000), true);
    assert.equal(crossesAlert(4_990, 20), true);
    // Already past it: the alert was raised by the request that crossed.
    assert.equal(crossesAlert(5_000, 50), false);
    assert.equal(crossesAlert(7_000, 50), false);
  });
});

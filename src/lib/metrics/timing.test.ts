import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { ApplicationFacts } from "./candidates";
import { daysTo, eventTiming, forecast, quantile, TIMING_EVENTS, WEEKS } from "./timing";

const DAY = 86_400_000;
const now = new Date("2026-10-29T12:00:00Z");
const app = (createdDaysAgo: number, sentAfter: number | null, acceptedAfter: number | null) => {
  const createdAt = new Date(now.getTime() - createdDaysAgo * DAY);
  const after = (d: number | null) => (d === null ? null : new Date(createdAt.getTime() + d * DAY));
  return { createdAt, sentAt: after(sentAfter), acceptedAt: after(acceptedAfter) } as unknown as ApplicationFacts;
};
const [SENT, ACCEPTED] = TIMING_EVENTS;

describe("timing", () => {
  it("quantiles interpolate", () => {
    assert.equal(quantile([], 0.5), null);
    assert.equal(quantile([1, 2, 3, 4], 0.5), 2.5);
    assert.equal(quantile([0, 10], 0.9), 9);
  });

  it("counts days to the milestone only for those that reached it, never negative", () => {
    assert.deepEqual(daysTo([app(100, 2, null), app(100, null, null), app(100, -1, null)], SENT.at), [2, 0]);
  });

  it("bins by week, the last bin open, with mean / median / p90", () => {
    const t = eventTiming([app(200, 0.5, 10), app(200, 6.9, 20), app(200, 7, 30), app(200, 100, null), app(200, null, null)], SENT);
    assert.equal(t.applications, 5);
    assert.equal(t.reached, 4);
    assert.deepEqual(
      t.bins.map((b) => b.count),
      [2, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1],
    );
    assert.equal(t.bins.length, WEEKS + 1);
    assert.equal(t.medianDays, 6.95);
    assert.equal(Math.round(t.meanDays! * 100) / 100, 28.6);
  });

  it("forecasts from mature applications only, spread over the weeks of the histogram", () => {
    // 10 old applications, 2 hired at week 2 and week 5; 10 recent ones with no hire yet.
    const old = Array.from({ length: 10 }, (_, i) => app(200, 1, i === 0 ? 10 : i === 1 ? 30 : null));
    const recent = Array.from({ length: 10 }, () => app(3, 1, null));
    const facts = [...old, ...recent];
    const t = eventTiming(facts, ACCEPTED);
    const f = forecast(facts, t, 300, now, ACCEPTED);
    assert.equal(f.basis, 10);
    assert.equal(f.rate, 0.2);
    assert.equal(f.expected, 60);
    assert.equal(f.byWeek[1], 30); // half by the end of week 2
    assert.equal(f.byWeek[4], 60);
    assert.equal(f.halfByWeek, 2);
    assert.equal(f.mostByWeek, 5);
  });
});

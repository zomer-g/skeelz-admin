import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ArgError } from "./args";
import { GA_REPORTS, runGaReport, type GaQuery } from "./ga";

// Each case is refused while the query is being built, before any database call.
const base: GaQuery = { report: "channels", fromDay: "2026-09-01", toDay: "2026-09-30", groupBy: [], filters: {}, limit: 10 };
const refuses = (q: Partial<GaQuery>) => assert.rejects(runGaReport({ ...base, ...q }), ArgError);

describe("runGaReport whitelists", () => {
  it("refuses an unknown report", () => refuses({ report: "users; DROP TABLE users" }));
  it("refuses a dimension the report does not have", () => refuses({ report: "channels", groupBy: ["event_name"] }));
  it("refuses a column name that is not a dimension", () => refuses({ groupBy: ["sessions"] }));
  it("refuses an injected group", () => refuses({ groupBy: ["channel_group) FROM users --"] }));
  it("refuses two time grains", () => refuses({ groupBy: ["date", "month"] }));
  it("refuses a filter on a dimension the report does not have", () => refuses({ filters: { event_name: "open_job_page" } }));
  it("refuses an order_by that is neither a metric nor a grouped dimension", () => refuses({ groupBy: ["source"], orderBy: "1; DROP TABLE users" }));
  it("every report has metrics and dimensions", () => {
    for (const [name, def] of Object.entries(GA_REPORTS)) {
      assert.ok(Object.keys(def.metrics).length, name);
      assert.ok(Object.keys(def.dims).length, name);
    }
  });
});

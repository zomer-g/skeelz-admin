import assert from "node:assert/strict";
import { test } from "node:test";
import { redactAuditEntry, redactTarget } from "./tools";

test("an activity-log entry over MCP loses people: details, query and addresses", () => {
  const e = redactAuditEntry({
    id: 1,
    at: new Date(0),
    actor: "staff@skeelz.co.il",
    action: "cvs.text_search",
    target: "מהנדס",
    details: { via: "mcp", results: 3, files: [{ name: "דנה", email: "d@x.com" }], filters: { q: "דנה" }, shown: { files: [] } },
  });
  assert.deepEqual(e.details, { via: "mcp", results: 3 });
  assert.equal(redactTarget("/candidates?q=%D7%93%D7%A0%D7%94"), "/candidates");
  assert.equal(redactTarget("/emails/dana%40example.com?tab=cases"), "/emails/[email]");
  assert.equal(redactTarget("dana@example.com"), "[email]");
  assert.equal(redactTarget("/positions/5001x00000AbCdE"), "/positions/5001x00000AbCdE");
});

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

/**
 * A tripwire: every hand-over of personal data (a candidate file, contact details copied in bulk,
 * the payments download, people over MCP) writes its counted entry with writeAuditStrict — so
 * nothing goes out unlogged when the log is unavailable — and runs under the person's lock, so
 * parallel requests cannot spend the same daily allowance twice. (The API is pinned in people.test.ts.)
 */
const root = join(__dirname, "..", "..");
const read = (...p: string[]) => readFileSync(join(root, ...p), "utf8");

describe("hand-overs of personal data are logged strictly and serialised", () => {
  it("a candidate file is served only after its strict entry, under the files lock", () => {
    const code = read("lib", "entities", "serve-file.ts");
    assert.match(code, /withUserLock\("files", userEmail,/);
    assert.match(code, /await writeAuditStrict\(userEmail, FILE_OPENED/);
    assert.doesNotMatch(code, /writeAudit\(userEmail, FILE_OPENED/);
  });

  for (const route of ["candidates", "cvs", "emails"]) {
    it(`/api/${route}/contacts counts under the export lock, strictly`, () => {
      const code = read("app", "api", route, "contacts", "route.ts");
      assert.match(code, /return guardedExport\(user\.email,/);
      assert.match(code, /await writeAuditStrict\(user\.email, "[a-z]+\.contacts_copied"/);
    });
  }

  it("the payments download counts under the export lock, strictly", () => {
    const code = read("app", "api", "lists", "[list]", "export", "route.ts");
    assert.match(code, /spec\.people \? guardedExport\(user\.email, run\)/);
    assert.match(code, /await writeAuditStrict\(user\.email, PAYMENTS_EXPORTED/);
  });

  it("an MCP tool that returns people runs under the export lock and logs the records, strictly", () => {
    const code = read("lib", "mcp", "server.ts");
    assert.match(code, /withUserLock\("exports", actor, \(\) => runCountingPeople/);
    assert.match(code, /await writeAuditStrict\(actor, MCP_PEOPLE_LISTED, tool\.name, \{ grantId: ctx\.principal\.grantId, count, ids/);
    assert.match(code, /await writeAuditStrict\(actor, "mcp\.call"/);
  });
});

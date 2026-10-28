import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

/** Every .ts file under a directory. */
function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sources(path);
    return /\.tsx?$/.test(name) && !name.endsWith(".test.ts") ? [path] : [];
  });
}

describe("people's details leave the API only behind people:read", () => {
  // A tripwire: names, emails and phones go out only through lib/api/records.ts with `access.people`,
  // which lib/api/people.ts sets after checking the scope, the issuer and the daily export budget.
  const root = join(__dirname, "..", "..");
  const PERSONAL = /candidateName|candidateEmail|candidatePhone|CandidateRow|ApplicationRow/;

  it("the gate refuses env keys and counts every answer under the issuer", () => {
    const gate = readFileSync(join(root, "lib", "api", "people.ts"), "utf8");
    assert.match(gate, /if \(key\.legacy \|\| !key\.createdBy \|\| !key\.scopes\.some/);
    assert.match(gate, /row\?\.active && row\.role === "admin"/);
    assert.match(gate, /writeAudit\(access\.actor, API_PEOPLE_LISTED/);
  });

  it("every route that shapes records passes the gate's answer, and counts it", () => {
    const routes = sources(join(root, "app", "api")).filter((f) => /applicationJson\(|candidateJson\(/.test(readFileSync(f, "utf8")));
    assert.ok(routes.length >= 3);
    for (const f of routes) {
      const code = readFileSync(f, "utf8");
      assert.match(code, /await peopleAccess\(key,/, f);
      assert.match(code, /await countPeople\(access,/, f);
      for (const call of code.matchAll(/(?:applicationJson|candidateJson)\([^)]*\)/g)) assert.match(call[0], /, access\.people\)$/, `${f}: ${call[0]}`);
    }
  });

  it("only records.ts in lib/api reads people's details; webhooks and aggregates never do", () => {
    const hits = sources(join(root, "lib", "api")).filter((f) => !f.endsWith("records.ts") && !f.endsWith("staff.ts") && PERSONAL.test(readFileSync(f, "utf8")));
    assert.deepEqual(hits, []);
  });
});

import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import { categoriesOf, effectiveStaffManager, roleAfter, roleFor } from "./permissions";

describe("permission categories", () => {
  it("edit and admin boxes map onto the role; admin includes editing", () => {
    assert.equal(roleFor({ edit: false, admin: false }), "viewer");
    assert.equal(roleFor({ edit: true, admin: false }), "editor");
    assert.equal(roleFor({ edit: false, admin: true }), "admin");
    assert.deepEqual(categoriesOf("admin", false), { edit: true, admin: true, staff: false });
    assert.deepEqual(categoriesOf("viewer", true), { edit: false, admin: false, staff: true });
  });

  it("one box at a time: unticking admin goes down to viewer, edit stays while admin is on", () => {
    assert.equal(roleAfter("viewer", "edit", true), "editor");
    assert.equal(roleAfter("editor", "edit", false), "viewer");
    assert.equal(roleAfter("editor", "admin", true), "admin");
    assert.equal(roleAfter("admin", "admin", false), "viewer");
    assert.equal(roleAfter("admin", "edit", false), "admin");
  });

  it("staff manager is never implied by admin, and never survives a preview", () => {
    assert.equal(effectiveStaffManager({ stored: false, envAdmin: false, previewing: false }), false);
    assert.equal(effectiveStaffManager({ stored: true, envAdmin: false, previewing: false }), true);
    assert.equal(effectiveStaffManager({ stored: false, envAdmin: true, previewing: false }), true);
    assert.equal(effectiveStaffManager({ stored: true, envAdmin: true, previewing: true }), false);
    // An admin role alone gives nothing here: the role is not an input at all.
    assert.equal(effectiveStaffManager.length, 1);
  });
});

/** Every .ts/.tsx file under a directory. */
function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sources(path);
    return /\.tsx?$/.test(name) && !name.endsWith(".test.ts") ? [path] : [];
  });
}

describe("staff data stays off MCP and the API", () => {
  // A tripwire: the MCP server and the API routes must never read the staff-manager flag or the
  // staff screens' data. Adding staff data there is a decision for docs/staff.md, not an accident.
  const root = join(__dirname, "..", "..");
  const dirs = [join(root, "lib", "mcp"), join(root, "lib", "api"), join(root, "app", "mcp"), join(root, "app", "api")];
  const FORBIDDEN = /staffManager|staff_manager|requireStaffManager|pageAuthStaff|app\/\(app\)\/staff/;

  it("no MCP or API module refers to staff data", () => {
    const hits = dirs.flatMap(sources).filter((f) => FORBIDDEN.test(readFileSync(f, "utf8")));
    assert.deepEqual(hits, []);
  });
});

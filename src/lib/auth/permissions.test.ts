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

describe("staff data reaches the API and MCP only behind their gates", () => {
  // A tripwire. Of the API code only lib/api/staff.ts (the gate: the key's issuer is a staff manager
  // now) and the routes under app/api/v1/staff may read staff data; of the MCP code only oauth.ts
  // (its gate, McpPrincipal.staffData) and staff-tools.ts, whose every tool is `staff: true`.
  // Anything else is a decision for docs/staff.md.
  const root = join(__dirname, "..", "..");
  const apiDirs = [join(root, "lib", "api"), join(root, "app", "api")];
  const mcpDirs = [join(root, "lib", "mcp"), join(root, "app", "mcp")];
  const MCP_ALLOWED = [join(root, "lib", "mcp", "oauth.ts"), join(root, "lib", "mcp", "staff-tools.ts")];
  const API_ALLOWED = [join(root, "lib", "api", "staff.ts"), ...sources(join(root, "app", "api", "v1", "staff"))];
  const FORBIDDEN =
    /staffManager|staff_manager|requireStaffManager|pageAuthStaff|app\/\(app\)\/staff|@\/lib\/staff|staffWorkItems|staff_work_items|staffSourceState|mondayUserId|monday_user_id/;

  it("of the API code, only the staff gate and the staff routes refer to staff data", () => {
    const hits = apiDirs.flatMap(sources).filter((f) => !API_ALLOWED.includes(f) && FORBIDDEN.test(readFileSync(f, "utf8")));
    assert.deepEqual(hits, []);
  });

  it("the API's staff scope needs an issuer who is a staff manager now, never an env key", () => {
    const gate = readFileSync(join(root, "lib", "api", "staff.ts"), "utf8");
    assert.match(gate, /if \(key\.legacy \|\| !key\.createdBy\) return false;/);
    assert.match(gate, /effectiveStaffManager\(\{ stored: row\?\.staffManager \?\? false, envAdmin, previewing: false \}\)/);
    const inbound = readFileSync(join(root, "lib", "api", "inbound.ts"), "utf8");
    assert.match(inbound, /if \(auth === "staff:read" && !\(await staffKeyAllowed\(key\)\)\)/);
    for (const f of sources(join(root, "app", "api", "v1", "staff"))) assert.match(readFileSync(f, "utf8"), /withApiKey\("[^"]+", "staff:read"/);
    const issue = readFileSync(join(root, "app", "(app)", "admin", "api", "actions.ts"), "utf8");
    assert.match(issue, /STAFF_SCOPES\.includes\(sc\)\) && !admin\.staffManager/);
  });

  it("of the MCP code, only the gate and the staff tools refer to staff data", () => {
    const hits = mcpDirs.flatMap(sources).filter((f) => !MCP_ALLOWED.includes(f) && FORBIDDEN.test(readFileSync(f, "utf8")));
    assert.deepEqual(hits, []);
  });

  it("the gate needs both the connection's switch and a staff manager right now", () => {
    const oauth = readFileSync(join(root, "lib", "mcp", "oauth.ts"), "utf8");
    assert.match(oauth, /staffData: row\.grant\.staffData && person\.staffManager/);
    assert.match(oauth, /effectiveStaffManager\(\{ stored: row\.staffManager, envAdmin, previewing: false \}\)/);
  });

  it("every staff tool is marked staff, and the registry hides and refuses them without the gate", () => {
    const tools = readFileSync(join(root, "lib", "mcp", "staff-tools.ts"), "utf8");
    const names = [...tools.matchAll(/name: "([a-z_]+)"/g)].map((m) => m[1]);
    assert.ok(names.length > 0);
    assert.equal([...tools.matchAll(/staff: true,/g)].length, names.length);
    const registry = readFileSync(join(root, "lib", "mcp", "tools.ts"), "utf8");
    assert.match(registry, /hasRole\(role, t\.minRole\) && \(!t\.staff \|\| staffData\)/);
    assert.match(registry, /if \(tool\.staff && !staffData\) return \{ ok: false, reason: "unknown" \}/);
    const server = readFileSync(join(root, "lib", "mcp", "server.ts"), "utf8");
    assert.match(server, /toolsFor\(ctx\.principal\.role, ctx\.principal\.staffData\)/);
    assert.match(server, /findTool\(name, principal\.role, principal\.staffData\)/);
  });

  it("the dashboard's shared modules (which MCP reads too) never load the staff hours", () => {
    const shared = ["metrics", "entities", "dashboard"].map((d) => join(root, "lib", d));
    const hits = shared.flatMap(sources).filter((f) => /@\/lib\/staff|staffWorkItems|staff_work_items|staffSourceState/.test(readFileSync(f, "utf8")));
    assert.deepEqual(hits, []);
  });
});

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { findTool, TOOL_CATALOGUE, toolsFor } from "./tools";

describe("cv_text: the text of candidate files only where the connection turned it on", () => {
  it("is hidden from tools/list without the switch, for every role", () => {
    for (const role of ["viewer", "editor", "admin"] as const) {
      assert.ok(!toolsFor(role).some((t) => t.name === "cv_text"));
      assert.ok(!toolsFor(role, { staffData: true }).some((t) => t.name === "cv_text"));
      assert.ok(toolsFor(role, { cvText: true }).some((t) => t.name === "cv_text"));
    }
  });

  it("is refused as unknown, not forbidden, without the switch", () => {
    assert.deepEqual(findTool("cv_text", "admin"), { ok: false, reason: "unknown" });
    assert.equal(findTool("cv_text", "viewer", { cvText: true }).ok, true);
  });

  it("counts as handing over a person, and is the only tool that reads files", () => {
    const tool = toolsFor("viewer", { cvText: true }).find((t) => t.name === "cv_text")!;
    assert.equal(tool.people?.({ text: "x" }), 1);
    assert.equal(tool.people?.("Daily file limit reached"), 0);
    assert.deepEqual(
      toolsFor("admin", { cvText: true, staffData: true }).filter((t) => t.cvText).map((t) => t.name),
      ["cv_text"],
    );
    assert.equal(TOOL_CATALOGUE.find((t) => t.name === "cv_text")?.cvText, true);
  });

  it("the switch does not open the staff tools, nor the staff switch cv_text", () => {
    assert.equal(findTool("staff_monthly", "admin", { cvText: true }).ok, false);
    assert.equal(findTool("cv_text", "admin", { staffData: true }).ok, false);
  });
});

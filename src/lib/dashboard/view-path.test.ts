import assert from "node:assert/strict";
import { test } from "node:test";
import { viewPath } from "./params";

test("the logged path keeps every value of a repeated key", () => {
  // The page searches the first q; the log must not drop it.
  assert.equal(viewPath("/candidates", { q: ["כהן", "x"], page: "2" }, ["q", "page"]), "/candidates?q=%D7%9B%D7%94%D7%9F&q=x&page=2");
  assert.equal(viewPath("/outreach/1", { topic: ["law", "social"], other: "z" }, ["topic"]), "/outreach/1?topic=law&topic=social");
  assert.equal(viewPath("/x", { q: "" }, ["q"]), "/x");
});

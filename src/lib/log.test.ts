import assert from "node:assert/strict";
import { test } from "node:test";
import { redactForConsole } from "./log";

test("database and Salesforce errors print as their code only", () => {
  const db = Object.assign(new Error('Failed query: select * from contacts where email = $1\nparams: dana@example.com'), {});
  assert.doesNotMatch(String(redactForConsole(db)), /dana/);
  const pg = Object.assign(new Error("duplicate key value: Key (email)=(dana@example.com)"), { code: "23505", severity: "ERROR" });
  assert.equal(redactForConsole(pg), "[error redacted: sqlstate 23505]");
  const wrapped = Object.assign(new Error("render failed"), { cause: pg, digest: "123" });
  assert.equal(redactForConsole(wrapped), "[error redacted: sqlstate 23505 digest 123]");
  class SalesforceError extends Error {
    name = "SalesforceError";
  }
  assert.match(String(redactForConsole(new SalesforceError("MALFORMED_QUERY: WHERE Email = 'dana@example.com'"))), /^\[error redacted: .*\(Salesforce\)\]$/);
  const plain = new Error("ordinary");
  assert.equal(redactForConsole(plain), plain);
  assert.equal(redactForConsole("text"), "text");
});

import assert from "node:assert/strict";
import { test } from "node:test";
import { countNewRows, recordIds } from "./audit-ids";

test("collects Salesforce ids and emails at id/email keys, once each", () => {
  const r = recordIds({
    people: [
      { contact_id: "0031x00000AbCdE", name: "דנה", email: "Dana@Example.com", phone: "0501234567" },
      { id: "5001x00000XyZwQAAA", candidate: { contact_id: "0031x00000AbCdE", email: "dana@example.com" } },
    ],
    owner_id: "0051x00000OwNeR",
    title: "0031x00000AbCdE",
  });
  assert.deepEqual(r.ids.sort(), ["0031x00000AbCdE", "5001x00000XyZwQAAA", "dana@example.com"].sort());
  assert.equal(r.more, false);
});

test("reads camelCase keys of the screens' rows, not words ending in id", () => {
  const r = recordIds([{ contactId: "0031x00000AbCdE", candidateEmail: "a@b.co", paid: "0031x00000ZzZzZ", documentId: "0691x00000DoCuM" }]);
  assert.deepEqual(r.ids.sort(), ["0031x00000AbCdE", "0691x00000DoCuM", "a@b.co"].sort());
});

test("caps the list and says so", () => {
  const rows = Array.from({ length: 10 }, (_, i) => ({ id: `0031x00000AbC${String(i).padStart(2, "0")}` }));
  const r = recordIds({ rows }, 4);
  assert.equal(r.ids.length, 4);
  assert.equal(r.more, true);
});

test("ignores names, phones and words that only look like ids", () => {
  assert.deepEqual(recordIds({ id: "abcdefghijklmno", name: "x@y", phone: "0501234567" }).ids, []);
});

test("a screen counts each person once a day", () => {
  const seen = new Set(["0031x00000AbCdE"]);
  const rows = [
    { contactId: "0031x00000AbCdE", id: "5001x00000AaAaAAAA" }, // shown earlier today
    { contactId: "0031x00000BbBbB", id: "5001x00000BbBbBAAA" },
    { contactId: "0031x00000BbBbB", id: "5001x00000CcCcCAAA" }, // same person, second application
    { email: "New@Example.com" },
    { title: "no ids" },
  ];
  assert.equal(countNewRows(rows, seen), 2);
  assert.equal(countNewRows([], seen), 0);
});

import assert from "node:assert/strict";
import { test } from "node:test";
import { rejectReasonLabel, rejectReasonLabels, rejectReasonValues } from "./reject-reasons";

test("stored values show as Salesforce's labels, each once, in order", () => {
  assert.deepEqual(rejectReasonLabels("תנאי סף ניסיון;תנאי סף הכשרה/השכלה"), ["ניסיון", "הכשרה/השכלה"]);
  assert.deepEqual(rejectReasonLabels("הבין את המשר וויתר"), ["הסיר/ה מועמדות לאחר שיחה"]);
  assert.deepEqual(rejectReasonLabels("שכר;שכר"), ["שכר"]);
});

test("spacing is folded, and a value no longer in the picklist is shown as stored", () => {
  assert.equal(rejectReasonLabel("לא עבר /ה  ראיון שלנו"), "לא עבר/ה ראיון שלנו");
  assert.equal(rejectReasonLabel("גילאי "), "גיל");
  assert.equal(rejectReasonLabel("דתיות"), "דתיות");
});

test("nothing recorded is no reasons", () => {
  assert.deepEqual(rejectReasonLabels(null), []);
  assert.deepEqual(rejectReasonLabels(""), []);
  assert.deepEqual(rejectReasonLabels(" ; "), []);
});

test("a label filters by every stored value behind it", () => {
  assert.deepEqual(rejectReasonValues("ניסיון"), ["תנאי סף ניסיון", "ניסיון"]);
  assert.deepEqual(rejectReasonValues("דתיות"), ["דתיות"]);
  // Every label maps back to its own value.
  for (const label of ["גיל", "תקלה טכנית", "לא בר/ת השמה", "גיאוגרפי 2"]) {
    assert.ok(rejectReasonValues(label).some((v) => rejectReasonLabel(v) === label));
  }
});

import assert from "node:assert/strict";
import { test } from "node:test";
import { rejectReasonLabel, rejectReasonLabels, rejectReasonValues, setRejectReasonDescribe } from "./reject-reasons";

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
  for (const label of ["גיל", "תקלה טכנית", "לא בר/ת השמה", "גיאוגרפי"]) {
    assert.ok(rejectReasonValues(label).some((v) => rejectReasonLabel(v) === label));
  }
});

test("the old גיאוגרפי and its replacement גיאוגרפי 2 are one reason", () => {
  assert.equal(rejectReasonLabel("גיאוגרפי 2"), "גיאוגרפי");
  assert.equal(rejectReasonLabel("גיאוגרפי"), "גיאוגרפי");
  assert.deepEqual(rejectReasonLabels("גיאוגרפי;גיאוגרפי 2;שכר"), ["גיאוגרפי", "שכר"]);
  assert.deepEqual(rejectReasonValues("גיאוגרפי").sort(), ["גיאוגרפי", "גיאוגרפי 2"].sort());
});

test("labels come from the Case describe once it is loaded, over the built-in ones", () => {
  try {
    setRejectReasonDescribe({ "שכר": "שכר נמוך", "ערך חדש": "תווית  חדשה", "גיאוגרפי 2": "גיאוגרפי 2" });
    assert.equal(rejectReasonLabel("שכר"), "שכר נמוך");
    assert.equal(rejectReasonLabel("ערך חדש"), "תווית חדשה");
    assert.equal(rejectReasonLabel("גילאי"), "גיל"); // not in this describe: the built-in label
    assert.equal(rejectReasonLabel("גיאוגרפי 2"), "גיאוגרפי");
    assert.deepEqual(rejectReasonValues("שכר נמוך"), ["שכר", "שכר נמוך"]);
  } finally {
    setRejectReasonDescribe({});
  }
});

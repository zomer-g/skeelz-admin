import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { contactHash, isPlausibleEmail, redactSmoovError, resolveFieldKeys, smoovCellPhone, smoovDate, toBulkContact, type PushCandidate } from "./push-payload";

const FIELDS = [
  { key: "email", label: "אימייל", custom: false },
  { key: "i49", label: "מקום מגורים", custom: true },
  { key: "i65", label: "עיר", custom: true },
  { key: "i66", label: "נפה", custom: true },
  { key: "i67", label: "מחוז", custom: true },
  { key: "i68", label: "CV", custom: true },
  { key: "i69", label: "תאריך יצירה", custom: true },
];
const KEYS = { city: "i65", subdistrict: "i66", district: "i67", cv: "i68", createdAt: "i69" };

const base: PushCandidate = {
  email: "dana@example.com",
  name: "דנה כהן לוי",
  firstName: null,
  lastName: null,
  phone: " 050-1234567 ",
  city: "רמת גן",
  subdistrict: "רמת גן",
  district: "תל אביב",
  hasCv: true,
  createdAt: new Date("2026-03-01T22:30:00Z"),
};

describe("SMOOV push payload", () => {
  it("finds the custom fields by label, leaving מקום מגורים alone", () => {
    assert.deepEqual(resolveFieldKeys(FIELDS), KEYS);
  });

  it("refuses when a field is missing or doubled", () => {
    assert.throws(() => resolveFieldKeys(FIELDS.filter((f) => f.key !== "i66")), /נפה \(0 found\)/);
    assert.throws(() => resolveFieldKeys([...FIELDS, { key: "i70", label: "CV", custom: true }]), /CV \(2 found\)/);
  });

  it("writes dates the way SMOOV reads them, in Israel time", () => {
    assert.equal(smoovDate(new Date("2026-03-01T22:30:00Z")), "02/03/2026 00:30");
  });

  it("maps a candidate, splitting the full name when there are no name fields", () => {
    assert.deepEqual(toBulkContact(base, KEYS), {
      email: "dana@example.com",
      firstName: "דנה",
      lastName: "כהן לוי",
      cellPhone: "972501234567",
      customFields: { i65: "רמת גן", i66: "רמת גן", i67: "תל אביב", i68: true, i69: "02/03/2026 00:30" },
    });
  });

  it("prefers the Contact's own name fields and leaves unknown places out", () => {
    const c = toBulkContact({ ...base, firstName: "Dana", lastName: "Cohen", phone: null, subdistrict: null, district: null, hasCv: false }, KEYS);
    assert.equal(c.firstName, "Dana");
    assert.equal(c.lastName, "Cohen");
    assert.equal(c.cellPhone, undefined);
    assert.deepEqual(c.customFields, { i68: false, i65: "רמת גן", i69: "02/03/2026 00:30" });
  });

  it("changes the hash only when something sent changes", () => {
    const a = toBulkContact(base, KEYS);
    assert.equal(contactHash(a), contactHash(toBulkContact({ ...base }, KEYS)));
    assert.notEqual(contactHash(a), contactHash(toBulkContact({ ...base, hasCv: false }, KEYS)));
  });

  it("writes mobiles the way SMOOV's examples do, and leaves out anything else", () => {
    assert.equal(smoovCellPhone("050-1234567"), "972501234567");
    assert.equal(smoovCellPhone("+972 50 123 4567"), "972501234567");
    assert.equal(smoovCellPhone("00972501234567"), "972501234567");
    assert.equal(smoovCellPhone("501234567"), "972501234567");
    assert.equal(smoovCellPhone("03-1234567"), null);
    assert.equal(smoovCellPhone("050-1234567 / 052-7654321"), null);
    assert.equal(smoovCellPhone("אין"), null);
    assert.equal(smoovCellPhone(null), null);
  });

  it("masks addresses and phone numbers in SMOOV's errors, keeping the reason", () => {
    assert.equal(
      redactSmoovError('SMOOV 400: {"contacts[3].email":"dana@example.com is invalid","cellPhone":"050-1234567","customFields[i69]":"bad date"}'),
      'SMOOV 400: {"contacts[3].email":"<email> is invalid","cellPhone":"<digits>","customFields[i69]":"bad date"}',
    );
  });

  it("filters out addresses SMOOV would reject", () => {
    assert.ok(isPlausibleEmail("a.b@mail.co.il"));
    assert.ok(!isPlausibleEmail("no-at-sign"));
    assert.ok(!isPlausibleEmail("a@b"));
  });
});

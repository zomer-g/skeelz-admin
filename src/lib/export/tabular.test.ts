import assert from "node:assert/strict";
import { test } from "node:test";
import { cellFromText, columnName, crc32, fileName, toCsv, toXlsx } from "./tabular";

const table = { name: "משרות", headers: ["משרה", "הגשות"], rows: [["מנהל/ת, מחסן", 12], ['ציטוט "כפול"', null], ["=HYPERLINK(1)", -3]] };

test("CSV: BOM for Hebrew in Excel, quoting, numbers as numbers, formulas defused", () => {
  const csv = toCsv(table);
  assert.ok(csv.startsWith("﻿"));
  assert.equal(
    csv,
    '﻿משרה,הגשות\r\n"מנהל/ת, מחסן",12\r\n"ציטוט ""כפול""",\r\n\'=HYPERLINK(1),-3\r\n',
  );
});

test("crc32 and column names", () => {
  assert.equal(crc32(new TextEncoder().encode("123456789")), 0xcbf43926);
  assert.deepEqual([0, 25, 26, 27, 701, 702].map(columnName), ["A", "Z", "AA", "AB", "ZZ", "AAA"]);
});

test("XLSX: a zip with the workbook, right to left, inline strings and numeric cells", () => {
  const bytes = toXlsx(table);
  assert.deepEqual([...bytes.slice(0, 4)], [0x50, 0x4b, 0x03, 0x04]); // PK
  const text = new TextDecoder().decode(bytes); // stored, so the XML is readable as is
  assert.match(text, /xl\/worksheets\/sheet1\.xml/);
  assert.match(text, /rightToLeft="1"/);
  assert.match(text, /<c r="A2" t="inlineStr"><is><t xml:space="preserve">מנהל\/ת, מחסן<\/t><\/is><\/c><c r="B2"><v>12<\/v><\/c>/);
  assert.match(text, /ציטוט &quot;כפול&quot;/);
  assert.match(text, /'=HYPERLINK\(1\)/);
  assert.match(text, /<sheet name="משרות"/);
});

test("cells read back from the screen", () => {
  assert.equal(cellFromText("1,234"), 1234);
  assert.equal(cellFromText("-5"), -5);
  assert.equal(cellFromText("12.5"), 12.5);
  assert.equal(cellFromText("12.5%"), "12.5%");
  assert.equal(cellFromText(" — "), null);
  assert.equal(cellFromText("01.11.26"), "01.11.26");
});

test("file names", () => {
  assert.equal(fileName("משרות / פעילות: 1.11", "csv"), "משרות_פעילות_1.11.csv");
  assert.equal(fileName("", "xlsx"), "export.xlsx");
});

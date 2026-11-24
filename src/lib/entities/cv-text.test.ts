import assert from "node:assert/strict";
import { test } from "node:test";
import { deflateRawSync } from "node:zlib";
import { CV_TEXT_LIMITS, docxXmlText, extractCvText, odtXmlText, plainText, rtfText, tidy, zipEntry } from "./cv-text";

/** A zip of the given entries, deflated, as Word and LibreOffice write them. */
function zip(entries: Record<string, string>): Uint8Array {
  const enc = new TextEncoder();
  const locals: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  for (const [name, content] of Object.entries(entries)) {
    const nameBytes = Buffer.from(enc.encode(name));
    const raw = Buffer.from(enc.encode(content));
    const data = deflateRawSync(raw);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(8, 8);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(nameBytes.length, 26);
    const dir = Buffer.alloc(46);
    dir.writeUInt32LE(0x02014b50, 0);
    dir.writeUInt16LE(8, 10);
    dir.writeUInt32LE(data.length, 20);
    dir.writeUInt32LE(raw.length, 24);
    dir.writeUInt16LE(nameBytes.length, 28);
    dir.writeUInt32LE(offset, 42);
    locals.push(local, nameBytes, data);
    central.push(dir, nameBytes);
    offset += 30 + nameBytes.length + data.length;
  }
  const dirBytes = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(Object.keys(entries).length, 8);
  end.writeUInt16LE(Object.keys(entries).length, 10);
  end.writeUInt32LE(dirBytes.length, 12);
  end.writeUInt32LE(offset, 16);
  return new Uint8Array(Buffer.concat([...locals, dirBytes, end]));
}

const DOCX_XML =
  '<?xml version="1.0"?><w:document><w:body>' +
  '<w:p><w:r><w:t>ישראל ישראלי</w:t></w:r></w:p>' +
  '<w:p><w:r><w:t xml:space="preserve">עובד סוציאלי </w:t></w:r><w:r><w:tab/><w:t>2020&amp;2024</w:t></w:r></w:p>' +
  "<w:p><w:del><w:r><w:delText>נמחק</w:delText></w:r></w:del><w:r><w:t>Excel</w:t><w:br/><w:t>Word</w:t></w:r></w:p>" +
  "</w:body></w:document>";

test("docx: paragraphs, tabs and breaks become text; deleted text is left out", async () => {
  assert.equal(tidy(docxXmlText(DOCX_XML)), "ישראל ישראלי\nעובד סוציאלי 2020&2024\nExcel\nWord");
  const result = await extractCvText(zip({ "[Content_Types].xml": "<x/>", "word/document.xml": DOCX_XML }), "docx");
  assert.deepEqual(result, { ok: true, text: "ישראל ישראלי\nעובד סוציאלי 2020&2024\nExcel\nWord", truncated: false });
});

test("zip: an entry that is not there is null; a file that is not a zip is unreadable", async () => {
  assert.equal(zipEntry(zip({ "a.txt": "x" }), "b.txt"), null);
  assert.deepEqual(await extractCvText(new TextEncoder().encode("hello"), "docx"), { ok: false, reason: "unreadable" });
});

test("odt: paragraphs, headings and repeated spaces", () => {
  const xml = '<office:text><text:h>קורות חיים</text:h><text:p>מהנדס<text:s text:c="2"/>מזון</text:p><text:p>&#1513;&#x05DC;&#x05D5;&#x05DD;</text:p></office:text>';
  assert.equal(tidy(odtXmlText(xml)), "קורות חיים\nמהנדס מזון\nשלום");
});

test("rtf: Hebrew from the code page, \\u characters, and the font table skipped", () => {
  // "שלום" in Windows-1255 is F9 EC E5 ED.
  const rtf = "{\\rtf1\\ansi\\ansicpg1255{\\fonttbl{\\f0 Arial;}}{\\*\\generator Word;}\\f0 \\'f9\\'ec\\'e5\\'ed\\par Excel\\tab \\u1488?\\u1489?}";
  assert.equal(tidy(rtfText(new TextEncoder().encode(rtf))), "שלום\nExcel אב");
});

test("txt: UTF-8, or Windows-1255 when the bytes are not UTF-8", () => {
  assert.equal(plainText(new TextEncoder().encode("﻿שלום")), "שלום");
  assert.equal(plainText(new Uint8Array([0xf9, 0xec, 0xe5, 0xed])), "שלום");
});

test("limits: unknown types, large files, empty text and the cut", async () => {
  assert.deepEqual(await extractCvText(new Uint8Array(10), "doc"), { ok: false, reason: "unsupported" });
  assert.deepEqual(await extractCvText(new Uint8Array(CV_TEXT_LIMITS.maxBytes + 1), "txt"), { ok: false, reason: "too_large" });
  assert.deepEqual(await extractCvText(new TextEncoder().encode(" \n\n "), "txt"), { ok: false, reason: "no_text" });
  const long = await extractCvText(new TextEncoder().encode("א".repeat(CV_TEXT_LIMITS.maxChars + 5)), "txt");
  assert.ok(long.ok && long.truncated && long.text.length === CV_TEXT_LIMITS.maxChars);
});

/** A one-page PDF with a line of text in a standard font, cross-reference table and all. */
function pdf(line: string): Uint8Array {
  const stream = `BT /F1 12 Tf 72 720 Td (${line}) Tj ET`;
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  let body = "%PDF-1.4\n";
  const offsets: number[] = [];
  objects.forEach((o, i) => {
    offsets.push(body.length);
    body += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const xref = body.length;
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("")}`;
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return new TextEncoder().encode(body);
}

test("pdf: the text layer, with the page count", async () => {
  const result = await extractCvText(pdf("Food engineer, 5 years"), "pdf");
  assert.deepEqual(result, { ok: true, text: "Food engineer, 5 years", truncated: false, pages: 1 });
});

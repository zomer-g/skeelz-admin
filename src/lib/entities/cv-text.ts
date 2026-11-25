import { inflateRawSync } from "node:zlib";

/**
 * The text of one candidate file, for the MCP tool cv_text (docs/mcp.md). Nothing here is stored:
 * the file is downloaded, read and handed over in one request, under the file limit and the audit
 * entry of serve-file.ts. Pure, apart from loading pdf.js for PDFs.
 *
 * pdf: pdf.js text layer (scanned PDFs have none). docx / odt: the document XML inside the zip.
 * rtf: the text runs, Hebrew from the code page. txt: UTF-8, else Windows-1255. Old .doc and the
 * rest are not read.
 */

export const CV_TEXT_LIMITS = {
  /** Larger files are not read (a CV is rarely over 2 MB). */
  maxBytes: 10 * 1024 * 1024,
  maxPages: 40,
  /** What is handed over at most; the rest is cut and said so. */
  maxChars: 60_000,
} as const;

export const CV_TEXT_EXTENSIONS = ["pdf", "docx", "odt", "rtf", "txt"] as const;

export type CvTextResult =
  | { ok: true; text: string; truncated: boolean; pages?: number }
  | { ok: false; reason: "unsupported" | "too_large" | "unreadable" | "no_text" };

export async function extractCvText(bytes: Uint8Array, extension: string | null): Promise<CvTextResult> {
  if (bytes.byteLength > CV_TEXT_LIMITS.maxBytes) return { ok: false, reason: "too_large" };
  const ext = (extension ?? "").toLowerCase();
  let text: string;
  let pages: number | undefined;
  try {
    if (ext === "pdf") ({ text, pages } = await pdfText(bytes));
    else if (ext === "docx") text = docxText(bytes);
    else if (ext === "odt") text = odtText(bytes);
    else if (ext === "rtf") text = rtfText(bytes);
    else if (ext === "txt") text = plainText(bytes);
    else return { ok: false, reason: "unsupported" };
  } catch {
    return { ok: false, reason: "unreadable" };
  }
  text = tidy(text);
  if (!text) return { ok: false, reason: "no_text" };
  const truncated = text.length > CV_TEXT_LIMITS.maxChars;
  return { ok: true, text: truncated ? text.slice(0, CV_TEXT_LIMITS.maxChars) : text, truncated, ...(pages ? { pages } : {}) };
}

/** Lines trimmed, runs of blank lines folded, control characters dropped. */
export function tidy(s: string): string {
  return s
    .replace(/\r\n?/g, "\n")
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "")
    .split("\n")
    .map((l) => l.replace(/[ \t ]+/g, " ").trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/* -------------------------------------------------------------------- pdf */

async function pdfText(bytes: Uint8Array): Promise<{ text: string; pages: number }> {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const task = pdfjs.getDocument({
    // pdf.js takes ownership of the buffer; a copy keeps the caller's intact.
    data: new Uint8Array(bytes),
    disableFontFace: true,
    useSystemFonts: false,
    stopAtErrors: false,
    verbosity: 0,
  });
  const doc = await task.promise;
  try {
    const out: string[] = [];
    const n = Math.min(doc.numPages, CV_TEXT_LIMITS.maxPages);
    for (let i = 1; i <= n; i++) {
      const page = await doc.getPage(i);
      const content = await page.getTextContent();
      let line = "";
      let prev: { x: number; w: number; y: number } | null = null;
      for (const item of content.items) {
        if (!("str" in item)) continue;
        const x = item.transform[4] as number;
        const y = item.transform[5] as number;
        // Items on one line with a visible gap between them (either direction, Hebrew runs right to
        // left) are separate words; pdf.js leaves the space out when the PDF positions them apart.
        if (prev && line && !/\s$/.test(line) && !/^\s/.test(item.str) && Math.abs(y - prev.y) < 2) {
          const gap = Math.max(x - (prev.x + prev.w), prev.x - (x + item.width));
          if (gap > Math.max(1, item.height * 0.15)) line += " ";
        }
        line += item.str;
        prev = item.str ? { x, w: item.width, y } : prev;
        if (item.hasEOL) {
          out.push(line);
          line = "";
          prev = null;
        }
      }
      if (line) out.push(line);
      out.push("");
      page.cleanup();
    }
    return { text: out.join("\n"), pages: doc.numPages };
  } finally {
    await task.destroy();
  }
}

/* -------------------------------------------------------------------- zip */

/** One entry of a zip file (docx, odt), by name, read from the central directory. null when absent. */
export function zipEntry(bytes: Uint8Array, name: string): Uint8Array | null {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  // The end-of-central-directory record sits in the last 64 KB + 22 bytes.
  let eocd = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65_557); i--) {
    if (view.getUint32(i, true) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error("not a zip");
  const count = view.getUint16(eocd + 10, true);
  let p = view.getUint32(eocd + 16, true);
  const decoder = new TextDecoder();
  for (let k = 0; k < count && p + 46 <= bytes.length; k++) {
    if (view.getUint32(p, true) !== 0x02014b50) throw new Error("bad central directory");
    const method = view.getUint16(p + 10, true);
    const compressed = view.getUint32(p + 20, true);
    const size = view.getUint32(p + 24, true);
    const nameLen = view.getUint16(p + 28, true);
    const extraLen = view.getUint16(p + 30, true);
    const commentLen = view.getUint16(p + 32, true);
    const local = view.getUint32(p + 42, true);
    const entryName = decoder.decode(bytes.subarray(p + 46, p + 46 + nameLen));
    if (entryName === name) {
      if (size > CV_TEXT_LIMITS.maxBytes * 4) throw new Error("entry too large");
      const start = local + 30 + view.getUint16(local + 26, true) + view.getUint16(local + 28, true);
      const data = bytes.subarray(start, start + compressed);
      if (method === 0) return data;
      if (method === 8) return new Uint8Array(inflateRawSync(data, { maxOutputLength: CV_TEXT_LIMITS.maxBytes * 4 }));
      throw new Error("unsupported compression");
    }
    p += 46 + nameLen + extraLen + commentLen;
  }
  return null;
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };
const decodeEntities = (s: string) =>
  s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === "#") {
      const code = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : "";
    }
    return ENTITIES[e.toLowerCase()] ?? m;
  });

/** Word's document.xml: paragraphs and breaks become new lines, tabs stay, every other tag goes. */
export function docxXmlText(xml: string): string {
  return decodeEntities(
    xml
      .replace(/<w:(?:delText|instrText)[^>]*>[\s\S]*?<\/w:(?:delText|instrText)>/g, "")
      .replace(/<w:tab\/>/g, "\t")
      .replace(/<w:(?:br|cr)[^>]*\/>/g, "\n")
      .replace(/<\/w:p>/g, "\n")
      .replace(/<\/w:tc>/g, "\t")
      .replace(/<[^>]+>/g, ""),
  );
}

function docxText(bytes: Uint8Array): string {
  const xml = zipEntry(bytes, "word/document.xml");
  if (!xml) throw new Error("no document.xml");
  return docxXmlText(new TextDecoder().decode(xml));
}

/** OpenDocument content.xml: paragraphs and headings become lines. */
export function odtXmlText(xml: string): string {
  return decodeEntities(
    xml
      .replace(/<text:tab\/>/g, "\t")
      .replace(/<text:line-break\/>/g, "\n")
      .replace(/<text:s(?: text:c="(\d+)")?\/>/g, (_, c: string | undefined) => " ".repeat(Math.min(Number(c ?? 1), 20)))
      .replace(/<\/text:(?:p|h)>/g, "\n")
      .replace(/<[^>]+>/g, ""),
  );
}

function odtText(bytes: Uint8Array): string {
  const xml = zipEntry(bytes, "content.xml");
  if (!xml) throw new Error("no content.xml");
  return odtXmlText(new TextDecoder().decode(xml));
}

/* -------------------------------------------------------------- rtf / txt */

/** Code pages RTF names with \ansicpgN that TextDecoder knows; Hebrew files say 1255. */
const decoderFor = (cp: number) => {
  try {
    return new TextDecoder(`windows-${cp}`);
  } catch {
    return new TextDecoder("windows-1252");
  }
};

/** Groups whose content is not the document's text. */
const RTF_SKIP = new Set(["fonttbl", "colortbl", "stylesheet", "info", "pict", "object", "header", "footer", "listtable", "listoverridetable", "themedata", "datastore", "latentstyles", "rsidtbl", "generator", "xmlnstbl", "mmathPr"]);

/** The text runs of an RTF document: \'hh bytes through its code page, \uN characters, \par lines. */
export function rtfText(bytes: Uint8Array): string {
  const s = new TextDecoder("latin1").decode(bytes);
  if (!s.startsWith("{\\rtf")) throw new Error("not rtf");
  const cp = Number(/\\ansicpg(\d+)/.exec(s)?.[1] ?? 1252);
  const decoder = decoderFor(cp);
  const out: string[] = [];
  let pending: number[] = [];
  const flush = () => {
    if (pending.length) out.push(decoder.decode(new Uint8Array(pending)));
    pending = [];
  };
  // A stack of "skip this group"; uc = how many fallback characters follow a \uN.
  const stack: { skip: boolean; uc: number }[] = [];
  let skip = false;
  let uc = 1;
  let dropNext = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s[i]!;
    if (c === "{") {
      stack.push({ skip, uc });
      if (s[i + 1] === "\\" && s[i + 2] === "*") skip = true;
      continue;
    }
    if (c === "}") {
      flush();
      ({ skip, uc } = stack.pop() ?? { skip: false, uc: 1 });
      continue;
    }
    if (c === "\\") {
      const next = s[i + 1] ?? "";
      if (next === "'") {
        const byte = parseInt(s.slice(i + 2, i + 4), 16);
        i += 3;
        if (dropNext > 0) dropNext--;
        else if (!skip && Number.isFinite(byte)) pending.push(byte);
        continue;
      }
      if (next === "\\" || next === "{" || next === "}") {
        i++;
        if (!skip) {
          flush();
          out.push(next);
        }
        continue;
      }
      const m = /^([a-zA-Z]+)(-?\d+)? ?/.exec(s.slice(i + 1, i + 40));
      if (!m) {
        i++;
        continue;
      }
      i += m[0].length;
      const [, word, arg] = m;
      if (RTF_SKIP.has(word!)) skip = true;
      if (skip) continue;
      flush();
      if (word === "par" || word === "line" || word === "row") out.push("\n");
      else if (word === "tab" || word === "cell") out.push("\t");
      else if (word === "uc") uc = Number(arg ?? 1);
      else if (word === "u") {
        let code = Number(arg ?? 0);
        if (code < 0) code += 65_536;
        out.push(String.fromCharCode(code));
        dropNext = uc;
      }
      continue;
    }
    if (c === "\r" || c === "\n") continue;
    if (dropNext > 0) {
      dropNext--;
      continue;
    }
    if (!skip) {
      flush();
      out.push(c);
    }
  }
  flush();
  return out.join("");
}

/** UTF-8 when it is valid, else the Hebrew Windows code page older files use. */
export function plainText(bytes: Uint8Array): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes).replace(/^﻿/, "");
  } catch {
    return new TextDecoder("windows-1255").decode(bytes);
  }
}

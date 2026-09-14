import type { sql } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { addDays, israelMidnight } from "@/lib/dashboard/params";

/**
 * Shared plumbing for the entity lists (applications, employers, candidates):
 * every filter is a URL parameter, read here and turned into safe SQL values.
 */

export type SearchParams = Record<string, string | string[] | undefined>;
export type Row = Record<string, unknown>;

export const PAGE_SIZE = 50;

export const run = async <T extends Row>(query: ReturnType<typeof sql>) => (await getDb().execute<T>(query)).rows as T[];
export const num = (v: unknown) => Number(v ?? 0);
export const str = (v: unknown) => (typeof v === "string" && v.trim() !== "" ? v : null);
export const asDate = (v: unknown) => (v == null || v === "" ? null : v instanceof Date ? v : new Date(String(v).replace(/([+-]\d{2})(\d{2})$/, "$1:$2")));
export const isTrue = (v: unknown) => v === true || v === "true";

/** A single URL parameter, trimmed; "" when absent. */
export function param(search: SearchParams, key: string, maxLength = 200): string {
  const v = search[key];
  return ((Array.isArray(v) ? v[0] : v) ?? "").trim().slice(0, maxLength);
}

/** A parameter restricted to a known set of values; "" otherwise. */
export function choice<T extends string>(search: SearchParams, key: string, allowed: readonly T[]): T | "" {
  const v = param(search, key);
  return (allowed as readonly string[]).includes(v) ? (v as T) : "";
}

const DAY = /^\d{4}-\d{2}-\d{2}$/;
export const dayParam = (search: SearchParams, key: string) => (DAY.test(param(search, key)) ? param(search, key) : "");

export const pageParam = (search: SearchParams) => Math.min(Math.max(Number.parseInt(param(search, "page"), 10) || 1, 1), 1000);

/** Half-open instant bounds for an inclusive Israel-day range; either side may be open. */
export function dayBounds(fromDay: string, toDay: string): { from: Date | null; to: Date | null } {
  return { from: fromDay ? israelMidnight(fromDay) : null, to: toDay ? israelMidnight(addDays(toDay, 1)) : null };
}

/** An ILIKE pattern that matches the text literally. */
export const containsPattern = (q: string) => `%${q.replace(/[\\%_]/g, (m) => `\\${m}`)}%`;

/**
 * The last nine digits of a phone-looking query, so 054-1234567 finds 972541234567.
 * null when the query has too few digits to be a phone number.
 */
export function phoneDigits(q: string): string | null {
  const digits = q.replace(/\D/g, "");
  if (digits.length < 6) return null;
  return digits.length > 9 ? digits.slice(-9) : digits;
}

/** A Salesforce record id: the only shape ever put into a query or a SOQL string. */
export const isSfId = (v: string) => /^[a-zA-Z0-9]{15,18}$/.test(v);

/** Plain text from the site's rich-text HTML, for display as text (never as HTML). */
export function htmlToText(html: string | null): string | null {
  if (!html) return null;
  const text = html
    .replace(/<\s*(br|\/p|\/div|\/li|\/h\d)[^>]*>/gi, "\n")
    .replace(/<\s*li[^>]*>/gi, "• ")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return text || null;
}

/** Salesforce record URL, when the instance is configured. */
export function sfRecordUrl(id: string): string | null {
  const base = process.env.SF_LOGIN_URL?.replace(/\/+$/, "");
  return base ? `${base}/${id}` : null;
}

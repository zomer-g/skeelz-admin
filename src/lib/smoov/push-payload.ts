import { createHash } from "node:crypto";
import type { SmoovBulkContact, SmoovContactField } from "./client";

/**
 * What one candidate becomes in the SMOOV job-seekers list. Pure, so it is
 * tested apart from the database and the API (`push-payload.test.ts`).
 */

/** The custom fields the list carries, by their label in SMOOV (contacts › custom fields). */
export const PUSH_FIELD_LABELS = {
  city: "עיר",
  subdistrict: "נפה",
  district: "מחוז",
  cv: "CV",
  createdAt: "תאריך יצירה",
} as const;

export type PushField = keyof typeof PUSH_FIELD_LABELS;
export type PushFieldKeys = Record<PushField, string>;

/** The fields' API keys ("i65"…), found by label so a field recreated in SMOOV needs no code change. */
export function resolveFieldKeys(fields: SmoovContactField[]): PushFieldKeys {
  const keys: Partial<PushFieldKeys> = {};
  const missing: string[] = [];
  for (const [field, label] of Object.entries(PUSH_FIELD_LABELS) as [PushField, string][]) {
    const matches = fields.filter((f) => f.custom && f.label.trim() === label);
    if (matches.length !== 1) missing.push(`${label} (${matches.length} found)`);
    else keys[field] = matches[0]!.key;
  }
  if (missing.length) throw new Error(`SMOOV custom fields not found exactly once: ${missing.join(", ")}`);
  return keys as PushFieldKeys;
}

export interface PushCandidate {
  email: string;
  name: string | null;
  firstName: string | null;
  lastName: string | null;
  phone: string | null;
  city: string | null;
  subdistrict: string | null;
  district: string | null;
  hasCv: boolean;
  createdAt: Date | null;
}

/** SMOOV's date format for date fields: "dd/MM/yyyy HH:mm", here in Israel time. */
export function smoovDate(d: Date): string {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Jerusalem",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(d);
  const p = (type: string) => parts.find((x) => x.type === type)?.value ?? "";
  return `${p("day")}/${p("month")}/${p("year")} ${p("hour")}:${p("minute")}`;
}

/** First and last name from the Contact's fields, else split from the full name at the first space. */
function names(c: PushCandidate): { firstName?: string; lastName?: string } {
  const first = c.firstName?.trim();
  const last = c.lastName?.trim();
  if (first || last) return { firstName: first || undefined, lastName: last || undefined };
  const full = c.name?.trim();
  if (!full) return {};
  const at = full.indexOf(" ");
  return at < 0 ? { firstName: full } : { firstName: full.slice(0, at), lastName: full.slice(at + 1).trim() };
}

export function toBulkContact(c: PushCandidate, keys: PushFieldKeys): SmoovBulkContact {
  const custom: Record<string, string | boolean> = { [keys.cv]: c.hasCv };
  if (c.city) custom[keys.city] = c.city;
  if (c.subdistrict) custom[keys.subdistrict] = c.subdistrict;
  if (c.district) custom[keys.district] = c.district;
  if (c.createdAt) custom[keys.createdAt] = smoovDate(c.createdAt);
  return {
    email: c.email,
    ...names(c),
    ...(c.phone?.trim() ? { cellPhone: c.phone.trim() } : {}),
    customFields: custom,
  };
}

/** Fingerprint of what was sent, so the next run sends only what changed. */
export function contactHash(contact: SmoovBulkContact): string {
  const fields = Object.keys(contact.customFields).sort().map((k) => [k, contact.customFields[k]]);
  return createHash("sha256")
    .update(JSON.stringify([contact.email, contact.firstName ?? null, contact.lastName ?? null, contact.cellPhone ?? null, fields]))
    .digest("hex");
}

/** SMOOV's error text with what could identify a person masked: addresses, and runs of digits that may be phones. */
export function redactSmoovError(text: string): string {
  return text
    .replace(/[^\s"'<>,;:]+@[^\s"'<>,;:]+/g, "<email>")
    .replace(/\+?\d[\d\s-]{6,}\d/g, "<digits>")
    .slice(0, 1000);
}

/** A plain address check: SMOOV rejects malformed ones, and they would be retried every run. */
export function isPlausibleEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email);
}

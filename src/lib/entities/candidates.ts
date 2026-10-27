import { sql, type SQL } from "drizzle-orm";
import { RECORD_TYPES } from "@/lib/metrics/candidates";
import { CANDIDATE_ACCOUNT_PATTERN } from "@/lib/metrics/marketing";
import { salesforceConfigured, sf } from "@/lib/sf/client";
import { asDate, choice, containsPattern, dayBounds, dayParam, isSfId, isTrue, num, PAGE_SIZE, param, phoneDigits, run, str, type SearchParams } from "./search";
import { orderBy, type Sort, type SortColumn } from "./sort";
import { AREA_VALUES, NAPA_VALUES, placeFilterSql, placeLabel, type PlaceLabel } from "@/lib/geo/filters";
import { GEO_CTES } from "@/lib/geo/localities";
import { logError } from "@/lib/log";
import { candidatePlaceSql } from "@/lib/metrics/geo";
import { SKILLS, skillNames, skillRowsSql } from "@/lib/skills";

/**
 * Candidates: Contacts in the candidate Accounts, and any Contact that applied.
 * Files (CVs) are not mirrored: they are listed live from Salesforce, and only
 * those linked to the candidate or to one of their applications can be opened.
 */

export interface CandidateFilters {
  q: string;
  /** The site's own district (`district_index__c`), exactly as in Salesforce. */
  district: string;
  /** CBS district (1–7), or "unknown" (lib/geo/filters.ts). */
  area: string;
  /** CBS sub-district code. */
  napa: string;
  /** A skill name (lib/skills.ts). */
  skill: string;
  city: string;
  account: string;
  cv: "yes" | "no" | "";
  /** הגשה מהירה (`Field6__c` on the Contact). */
  fast: "yes" | "no" | "";
  applied: "yes" | "no" | "";
  fromDay: string;
  toDay: string;
}

export interface CandidateRow {
  id: string;
  name: string | null;
  email: string | null;
  phone: string | null;
  city: string | null;
  district: string | null;
  /** Where the candidate lives, in CBS terms (from the locality code, else the city name). */
  place: PlaceLabel;
  accountName: string | null;
  hasCv: boolean;
  /** הגשה מהירה (`Field6__c`): the candidate came in through the site's one-click apply. */
  fastApply: boolean;
  applications: number;
  /** The person's first application: when someone who applied more than once actually first did. */
  firstApplicationAt: Date | null;
  lastApplicationAt: Date | null;
  createdAt: Date | null;
}

const PLACE = candidatePlaceSql("ct");

export const CANDIDATES = sql`
  WITH ${GEO_CTES},
  apps AS (
    SELECT a.contact_id, count(*) AS n, min(a.created_date) AS first_at, max(a.created_date) AS last_at
      FROM sf_case a JOIN sf_record_type rt ON rt.id = a.record_type_id
     WHERE rt.developer_name IN (${RECORD_TYPES.application}, ${RECORD_TYPES.accepted}) AND NOT a.is_deleted AND a.contact_id IS NOT NULL
     GROUP BY a.contact_id
  ),
  cand AS (
    SELECT ct.id, ct.name, ct.created_date, ct.data, acc.name AS account_name,
           coalesce(ct.email, lower(nullif(ct.data->>'email_cambium__c', ''))) AS email,
           coalesce(nullif(ct.data->>'MobilePhone', ''), nullif(ct.data->>'Phone', ''), nullif(ct.data->>'phoneNumber_cambium__c', '')) AS phone,
           coalesce(nullif(ct.data->>'City_fix__c', ''), nullif(ct.data->>'city_index__c', '')) AS city,
           nullif(ct.data->>'district_index__c', '') AS district,
           coalesce(ct.data->>'CV__c', 'false') = 'true' AS has_cv,
           coalesce(ct.data->>'Field6__c', 'false') = 'true' AS fast_applied,
           coalesce(apps.n, 0) AS applications, apps.first_at, apps.last_at,
           ${PLACE.kind} AS place_kind, ${PLACE.napa} AS napa, ${PLACE.locality} AS locality
      FROM sf_contact ct
      LEFT JOIN sf_account acc ON acc.id = ct.account_id
      LEFT JOIN apps ON apps.contact_id = ct.id
      ${PLACE.joins}
     WHERE NOT ct.is_deleted AND (acc.name ILIKE ${CANDIDATE_ACCOUNT_PATTERN} OR apps.n IS NOT NULL)
  )`;

function toCandidate(r: Record<string, unknown>): CandidateRow {
  return {
    id: String(r.id),
    name: str(r.name),
    email: str(r.email),
    phone: str(r.phone),
    city: str(r.city),
    district: str(r.district),
    place: placeLabel(r),
    accountName: str(r.account_name),
    hasCv: isTrue(r.has_cv),
    fastApply: isTrue(r.fast_applied),
    applications: num(r.applications),
    firstApplicationAt: asDate(r.first_at),
    lastApplicationAt: asDate(r.last_at),
    createdAt: asDate(r.created_date),
  };
}

/** The columns the list can be sorted by; `created` is the default. */
export const CANDIDATE_SORTS: readonly SortColumn[] = [
  { key: "created", kind: "date", by: sql`c.created_date` },
  { key: "name", kind: "text", by: sql`c.name` },
  { key: "city", kind: "text", by: sql`c.city` },
  { key: "account", kind: "text", by: sql`c.account_name` },
  { key: "cv", kind: "number", by: sql`c.has_cv` },
  { key: "fast", kind: "number", by: sql`c.fast_applied` },
  { key: "applications", kind: "number", by: sql`c.applications` },
  { key: "first", kind: "date", by: sql`c.first_at` },
  { key: "last", kind: "date", by: sql`c.last_at` },
];

/** The list's filters as the URL carries them — read here so the page and the contact export agree. */
export function candidateFilters(search: SearchParams): CandidateFilters {
  return {
    q: param(search, "q"),
    district: param(search, "district"),
    area: choice(search, "area", AREA_VALUES),
    napa: choice(search, "napa", NAPA_VALUES),
    skill: choice(search, "skill", SKILLS.map((s) => s.label)),
    city: param(search, "city"),
    account: param(search, "account"),
    cv: choice(search, "cv", ["yes", "no"] as const),
    fast: choice(search, "fast", ["yes", "no"] as const),
    applied: choice(search, "applied", ["yes", "no"] as const),
    fromDay: dayParam(search, "from"),
    toDay: dayParam(search, "to"),
  };
}

/** Every filter of the list as one WHERE, shared by the list and by the contact export. */
function whereOf(f: CandidateFilters): SQL {
  const parts: SQL[] = [sql`true`];
  if (f.q) {
    const p = containsPattern(f.q);
    const digits = phoneDigits(f.q);
    parts.push(sql`(c.name ILIKE ${p} OR c.email ILIKE ${p}
      ${digits ? sql`OR regexp_replace(coalesce(c.phone, ''), '[^0-9]', '', 'g') LIKE ${`%${digits}%`}` : sql.raw("")})`);
  }
  if (f.district) parts.push(sql`c.district = ${f.district}`);
  parts.push(...placeFilterSql("c", f.area, f.napa));
  if (f.skill) parts.push(sql`EXISTS (SELECT 1 FROM (${skillRowsSql("c.id", "c.data->>'skills_cambium__c'", "c.data")}) k WHERE k.skill = ${f.skill})`);
  if (f.city) parts.push(sql`c.city ILIKE ${containsPattern(f.city)}`);
  if (f.account) parts.push(sql`c.account_name = ${f.account}`);
  if (f.cv === "yes") parts.push(sql`c.has_cv`);
  if (f.cv === "no") parts.push(sql`NOT c.has_cv`);
  if (f.fast === "yes") parts.push(sql`c.fast_applied`);
  if (f.fast === "no") parts.push(sql`NOT c.fast_applied`);
  if (f.applied === "yes") parts.push(sql`c.applications > 0`);
  if (f.applied === "no") parts.push(sql`c.applications = 0`);
  const { from, to } = dayBounds(f.fromDay, f.toDay);
  if (from) parts.push(sql`c.created_date >= ${from}`);
  if (to) parts.push(sql`c.created_date < ${to}`);
  return sql.join(parts, sql` AND `);
}

export async function searchCandidates(
  f: CandidateFilters,
  { page = 1, pageSize = PAGE_SIZE, sort }: { page?: number; pageSize?: number; sort?: Sort } = {},
): Promise<{ rows: CandidateRow[]; total: number }> {
  const where = whereOf(f);

  const [rows, count] = await Promise.all([
    run(sql`${CANDIDATES} SELECT c.* FROM cand c WHERE ${where}
             ORDER BY ${orderBy(CANDIDATE_SORTS, sort ?? { key: "created", dir: "desc" }, sql`c.id`)}
             LIMIT ${pageSize} OFFSET ${(page - 1) * pageSize}`),
    run(sql`${CANDIDATES} SELECT count(*) AS n FROM cand c WHERE ${where}`),
  ]);
  return { rows: rows.map(toCandidate), total: num(count[0]?.n) };
}

/** What the list can hand over for a mailing or a phone round. */
export const CONTACT_FIELDS = { email: "מיילים", phone: "טלפונים" } as const;
export type ContactField = keyof typeof CONTACT_FIELDS;

/** A guard, not a quota: more addresses than this is a mailing-list job, not a copy-paste. */
export const MAX_CONTACTS = 5_000;

/**
 * Every address (or phone) behind the current filter, not only the page on
 * screen — what "copy the 300 candidates with this skill" needs. Values come
 * back once each, newest candidate first.
 */
export async function loadCandidateContacts(
  f: CandidateFilters,
  field: ContactField,
): Promise<{ values: string[]; candidates: number; truncated: boolean }> {
  const where = whereOf(f);
  const column = field === "email" ? sql`c.email` : sql`c.phone`;
  const rows = await run(sql`${CANDIDATES}
    SELECT ${column} AS v, max(c.created_date) AS at FROM cand c
     WHERE ${where} AND ${column} IS NOT NULL AND btrim(${column}) <> ''
     GROUP BY 1 ORDER BY 2 DESC NULLS LAST
     LIMIT ${MAX_CONTACTS + 1}`);

  // Phones are typed by hand in every shape there is; the digits decide what is the same number.
  const seen = new Set<string>();
  const values: string[] = [];
  for (const r of rows) {
    const value = String(r.v).trim();
    const key = field === "phone" ? value.replace(/\D/g, "") : value.toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    values.push(field === "email" ? key : value);
  }
  return { values: values.slice(0, MAX_CONTACTS), candidates: values.length, truncated: values.length > MAX_CONTACTS };
}

export async function loadCandidateFilterOptions(): Promise<{ accounts: string[] }> {
  const accounts = await run(sql`
    SELECT acc.name AS v, count(*) AS n FROM sf_contact ct JOIN sf_account acc ON acc.id = ct.account_id
     WHERE NOT ct.is_deleted AND acc.name ILIKE ${CANDIDATE_ACCOUNT_PATTERN} GROUP BY 1 ORDER BY 2 DESC LIMIT 20`);
  return { accounts: accounts.map((r) => String(r.v)) };
}

export interface CandidateDetail extends CandidateRow {
  firstName: string | null;
  birthDate: string | null;
  gender: string | null;
  contactType: string | null;
  skills: string[];
  talent: boolean;
  lastActivityDate: string | null;
}

export async function loadCandidate(id: string): Promise<CandidateDetail | null> {
  if (!isSfId(id)) return null;
  const [r] = await run(sql`${CANDIDATES} SELECT c.* FROM cand c WHERE c.id = ${id}`);
  if (!r) return null;
  const data = (r.data ?? {}) as Record<string, unknown>;
  return {
    ...toCandidate(r),
    firstName: str(data.FirstName) ?? str(data.firstName_cambium__c),
    birthDate: str(data.Birthdate) ?? str(data.dateOfBirth_cambium__c),
    gender: str(data.Gender__c),
    contactType: str(data.contact_type_C__c),
    // The site lists skills by id; each id has its name (lib/skills.ts), and the checkboxes repeat them.
    skills: skillNames(str(data.skills_cambium__c), data),
    talent: isTrue(data.Field3__c),
    lastActivityDate: str(data.LastActivityDate),
  };
}

export interface CandidateFile {
  documentId: string;
  versionId: string;
  title: string;
  extension: string | null;
  size: number;
  createdAt: Date | null;
  /** The application the file is attached to, when it is not on the candidate. */
  applicationId: string | null;
}

/** Files attached to the candidate or to any of their applications, straight from Salesforce. */
export async function loadCandidateFiles(contactId: string): Promise<{ files: CandidateFile[]; error: string | null }> {
  if (!isSfId(contactId)) return { files: [], error: null };
  if (!salesforceConfigured()) return { files: [], error: "Salesforce לא מחובר" };
  const appIds = (
    await run(sql`
      SELECT a.id FROM sf_case a JOIN sf_record_type rt ON rt.id = a.record_type_id
       WHERE a.contact_id = ${contactId} AND NOT a.is_deleted
         AND rt.developer_name IN (${RECORD_TYPES.application}, ${RECORD_TYPES.accepted})
       ORDER BY a.created_date DESC LIMIT 150`)
  ).map((r) => String(r.id));
  // Ids are validated to the Salesforce id shape before they go into the SOQL string.
  const ids = [contactId, ...appIds].filter(isSfId);
  try {
    const links = await sf.query<{
      ContentDocumentId: string;
      LinkedEntityId: string;
      ContentDocument: { Title: string; FileExtension: string | null; ContentSize: number; LatestPublishedVersionId: string; CreatedDate: string };
    }>(
      `SELECT ContentDocumentId, LinkedEntityId, ContentDocument.Title, ContentDocument.FileExtension, ContentDocument.ContentSize,
              ContentDocument.LatestPublishedVersionId, ContentDocument.CreatedDate
         FROM ContentDocumentLink WHERE LinkedEntityId IN (${ids.map((i) => `'${i}'`).join(",")})`,
    );
    const byDocument = new Map<string, CandidateFile>();
    for (const l of links) {
      const existing = byDocument.get(l.ContentDocumentId);
      const onApplication = l.LinkedEntityId !== contactId;
      if (existing && (existing.applicationId === null || onApplication)) continue;
      byDocument.set(l.ContentDocumentId, {
        documentId: l.ContentDocumentId,
        versionId: l.ContentDocument.LatestPublishedVersionId,
        title: l.ContentDocument.Title,
        extension: l.ContentDocument.FileExtension?.toLowerCase() ?? null,
        size: l.ContentDocument.ContentSize,
        createdAt: asDate(l.ContentDocument.CreatedDate),
        applicationId: onApplication ? l.LinkedEntityId : null,
      });
    }
    return { files: [...byDocument.values()].sort((a, b) => (b.createdAt?.getTime() ?? 0) - (a.createdAt?.getTime() ?? 0)), error: null };
  } catch (err) {
    logError("candidates files", err);
    return { files: [], error: "לא ניתן לטעון את הקבצים מ-Salesforce כרגע" };
  }
}

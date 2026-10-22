import { sql, type SQL } from "drizzle-orm";
import { writeAudit } from "@/lib/audit";
import { isTopicId, topicLabel } from "@/lib/cv-topics";
import { logError } from "@/lib/log";
import { RECORD_TYPES } from "@/lib/metrics/candidates";
import { salesforceConfigured, sf } from "@/lib/sf/client";
import { TOPICS_OBJECT } from "@/lib/sf/sync-topics";
import { cvFilePath } from "./cv";
import { AREA_VALUES, NAPA_VALUES, placeFilterSql, placeLabel, type PlaceLabel } from "@/lib/geo/filters";
import { GEO_CTES } from "@/lib/geo/localities";
import { candidatePlaceSql } from "@/lib/metrics/geo";
import { asDate, choice, containsPattern, dayBounds, dayParam, num, PAGE_SIZE, param, run, str, type SearchParams } from "./search";
import { orderBy, type Sort, type SortColumn } from "./sort";

/**
 * Every CV in one list (/cvs): the files on Contacts, on CV ("קורות חיים") and application Cases,
 * and on those Cases' emails, from the mirrored file links (lib/sf/sync-files.ts, metadata only).
 * One row per file, with the person it belongs to and the CV Case it came in on.
 *
 * "Never handled": a stretch of CVs went unanswered. Those are CV Cases that the staff never
 * touched — nobody set their Contact, changed their type or owner, or moved their status — and
 * that were closed in the bulk closure of 14.10.2026. Their history holds only their creation and
 * that closure (and any other status change by the same user), apart from what the automation set on arrival.
 */

/** The bulk closure of untouched CV Cases: who did it, and on which Israel day. */
export const BULK_CLOSURE = { userId: "0058d000006jfKjAAI", day: "2026-10-14" } as const;

/** Changes that user's automation makes this soon after a Case is created are not handling. */
const AUTOMATION_MINUTES = 10;

/** Document types a CV comes in. Anything else (images, archives, mail parts) shows only under "all files". */
export const CV_EXTENSIONS = ["pdf", "doc", "docx", "rtf", "odt", "txt", "pages"];

export const CV_SOURCES = ["contact", "case", "email"] as const;
export type CvSourceKind = (typeof CV_SOURCES)[number];
export const CV_SOURCE_LABELS: Record<CvSourceKind, string> = { contact: "באיש הקשר", case: "ב-Case", email: "במייל של Case" };

export interface CvFilters {
  /** Name or email of the person, file name or Case number. */
  q: string;
  source: CvSourceKind | "";
  unhandled: "yes" | "no" | "";
  /** "all" adds files that are not documents (images and the like). */
  kind: "all" | "";
  fromDay: string;
  toDay: string;
  /** Words to find inside the files (Salesforce's full-text index). */
  text: string;
  /** A topic or group of lib/cv-topics.ts: files whose text matched one of its phrases (cv_topics). */
  topic: string;
  /** Where the person lives (their Contact): CBS district (1–7) or "unknown", and sub-district (lib/geo/filters.ts). */
  area: string;
  napa: string;
}

/** The screen's filters as the URL carries them — read here so the list and the contact export agree. */
export function cvFilters(search: SearchParams): CvFilters {
  const topic = param(search, "topic");
  return {
    q: param(search, "q"),
    text: param(search, "text", 100),
    topic: isTopicId(topic) ? topic : "",
    // "Never handled" is kept for the data and the MCP only; the screen does not show it.
    unhandled: "",
    source: choice(search, "source", CV_SOURCES),
    kind: param(search, "kind") === "all" ? "all" : "",
    area: choice(search, "area", AREA_VALUES),
    napa: choice(search, "napa", NAPA_VALUES),
    fromDay: dayParam(search, "from"),
    toDay: dayParam(search, "to"),
  };
}

export interface CvRow {
  documentId: string;
  title: string | null;
  extension: string | null;
  size: number;
  /** When it arrived: its earliest email, or the file's creation. */
  receivedAt: Date | null;
  sources: CvSourceKind[];
  contactId: string | null;
  name: string | null;
  email: string | null;
  phone: string | null;
  /** Where the person lives, from their Contact's city (CBS terms). */
  place: PlaceLabel;
  caseId: string | null;
  caseNumber: string | null;
  caseType: string | null;
  caseStatus: string | null;
  unhandled: boolean;
  /** Under a topic filter: the topic's phrases found in the file. */
  topicPhrases: string[];
  /** Where the file opens on the site (checked and audited there), or null when it has no owner the routes know. */
  openPath: string | null;
}

/** CV Cases never handled by the staff (see above). */
const UNHANDLED = sql`
  unhandled AS (
    SELECT a.id
      FROM sf_case a JOIN sf_record_type rt ON rt.id = a.record_type_id
     WHERE rt.developer_name = ${RECORD_TYPES.cvMessage} AND NOT a.is_deleted
       AND EXISTS (
         SELECT 1 FROM sf_case_history h
          WHERE h.case_id = a.id AND h.field = 'Status' AND h.created_by_id = ${BULK_CLOSURE.userId}
            AND to_char(h.created_date AT TIME ZONE 'Asia/Jerusalem', 'YYYY-MM-DD') = ${BULK_CLOSURE.day})
       AND NOT EXISTS (
         SELECT 1 FROM sf_case_history h
          WHERE h.case_id = a.id AND h.field <> 'created'
            -- The same user's status changes are the closure itself.
            AND NOT (h.field = 'Status' AND h.created_by_id = ${BULK_CLOSURE.userId})
            -- Email-to-Case and its flows run as that user too: what they set on arrival (the type
            -- "קורות חיים", the owner, the Contact) is automation, not handling.
            AND NOT (h.created_by_id = ${BULK_CLOSURE.userId} AND h.created_date <= a.created_date + interval '${sql.raw(String(AUTOMATION_MINUTES))} minutes'))
  )`;

const PLACE = candidatePlaceSql("ct");

/** One row per file, with its person and its Case (a CV Case first). */
const CVS = sql`
  WITH ${GEO_CTES}, ${UNHANDLED},
  links AS (
    SELECT l.document_id, l.entity_type, l.title, l.extension, l.size, l.document_created_at,
           CASE WHEN l.entity_type = 'contact' THEN l.linked_entity_id END AS contact_id,
           CASE WHEN l.entity_type = 'case' THEN l.linked_entity_id ELSE m.parent_id END AS case_id,
           m.message_date
      FROM sf_file_link l
      LEFT JOIN sf_email_message m ON l.entity_type = 'email' AND m.id = l.linked_entity_id
  ),
  docs AS (
    SELECT document_id, max(title) AS title, max(extension) AS extension, max(size) AS size,
           coalesce(min(message_date), min(document_created_at)) AS received_at,
           array_agg(DISTINCT entity_type) AS sources,
           array_agg(DISTINCT case_id) FILTER (WHERE case_id IS NOT NULL) AS case_ids,
           (array_agg(contact_id) FILTER (WHERE contact_id IS NOT NULL))[1] AS contact_id
      FROM links GROUP BY document_id
  ),
  cv AS (
    SELECT d.document_id, d.title, d.extension, coalesce(d.size, 0) AS size, d.received_at, d.sources,
           c.id AS case_id, c.data->>'CaseNumber' AS case_number, c.rt_label AS case_type, c.status AS case_status,
           ct.id AS contact_id, coalesce(ct.name, nullif(c.data->>'SuppliedName', '')) AS name,
           coalesce(ct.email, lower(nullif(c.data->>'SuppliedEmail', ''))) AS email,
           coalesce(nullif(ct.data->>'MobilePhone', ''), nullif(ct.data->>'Phone', ''), nullif(ct.data->>'phoneNumber_cambium__c', ''), nullif(c.data->>'SuppliedPhone', '')) AS phone,
           ${PLACE.kind} AS place_kind, ${PLACE.napa} AS napa, ${PLACE.locality} AS locality,
           EXISTS (SELECT 1 FROM unhandled u WHERE u.id = ANY(d.case_ids)) AS unhandled
      FROM docs d
      LEFT JOIN LATERAL (
        SELECT a.id, a.data, a.status, a.contact_id, rt.name AS rt_label
          FROM sf_case a LEFT JOIN sf_record_type rt ON rt.id = a.record_type_id
         WHERE a.id = ANY(d.case_ids) AND NOT a.is_deleted
         ORDER BY (rt.developer_name = ${RECORD_TYPES.cvMessage}) DESC, a.created_date
         LIMIT 1
      ) c ON true
      LEFT JOIN sf_contact ct ON ct.id = coalesce(d.contact_id, c.contact_id) AND NOT ct.is_deleted
      ${PLACE.joins}
  )`;

export const CV_SORTS: readonly SortColumn[] = [
  { key: "received", kind: "date", by: sql`v.received_at` },
  { key: "name", kind: "text", by: sql`v.name` },
  { key: "title", kind: "text", by: sql`v.title` },
  { key: "size", kind: "number", by: sql`v.size` },
];

const toRow = (r: Record<string, unknown>): CvRow => {
  const email = str(r.email);
  const contactId = str(r.contact_id);
  const documentId = String(r.document_id);
  return {
    documentId,
    title: str(r.title),
    extension: str(r.extension),
    size: num(r.size),
    receivedAt: asDate(r.received_at),
    sources: (Array.isArray(r.sources) ? r.sources : []).filter((s): s is CvSourceKind => (CV_SOURCES as readonly string[]).includes(String(s))),
    contactId,
    name: str(r.name),
    email,
    phone: str(r.phone),
    place: placeLabel(r),
    caseId: str(r.case_id),
    caseNumber: str(r.case_number),
    caseType: str(r.case_type),
    caseStatus: str(r.case_status),
    unhandled: r.unhandled === true,
    topicPhrases: Array.isArray(r.topic_phrases) ? r.topic_phrases.map(String) : [],
    openPath: email ? cvFilePath(email, documentId) : contactId ? `/api/candidates/${contactId}/files/${documentId}` : null,
  };
};

/** SOSL reserves these characters; they are escaped, so a search is always words, never syntax. */
const escapeSosl = (s: string) => s.replace(/[?&|!{}[\]()^~*:\\"'+-]/g, (c) => `\\${c}`);

/**
 * Files whose text (or name) holds the words, from Salesforce's full-text index — the files are
 * never read here. null when Salesforce is not reachable.
 */
export async function findInFiles(text: string): Promise<Set<string> | null> {
  const words = text.trim().replace(/\s+/g, " ").slice(0, 100);
  if (words.length < 2 || !salesforceConfigured()) return null;
  try {
    const res = await sf.search<{ ContentDocumentId: string }>(
      `FIND {${escapeSosl(words)}} IN ALL FIELDS RETURNING ContentVersion(ContentDocumentId WHERE IsLatest = true) LIMIT 2000`,
    );
    return new Set(res.searchRecords.map((r) => r.ContentDocumentId));
  } catch (err) {
    logError("cv text search", err);
    return null;
  }
}

/** Who is searching, so a search inside the files is logged in full: what was asked and what came back. */
export interface SearchActor {
  actor: string;
  via: "screen" | "mcp";
}

/** How many of the results a log entry lists by name. */
const LOGGED_RESULTS = 200;

async function logTextSearch(f: CvFilters, found: Set<string> | null, where: SQL, total: number, who: SearchActor): Promise<void> {
  // A word search Salesforce did not answer returned nothing; a topic search reads the mirror.
  const rows =
    !f.text || found
      ? await run(sql`${CVS} SELECT v.document_id, v.title, v.name, v.email FROM cv v WHERE ${where} ORDER BY v.received_at DESC NULLS LAST LIMIT ${LOGGED_RESULTS}`)
      : [];
  const { text, ...filters } = f;
  // A topic-only search is logged under the topic's name.
  await writeAudit(who.actor, "cvs.text_search", text || `נושא: ${topicLabel(f.topic) ?? f.topic}`, {
    via: who.via,
    filters: Object.fromEntries(Object.entries(filters).filter(([, v]) => v)),
    // How many files Salesforce's index matched, and how many of them passed the other filters.
    matched: found?.size ?? null,
    results: total,
    files: rows.map((r) => ({ documentId: String(r.document_id), title: str(r.title), name: str(r.name), email: str(r.email) })),
  });
}

function whereOf(f: CvFilters, found: Set<string> | null): SQL {
  const parts: SQL[] = [sql`true`];
  if (f.q) {
    const p = containsPattern(f.q);
    parts.push(sql`(v.name ILIKE ${p} OR v.email ILIKE ${p} OR v.title ILIKE ${p} OR v.case_number ILIKE ${p})`);
  }
  if (f.source) parts.push(sql`${f.source} = ANY(v.sources)`);
  if (f.unhandled === "yes") parts.push(sql`v.unhandled`);
  if (f.unhandled === "no") parts.push(sql`NOT v.unhandled`);
  if (f.kind !== "all") parts.push(sql`v.extension IN ${CV_EXTENSIONS}`);
  parts.push(...placeFilterSql("v", f.area, f.napa));
  const { from, to } = dayBounds(f.fromDay, f.toDay);
  if (from) parts.push(sql`v.received_at >= ${from}`);
  if (to) parts.push(sql`v.received_at < ${to}`);
  if (f.text) {
    const ids = [...(found ?? [])];
    parts.push(ids.length ? sql`v.document_id IN ${ids}` : sql`false`);
  }
  if (f.topic) parts.push(isTopicId(f.topic) ? sql`v.document_id IN (SELECT document_id FROM cv_topics WHERE topic_id = ${f.topic})` : sql`false`);
  return sql.join(parts, sql` AND `);
}

/** Searches inside the files — words or a topic — are logged in full. */
const searchesInside = (f: CvFilters) => Boolean(f.text || f.topic);

/** How many files each topic and group holds under the other filters (the topic filter itself left out). */
async function topicCounts(f: CvFilters, found: Set<string> | null): Promise<Map<string, number>> {
  const where = whereOf({ ...f, topic: "" }, found);
  const rows = await run(sql`${CVS} SELECT t.topic_id, count(*) AS n FROM cv v JOIN cv_topics t ON t.document_id = v.document_id WHERE ${where} GROUP BY t.topic_id`);
  return new Map(rows.map((r) => [String(r.topic_id), num(r.n)]));
}

export async function searchCvs(
  f: CvFilters,
  {
    page = 1,
    pageSize = PAGE_SIZE,
    sort,
    who,
    topics = false,
  }: { page?: number; pageSize?: number; sort?: Sort; who?: SearchActor; /** Also count the files under each topic. */ topics?: boolean } = {},
): Promise<{
  rows: CvRow[];
  total: number;
  unhandled: number;
  textSearch: "ok" | "unavailable" | null;
  topicCounts: Map<string, number> | null;
}> {
  const found = f.text ? await findInFiles(f.text) : null;
  const where = whereOf(f, found);
  const phrases = f.topic && isTopicId(f.topic) ? sql`(SELECT t.phrases FROM cv_topics t WHERE t.document_id = v.document_id AND t.topic_id = ${f.topic})` : sql`NULL`;
  const [rows, count, counts] = await Promise.all([
    run(sql`${CVS} SELECT v.*, ${phrases} AS topic_phrases FROM cv v WHERE ${where}
             ORDER BY ${orderBy(CV_SORTS, sort ?? { key: "received", dir: "desc" }, sql`v.document_id`)}
             LIMIT ${pageSize} OFFSET ${(page - 1) * pageSize}`),
    run(sql`${CVS} SELECT count(*) AS n, count(*) FILTER (WHERE v.unhandled) AS unhandled FROM cv v WHERE ${where}`),
    topics ? topicCounts(f, found) : null,
  ]);
  if (searchesInside(f) && who) await logTextSearch(f, found, where, num(count[0]?.n), who);
  return {
    rows: rows.map(toRow),
    total: num(count[0]?.n),
    unhandled: num(count[0]?.unhandled),
    textSearch: f.text ? (found ? "ok" : "unavailable") : null,
    topicCounts: counts,
  };
}

export interface CvLink {
  type: CvSourceKind;
  /** The Contact, Case or email the file hangs on. */
  entityId: string;
  /** For an email: its Case, subject and date. */
  caseId: string | null;
  subject: string | null;
  at: Date | null;
}

/** One file, with every place it hangs. null when the mirror does not know it. */
export async function loadCv(documentId: string): Promise<{ cv: CvRow; links: CvLink[] } | null> {
  if (!/^069[a-zA-Z0-9]{12,15}$/.test(documentId)) return null;
  const [row] = await run(sql`${CVS} SELECT v.* FROM cv v WHERE v.document_id = ${documentId}`);
  if (!row) return null;
  const links = await run(sql`
    SELECT l.entity_type, l.linked_entity_id, m.parent_id, m.subject, m.message_date
      FROM sf_file_link l LEFT JOIN sf_email_message m ON l.entity_type = 'email' AND m.id = l.linked_entity_id
     WHERE l.document_id = ${documentId}
     ORDER BY m.message_date NULLS FIRST`);
  return {
    cv: toRow(row),
    links: links.map((l) => ({
      type: String(l.entity_type) as CvSourceKind,
      entityId: String(l.linked_entity_id),
      caseId: l.entity_type === "case" ? String(l.linked_entity_id) : str(l.parent_id),
      subject: str(l.subject),
      at: asDate(l.message_date),
    })),
  };
}

export interface CvSummary {
  files: number;
  people: number;
  unhandled: { files: number; cases: number };
  bySource: Record<CvSourceKind, number>;
  /** Files by the month they arrived (YYYY-MM), with how many of them were never handled. */
  byMonth: { month: string; files: number; unhandled: number }[];
}

/** The figures behind the list, for the MCP and the page header: under the same filters. */
export async function cvSummary(f: CvFilters, who?: SearchActor): Promise<CvSummary & { textSearch: "ok" | "unavailable" | null }> {
  const found = f.text ? await findInFiles(f.text) : null;
  const where = whereOf(f, found);
  const [totals, months, cases] = await Promise.all([
    run(sql`${CVS}
      SELECT count(*) AS files, count(DISTINCT coalesce(v.email, v.contact_id, v.document_id)) AS people,
             count(*) FILTER (WHERE v.unhandled) AS unhandled,
             count(*) FILTER (WHERE 'contact' = ANY(v.sources)) AS on_contact,
             count(*) FILTER (WHERE 'case' = ANY(v.sources)) AS on_case,
             count(*) FILTER (WHERE 'email' = ANY(v.sources)) AS on_email
        FROM cv v WHERE ${where}`),
    run(sql`${CVS}
      SELECT to_char(v.received_at AT TIME ZONE 'Asia/Jerusalem', 'YYYY-MM') AS month, count(*) AS files, count(*) FILTER (WHERE v.unhandled) AS unhandled
        FROM cv v WHERE ${where} AND v.received_at IS NOT NULL GROUP BY 1 ORDER BY 1`),
    run(sql`WITH ${UNHANDLED} SELECT count(*) AS n FROM unhandled`),
  ]);
  const t = totals[0] ?? {};
  if (searchesInside(f) && who) await logTextSearch(f, found, where, num(t.files), who);
  return {
    files: num(t.files),
    people: num(t.people),
    unhandled: { files: num(t.unhandled), cases: num(cases[0]?.n) },
    bySource: { contact: num(t.on_contact), case: num(t.on_case), email: num(t.on_email) },
    byMonth: months.map((m) => ({ month: String(m.month), files: num(m.files), unhandled: num(m.unhandled) })),
    textSearch: f.text ? (found ? "ok" : "unavailable") : null,
  };
}

/** The topics one file matched, with the phrases found. */
export async function loadCvTopics(documentId: string): Promise<{ topicId: string; phrases: string[] }[]> {
  const rows = await run(sql`SELECT topic_id, phrases FROM cv_topics WHERE document_id = ${documentId} ORDER BY topic_id`);
  return rows.map((r) => ({ topicId: String(r.topic_id), phrases: Array.isArray(r.phrases) ? r.phrases.map(String) : [] }));
}

/** Every topic and group with its files under the filters (for the MCP), and when the topics were last refreshed. */
export async function cvTopicCounts(f: CvFilters): Promise<{ counts: Map<string, number>; refreshedAt: Date | null; textSearch: "ok" | "unavailable" | null }> {
  const found = f.text ? await findInFiles(f.text) : null;
  const [counts, refreshedAt] = await Promise.all([topicCounts(f, found), topicsRefreshedAt()]);
  return { counts, refreshedAt, textSearch: f.text ? (found ? "ok" : "unavailable") : null };
}

export async function topicsRefreshedAt(): Promise<Date | null> {
  const [row] = await run(sql`SELECT last_success_at FROM sync_state WHERE object = ${TOPICS_OBJECT}`);
  return asDate(row?.last_success_at);
}

export type CvContactField = "email" | "phone";
export const MAX_CV_CONTACTS = 5_000;
/** SKEELZ's own mail domain, left out of the copied addresses. */
const OWN_EMAIL_DOMAIN = "skeelz.co.il";

/**
 * The emails (or phones) of the people behind every file the filter finds — not only the page on
 * screen — each once (phones compared by digits), newest file first. `files` is how many files matched.
 */
export async function loadCvContacts(
  f: CvFilters,
  field: CvContactField,
): Promise<{ values: string[]; files: number; truncated: boolean; textSearch: "ok" | "unavailable" | null }> {
  const found = f.text ? await findInFiles(f.text) : null;
  const where = whereOf(f, found);
  const column = field === "email" ? sql`v.email` : sql`v.phone`;
  // A CV a staff member forwarded or tried can carry their own address; it is no candidate's.
  const own = field === "email" ? sql`AND v.email NOT ILIKE ${`%@${OWN_EMAIL_DOMAIN}`}` : sql``;
  const [rows, count] = await Promise.all([
    run(sql`${CVS} SELECT ${column} AS v, max(v.received_at) AS at FROM cv v
             WHERE ${where} AND ${column} IS NOT NULL AND btrim(${column}) <> '' ${own}
             GROUP BY 1 ORDER BY 2 DESC NULLS LAST LIMIT ${MAX_CV_CONTACTS + 1}`),
    run(sql`${CVS} SELECT count(*) AS n FROM cv v WHERE ${where}`),
  ]);
  const seen = new Set<string>();
  const values: string[] = [];
  for (const r of rows) {
    const value = String(r.v).trim();
    const key = field === "phone" ? value.replace(/\D/g, "") : value.toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    values.push(field === "email" ? key : value);
  }
  return {
    values: values.slice(0, MAX_CV_CONTACTS),
    files: num(count[0]?.n),
    truncated: values.length > MAX_CV_CONTACTS,
    textSearch: f.text ? (found ? "ok" : "unavailable") : null,
  };
}

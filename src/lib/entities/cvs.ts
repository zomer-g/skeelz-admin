import { sql, type SQL } from "drizzle-orm";
import { logError } from "@/lib/log";
import { RECORD_TYPES } from "@/lib/metrics/candidates";
import { salesforceConfigured, sf } from "@/lib/sf/client";
import { cvFilePath } from "./cv";
import { asDate, containsPattern, dayBounds, num, PAGE_SIZE, run, str } from "./search";
import { orderBy, type Sort, type SortColumn } from "./sort";

/**
 * Every CV in one list (/cvs): the files on Contacts, on CV ("קורות חיים") and application Cases,
 * and on those Cases' emails, from the mirrored file links (lib/sf/sync-files.ts, metadata only).
 * One row per file, with the person it belongs to and the CV Case it came in on.
 *
 * "Never handled": a stretch of CVs went unanswered. Those are CV Cases that the staff never
 * touched — nobody set their Contact, changed their type or owner, or moved their status — and
 * that were closed in the bulk closure of 14.10.2026. Their history holds only their creation and
 * that closure (and any other status change by the same user).
 */

/** The bulk closure of untouched CV Cases: who did it, and on which Israel day. */
export const BULK_CLOSURE = { userId: "0058d000006jfKjAAI", day: "2026-10-14" } as const;

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
  caseId: string | null;
  caseNumber: string | null;
  caseType: string | null;
  caseStatus: string | null;
  unhandled: boolean;
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
            AND NOT (h.field = 'Status' AND h.created_by_id = ${BULK_CLOSURE.userId}))
  )`;

/** One row per file, with its person and its Case (a CV Case first). */
const CVS = sql`
  WITH ${UNHANDLED},
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
    caseId: str(r.case_id),
    caseNumber: str(r.case_number),
    caseType: str(r.case_type),
    caseStatus: str(r.case_status),
    unhandled: r.unhandled === true,
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
  const { from, to } = dayBounds(f.fromDay, f.toDay);
  if (from) parts.push(sql`v.received_at >= ${from}`);
  if (to) parts.push(sql`v.received_at < ${to}`);
  if (f.text) {
    const ids = [...(found ?? [])];
    parts.push(ids.length ? sql`v.document_id IN ${ids}` : sql`false`);
  }
  return sql.join(parts, sql` AND `);
}

export async function searchCvs(
  f: CvFilters,
  { page = 1, pageSize = PAGE_SIZE, sort }: { page?: number; pageSize?: number; sort?: Sort } = {},
): Promise<{ rows: CvRow[]; total: number; unhandled: number; textSearch: "ok" | "unavailable" | null }> {
  const found = f.text ? await findInFiles(f.text) : null;
  const where = whereOf(f, found);
  const [rows, count] = await Promise.all([
    run(sql`${CVS} SELECT v.* FROM cv v WHERE ${where}
             ORDER BY ${orderBy(CV_SORTS, sort ?? { key: "received", dir: "desc" }, sql`v.document_id`)}
             LIMIT ${pageSize} OFFSET ${(page - 1) * pageSize}`),
    run(sql`${CVS} SELECT count(*) AS n, count(*) FILTER (WHERE v.unhandled) AS unhandled FROM cv v WHERE ${where}`),
  ]);
  return {
    rows: rows.map(toRow),
    total: num(count[0]?.n),
    unhandled: num(count[0]?.unhandled),
    textSearch: f.text ? (found ? "ok" : "unavailable") : null,
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
export async function cvSummary(f: CvFilters): Promise<CvSummary & { textSearch: "ok" | "unavailable" | null }> {
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
  return {
    files: num(t.files),
    people: num(t.people),
    unhandled: { files: num(t.unhandled), cases: num(cases[0]?.n) },
    bySource: { contact: num(t.on_contact), case: num(t.on_case), email: num(t.on_email) },
    byMonth: months.map((m) => ({ month: String(m.month), files: num(m.files), unhandled: num(m.unhandled) })),
    textSearch: f.text ? (found ? "ok" : "unavailable") : null,
  };
}

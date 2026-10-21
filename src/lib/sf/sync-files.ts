import { eq, getTableColumns, inArray, sql } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { sfFileLink, syncRuns, syncState } from "@/lib/db/schema";
import { logError, safeErrorMessage } from "@/lib/log";
import { RECORD_TYPES } from "@/lib/metrics/candidates";
import { sf } from "./client";
import { toDate } from "./sync-objects";

/**
 * Mirrors where candidate files hang (ContentDocumentLink) — never the files. ContentDocumentLink
 * can only be read filtered by the records it links to, and SOQL allows no OR between semi-joins,
 * so each kind of record is its own query:
 *   contact   every file on a Contact
 *   case      files on a CV ("קורות חיים") Case or an application
 *   email     files on an email of one of those Cases — where a CV that arrived by mail lands
 * Incremental runs read links added since the cursor; full and reconcile runs read them all and
 * drop the ones Salesforce no longer has.
 */

export const FILES_OBJECT = "Files";

/** The Case types whose files are candidate files. */
export const FILE_CASE_TYPES = [RECORD_TYPES.cvMessage, RECORD_TYPES.application, RECORD_TYPES.accepted];

const caseTypes = FILE_CASE_TYPES.map((t) => `'${t}'`).join(", ");
const SOURCES: { type: "contact" | "case" | "email"; where: string }[] = [
  { type: "contact", where: "LinkedEntityId IN (SELECT Id FROM Contact)" },
  { type: "case", where: `LinkedEntityId IN (SELECT Id FROM Case WHERE RecordType.DeveloperName IN (${caseTypes}))` },
  { type: "email", where: `LinkedEntityId IN (SELECT Id FROM EmailMessage WHERE Parent.RecordType.DeveloperName IN (${caseTypes}))` },
];

const FIELDS =
  "Id, ContentDocumentId, LinkedEntityId, SystemModstamp, ContentDocument.Title, ContentDocument.FileExtension, " +
  "ContentDocument.ContentSize, ContentDocument.CreatedDate, ContentDocument.LatestPublishedVersionId";

const CURSOR_OVERLAP_MS = 2 * 60_000;
const UPSERT_CHUNK = 500;

interface LinkRecord {
  Id: string;
  ContentDocumentId: string;
  LinkedEntityId: string;
  SystemModstamp: string;
  ContentDocument: { Title: string; FileExtension: string | null; ContentSize: number; CreatedDate: string; LatestPublishedVersionId: string };
}

const soqlDateTime = (d: Date) => d.toISOString().replace(/\.\d{3}Z$/, "Z");

export async function syncFiles(mode: "incremental" | "full" | "reconcile", trigger: string) {
  const db = getDb();
  const started = Date.now();
  const [run] = await db.insert(syncRuns).values({ object: FILES_OBJECT, mode, trigger }).returning({ id: syncRuns.id });
  const [state] = await db.select().from(syncState).where(eq(syncState.object, FILES_OBJECT));
  await db
    .insert(syncState)
    .values({ object: FILES_OBJECT, lastStartedAt: new Date() })
    .onConflictDoUpdate({ target: syncState.object, set: { lastStartedAt: new Date() } });

  const everything = mode !== "incremental" || !state?.cursor;
  const since = everything ? null : new Date(state!.cursor!.getTime() - CURSOR_OVERLAP_MS);
  const columns = getTableColumns(sfFileLink);
  const set = Object.fromEntries(
    (Object.entries(columns) as [string, { name: string }][]).filter(([k]) => k !== "id").map(([k, c]) => [k, sql.raw(`excluded."${c.name}"`)]),
  );

  let upserted = 0;
  let deleted = 0;
  let cursor = state?.cursor ?? null;
  const seen = new Set<string>();
  try {
    for (const source of SOURCES) {
      const soql = `SELECT ${FIELDS} FROM ContentDocumentLink WHERE ${source.where}${since ? ` AND SystemModstamp > ${soqlDateTime(since)}` : ""}`;
      for await (const page of sf.queryPages<LinkRecord>(soql)) {
        const rows = page.map((r) => {
          seen.add(r.Id);
          const at = toDate(r.SystemModstamp);
          if (at && (!cursor || at > cursor)) cursor = at;
          return {
            id: r.Id,
            documentId: r.ContentDocumentId,
            linkedEntityId: r.LinkedEntityId,
            entityType: source.type,
            title: r.ContentDocument?.Title ?? null,
            extension: r.ContentDocument?.FileExtension?.toLowerCase() ?? null,
            size: r.ContentDocument?.ContentSize ?? null,
            versionId: r.ContentDocument?.LatestPublishedVersionId ?? null,
            documentCreatedAt: toDate(r.ContentDocument?.CreatedDate),
            systemModstamp: at,
          };
        });
        for (let i = 0; i < rows.length; i += UPSERT_CHUNK) {
          await db.insert(sfFileLink).values(rows.slice(i, i + UPSERT_CHUNK)).onConflictDoUpdate({ target: sfFileLink.id, set });
        }
        upserted += rows.length;
      }
    }
    if (everything) {
      // A full read that came back empty is a permission problem, not every file gone.
      const local = (await db.select({ id: sfFileLink.id }).from(sfFileLink)).map((r) => r.id);
      if (seen.size || !local.length) {
        const stale = local.filter((id) => !seen.has(id));
        for (let i = 0; i < stale.length; i += UPSERT_CHUNK) await db.delete(sfFileLink).where(inArray(sfFileLink.id, stale.slice(i, i + UPSERT_CHUNK)));
        deleted = stale.length;
      }
    }
    const [{ n }] = (await db.execute<{ n: number }>(sql`SELECT count(*)::int AS n FROM sf_file_link`)).rows as { n: number }[];
    await db
      .update(syncState)
      .set({ cursor, lastSuccessAt: new Date(), lastError: null, rowCount: n })
      .where(eq(syncState.object, FILES_OBJECT));
    await db.update(syncRuns).set({ finishedAt: new Date(), upserted, deleted, apiUsage: sf.lastLimitInfo() }).where(eq(syncRuns.id, run!.id));
    return { object: FILES_OBJECT, upserted, deleted, ms: Date.now() - started };
  } catch (err) {
    const error = safeErrorMessage(err);
    logError(`sync ${FILES_OBJECT} ${mode}`, err);
    await db.update(syncState).set({ lastError: error.slice(0, 2000) }).where(eq(syncState.object, FILES_OBJECT));
    await db.update(syncRuns).set({ finishedAt: new Date(), upserted, deleted, error }).where(eq(syncRuns.id, run!.id));
    return { object: FILES_OBJECT, upserted, deleted, error, ms: Date.now() - started };
  }
}

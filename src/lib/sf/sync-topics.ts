import { createHash } from "node:crypto";
import { eq, inArray, sql } from "drizzle-orm";
import { phraseForms, phraseIndex, soslTerm } from "@/lib/cv-topics";
import { getDb } from "@/lib/db/client";
import { cvTopics, cvTopicScans, syncRuns, syncState } from "@/lib/db/schema";
import { logError, safeErrorMessage } from "@/lib/log";
import { sf } from "./client";

/**
 * Tags candidate files with the topics of lib/cv-topics.ts. Each phrase is one SOSL search over the
 * files' text (every Hebrew prefix and quote form OR-ed); a file belongs to every topic, and group,
 * whose phrase it matched.
 *
 * Each file is searched once: cv_topic_scans remembers which files were searched under which version
 * of the topic list. Once an hour the incremental sync looks for files not searched yet — new CVs, once
 * they are an hour old and Salesforce has indexed their text — and searches only them (SOSL filtered to their ids); with none, it calls nothing. Changing the list
 * changes its version, so every file is searched again once, the next hour. A full sync from
 * /admin/sync rebuilds everything and drops files that left the mirror; the nightly reconcile skips it.
 *
 * Many files at once (a first build, a new list) are searched in the whole index instead, one search
 * a phrase. SOSL returns at most 2,000 records; a phrase that hits that is searched again by file
 * creation date, halving the range until each part fits.
 */

export const TOPICS_OBJECT = "CvTopics";

/** Changes whenever a phrase or what it counts for changes. */
export const TOPICS_VERSION = createHash("sha256")
  .update(JSON.stringify([...phraseIndex()].map(([phrase, ids]) => [phrase, [...ids].sort()])))
  .digest("hex")
  .slice(0, 12);

const CHECK_EVERY_MS = 3_600_000;
/** How old a file must be before it is searched: the full-text index lags behind uploads. */
const INDEX_DELAY_MIN = 60;
/** Above this many files to search, one search a phrase over the whole index beats searches by id lists. */
const WHOLE_INDEX_FROM = 300;
const ID_BATCH = 200;
const SOSL_LIMIT = 2000;
const CONCURRENCY = 4;
const WRITE_CHUNK = 1000;
/** Before any file in the org; the search's date ranges start here. */
const EPOCH = new Date("2010-01-01T00:00:00Z");
const DAY_MS = 86_400_000;

const soslDateTime = (d: Date) => d.toISOString().replace(/\.\d{3}Z$/, "Z");
const isDocumentId = (id: string) => /^069[a-zA-Z0-9]{12}(?:[a-zA-Z0-9]{3})?$/.test(id);

async function search(term: string, filter: string): Promise<string[]> {
  const res = await sf.search<{ ContentDocumentId: string }>(
    `FIND {${term}} IN ALL FIELDS RETURNING ContentVersion(ContentDocumentId WHERE IsLatest = true${filter}) LIMIT ${SOSL_LIMIT}`,
  );
  return res.searchRecords.map((r) => r.ContentDocumentId);
}

/** Every file in the index matching the term, past the 2,000 cap. `capped` when even a one-day range hit it. */
async function searchAll(term: string, from: Date | null = null, to: Date | null = null): Promise<{ ids: Set<string>; capped: boolean }> {
  const ids = await search(term, from && to ? ` AND CreatedDate >= ${soslDateTime(from)} AND CreatedDate < ${soslDateTime(to)}` : "");
  if (ids.length < SOSL_LIMIT) return { ids: new Set(ids), capped: false };
  const start = from ?? EPOCH;
  const end = to ?? new Date(Date.now() + DAY_MS);
  if (end.getTime() - start.getTime() <= DAY_MS) return { ids: new Set(ids), capped: true };
  const mid = new Date(start.getTime() + Math.floor((end.getTime() - start.getTime()) / 2));
  const [a, b] = [await searchAll(term, start, mid), await searchAll(term, mid, end)];
  return { ids: new Set([...a.ids, ...b.ids]), capped: a.capped || b.capped };
}

/** The files among `ids` (at most ID_BATCH) matching the term. */
const searchIn = async (term: string, ids: string[]) => new Set(await search(term, ` AND ContentDocumentId IN ('${ids.join("','")}')`));

export interface TopicsResult {
  object: string;
  /** Files searched. */
  upserted: number;
  deleted: number;
  error?: string;
  ms: number;
}

/** null when there was nothing to do: a reconcile, the last check within the hour, or no file left to search. */
export async function syncTopics(mode: "incremental" | "full" | "reconcile", trigger: string): Promise<TopicsResult | null> {
  if (mode === "reconcile") return null;
  const db = getDb();
  const [state] = await db.select().from(syncState).where(eq(syncState.object, TOPICS_OBJECT));
  if (mode === "incremental" && state?.lastSuccessAt && Date.now() - state.lastSuccessAt.getTime() < CHECK_EVERY_MS) return null;

  const rebuild = mode === "full";
  const pending = (
    (
      await db.execute<{ id: string }>(
        rebuild
          ? sql`SELECT DISTINCT document_id AS id FROM sf_file_link`
          : sql`SELECT l.document_id AS id FROM sf_file_link l
                 LEFT JOIN cv_topic_scans s ON s.document_id = l.document_id
                 WHERE s.document_id IS NULL OR s.version <> ${TOPICS_VERSION}
                 GROUP BY l.document_id
                -- Salesforce indexes a file's text a while after it arrives; searched too soon, it would stay untagged.
                HAVING coalesce(min(l.document_created_at), now()) < now() - ${`${INDEX_DELAY_MIN} minutes`}::interval`,
      )
    ).rows as { id: string }[]
  )
    .map((r) => r.id)
    .filter(isDocumentId);
  if (!pending.length) {
    await db
      .insert(syncState)
      .values({ object: TOPICS_OBJECT, lastSuccessAt: new Date() })
      .onConflictDoUpdate({ target: syncState.object, set: { lastSuccessAt: new Date(), lastError: null } });
    return null;
  }

  const started = Date.now();
  const [run] = await db.insert(syncRuns).values({ object: TOPICS_OBJECT, mode, trigger }).returning({ id: syncRuns.id });
  await db
    .insert(syncState)
    .values({ object: TOPICS_OBJECT, lastStartedAt: new Date() })
    .onConflictDoUpdate({ target: syncState.object, set: { lastStartedAt: new Date() } });

  try {
    const wanted = new Set(pending);
    // document → topic → the phrases found
    const found = new Map<string, Map<string, Set<string>>>();
    const capped: string[] = [];
    const record = (ids: Iterable<string>, phrase: string, topics: Set<string>) => {
      for (const id of ids) {
        if (!wanted.has(id)) continue;
        const byTopic = found.get(id) ?? new Map<string, Set<string>>();
        for (const t of topics) byTopic.set(t, (byTopic.get(t) ?? new Set()).add(phrase));
        found.set(id, byTopic);
      }
    };
    const whole = pending.length > WHOLE_INDEX_FROM;
    const batches = whole ? [null] : Array.from({ length: Math.ceil(pending.length / ID_BATCH) }, (_, i) => pending.slice(i * ID_BATCH, (i + 1) * ID_BATCH));
    const phrases = [...phraseIndex()];
    for (const batch of batches) {
      for (let i = 0; i < phrases.length; i += CONCURRENCY) {
        await Promise.all(
          phrases.slice(i, i + CONCURRENCY).map(async ([phrase, topics]) => {
            const term = soslTerm(phraseForms(phrase));
            if (batch) return record(await searchIn(term, batch), phrase, topics);
            const res = await searchAll(term);
            if (res.capped) capped.push(phrase);
            record(res.ids, phrase, topics);
          }),
        );
      }
    }

    const rows = [...found].flatMap(([documentId, byTopic]) => [...byTopic].map(([topicId, ps]) => ({ documentId, topicId, phrases: [...ps].sort() })));
    // A whole-index search that finds nothing at all is a search or permission problem, not every CV empty.
    if (whole && !rows.length) throw new Error(`topic search found nothing in ${pending.length} files; keeping what is there`);
    let deleted = 0;
    await db.transaction(async (tx) => {
      if (rebuild) {
        // Files that left the mirror.
        const gone = await tx.execute(sql`DELETE FROM cv_topic_scans s WHERE NOT EXISTS (SELECT 1 FROM sf_file_link l WHERE l.document_id = s.document_id)`);
        await tx.execute(sql`DELETE FROM cv_topics t WHERE NOT EXISTS (SELECT 1 FROM sf_file_link l WHERE l.document_id = t.document_id)`);
        deleted = gone.rowCount ?? 0;
      }
      for (let i = 0; i < pending.length; i += WRITE_CHUNK) {
        const chunk = pending.slice(i, i + WRITE_CHUNK);
        await tx.delete(cvTopics).where(inArray(cvTopics.documentId, chunk));
        await tx
          .insert(cvTopicScans)
          .values(chunk.map((documentId) => ({ documentId, version: TOPICS_VERSION })))
          .onConflictDoUpdate({ target: cvTopicScans.documentId, set: { version: TOPICS_VERSION, scannedAt: new Date() } });
      }
      for (let i = 0; i < rows.length; i += WRITE_CHUNK) await tx.insert(cvTopics).values(rows.slice(i, i + WRITE_CHUNK));
    });

    if (capped.length) console.warn(`[sync] ${TOPICS_OBJECT}: still ${SOSL_LIMIT} matches within one day for ${capped.join(", ")}`);
    const [{ n }] = (await db.execute<{ n: number }>(sql`SELECT count(DISTINCT document_id)::int AS n FROM cv_topics`)).rows as { n: number }[];
    await db
      .update(syncState)
      .set({ cursor: new Date(), lastSuccessAt: new Date(), lastError: null, rowCount: n })
      .where(eq(syncState.object, TOPICS_OBJECT));
    await db
      .update(syncRuns)
      .set({ finishedAt: new Date(), upserted: pending.length, deleted, apiUsage: sf.lastLimitInfo() })
      .where(eq(syncRuns.id, run!.id));
    return { object: TOPICS_OBJECT, upserted: pending.length, deleted, ms: Date.now() - started };
  } catch (err) {
    const error = safeErrorMessage(err);
    logError(`sync ${TOPICS_OBJECT} ${mode}`, err);
    await db.update(syncState).set({ lastError: error.slice(0, 2000) }).where(eq(syncState.object, TOPICS_OBJECT));
    await db.update(syncRuns).set({ finishedAt: new Date(), error }).where(eq(syncRuns.id, run!.id));
    return { object: TOPICS_OBJECT, upserted: 0, deleted: 0, error, ms: Date.now() - started };
  }
}

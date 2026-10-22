import { sql, type SQL } from "drizzle-orm";
import { writeAudit } from "@/lib/audit";
import { isTopicId, phraseForms, soslTerm } from "@/lib/cv-topics";
import { placeLabel, type PlaceLabel } from "@/lib/geo/filters";
import { GEO_CTES } from "@/lib/geo/localities";
import { districtOf } from "@/lib/geo/map";
import { groupOf, jobTopics, suggestedTopics, titleKeywords, type JobTopic } from "@/lib/job-topics";
import { RECORD_TYPES } from "@/lib/metrics/candidates";
import { companyKeySql, companyNameOf } from "@/lib/metrics/company";
import { jobPlaceSql } from "@/lib/metrics/geo";
import { jobPaidSql } from "@/lib/metrics/paid";
import { logError } from "@/lib/log";
import { salesforceConfigured, sf } from "@/lib/sf/client";
import { skillNames } from "@/lib/skills";
import { cvFilePath } from "./cv";
import { CV_EXTENSIONS, CVS, type SearchActor } from "./cvs";
import { asDate, htmlToText, isSfId, isTrue, num, PAGE_SIZE, run, str } from "./search";

/**
 * Outreach (/outreach, "פעילות יזומה"): for a job, the candidates whose CVs fit it best, so the
 * staff can approach them before they apply. The job's field is read from its title, description and
 * skills (lib/job-topics.ts), in the topics CVs are tagged with (cv_topics); its place is the CBS
 * locality of the job (lib/geo). Each person is ranked by their best CV:
 *
 *   topic  — a chosen topic in the CV counts TOPIC_WEIGHT, a chosen group GROUP_WEIGHT, and the
 *            group of a chosen topic (the same broad field) FIELD_WEIGHT; each chosen word found in
 *            the CV (live from Salesforce's index, for jobs no topic covers) WORD_WEIGHT;
 *   place  — the person lives in the job's sub-district (PLACE_NAPA) or district (PLACE_DISTRICT);
 *   fresh  — the CV arrived in the last 90 days (FRESH_RECENT) or year (FRESH_YEAR).
 *
 * Only CVs with a topic or word match are listed. People who already applied to the job are left out unless
 * asked for. Every search is logged like a search inside the CVs (cvs.text_search), with its results.
 */

const TOPIC_WEIGHT = 3;
const GROUP_WEIGHT = 2;
const FIELD_WEIGHT = 1;
const PLACE_NAPA = 3;
const PLACE_DISTRICT = 1.5;
const FRESH_RECENT = 1;
const FRESH_YEAR = 0.5;
/** Each chosen word found in the CV. */
const WORD_WEIGHT = 2;
/** How many of the results a log entry lists by name, as on /cvs. */
const LOGGED_RESULTS = 200;

/** How far from the job to look: its sub-district, its district, or the whole country. */
export const REACHES = ["napa", "district", "all"] as const;
export type Reach = (typeof REACHES)[number];
export const REACH_LABELS: Record<Reach, string> = { napa: "באותה נפה", district: "באותו מחוז", all: "בכל הארץ" };

export interface OutreachJob {
  id: string;
  caseNumber: string | null;
  title: string | null;
  company: string | null;
  companyKey: string | null;
  status: string | null;
  paid: boolean;
  place: PlaceLabel;
  /** CBS sub-district of the job, when it has a locality. */
  napa: number | null;
  skills: string[];
  createdAt: Date | null;
  /** The fields the job's text points at, strongest first, and the ones to search by. */
  topics: JobTopic[];
  suggested: string[];
  /** Words of the title to look for inside CVs, for a job no topic fits (lib/job-topics.ts). */
  keywords: string[];
}

const PLACE = jobPlaceSql("p");
const COMPANY_NAME = companyNameOf();

const JOBS = sql`
  WITH ${GEO_CTES}
  SELECT p.id, p.created_date, p.data->>'CaseNumber' AS case_number,
         coalesce(nullif(p.data->>'Position_cambium__c', ''), nullif(p.data->>'Position_Name__c', ''), nullif(p.data->>'Subject', '')) AS title,
         ${sql.raw(COMPANY_NAME)} AS company, ${companyKeySql(COMPANY_NAME)} AS company_key,
         nullif(p.data->>'PStatus__c', '') AS p_status, ${jobPaidSql("p")} AS paid,
         p.data->>'PDescription_cambium__c' AS description, p.data->>'PSkills_cambium__c' AS skill_ids,
         ${PLACE.kind} AS place_kind, ${PLACE.napa} AS napa, ${PLACE.locality} AS locality
    FROM sf_case p
    JOIN sf_record_type rt ON rt.id = p.record_type_id
    LEFT JOIN sf_account acc ON acc.id = p.account_id
    ${PLACE.joins}
   WHERE rt.developer_name = ${RECORD_TYPES.position} AND NOT p.is_deleted`;

function toJob(r: Record<string, unknown>): OutreachJob {
  const title = str(r.title);
  const skills = skillNames(str(r.skill_ids));
  const topics = jobTopics({ title, description: htmlToText(str(r.description)), skills });
  return {
    id: String(r.id),
    caseNumber: str(r.case_number),
    title,
    company: str(r.company),
    companyKey: str(r.company_key),
    status: str(r.p_status),
    paid: isTrue(r.paid),
    place: placeLabel(r),
    napa: r.napa == null ? null : Number(r.napa),
    skills,
    createdAt: asDate(r.created_date),
    topics,
    suggested: suggestedTopics(topics),
    keywords: titleKeywords(title),
  };
}

export async function loadOutreachJob(id: string): Promise<OutreachJob | null> {
  if (!isSfId(id)) return null;
  const [row] = await run(sql`${JOBS} AND p.id = ${id}`);
  return row ? toJob(row) : null;
}

/** The same, for a page of the jobs list. */
export async function loadOutreachJobs(ids: string[]): Promise<Map<string, OutreachJob>> {
  const valid = ids.filter(isSfId);
  if (!valid.length) return new Map();
  const rows = await run(sql`${JOBS} AND p.id IN ${valid}`);
  return new Map(rows.map((r) => [String(r.id), toJob(r)]));
}

export interface OutreachFilters {
  /** Topic and group ids of lib/cv-topics.ts. */
  topics: string[];
  /** Words to find inside the CVs (Salesforce's full-text index), for what no topic covers. */
  words: string[];
  reach: Reach;
  /** Also list people who already applied to the job. */
  withApplied: boolean;
}

/** Words as typed: split on spaces and commas, each once, at most MAX_WORDS. */
export const MAX_WORDS = 5;
export function parseWords(v: string): string[] {
  const words = v
    .split(/[\s,]+/)
    .map((w) => w.replace(/[{}]/g, "").slice(0, 40))
    .filter((w) => w.replace(/\*/g, "").length >= 2);
  return [...new Set(words)].slice(0, MAX_WORDS);
}

/** The reach that fits the job when none is chosen: its district, or everywhere for a job with no locality. */
export const defaultReach = (job: OutreachJob): Reach => (job.napa == null ? "all" : "district");

export interface OutreachRow {
  rank: number;
  score: number;
  documentId: string;
  title: string | null;
  extension: string | null;
  receivedAt: Date | null;
  contactId: string | null;
  name: string | null;
  email: string | null;
  place: PlaceLabel;
  /** Where the person stands to the job: same sub-district, same district, or neither. */
  near: "napa" | "district" | null;
  /** The chosen topics (and groups) the CV matched, and the phrases found for them. */
  topics: string[];
  phrases: string[];
  /** The chosen words found in the CV. */
  words: string[];
  /** The person's other files that matched. */
  otherFiles: number;
  applied: boolean;
  openPath: string | null;
}

/** The weight each topic or group counts for, from the chosen ids. */
function weights(chosen: string[]): [string, number][] {
  const w = new Map<string, number>();
  const raise = (id: string, n: number) => w.set(id, Math.max(w.get(id) ?? 0, n));
  for (const id of chosen) {
    if (id.includes(".")) {
      raise(id, TOPIC_WEIGHT);
      raise(groupOf(id), FIELD_WEIGHT);
    } else raise(id, GROUP_WEIGHT);
  }
  return [...w];
}

/**
 * Which of the words each file holds, from Salesforce's full-text index: one search a word, with its
 * Hebrew prefixes (as the topics are searched). null when Salesforce did not answer.
 */
async function findWords(words: string[]): Promise<Map<string, string[]> | null> {
  if (!words.length) return new Map();
  if (!salesforceConfigured()) return null;
  try {
    const found = new Map<string, string[]>();
    const results = await Promise.all(
      words.map((w) =>
        sf.search<{ ContentDocumentId: string }>(
          `FIND {${soslTerm(phraseForms(w))}} IN ALL FIELDS RETURNING ContentVersion(ContentDocumentId WHERE IsLatest = true) LIMIT 2000`,
        ),
      ),
    );
    results.forEach((res, i) => {
      for (const { ContentDocumentId: id } of res.searchRecords) found.set(id, [...(found.get(id) ?? []), words[i]!]);
    });
    return found;
  } catch (err) {
    logError("outreach word search", err);
    return null;
  }
}

/** The people whose CVs fit the job best, one row each (their best file), page by page. */
export async function searchOutreach(
  job: OutreachJob,
  f: OutreachFilters,
  { page = 1, pageSize = PAGE_SIZE, who }: { page?: number; pageSize?: number; who?: SearchActor } = {},
): Promise<{ rows: OutreachRow[]; total: number; wordSearch: "ok" | "unavailable" | null }> {
  const chosen = f.topics.filter(isTopicId);
  const words = f.words;
  if (!chosen.length && !words.length) return { rows: [], total: 0, wordSearch: null };
  const foundWords = await findWords(words);
  const wordSearch = words.length ? (foundWords ? "ok" : "unavailable") : null;
  const wanted = chosen.length
    ? sql`VALUES ${sql.join(
        weights(chosen).map(([id, w]) => sql`(${id}::text, ${w}::numeric)`),
        sql`, `,
      )}`
    : sql`SELECT NULL::text, 0::numeric WHERE false`;
  const wordRows = JSON.stringify(Object.fromEntries(foundWords ?? []));
  const napa = job.napa;
  const district = napa == null ? null : districtOf(napa);
  const reach: Reach = napa == null ? "all" : f.reach;
  const within: SQL =
    reach === "napa" && napa != null ? sql`s.napa = ${napa}` : reach === "district" && district != null ? sql`s.napa / 10 = ${district}` : sql`true`;
  const placeScore =
    napa == null
      ? sql`0::numeric`
      : sql`CASE WHEN v.napa = ${napa} THEN ${PLACE_NAPA}::numeric WHEN v.napa / 10 = ${district}::int THEN ${PLACE_DISTRICT}::numeric ELSE 0 END`;

  const ranked = sql`${CVS},
    wanted (topic_id, w) AS (${wanted}),
    by_topic AS (
      SELECT t.document_id, sum(w.w) AS topic_score, array_agg(t.topic_id ORDER BY w.w DESC, t.topic_id) AS topics
        FROM cv_topics t JOIN wanted w ON w.topic_id = t.topic_id
       GROUP BY t.document_id
    ),
    by_word AS (
      SELECT e.key AS document_id, ARRAY(SELECT jsonb_array_elements_text(e.value)) AS words
        FROM jsonb_each(${wordRows}::jsonb) e
    ),
    matched AS (
      SELECT coalesce(t.document_id, w.document_id) AS document_id,
             coalesce(t.topic_score, 0) + ${WORD_WEIGHT}::numeric * coalesce(cardinality(w.words), 0) AS topic_score,
             coalesce(t.topics, '{}') AS topics, coalesce(w.words, '{}') AS words
        FROM by_topic t FULL JOIN by_word w ON w.document_id = t.document_id
    ),
    scored AS (
      SELECT v.document_id, v.title, v.extension, v.received_at, v.contact_id, v.name, v.email, v.place_kind, v.napa, v.locality,
             m.topic_score, m.topics, m.words,
             ${placeScore} AS place_score,
             CASE WHEN v.received_at > now() - interval '90 days' THEN ${FRESH_RECENT}::numeric
                  WHEN v.received_at > now() - interval '365 days' THEN ${FRESH_YEAR}::numeric ELSE 0 END AS fresh_score,
             EXISTS (
               SELECT 1 FROM sf_case a LEFT JOIN sf_contact ac ON ac.id = a.contact_id
                WHERE a.parent_id = ${job.id} AND NOT a.is_deleted
                  AND (a.contact_id = v.contact_id OR (v.email IS NOT NULL AND (ac.email = v.email OR lower(a.data->>'SuppliedEmail') = v.email)))
             ) AS applied,
             coalesce(v.email, v.contact_id, v.document_id) AS person
        FROM cv v JOIN matched m ON m.document_id = v.document_id
       WHERE v.extension IN ${CV_EXTENSIONS}
    ),
    best AS (
      SELECT DISTINCT ON (s.person) s.*, s.topic_score + s.place_score + s.fresh_score AS score,
             count(*) OVER (PARTITION BY s.person) - 1 AS other_files
        FROM scored s
       WHERE ${within} ${f.withApplied ? sql`` : sql`AND NOT s.applied`}
       ORDER BY s.person, s.topic_score + s.place_score + s.fresh_score DESC, s.received_at DESC NULLS LAST, s.document_id
    )`;
  const order = sql`b.score DESC, b.received_at DESC NULLS LAST, b.document_id`;
  const [rows, count] = await Promise.all([
    run(sql`${ranked}
      SELECT b.*,
             (SELECT array_agg(DISTINCT p ORDER BY p) FROM cv_topics t JOIN wanted w ON w.topic_id = t.topic_id, unnest(t.phrases) p
               WHERE t.document_id = b.document_id) AS phrases
        FROM best b ORDER BY ${order} LIMIT ${pageSize} OFFSET ${(page - 1) * pageSize}`),
    run(sql`${ranked} SELECT count(*) AS n FROM best`),
  ]);
  const total = num(count[0]?.n);
  const offset = (page - 1) * pageSize;
  const result = rows.map((r, i) => toRow(r, offset + i + 1, napa));

  if (who) {
    // A search inside the CVs: logged with what was asked and what came back, as on /cvs.
    const logged =
      offset === 0 && result.length >= Math.min(total, LOGGED_RESULTS)
        ? result
        : (await run(sql`${ranked} SELECT b.* FROM best b ORDER BY ${order} LIMIT ${LOGGED_RESULTS}`)).map((r, i) => toRow(r, i + 1, napa));
    await writeAudit(who.actor, "cvs.text_search", `פעילות יזומה: ${job.title ?? job.id}`, {
      via: who.via,
      outreach: { jobId: job.id, reach, withApplied: f.withApplied },
      filters: { topic: chosen.join(","), ...(words.length ? { text: words.join(" ") } : {}), ...(reach === "napa" ? { napa: String(napa) } : reach === "district" ? { area: String(district) } : {}) },
      matched: foundWords ? foundWords.size : null,
      results: total,
      files: logged.slice(0, LOGGED_RESULTS).map((r) => ({ documentId: r.documentId, title: r.title, name: r.name, email: r.email })),
    });
  }
  return { rows: result, total, wordSearch };
}

function toRow(r: Record<string, unknown>, rank: number, jobNapa: number | null): OutreachRow {
  const email = str(r.email);
  const contactId = str(r.contact_id);
  const documentId = String(r.document_id);
  const napa = r.napa == null ? null : Number(r.napa);
  return {
    rank,
    score: Number(r.score ?? 0),
    documentId,
    title: str(r.title),
    extension: str(r.extension),
    receivedAt: asDate(r.received_at),
    contactId,
    name: str(r.name),
    email,
    place: placeLabel(r),
    near: jobNapa == null || napa == null ? null : napa === jobNapa ? "napa" : districtOf(napa) === districtOf(jobNapa) ? "district" : null,
    topics: Array.isArray(r.topics) ? r.topics.map(String) : [],
    phrases: Array.isArray(r.phrases) ? r.phrases.map(String) : [],
    words: Array.isArray(r.words) ? r.words.map(String) : [],
    otherFiles: num(r.other_files),
    applied: r.applied === true,
    openPath: email ? cvFilePath(email, documentId) : contactId ? `/api/candidates/${contactId}/files/${documentId}` : null,
  };
}

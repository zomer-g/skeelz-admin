import { sql } from "drizzle-orm";
import { writeAudit } from "@/lib/audit";
import { isTopicId } from "@/lib/cv-topics";
import { districtOf } from "@/lib/geo/map";
import { groupOf } from "@/lib/job-topics";
import { CANDIDATES } from "./candidates";
import { CV_EXTENSIONS, CVS, type SearchActor } from "./cvs";
import { JOBS, PLACE_DISTRICT, PLACE_NAPA, REACHES, toJob, weights, type OutreachJob, type Reach } from "./outreach";
import { choice, isSfId, param, run, str, type SearchParams } from "./search";

/**
 * Jobs for a candidate ("משרות מתאימות", /candidates/[id]/jobs): outreach (./outreach.ts) turned around.
 * The person's fields are the topics their CV files were tagged with (cv_topics, every file of the
 * person: on the Contact, on their Cases or in those Cases' emails, found by Contact or email as on
 * /cvs); each job's field is read from its title, description and skills (lib/job-topics.ts) as on
 * /positions. Only jobs live on the site now (`PStatus__c` = Active) are ranked, by the same weights
 * outreach uses, so a pair scores the same from both sides:
 *
 *   topic — each topic the job suggests that the person's CVs hold counts TOPIC_WEIGHT, a group
 *           GROUP_WEIGHT, the broad field of a topic FIELD_WEIGHT (`weights` of ./outreach.ts);
 *   place — the job is in the person's sub-district (PLACE_NAPA) or district (PLACE_DISTRICT);
 *   fresh — the job was opened in the last 30 days (FRESH_RECENT) or 90 (FRESH_QUARTER).
 *
 * Only jobs with a field match are listed. Nationwide and from-home jobs are within every reach. Jobs
 * the person already applied to are left out unless asked for. Each search is logged as a search
 * inside the CVs (cvs.text_search), with the jobs it listed: it reads what the person's files say.
 */

const FRESH_RECENT = 1;
const FRESH_QUARTER = 0.5;
/** How many of the listed jobs a log entry names. */
const LOGGED_RESULTS = 100;

export interface MatchCandidate {
  id: string;
  name: string | null;
  email: string | null;
  /** CBS sub-district of where the person lives, when known. */
  napa: number | null;
}

/** A topic (or group) found in the person's CVs, with the phrases and how many files held it. */
export interface CandidateTopic {
  id: string;
  phrases: string[];
  files: number;
}

export async function loadMatchCandidate(id: string): Promise<MatchCandidate | null> {
  if (!isSfId(id)) return null;
  const [r] = await run(sql`${CANDIDATES} SELECT c.id, c.name, c.email, c.napa FROM cand c WHERE c.id = ${id}`);
  return r ? { id: String(r.id), name: str(r.name), email: str(r.email), napa: r.napa == null ? null : Number(r.napa) } : null;
}

/** The topics every CV file of the person was tagged with, most files first. */
export async function loadCandidateTopics(c: MatchCandidate): Promise<{ topics: CandidateTopic[]; files: number }> {
  const person = c.email ? sql`(v.contact_id = ${c.id} OR v.email = ${c.email.toLowerCase()})` : sql`v.contact_id = ${c.id}`;
  const mine = sql`${CVS}, mine AS (SELECT DISTINCT v.document_id FROM cv v WHERE ${person} AND v.extension IN ${CV_EXTENSIONS})`;
  const [rows, count] = await Promise.all([
    run(sql`${mine}
      SELECT t.topic_id, count(DISTINCT t.document_id) AS files,
             (SELECT array_agg(DISTINCT p ORDER BY p) FROM cv_topics t2, unnest(t2.phrases) p
               WHERE t2.topic_id = t.topic_id AND t2.document_id IN (SELECT document_id FROM mine)) AS phrases
        FROM cv_topics t
       WHERE t.document_id IN (SELECT document_id FROM mine)
       GROUP BY t.topic_id
       ORDER BY files DESC, t.topic_id`),
    run(sql`${mine} SELECT count(*) AS n FROM mine`),
  ]);
  return {
    topics: rows.map((r) => ({ id: String(r.topic_id), files: Number(r.files), phrases: Array.isArray(r.phrases) ? r.phrases.map(String) : [] })),
    files: Number(count[0]?.n ?? 0),
  };
}

export interface JobMatchFilters {
  /** The person's topics to match by: the ones found in their CVs unless the form narrowed them. */
  topics: string[];
  reach: Reach;
  /** Also list jobs the person already applied to. */
  withApplied: boolean;
}

/** The reach that fits the person when none is chosen: their district, or everywhere with no known place. */
export const defaultCandidateReach = (napa: number | null): Reach => (napa == null ? "all" : "district");

/** The search as the URL carries it. Before the form is first sent (`s` missing), every topic the CVs hold. */
export function jobMatchFilters(search: SearchParams, c: MatchCandidate, found: CandidateTopic[]): JobMatchFilters {
  let topics = found.map((t) => t.id);
  if (param(search, "s") === "1") {
    const raw = search.topic;
    const values = (Array.isArray(raw) ? raw : raw ? [raw] : [])
      .flatMap((v) => v.split(","))
      .map((v) => v.trim())
      .filter(isTopicId);
    topics = [...new Set(values)].slice(0, 20);
  }
  return {
    topics,
    reach: c.napa == null ? "all" : choice(search, "reach", REACHES) || defaultCandidateReach(c.napa),
    withApplied: param(search, "applied") === "1",
  };
}

export interface JobMatchRow {
  rank: number;
  score: number;
  job: OutreachJob;
  /** The job's suggested topics the person's CVs hold, strongest first. */
  matched: string[];
  near: "napa" | "district" | null;
  applied: boolean;
}

interface RankOptions {
  topics: string[];
  napa: number | null;
  reach: Reach;
  withApplied: boolean;
  applied: ReadonlySet<string>;
  now?: Date;
}

const DAY = 86_400_000;

/** Pure ranking of jobs for a person (tested in job-match.test.ts). */
export function rankJobs(jobs: readonly OutreachJob[], o: RankOptions): JobMatchRow[] {
  // A chosen topic stands for its broad field too, as the CV tagging does (lib/cv-topics.ts phraseIndex).
  const held = new Set(o.topics.flatMap((t) => [t, groupOf(t)]));
  const district = o.napa == null ? null : districtOf(o.napa);
  const now = (o.now ?? new Date()).getTime();
  const rows: Omit<JobMatchRow, "rank">[] = [];
  for (const job of jobs) {
    const applied = o.applied.has(job.id);
    if (applied && !o.withApplied) continue;
    const everywhere = job.place.kind === "national" || job.place.kind === "remote";
    const near: JobMatchRow["near"] =
      o.napa == null || job.napa == null ? null : job.napa === o.napa ? "napa" : districtOf(job.napa) === district ? "district" : null;
    if (!everywhere && o.reach === "napa" && near !== "napa") continue;
    if (!everywhere && o.reach === "district" && near == null) continue;
    let topicScore = 0;
    const matched: string[] = [];
    for (const [id, w] of weights(job.suggested)) {
      if (!held.has(id)) continue;
      topicScore += w;
      matched.push(id);
    }
    if (!topicScore) continue;
    const age = job.createdAt ? (now - job.createdAt.getTime()) / DAY : Infinity;
    const fresh = age <= 30 ? FRESH_RECENT : age <= 90 ? FRESH_QUARTER : 0;
    const place = near === "napa" ? PLACE_NAPA : near === "district" ? PLACE_DISTRICT : 0;
    // The topics first, then the broad fields they brought in.
    matched.sort((a, b) => Number(!a.includes(".")) - Number(!b.includes(".")));
    rows.push({ score: topicScore + place + fresh, job, matched, near, applied });
  }
  rows.sort((a, b) => b.score - a.score || (b.job.createdAt?.getTime() ?? 0) - (a.job.createdAt?.getTime() ?? 0) || a.job.id.localeCompare(b.job.id));
  return rows.map((r, i) => ({ ...r, rank: i + 1 }));
}

/** Every job live on the site now. */
async function loadActiveJobs(): Promise<OutreachJob[]> {
  const rows = await run(sql`${JOBS} AND p.data->>'PStatus__c' = 'Active'`);
  return rows.map(toJob);
}

/** The jobs among `ids` the person applied to (an application under the job, by Contact or email). */
async function appliedJobs(c: MatchCandidate, ids: string[]): Promise<Set<string>> {
  if (!ids.length) return new Set();
  const email = c.email?.toLowerCase() ?? null;
  const rows = await run(sql`
    SELECT DISTINCT a.parent_id FROM sf_case a LEFT JOIN sf_contact ac ON ac.id = a.contact_id
     WHERE a.parent_id IN ${ids} AND NOT a.is_deleted
       AND (a.contact_id = ${c.id} ${email ? sql`OR ac.email = ${email} OR lower(a.data->>'SuppliedEmail') = ${email}` : sql``})`);
  return new Set(rows.map((r) => String(r.parent_id)));
}

/** The active jobs that fit the person best, every one of them (the page pages them), logged when `who` is given. */
export async function matchJobs(
  c: MatchCandidate,
  f: JobMatchFilters,
  who?: SearchActor,
): Promise<{ rows: JobMatchRow[]; activeJobs: number }> {
  const jobs = await loadActiveJobs();
  const applied = await appliedJobs(c, jobs.map((j) => j.id));
  const rows = f.topics.length ? rankJobs(jobs, { topics: f.topics, napa: c.napa, reach: f.reach, withApplied: f.withApplied, applied }) : [];
  if (who) {
    await writeAudit(who.actor, "cvs.text_search", `משרות מתאימות: ${c.name ?? c.email ?? c.id}`, {
      via: who.via,
      jobMatch: { contactId: c.id, email: c.email, reach: f.reach, withApplied: f.withApplied },
      filters: { topic: f.topics.join(",") },
      results: rows.length,
      jobs: rows.slice(0, LOGGED_RESULTS).map((r) => ({ id: r.job.id, title: r.job.title, score: r.score })),
    });
  }
  return { rows, activeJobs: jobs.length };
}

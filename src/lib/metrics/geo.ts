import { sql } from "drizzle-orm";
import { cached } from "@/lib/cache";
import { asDate, num, run, str } from "@/lib/entities/search";
import { GEO_CTES, geoPlaceSql, localityByCode, type PlaceKind } from "@/lib/geo/localities";
import { DISTRICTS, districtOf, SUBDISTRICTS } from "@/lib/geo/map";
import { CANDIDATE_ACCOUNT_PATTERN } from "@/lib/metrics/marketing";
import { skillRowsSql, SKILLS } from "@/lib/skills";
import { RECORD_TYPES } from "./candidates";
import { jobPaidSql, type Scope } from "./paid";

/**
 * Jobs and candidates on the map, and where demand and supply part: which districts and
 * sub-districts (CBS) have many open jobs and few candidates, and which skills the open jobs
 * ask for that few candidates have. Places come from lib/geo/localities.ts, skills from lib/skills.ts.
 */

/** A candidate's city: the formula field first, then the site's index, then what was typed. */
export const candidateCitySql = (a: string) =>
  sql.raw(
    `coalesce(nullif(${a}.data->>'City_fix__c', ''), nullif(nullif(${a}.data->>'city_index__c', ''), 'אין'), nullif(${a}.data->>'City_c__c', ''), nullif(${a}.data->>'MailingCity', ''))`,
  );
/** A job's place as the site wrote it. */
export const jobCitySql = (a: string) => sql.raw(`coalesce(nullif(${a}.data->>'PLocation_cambium__c', ''), nullif(nullif(${a}.data->>'city_index__c', ''), 'אין'))`);

/** Place joins/columns for a Contact aliased `a` (needs GEO_CTES in the WITH list). */
export const candidatePlaceSql = (a: string) => geoPlaceSql(`${a}g`, sql.raw(`${a}.data->>'citySymbol_cambium__c'`), candidateCitySql(a));
/** Place joins/columns for a job Case aliased `a` (needs GEO_CTES in the WITH list). */
export const jobPlaceSql = (a: string) => geoPlaceSql(`${a}g`, sql.raw(`${a}.data->>'citySymbol_cambium__c'`), jobCitySql(a));

export type Level = "district" | "subdistrict";
export const parseLevel = (v: string | string[] | undefined): Level => ((Array.isArray(v) ? v[0] : v) === "district" ? "district" : "subdistrict");

export interface PlaceFact {
  kind: PlaceKind;
  /** CBS sub-district (נפה) code, when placed. */
  napa: number | null;
  locality: number | null;
  skills: string[];
}

export interface JobFact extends PlaceFact {
  id: string;
  title: string | null;
  company: string | null;
  createdAt: Date | null;
  active: boolean;
  paid: boolean;
}

export interface CandidateFact extends PlaceFact {
  id: string;
  createdAt: Date | null;
  lastApplicationAt: Date | null;
}

const asKind = (v: unknown): PlaceKind => (v === "locality" || v === "national" || v === "remote" ? v : "unknown");
const asSkills = (v: unknown) => (Array.isArray(v) ? (v as string[]) : []);

/** Every job with its place and skills. Cached briefly (lib/cache.ts). */
export function loadJobFacts(): Promise<JobFact[]> {
  return cached("geo-jobs", async () => {
    const g = jobPlaceSql("p");
    const rows = await run(sql`
      WITH ${GEO_CTES}
      SELECT p.id, p.created_date,
             coalesce(nullif(p.data->>'Position_cambium__c', ''), nullif(p.data->>'Position_Name__c', ''), nullif(p.data->>'Subject', '')) AS title,
             coalesce(nullif(p.data->>'company_cambium__c', ''), acc.name) AS company,
             coalesce((p.data->>'PStatus__c') = 'Active', false) AS active,
             ${jobPaidSql("p")} AS paid,
             ${g.kind} AS kind, ${g.napa} AS napa, ${g.locality} AS locality,
             ARRAY(SELECT DISTINCT k.skill FROM (${skillRowsSql("p.id", "p.data->>'PSkills_cambium__c'")}) k) AS skills
        FROM sf_case p
        JOIN sf_record_type rt ON rt.id = p.record_type_id
        LEFT JOIN sf_account acc ON acc.id = p.account_id
        ${g.joins}
       WHERE rt.developer_name = ${RECORD_TYPES.position} AND NOT p.is_deleted`);
    return rows.map((r) => ({
      id: String(r.id),
      title: str(r.title),
      company: str(r.company),
      createdAt: asDate(r.created_date),
      active: r.active === true,
      paid: r.paid === true,
      kind: asKind(r.kind),
      napa: r.napa == null ? null : num(r.napa),
      locality: r.locality == null ? null : num(r.locality),
      skills: asSkills(r.skills),
    }));
  });
}

/** Every candidate in the pool (as /candidates) with place, skills and last application. Cached briefly. */
export function loadCandidateFacts(): Promise<CandidateFact[]> {
  return cached("geo-candidates", async () => {
    const g = candidatePlaceSql("ct");
    const rows = await run(sql`
      WITH ${GEO_CTES},
      apps AS (
        SELECT a.contact_id, max(a.created_date) AS last_at
          FROM sf_case a JOIN sf_record_type rt ON rt.id = a.record_type_id
         WHERE rt.developer_name IN (${RECORD_TYPES.application}, ${RECORD_TYPES.accepted}) AND NOT a.is_deleted AND a.contact_id IS NOT NULL
         GROUP BY a.contact_id
      )
      SELECT ct.id, ct.created_date, apps.last_at,
             ${g.kind} AS kind, ${g.napa} AS napa, ${g.locality} AS locality,
             ARRAY(SELECT DISTINCT k.skill FROM (${skillRowsSql("ct.id", "ct.data->>'skills_cambium__c'", "ct.data")}) k) AS skills
        FROM sf_contact ct
        LEFT JOIN sf_account acc ON acc.id = ct.account_id
        LEFT JOIN apps ON apps.contact_id = ct.id
        ${g.joins}
       WHERE NOT ct.is_deleted AND (acc.name ILIKE ${CANDIDATE_ACCOUNT_PATTERN} OR apps.contact_id IS NOT NULL)`);
    return rows.map((r) => ({
      id: String(r.id),
      createdAt: asDate(r.created_date),
      lastApplicationAt: asDate(r.last_at),
      kind: asKind(r.kind),
      napa: r.napa == null ? null : num(r.napa),
      locality: r.locality == null ? null : num(r.locality),
      skills: asSkills(r.skills),
    }));
  });
}

/* ----------------------------------------------------------- aggregation */

export const regionOf = (napa: number | null, level: Level) => (napa == null ? null : level === "district" ? districtOf(napa) : napa);
export const regionsOf = (level: Level) => (level === "district" ? DISTRICTS : SUBDISTRICTS);

/** How many facts fall in each region of the level. */
export function countByRegion(facts: PlaceFact[], level: Level): Map<number, number> {
  const out = new Map<number, number>();
  for (const f of facts) {
    const r = regionOf(f.napa, level);
    if (r != null) out.set(r, (out.get(r) ?? 0) + 1);
  }
  return out;
}

/** Facts with no region: nationwide, from home, or unknown. */
export function unplaced(facts: PlaceFact[]): Record<Exclude<PlaceKind, "locality">, number> {
  const out = { national: 0, remote: 0, unknown: 0 };
  for (const f of facts) if (f.napa == null) out[f.kind === "locality" ? "unknown" : f.kind]++;
  return out;
}

/** The most common localities among the facts, for the region tables. */
export function topLocalities(facts: PlaceFact[], limit = 10): { code: number; name: string; count: number }[] {
  const counts = new Map<number, number>();
  for (const f of facts) if (f.locality != null) counts.set(f.locality, (counts.get(f.locality) ?? 0) + 1);
  return [...counts]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([code, count]) => ({ code, name: localityByCode(code)?.name ?? String(code), count }));
}

/* -------------------------------------------------------------- matching */

export type Supply = "pool" | "recent";
export const parseSupply = (v: string | string[] | undefined): Supply => ((Array.isArray(v) ? v[0] : v) === "recent" ? "recent" : "pool");

export interface GapRow {
  code: number;
  name: string;
  jobs: number;
  candidates: number;
  /** Candidates per open job here; null without jobs. */
  perJob: number | null;
  /**
   * Candidates per job here against the country's (log2): below 0 demand outruns supply,
   * above 0 supply outruns demand. null without jobs, or without candidates anywhere.
   */
  balance: number | null;
}

export interface SkillGap {
  skill: string;
  jobs: number;
  candidates: number;
  /** Share of the open jobs that ask for the skill. */
  jobShare: number;
  /** Share of the candidates who have it. */
  candidateShare: number;
  perJob: number | null;
  balance: number | null;
}

export interface Matching {
  level: Level;
  supply: Supply;
  /** The region the skill table is narrowed to, or null for the whole country. */
  region: number | null;
  totals: { jobs: number; candidates: number; placedJobs: number; placedCandidates: number; jobsWithSkills: number; candidatesWithSkills: number };
  regions: GapRow[];
  jobsUnplaced: Record<Exclude<PlaceKind, "locality">, number>;
  candidatesUnplaced: number;
  skills: SkillGap[];
  /** Region × skill pairs where open jobs have the fewest candidates, worst first. */
  hotspots: { region: number; regionName: string; skill: string; jobs: number; candidates: number; perJob: number }[];
}

const balanceOf = (perJob: number | null, overall: number | null) => (perJob == null || !overall ? null : Math.log2(Math.max(perJob, 0.05) / overall));

/**
 * Demand = the open jobs (live on the site, in the paid scope). Supply = the candidate pool,
 * or (supply "recent") the candidates who joined or applied in the range. Regions use where
 * the job is and where the candidate lives; nationwide and from-home jobs fit everywhere, so
 * they count in the skill comparison but not in any region.
 */
export async function loadMatching(opts: { scope: Scope; supply: Supply; level: Level; region: number | null; from: Date; to: Date }): Promise<Matching> {
  const [jobFacts, candidateFacts] = await Promise.all([loadJobFacts(), loadCandidateFacts()]);
  const jobs = jobFacts.filter((j) => j.active && (opts.scope === "all" || j.paid));
  const inRange = (d: Date | null) => d != null && d >= opts.from && d < opts.to;
  const candidates = opts.supply === "recent" ? candidateFacts.filter((c) => inRange(c.createdAt) || inRange(c.lastApplicationAt)) : candidateFacts;

  const jobsByRegion = countByRegion(jobs, opts.level);
  const candsByRegion = countByRegion(candidates, opts.level);
  const placedJobs = jobs.filter((j) => j.napa != null).length;
  const placedCandidates = candidates.filter((c) => c.napa != null).length;
  const overall = placedJobs ? placedCandidates / placedJobs : null;

  const regions: GapRow[] = regionsOf(opts.level)
    .map(({ code, name }) => {
      const j = jobsByRegion.get(code) ?? 0;
      const c = candsByRegion.get(code) ?? 0;
      const perJob = j ? c / j : null;
      return { code, name, jobs: j, candidates: c, perJob, balance: balanceOf(perJob, overall) };
    })
    .filter((r) => r.jobs || r.candidates);

  const inRegion = (f: PlaceFact) => opts.region == null || regionOf(f.napa, opts.level) === opts.region;
  // In a region, nationwide and from-home jobs are open to its candidates too.
  const regionJobs = jobs.filter((j) => inRegion(j) || (opts.region != null && (j.kind === "national" || j.kind === "remote")));
  const regionCands = candidates.filter(inRegion);
  const skills = skillGaps(regionJobs, regionCands);

  const hotspots: Matching["hotspots"] = [];
  for (const { code, name } of regionsOf(opts.level)) {
    const rj = jobs.filter((j) => regionOf(j.napa, opts.level) === code);
    if (!rj.length) continue;
    const rc = candidates.filter((c) => regionOf(c.napa, opts.level) === code);
    for (const g of skillGaps(rj, rc)) {
      if (g.jobs >= 2 && g.perJob != null) hotspots.push({ region: code, regionName: name, skill: g.skill, jobs: g.jobs, candidates: g.candidates, perJob: g.perJob });
    }
  }
  hotspots.sort((a, b) => a.perJob - b.perJob || b.jobs - a.jobs);

  return {
    level: opts.level,
    supply: opts.supply,
    region: opts.region,
    totals: {
      jobs: jobs.length,
      candidates: candidates.length,
      placedJobs,
      placedCandidates,
      jobsWithSkills: jobs.filter((j) => j.skills.length).length,
      candidatesWithSkills: candidates.filter((c) => c.skills.length).length,
    },
    regions,
    jobsUnplaced: unplaced(jobs),
    candidatesUnplaced: candidates.length - placedCandidates,
    skills,
    hotspots: hotspots.slice(0, 12),
  };
}

/**
 * Per skill: how many jobs ask for it and how many candidates have it, among those that list any
 * skill. Candidates tick about three times as many skills as jobs ask for, so the balance compares
 * each skill's share of all the skills named on each side, not the raw counts: a "short" skill is
 * one the jobs ask for more often, relative to the other skills, than the candidates offer it.
 */
export function skillGaps(jobs: PlaceFact[], candidates: PlaceFact[]): SkillGap[] {
  const withJobs = jobs.filter((j) => j.skills.length);
  const withCands = candidates.filter((c) => c.skills.length);
  const known = new Set(SKILLS.map((s) => s.label));
  const mentions = (list: PlaceFact[]) => list.reduce((n, f) => n + f.skills.filter((s) => known.has(s)).length, 0);
  const jobMentions = mentions(withJobs);
  const candMentions = mentions(withCands);
  return SKILLS.map(({ label }) => {
    const j = withJobs.filter((x) => x.skills.includes(label)).length;
    const c = withCands.filter((x) => x.skills.includes(label)).length;
    const jobMix = jobMentions ? j / jobMentions : 0;
    const candMix = candMentions ? c / candMentions : 0;
    return {
      skill: label,
      jobs: j,
      candidates: c,
      jobShare: withJobs.length ? j / withJobs.length : 0,
      candidateShare: withCands.length ? c / withCands.length : 0,
      perJob: j ? c / j : null,
      balance: j && candMentions ? Math.log2(Math.max(candMix, 0.001) / jobMix) : null,
    };
  })
    .filter((g) => g.jobs || g.candidates)
    .sort((a, b) => (a.balance ?? Infinity) - (b.balance ?? Infinity) || b.jobs - a.jobs);
}

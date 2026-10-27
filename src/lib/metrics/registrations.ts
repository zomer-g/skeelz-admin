import { sql } from "drizzle-orm";
import { addDays, israelDay, israelMidnight } from "@/lib/dashboard/params";
import { CANDIDATES } from "@/lib/entities/candidates";
import { CV_EXTENSIONS } from "@/lib/entities/cvs";
import { asDate, isTrue, run, str } from "@/lib/entities/search";
import { RECORD_TYPES } from "./candidates";
import {
  ANOMALY_WINDOW,
  applyExclusions,
  classifyCvArrival,
  CV_ARRIVALS,
  emptyBuckets,
  flagAnomalies,
  isInternal,
  median,
  nextPeriod,
  periodOf,
  periodsBetween,
  periodStartDay,
  rate,
  timeBucket,
  type CvArrival,
  type ExclusionOptions,
  type Period,
} from "./segments";

/**
 * Registration cohorts (the MCP's registration_cohorts): people who signed up on the site — the
 * candidates of search_candidates with fast=no, i.e. Contacts without הגשה מהירה (`Field6__c`) —
 * grouped by the month or quarter their Contact was made, with when they first applied, how often
 * they came back, and when their first CV arrived. Aggregates only: no names, emails or phones leave
 * here. Definitions: docs/candidates-tab-metrics.md, "רשומים מול הגשה מהירה".
 */

const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;

interface Registrant {
  id: string;
  createdAt: Date;
  candidateEmail: string | null;
  candidateName: string | null;
  hasCv: boolean;
}

interface RegistrantApplication {
  id: string;
  contactId: string;
  jobId: string | null;
  createdAt: Date;
  contactCreatedAt: Date;
  candidateEmail: string | null;
  candidateName: string | null;
}

/** Registered candidates (fast=no) made in [from, to). */
async function loadRegistrants(from: Date, to: Date): Promise<Registrant[]> {
  const rows = await run(sql`${CANDIDATES}
    SELECT c.id, c.created_date, lower(btrim(c.email)) AS email, c.name, c.has_cv FROM cand c
     WHERE NOT c.fast_applied AND c.created_date >= ${from} AND c.created_date < ${to}`);
  return rows.map((r) => ({ id: String(r.id), createdAt: asDate(r.created_date)!, candidateEmail: str(r.email), candidateName: str(r.name), hasCv: isTrue(r.has_cv) }));
}

/** Applications of registered candidates who signed up in [from, to), and every application a registered candidate made in it. */
async function loadRegistrantApplications(from: Date, to: Date): Promise<RegistrantApplication[]> {
  const rows = await run(sql`
    SELECT a.id, a.contact_id, a.parent_id, a.created_date, ct.created_date AS contact_created,
           lower(btrim(coalesce(ct.email, ct.data->>'email_cambium__c'))) AS email, ct.name
      FROM sf_case a
      JOIN sf_record_type rt ON rt.id = a.record_type_id
      JOIN sf_contact ct ON ct.id = a.contact_id
     WHERE rt.developer_name IN (${RECORD_TYPES.application}, ${RECORD_TYPES.accepted}) AND NOT a.is_deleted
       AND NOT ct.is_deleted AND coalesce(ct.data->>'Field6__c', 'false') <> 'true'
       AND ((ct.created_date >= ${from} AND ct.created_date < ${to}) OR (a.created_date >= ${from} AND a.created_date < ${to}))`);
  return rows.map((r) => ({
    id: String(r.id),
    contactId: String(r.contact_id),
    jobId: str(r.parent_id),
    createdAt: asDate(r.created_date)!,
    contactCreatedAt: asDate(r.contact_created)!,
    candidateEmail: str(r.email),
    candidateName: str(r.name),
  }));
}

/**
 * For each registrant made in [from, to): the earliest CV-type file on the site side and by mail,
 * across every Contact with the same address (lower-cased, trimmed, as on /emails/<address>) and
 * their Cases (plus Contact-less Cases sent from that address), from the mirrored file links.
 *   site: a file on one of those Contacts, or on one of their application Cases;
 *   mail: a file on an incoming email of one of their Cases, or on a "קורות חיים" (cv_message) Case.
 */
async function loadCvEvidence(from: Date, to: Date): Promise<Map<string, { site: Date | null; mail: Date | null }>> {
  const rows = await run(sql`${CANDIDATES},
    cohort AS (
      SELECT c.id, lower(btrim(c.email)) AS email FROM cand c
       WHERE NOT c.fast_applied AND c.created_date >= ${from} AND c.created_date < ${to}
    ),
    people AS (
      SELECT co.id AS cohort_id, co.id AS contact_id FROM cohort co
      UNION
      SELECT co.id, ct.id FROM cohort co JOIN sf_contact ct ON lower(btrim(ct.email)) = co.email AND NOT ct.is_deleted
       WHERE co.email IS NOT NULL
    ),
    cases AS (
      SELECT p.cohort_id, a.id AS case_id, rt.developer_name AS type
        FROM people p JOIN sf_case a ON a.contact_id = p.contact_id AND NOT a.is_deleted
        JOIN sf_record_type rt ON rt.id = a.record_type_id
      UNION
      SELECT co.id, a.id, rt.developer_name
        FROM cohort co JOIN sf_case a ON a.contact_id IS NULL AND NOT a.is_deleted AND lower(btrim(a.data->>'SuppliedEmail')) = co.email
        JOIN sf_record_type rt ON rt.id = a.record_type_id
       WHERE co.email IS NOT NULL
    ),
    files AS (
      SELECT p.cohort_id, 'site' AS via, l.document_created_at AS at
        FROM people p JOIN sf_file_link l ON l.entity_type = 'contact' AND l.linked_entity_id = p.contact_id
       WHERE l.extension IN ${CV_EXTENSIONS}
      UNION ALL
      SELECT c.cohort_id, CASE WHEN c.type = ${RECORD_TYPES.cvMessage} THEN 'mail' ELSE 'site' END, l.document_created_at
        FROM cases c JOIN sf_file_link l ON l.entity_type = 'case' AND l.linked_entity_id = c.case_id
       WHERE l.extension IN ${CV_EXTENSIONS} AND c.type IN (${RECORD_TYPES.cvMessage}, ${RECORD_TYPES.application}, ${RECORD_TYPES.accepted})
      UNION ALL
      SELECT c.cohort_id, 'mail', coalesce(m.message_date, l.document_created_at)
        FROM cases c JOIN sf_email_message m ON m.parent_id = c.case_id AND NOT m.is_deleted AND m.incoming
        JOIN sf_file_link l ON l.entity_type = 'email' AND l.linked_entity_id = m.id
       WHERE l.extension IN ${CV_EXTENSIONS}
    )
    SELECT cohort_id, min(at) FILTER (WHERE via = 'site') AS site_at, min(at) FILTER (WHERE via = 'mail') AS mail_at
      FROM files WHERE at IS NOT NULL GROUP BY cohort_id`);
  return new Map(rows.map((r) => [String(r.cohort_id), { site: asDate(r.site_at), mail: asDate(r.mail_at) }]));
}

export interface CohortOptions {
  fromDay: string;
  toDay: string;
  period: Period;
  /** applied_within_days: the share who applied within this many days of signing up. */
  withinDays: number;
  exclusions: ExclusionOptions;
  now?: Date;
}

/** One cohort's figures; also used for the whole range. */
function cohortFigures(
  people: Registrant[],
  apps: Map<string, RegistrantApplication[]>,
  evidence: Map<string, { site: Date | null; mail: Date | null }>,
  withinDays: number,
) {
  const buckets = emptyBuckets();
  const minutes: number[] = [];
  const arrivals = Object.fromEntries(CV_ARRIVALS.map((k) => [k, 0])) as Record<CvArrival, number>;
  let applied = 0;
  let multiJob = 0;
  let returned = 0;
  let within = 0;
  let flagOnly = 0;
  for (const p of people) {
    const list = apps.get(p.id) ?? [];
    const e = evidence.get(p.id);
    const arrival = classifyCvArrival({ registeredAt: p.createdAt, siteFileAt: e?.site ?? null, mailFileAt: e?.mail ?? null, cvFlag: p.hasCv });
    arrivals[arrival]++;
    if (arrival === "at_registration" && !e?.site && !e?.mail) flagOnly++;
    if (!list.length) continue;
    applied++;
    const first = Math.min(...list.map((a) => a.createdAt.getTime()));
    const span = (first - p.createdAt.getTime()) / MINUTE;
    buckets[timeBucket(span)]++;
    minutes.push(Math.max(0, span));
    if (span <= withinDays * 24 * 60) within++;
    if (new Set(list.map((a) => a.jobId ?? `app:${a.id}`)).size > 1) multiJob++;
    if (list.some((a) => a.createdAt.getTime() > p.createdAt.getTime() + DAY)) returned++;
  }
  const registered = people.length;
  const withCv = people.filter((p) => p.hasCv).length;
  const m = median(minutes);
  return {
    registered,
    with_cv: withCv,
    with_cv_rate: rate(withCv, registered),
    applied,
    applied_rate: rate(applied, registered),
    first_application: {
      buckets,
      median_minutes: m === null ? null : Math.round(m),
    },
    applied_within_days: { days: withinDays, count: within, rate: rate(within, registered) },
    applied_to_more_than_one_job: { count: multiJob, rate_of_applied: rate(multiJob, applied) },
    applied_more_than_24h_after_signup: { count: returned, rate_of_applied: rate(returned, applied) },
    cv_arrival: { ...arrivals, at_registration_by_flag_only: flagOnly },
  };
}

export async function registrationCohorts(o: CohortOptions) {
  const now = o.now ?? new Date();
  const keys = periodsBetween(o.fromDay, o.toDay, o.period);
  const from = israelMidnight(o.fromDay);
  const to = israelMidnight(addDays(o.toDay, 1));
  // The wave baseline looks ANOMALY_WINDOW periods either side, beyond the range asked for (up to now).
  const back = new Date(`${periodStartDay(keys[0]!)}T12:00:00Z`);
  back.setUTCMonth(back.getUTCMonth() - ANOMALY_WINDOW * (o.period === "quarter" ? 3 : 1));
  const padFromDay = periodStartDay(periodOf(back, o.period));
  let padEndKey = keys[keys.length - 1]!;
  for (let i = 0; i <= ANOMALY_WINDOW; i++) padEndKey = nextPeriod(padEndKey);
  const padFrom = israelMidnight(padFromDay);
  const padTo = new Date(Math.min(israelMidnight(periodStartDay(padEndKey)).getTime(), now.getTime()));

  const [all, appRows, evidence] = await Promise.all([loadRegistrants(padFrom, padTo), loadRegistrantApplications(from, to), loadCvEvidence(from, to)]);

  // Exclusions: internal people are left out with their applications; repeats within a minute count once.
  const excludedPeople = new Set(o.exclusions.internal ? all.filter(isInternal).map((p) => p.id) : []);
  const people = all.filter((p) => !excludedPeople.has(p.id));
  const ex = applyExclusions(appRows, o.exclusions, (a) => a.jobId);
  const apps = ex.kept;

  const inRange = people.filter((p) => p.createdAt >= from && p.createdAt < to);
  const byContact = new Map<string, RegistrantApplication[]>();
  for (const a of apps) {
    const list = byContact.get(a.contactId);
    if (list) list.push(a);
    else byContact.set(a.contactId, [a]);
  }

  // Volumes over the padded range, for the wave baseline.
  const padKeys = periodsBetween(padFromDay, israelDay(new Date(padTo.getTime() - 1)), o.period);
  const volume = new Map(padKeys.map((k) => [k, { registered: 0, withCv: 0 }]));
  for (const p of people) {
    const v = volume.get(periodOf(p.createdAt, o.period));
    if (!v) continue;
    v.registered++;
    if (p.hasCv) v.withCv++;
  }
  const flagList = flagAnomalies(padKeys.map((k) => volume.get(k)!));
  const flags = new Map(padKeys.map((k, i) => [k, flagList[i]!]));

  const periods = keys.map((key) => {
    const startDay = periodStartDay(key);
    const start = israelMidnight(startDay);
    const end = israelMidnight(periodStartDay(nextPeriod(key)));
    const cohort = inRange.filter((p) => periodOf(p.createdAt, o.period) === key);
    // Applications made in the period inside the range asked for, by who made them.
    const made = apps.filter((a) => a.createdAt >= start && a.createdAt < end && a.createdAt >= from && a.createdAt < to);
    const returning = made.filter((a) => a.contactCreatedAt < start);
    const flag = flags.get(key);
    return {
      period: key,
      start: startDay,
      // A cohort is complete for applied_within_days once its last member has had the full N days.
      complete_for_within_days: end.getTime() + o.withinDays * DAY <= now.getTime(),
      ...cohortFigures(cohort, byContact, evidence, o.withinDays),
      applications_in_period: {
        by_this_cohort: made.filter((a) => a.contactCreatedAt >= start).length,
        by_earlier_registrants: returning.length,
        earlier_registrants_who_applied: new Set(returning.map((a) => a.contactId)).size,
      },
      anomaly: flag?.anomaly ?? false,
      anomaly_baseline: flag ? { registered: flag.baseline_registered, cv_share: flag.baseline_cv_share } : null,
    };
  });

  const createdInRange = (d: Date) => d >= from && d < to;
  return {
    range: { from: o.fromDay, to: o.toDay, period: o.period },
    exclusions: o.exclusions,
    excluded: {
      internal_registrants: all.filter((p) => excludedPeople.has(p.id) && createdInRange(p.createdAt)).length,
      internal_applications: appRows.filter((a) => ex.internalIds.has(a.id)).length,
      duplicate_applications: appRows.filter((a) => ex.duplicateIds.has(a.id)).length,
    },
    totals: cohortFigures(inRange, byContact, evidence, o.withinDays),
    periods,
  };
}

import { and, eq, gte, lt, sql } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { sfCase, sfRecordType, syncState } from "@/lib/db/schema";

/**
 * Candidates tab. Definitions live in docs/candidates-tab-metrics.md.
 *
 * Salesforce's status values are inconsistent about whitespace — some hold a
 * double space, some a no-break space between words — so every status is
 * compared after `normStatus` (in SQL: the same folding on the history values).
 *
 * One query builds a fact row per application (a few thousand rows); the
 * metrics are then plain aggregations over those rows, which keeps every
 * definition readable in one place and lets both date modes share the facts.
 */

export const RECORD_TYPES = {
  application: "RecordType2",
  accepted: "Placement_cambium",
  position: "Position",
} as const;

/** Folds no-break spaces and runs of spaces into one space. */
export function normStatus(value: string | null): string | null {
  return value == null ? null : value.replace(/[ \s]+/g, " ").trim();
}

export const STATUS = {
  new: normStatus("New")!,
  requestedCv: normStatus('ביקשנו קו"ח')!,
  inHandling: normStatus("בטיפול מועמד/מעסיק")!,
  sent: normStatus('נשלחו קו"ח')!,
  rejectedByUs: normStatus("נדחה על ידנו")!,
  interview: normStatus("זומן לראיון")!,
  accepted: normStatus("התקבל")!,
};

/** Any of these after the CV was sent means the employer answered. */
export const EMPLOYER_RESPONSE_STATUSES = [
  "זומן לראיון",
  "נדחה על ידי מעסיק",
  "מעסיק הגיב",
  "נדחה אחרי ראיון",
  "התקבל",
  "Response Received",
].map((s) => normStatus(s)!);

/** After "asked for a CV", either of these means the candidate sent one. */
export const CV_RECEIVED_STATUSES = [STATUS.inHandling, STATUS.sent];

/** Salesforce started keeping Case status history on this date. */
export const STATUS_HISTORY_START = new Date("2025-03-13T00:00:00Z");

export const WAITING_DAYS = 5;

/** Task.Field1__c ("צד לשיחה") on a logged call. Other parties are not a touch. */
export const CALL_PARTY = { candidate: "מועמד", employer: "מעסיק" } as const;

export interface ApplicationFacts {
  id: string;
  /** The job (Position Case) the application belongs to. */
  parentId: string | null;
  status: string | null;
  recordType: string;
  createdAt: Date;
  closedAt: Date | null;
  candidateName: string | null;
  jobTitle: string | null;
  company: string | null;
  ownerName: string | null;
  rejectReasons: string[];
  firstTouchAt: Date | null;
  requestedCvAt: Date | null;
  cvReceivedAt: Date | null;
  sentAt: Date | null;
  lastSentAt: Date | null;
  employerResponseAt: Date | null;
  rejectedByUsAt: Date | null;
  interviewAt: Date | null;
  acceptedAt: Date | null;
  candidateTouchesBeforeSent: number;
  employerTouchesAfterSent: number;
  candidateEmails: number;
  candidateCalls: number;
  employerEmails: number;
  employerCalls: number;
}

interface FactsRow {
  id: string;
  parent_id: string | null;
  status: string | null;
  record_type: string;
  created_at: Date;
  closed_at: Date | null;
  candidate_name: string | null;
  job_title: string | null;
  company: string | null;
  owner_name: string | null;
  reject_reasons: string | null;
  first_touch_at: Date | null;
  requested_cv_at: Date | null;
  cv_received_at: Date | null;
  sent_at: Date | null;
  last_sent_at: Date | null;
  employer_response_at: Date | null;
  rejected_by_us_at: Date | null;
  interview_at: Date | null;
  accepted_at: Date | null;
  candidate_emails: number;
  candidate_calls: number;
  employer_emails: number;
  employer_calls: number;
}

export async function loadApplicationFacts(): Promise<ApplicationFacts[]> {
  const result = await getDb().execute<FactsRow & Record<string, unknown>>(sql`
    WITH apps AS (
      SELECT c.id, c.status, c.created_date, c.closed_date, c.contact_id, c.parent_id, c.owner_id, c.data,
             rt.developer_name AS record_type,
             lower(nullif(c.data->>'ContactEmail', '')) AS candidate_email
        FROM sf_case c
        JOIN sf_record_type rt ON rt.id = c.record_type_id
       WHERE rt.developer_name IN (${RECORD_TYPES.application}, ${RECORD_TYPES.accepted})
         AND NOT c.is_deleted
    ),
    sh AS (
      SELECT h.case_id,
             btrim(regexp_replace(replace(h.new_value, chr(160), ' '), ' +', ' ', 'g')) AS new_value,
             h.created_date
        FROM sf_case_history h
        JOIN apps a ON a.id = h.case_id
       WHERE h.field = 'Status'
    ),
    st AS (
      SELECT case_id,
             min(created_date) AS first_change_at,
             min(created_date) FILTER (WHERE new_value = ${STATUS.requestedCv}) AS requested_cv_at,
             min(created_date) FILTER (WHERE new_value = ${STATUS.sent}) AS sent_at,
             max(created_date) FILTER (WHERE new_value = ${STATUS.sent}) AS last_sent_at,
             min(created_date) FILTER (WHERE new_value = ${STATUS.rejectedByUs}) AS rejected_by_us_at,
             min(created_date) FILTER (WHERE new_value = ${STATUS.interview}) AS interview_at,
             min(created_date) FILTER (WHERE new_value = ${STATUS.accepted}) AS accepted_status_at
        FROM sh
       GROUP BY case_id
    ),
    cv AS (
      SELECT sh.case_id, min(sh.created_date) AS at
        FROM sh JOIN st USING (case_id)
       WHERE sh.created_date > st.requested_cv_at AND sh.new_value IN ${CV_RECEIVED_STATUSES}
       GROUP BY sh.case_id
    ),
    er AS (
      SELECT sh.case_id, min(sh.created_date) AS at
        FROM sh JOIN st USING (case_id)
       WHERE sh.created_date > st.sent_at AND sh.new_value IN ${EMPLOYER_RESPONSE_STATUSES}
       GROUP BY sh.case_id
    ),
    rth AS (
      SELECT h.case_id, min(h.created_date) AS at
        FROM sf_case_history h
        JOIN apps a ON a.id = h.case_id
       WHERE h.field = 'RecordType' AND h.new_value = ${RECORD_TYPES.accepted}
       GROUP BY h.case_id
    ),
    jobs AS (
      SELECT j.id,
             coalesce(nullif(j.data->>'Position_cambium__c', ''), nullif(j.data->>'Position_Name__c', ''), nullif(j.data->>'Subject', '')) AS title,
             coalesce(nullif(j.data->>'company_cambium__c', ''), acc.name) AS company,
             array_remove(ARRAY[
               lower(nullif(j.data->>'PEmail_cambium__c', '')),
               lower(nullif(j.data->>'ContactEmail', '')),
               lower(nullif(j.data->>'r_mail__c', ''))
             ], NULL) AS employer_emails
        FROM sf_case j
        LEFT JOIN sf_account acc ON acc.id = j.account_id
       WHERE j.id IN (SELECT parent_id FROM apps WHERE parent_id IS NOT NULL)
    )
    SELECT a.id,
           a.parent_id,
           a.status,
           a.record_type,
           a.created_date AS created_at,
           a.closed_date AS closed_at,
           coalesce(ct.name, nullif(a.data->>'full_name__c', ''), nullif(a.data->>'A_Name_Cam__c', ''), nullif(a.data->>'SuppliedName', '')) AS candidate_name,
           coalesce(j.title, nullif(a.data->>'position_name_for_applied__c', ''), nullif(a.data->>'Position_Name__c', '')) AS job_title,
           coalesce(j.company, nullif(a.data->>'company_cambium__c', '')) AS company,
           u.name AS owner_name,
           a.data->>'Field21__c' AS reject_reasons,
           LEAST(st.first_change_at, em.first_email_at, ca.first_call_at) AS first_touch_at,
           st.requested_cv_at,
           cv.at AS cv_received_at,
           st.sent_at,
           st.last_sent_at,
           er.at AS employer_response_at,
           st.rejected_by_us_at,
           st.interview_at,
           coalesce(st.accepted_status_at, rth.at,
                    CASE WHEN a.record_type = ${RECORD_TYPES.accepted} THEN a.created_date END) AS accepted_at,
           coalesce(em.candidate_emails, 0)::int AS candidate_emails,
           coalesce(ca.candidate_calls, 0)::int AS candidate_calls,
           coalesce(em.employer_emails, 0)::int AS employer_emails,
           coalesce(ca.employer_calls, 0)::int AS employer_calls
      FROM apps a
      LEFT JOIN st ON st.case_id = a.id
      LEFT JOIN cv ON cv.case_id = a.id
      LEFT JOIN er ON er.case_id = a.id
      LEFT JOIN rth ON rth.case_id = a.id
      LEFT JOIN jobs j ON j.id = a.parent_id
      LEFT JOIN sf_contact ct ON ct.id = a.contact_id
      LEFT JOIN sf_user u ON u.id = a.owner_id
      LEFT JOIN LATERAL (
        SELECT min(e.message_date) AS first_email_at,
               count(*) FILTER (
                 WHERE a.candidate_email IS NOT NULL
                   AND strpos(e.to_address, a.candidate_email) > 0
                   AND (st.sent_at IS NULL OR e.message_date < st.sent_at)
               ) AS candidate_emails,
               -- From the application's creation, not from the status change: the
               -- email that sends the CV usually goes out moments before someone
               -- sets "נשלחו קו״ח", and it is the first touch with the employer.
               count(*) FILTER (
                 WHERE st.sent_at IS NOT NULL
                   AND e.message_date <= coalesce(er.at, a.closed_date, now())
                   AND EXISTS (SELECT 1 FROM unnest(j.employer_emails) addr WHERE strpos(e.to_address, addr) > 0)
               ) AS employer_emails
          FROM sf_email_message e
         WHERE e.parent_id = a.id AND NOT e.incoming AND NOT e.is_deleted
      ) em ON true
      LEFT JOIN LATERAL (
        -- Calls logged on the application, attributed by "צד לשיחה". A call
        -- with no party marked falls back to timing: before the CV is sent it is
        -- with the candidate; after it, with the employer unless logged against
        -- the candidate. Calls with any other party are not a touch.
        SELECT min(k.at) AS first_call_at,
               count(*) FILTER (
                 WHERE (st.sent_at IS NULL OR k.at < st.sent_at)
                   AND (k.party = ${CALL_PARTY.candidate} OR k.party IS NULL)
               ) AS candidate_calls,
               count(*) FILTER (
                 WHERE st.sent_at IS NOT NULL
                   AND k.at <= coalesce(er.at, a.closed_date, now())
                   AND (
                     k.party = ${CALL_PARTY.employer}
                     OR (k.party IS NULL AND k.at > st.sent_at AND k.who_id IS DISTINCT FROM a.contact_id)
                   )
               ) AS employer_calls
          FROM (
            SELECT t.who_id, btrim(t.call_party) AS party, coalesce(t.completed_at, t.created_date) AS at
              FROM sf_task t
             WHERE t.what_id = a.id AND NOT t.is_deleted
               AND (t.task_subtype = 'Call' OR t.type ILIKE 'call%')
          ) k
      ) ca ON true
  `);

  // Drivers differ on whether aggregated timestamps arrive as Date or string; normalise.
  const asDate = (v: Date | string | null): Date | null => (v == null ? null : v instanceof Date ? v : new Date(v));

  return result.rows.map((r) => ({
    id: r.id,
    parentId: r.parent_id,
    status: normStatus(r.status),
    recordType: r.record_type,
    createdAt: asDate(r.created_at)!,
    closedAt: asDate(r.closed_at),
    candidateName: r.candidate_name,
    jobTitle: r.job_title,
    company: r.company,
    ownerName: r.owner_name,
    rejectReasons: r.reject_reasons
      ? r.reject_reasons
          .split(";")
          .map((s) => normStatus(s)!)
          .filter(Boolean)
      : [],
    firstTouchAt: asDate(r.first_touch_at),
    requestedCvAt: asDate(r.requested_cv_at),
    cvReceivedAt: asDate(r.cv_received_at),
    sentAt: asDate(r.sent_at),
    lastSentAt: asDate(r.last_sent_at),
    employerResponseAt: asDate(r.employer_response_at),
    rejectedByUsAt: asDate(r.rejected_by_us_at),
    interviewAt: asDate(r.interview_at),
    acceptedAt: asDate(r.accepted_at),
    candidateTouchesBeforeSent: Number(r.candidate_emails) + Number(r.candidate_calls),
    employerTouchesAfterSent: Number(r.employer_emails) + Number(r.employer_calls),
    candidateEmails: Number(r.candidate_emails),
    candidateCalls: Number(r.candidate_calls),
    employerEmails: Number(r.employer_emails),
    employerCalls: Number(r.employer_calls),
  }));
}

export async function countNewJobs(from: Date, to: Date): Promise<number> {
  const [row] = await getDb()
    .select({ n: sql<number>`count(*)::int` })
    .from(sfCase)
    .innerJoin(sfRecordType, eq(sfRecordType.id, sfCase.recordTypeId))
    .where(
      and(
        eq(sfRecordType.developerName, RECORD_TYPES.position),
        eq(sfCase.isDeleted, false),
        gte(sfCase.createdDate, from),
        lt(sfCase.createdDate, to),
      ),
    );
  return row?.n ?? 0;
}

export async function syncFreshness(): Promise<{ casesSyncedAt: Date | null; callsAvailable: boolean }> {
  const rows = await getDb().select().from(syncState);
  const byObject = new Map(rows.map((r) => [r.object, r]));
  return {
    casesSyncedAt: byObject.get("Case")?.lastSuccessAt ?? null,
    callsAvailable: Boolean(byObject.get("Task")?.lastSuccessAt),
  };
}

/* ------------------------------------------------------------ aggregation */

export type Basis = "application" | "event";

export interface Stats {
  count: number;
  avg: number | null;
  median: number | null;
}

export interface WaitingRow {
  id: string;
  candidateName: string | null;
  jobTitle: string | null;
  company: string | null;
  ownerName: string | null;
  sentAt: Date;
  daysWaiting: number;
}

export interface CandidateMetrics {
  from: Date;
  to: Date;
  basis: Basis;
  newJobs: number;
  applications: number;
  statusNew: number;
  inHandling: number;
  firstTouchHours: Stats;
  requestedCv: number;
  cvReceived: number;
  touchesUntilSent: Stats;
  /** Average emails and calls per sent application, per side. */
  touchMix: {
    candidate: { emails: number | null; calls: number | null };
    employer: { emails: number | null; calls: number | null };
  };
  rejectedByUs: number;
  rejectReasons: { reason: string; count: number }[];
  sentToEmployer: number;
  daysToTransfer: Stats;
  employerResponded: number;
  employerNotResponded: number;
  touchesUntilResponse: { responded: Stats; notResponded: Stats };
  interviews: number;
  accepted: number;
  waiting: WaitingRow[];
}

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

export function stats(values: number[]): Stats {
  const clean = values.filter((v) => Number.isFinite(v) && v >= 0).sort((a, b) => a - b);
  if (!clean.length) return { count: 0, avg: null, median: null };
  const mid = Math.floor(clean.length / 2);
  return {
    count: clean.length,
    avg: clean.reduce((s, v) => s + v, 0) / clean.length,
    median: clean.length % 2 ? clean[mid]! : (clean[mid - 1]! + clean[mid]!) / 2,
  };
}

const inRange = (d: Date | null, from: Date, to: Date): d is Date => d !== null && d >= from && d < to;

const mean = (values: number[]): number | null => (values.length ? values.reduce((s, v) => s + v, 0) / values.length : null);

export function computeCandidateMetrics(
  facts: ApplicationFacts[],
  newJobs: number,
  { from, to, basis, now = new Date() }: { from: Date; to: Date; basis: Basis; now?: Date },
): CandidateMetrics {
  const cohort = facts.filter((f) => inRange(f.createdAt, from, to));

  // Application basis: the applications created in the range, and what became of them.
  // Event basis: whatever happened in the range, whenever the application was created.
  const reached = (at: (f: ApplicationFacts) => Date | null) =>
    basis === "application" ? cohort.filter((f) => at(f) !== null) : facts.filter((f) => inRange(at(f), from, to));
  // "Right now" figures: the cohort's current state, or the whole pipeline's.
  const current = basis === "application" ? cohort : facts;

  const firstTouched = reached((f) => f.firstTouchAt);
  const requested = reached((f) => f.requestedCvAt);
  const sent = reached((f) => f.sentAt);
  const responded = sent.filter((f) => f.employerResponseAt);
  const notResponded = sent.filter((f) => !f.employerResponseAt);

  const rejected =
    basis === "application"
      ? cohort.filter((f) => f.rejectedByUsAt || f.status === STATUS.rejectedByUs)
      : facts.filter((f) => inRange(f.rejectedByUsAt, from, to));
  const reasons = new Map<string, number>();
  for (const f of rejected) {
    for (const r of f.rejectReasons.length ? f.rejectReasons : ["לא צוינה סיבה"]) reasons.set(r, (reasons.get(r) ?? 0) + 1);
  }

  const waiting = facts
    .filter((f) => f.status === STATUS.sent && f.lastSentAt && now.getTime() - f.lastSentAt.getTime() > WAITING_DAYS * DAY)
    .map((f) => ({
      id: f.id,
      candidateName: f.candidateName,
      jobTitle: f.jobTitle,
      company: f.company,
      ownerName: f.ownerName,
      sentAt: f.lastSentAt!,
      daysWaiting: Math.floor((now.getTime() - f.lastSentAt!.getTime()) / DAY),
    }))
    // Freshest first: a CV sent last week can still be chased; one from last year
    // is more likely a status nobody closed.
    .sort((a, b) => a.daysWaiting - b.daysWaiting);

  return {
    from,
    to,
    basis,
    newJobs,
    applications: cohort.length,
    statusNew: current.filter((f) => f.status === STATUS.new).length,
    inHandling: current.filter((f) => f.status === STATUS.inHandling).length,
    firstTouchHours: stats(firstTouched.map((f) => (f.firstTouchAt!.getTime() - f.createdAt.getTime()) / HOUR)),
    requestedCv: requested.length,
    cvReceived: requested.filter((f) => f.cvReceivedAt).length,
    touchesUntilSent: stats(sent.map((f) => f.candidateTouchesBeforeSent)),
    touchMix: {
      candidate: { emails: mean(sent.map((f) => f.candidateEmails)), calls: mean(sent.map((f) => f.candidateCalls)) },
      employer: { emails: mean(sent.map((f) => f.employerEmails)), calls: mean(sent.map((f) => f.employerCalls)) },
    },
    rejectedByUs: rejected.length,
    rejectReasons: [...reasons.entries()].map(([reason, count]) => ({ reason, count })).sort((a, b) => b.count - a.count),
    sentToEmployer: sent.length,
    daysToTransfer: stats(sent.map((f) => (f.sentAt!.getTime() - f.createdAt.getTime()) / DAY)),
    employerResponded: responded.length,
    employerNotResponded: notResponded.length,
    touchesUntilResponse: {
      responded: stats(responded.map((f) => f.employerTouchesAfterSent)),
      notResponded: stats(notResponded.map((f) => f.employerTouchesAfterSent)),
    },
    interviews: reached((f) => f.interviewAt).length,
    accepted: reached((f) => f.acceptedAt).length,
    waiting,
  };
}

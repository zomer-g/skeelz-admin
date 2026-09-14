import { sql } from "drizzle-orm";
import { cached } from "@/lib/cache";
import type { DashboardParams } from "@/lib/dashboard/params";
import { getDb } from "@/lib/db/client";
import { SKILL_FIELDS } from "@/lib/entities/candidates";
import { CALL_PARTY, RECORD_TYPES } from "./candidates";
import { CANDIDATE_ACCOUNT_PATTERN } from "./marketing";
import { applicationPaidSql } from "./paid";

/**
 * Candidates tab: the candidate pool itself. The application pipeline lives on
 * the jobs tab. Definitions in docs/dashboard-tabs.md.
 *
 * The pool is every Contact in a candidate Account (its name contains "מועמד")
 * plus any Contact that applied. A candidate is active in the range when they
 * applied, were emailed or called about one of their applications, or
 * Salesforce recorded activity on them (LastActivityDate) — the last one only
 * outside the paid scope, since it can't be tied to a job.
 */

export interface AccountRow {
  account: string;
  candidates: number;
  newInRange: number;
  active: number;
  applicants: number;
  withCv: number;
}

export interface TalentMetrics {
  candidates: number;
  /** Of the pool, those in the Cambium candidate Account(s). */
  cambium: number;
  newInRange: number;
  active: number;
  /** Candidates with an application in the scope, created in the range. */
  applicants: number;
  /** Of those, how many had applied before the range too. */
  returning: number;
  applications: number;
  withCv: number;
  applicantsWithCv: number;
  /** Applicants in the range whatever the scope: all, and with a paid application. */
  appliedSplit: { all: number; paid: number };
  accounts: AccountRow[];
  dailyNew: Map<string, number>;
  dailyApplicants: Map<string, number>;
  districts: { district: string; count: number }[];
  skills: { skill: string; count: number }[];
}

/** Candidates outside the candidate Accounts (applicants with some other Account) are grouped under one row. */
export const OTHER_ACCOUNT = "אחר";

/** Cambium's candidate Account names start with this ("…מחוץ לקמביום" is outside Cambium, so it must not match). */
export const CAMBIUM_ACCOUNT_PREFIX = "קמביום";

type Json = Record<string, unknown>;
const n = (v: unknown) => Number(v ?? 0);

/** Cached briefly per range and scope (see lib/cache.ts). */
export function loadTalentMetrics(p: DashboardParams): Promise<TalentMetrics> {
  return cached(`talent:${p.fromDay}:${p.toDay}:${p.scope}`, () => queryTalentMetrics(p));
}

async function queryTalentMetrics(p: DashboardParams): Promise<TalentMetrics> {
  const paidOnly = p.scope === "paid";
  const inRange = (col: string) => sql`${sql.raw(col)} >= ${p.from} AND ${sql.raw(col)} < ${p.to}`;
  const active = sql`(c.applied_n IS NOT NULL OR c.touched ${
    paidOnly ? sql.raw("") : sql`OR (c.last_activity >= ${p.fromDay} AND c.last_activity <= ${p.toDay})`
  })`;

  const result = await getDb().execute(sql`
    WITH app AS (
      SELECT a.id, a.contact_id, a.created_date, ${applicationPaidSql("a", "j")} AS paid
        FROM sf_case a
        JOIN sf_record_type rt ON rt.id = a.record_type_id
        LEFT JOIN sf_case j ON j.id = a.parent_id
       WHERE rt.developer_name IN (${RECORD_TYPES.application}, ${RECORD_TYPES.accepted}) AND NOT a.is_deleted AND a.contact_id IS NOT NULL
    ),
    scoped AS (SELECT * FROM app ${paidOnly ? sql`WHERE paid` : sql.raw("")}),
    applied AS (SELECT contact_id, count(*) AS n FROM scoped WHERE ${inRange("created_date")} GROUP BY contact_id),
    applied_any AS (SELECT contact_id, bool_or(paid) AS paid FROM app WHERE ${inRange("created_date")} GROUP BY contact_id),
    earlier AS (SELECT DISTINCT contact_id FROM scoped WHERE created_date < ${p.from}),
    touched AS (
      SELECT s.contact_id FROM scoped s JOIN sf_email_message e ON e.parent_id = s.id
       WHERE NOT e.is_deleted AND ${inRange("e.message_date")}
      UNION
      SELECT s.contact_id FROM scoped s JOIN sf_task t ON t.what_id = s.id
       WHERE NOT t.is_deleted AND ${inRange("coalesce(t.completed_at, t.created_date)")}
         AND (t.call_party IS NULL OR btrim(t.call_party) = ${CALL_PARTY.candidate})
    ),
    c AS (
      SELECT ct.id, ct.created_date,
             CASE WHEN acc.name ILIKE ${CANDIDATE_ACCOUNT_PATTERN} THEN acc.name ELSE ${OTHER_ACCOUNT} END AS account,
             coalesce(ct.data->>'CV__c', 'false') = 'true' AS has_cv,
             -- "אין" is how the site says it has no district: the same as none at all.
             coalesce(nullif(nullif(ct.data->>'district_index__c', ''), 'אין'), 'לא ידוע') AS district,
             ct.data->>'LastActivityDate' AS last_activity,
             ap.n AS applied_n,
             aa.contact_id IS NOT NULL AS applied_any,
             coalesce(aa.paid, false) AS applied_paid,
             er.contact_id IS NOT NULL AS applied_earlier,
             tc.contact_id IS NOT NULL AS touched
        FROM sf_contact ct
        LEFT JOIN sf_account acc ON acc.id = ct.account_id
        LEFT JOIN applied ap ON ap.contact_id = ct.id
        LEFT JOIN applied_any aa ON aa.contact_id = ct.id
        LEFT JOIN earlier er ON er.contact_id = ct.id
        LEFT JOIN touched tc ON tc.contact_id = ct.id
       WHERE NOT ct.is_deleted AND (acc.name ILIKE ${CANDIDATE_ACCOUNT_PATTERN} OR ct.id IN (SELECT contact_id FROM app))
    )
    SELECT
      (SELECT json_agg(x ORDER BY x.candidates DESC) FROM (
         SELECT c.account,
                count(*) AS candidates,
                count(*) FILTER (WHERE ${inRange("c.created_date")}) AS new_in_range,
                count(*) FILTER (WHERE ${active}) AS active,
                count(*) FILTER (WHERE c.applied_n IS NOT NULL) AS applicants,
                count(*) FILTER (WHERE c.applied_n IS NOT NULL AND c.applied_earlier) AS returning,
                coalesce(sum(c.applied_n), 0) AS applications,
                count(*) FILTER (WHERE c.has_cv) AS with_cv,
                count(*) FILTER (WHERE c.applied_n IS NOT NULL AND c.has_cv) AS applicants_with_cv,
                count(*) FILTER (WHERE c.applied_any) AS applied_all,
                count(*) FILTER (WHERE c.applied_paid) AS applied_paid
           FROM c GROUP BY c.account) x) AS accounts,
      (SELECT json_agg(x) FROM (
         SELECT d.day, sum(d.new_n) AS new_n, sum(d.app_n) AS app_n FROM (
           SELECT to_char(c.created_date AT TIME ZONE 'Asia/Jerusalem', 'YYYY-MM-DD') AS day, 1 AS new_n, 0 AS app_n
             FROM c WHERE ${inRange("c.created_date")}
           UNION ALL
           SELECT day, 0, 1 FROM (
             SELECT DISTINCT contact_id, to_char(created_date AT TIME ZONE 'Asia/Jerusalem', 'YYYY-MM-DD') AS day
               FROM scoped WHERE ${inRange("created_date")}) daily
         ) d GROUP BY d.day) x) AS daily,
      (SELECT json_agg(x ORDER BY x.count DESC) FROM (
         SELECT c.district, count(*) AS count FROM c WHERE c.applied_n IS NOT NULL GROUP BY c.district ORDER BY 2 DESC LIMIT 8) x) AS districts,
      (SELECT json_agg(x ORDER BY x.count DESC) FROM (
         -- The site's skill list holds names for some candidates and internal ids for others; ids are skipped.
         -- The skill checkboxes on the Contact cover the rest; a candidate counts once per skill.
         -- Read from the Contact for the applicants only, not carried through the whole pool.
         SELECT k.skill, count(DISTINCT k.id) AS count FROM (
           SELECT ct.id, btrim(s) AS skill
             FROM c JOIN sf_contact ct ON ct.id = c.id, unnest(string_to_array(ct.data->>'skills_cambium__c', ',')) s
            WHERE c.applied_n IS NOT NULL AND btrim(s) <> '' AND btrim(s) !~ '^[0-9a-f]{24}$'
           UNION ALL
           SELECT ct.id, flag
             FROM c JOIN sf_contact ct ON ct.id = c.id,
                  unnest(array_remove(ARRAY[${sql.join(
                    SKILL_FIELDS.map(([field, label]) => sql`CASE WHEN ct.data->>${field} = 'true' THEN ${label}::text END`),
                    sql`, `,
                  )}], NULL)) flag
            WHERE c.applied_n IS NOT NULL
         ) k GROUP BY k.skill ORDER BY 2 DESC LIMIT 10) x) AS skills`);

  const row = (result.rows[0] ?? {}) as Json;
  const accountsRaw = (row.accounts as Json[] | null) ?? [];
  const sum = (key: string) => accountsRaw.reduce((s, a) => s + n(a[key]), 0);
  const daily = (row.daily as Json[] | null) ?? [];

  return {
    candidates: sum("candidates"),
    cambium: accountsRaw.filter((a) => String(a.account).startsWith(CAMBIUM_ACCOUNT_PREFIX)).reduce((s, a) => s + n(a.candidates), 0),
    newInRange: sum("new_in_range"),
    active: sum("active"),
    applicants: sum("applicants"),
    returning: sum("returning"),
    applications: sum("applications"),
    withCv: sum("with_cv"),
    applicantsWithCv: sum("applicants_with_cv"),
    appliedSplit: { all: sum("applied_all"), paid: sum("applied_paid") },
    accounts: accountsRaw
      .map((a) => ({
        account: String(a.account),
        candidates: n(a.candidates),
        newInRange: n(a.new_in_range),
        active: n(a.active),
        applicants: n(a.applicants),
        withCv: n(a.with_cv),
      }))
      // The named candidate Accounts first, by size; the catch-all row last.
      .sort((a, b) => Number(a.account === OTHER_ACCOUNT) - Number(b.account === OTHER_ACCOUNT) || b.candidates - a.candidates),
    dailyNew: new Map(daily.map((d) => [String(d.day), n(d.new_n)])),
    dailyApplicants: new Map(daily.map((d) => [String(d.day), n(d.app_n)])),
    districts: ((row.districts as Json[] | null) ?? []).map((d) => ({ district: String(d.district), count: n(d.count) })),
    skills: ((row.skills as Json[] | null) ?? []).map((s) => ({ skill: String(s.skill), count: n(s.count) })),
  };
}

import { sql } from "drizzle-orm";

/**
 * Paid vs. showcase activity. Some jobs on the site are paid (the employer pays
 * for them); the rest are there so the board looks full. Every dashboard figure
 * built on jobs or applications honours the scope, and the default is paid only.
 *
 * - A job is paid when the site marks it sponsored (`isSponserd_cambium__c`), or
 *   by the older "משרה בתשלום" checkbox (`Field18__c`) that preceded it.
 * - An application is paid when it is stamped "הגשה למשרה בתשלום" (`A_Money__c`)
 *   at the time it was made, or when its job is paid. The site never fills
 *   `isSponserd_cambium__c` on applications, only on jobs.
 */

export const SCOPES = [
  { key: "paid", label: "בתשלום בלבד", hint: "משרות בתשלום וההגשות אליהן" },
  { key: "all", label: "כל המשרות", hint: "כולל משרות שלא בתשלום, שמוצגות באתר כתפאורה" },
] as const;

export type Scope = (typeof SCOPES)[number]["key"];

export const DEFAULT_SCOPE: Scope = "paid";

export const parseScope = (value: string | undefined): Scope => (value === "all" ? "all" : DEFAULT_SCOPE);

/** Row filter for loaded jobs or applications. */
export const inScope =
  (scope: Scope) =>
  (row: { paid: boolean }): boolean =>
    scope === "all" || row.paid;

/**
 * SQL boolean, never null: the job Case under `alias` is paid.
 * `alias` is a table alias written in code, never user input.
 */
export function jobPaidSql(alias: string) {
  return sql.raw(`coalesce((${alias}.data->>'isSponserd_cambium__c') = 'true' OR (${alias}.data->>'Field18__c') = 'true', false)`);
}

/** SQL boolean, never null: the application under `app` is paid; `job` is its (left-joined) job Case. */
export function applicationPaidSql(app: string, job: string) {
  return sql`(coalesce((${sql.raw(app)}.data->>'A_Money__c') = 'true', false) OR ${jobPaidSql(job)})`;
}

/** Public site job keys of paid jobs, as a subquery. */
export const paidJobKeysSql = sql`
  SELECT DISTINCT pj.site_job_key FROM sf_case pj
    JOIN sf_record_type pjrt ON pjrt.id = pj.record_type_id
   WHERE pjrt.developer_name = 'Position' AND NOT pj.is_deleted AND pj.site_job_key IS NOT NULL AND ${jobPaidSql("pj")}`;

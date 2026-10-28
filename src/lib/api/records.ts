import { sql } from "drizzle-orm";
import { addDays, israelMidnight } from "@/lib/dashboard/params";
import { getDb } from "@/lib/db/client";
import type { ApplicationRow } from "@/lib/entities/applications";
import type { CandidateRow } from "@/lib/entities/candidates";
import { normStatus, RECORD_TYPES } from "@/lib/metrics/candidates";
import { applicationPaidSql, type Scope } from "@/lib/metrics/paid";

/**
 * The detailed side of the API (records:read): one application or one candidate per row, by ids,
 * never a file. A person's name, email and phone are added only when `people` is true, which
 * lib/api/people.ts decides (people:read, an active admin issuer, the daily export budget).
 */

const iso = (d: Date | null) => d?.toISOString() ?? null;

export function applicationJson(r: ApplicationRow, people: boolean) {
  return {
    id: r.id,
    case_number: r.caseNumber,
    job_id: r.jobId,
    job_title: r.jobTitle,
    company: r.company,
    candidate_id: r.candidateId,
    status: r.status,
    paid: r.paid,
    fast_applied: r.fastApplied,
    candidate_has_cv: r.candidateHasCv,
    owner: r.ownerName,
    created_at: r.createdAt.toISOString(),
    closed_at: iso(r.closedAt),
    accepted_at: iso(r.acceptedAt),
    start_date: r.startDate,
    ...(people ? { candidate: { name: r.candidateName, email: r.candidateEmail, phone: r.candidatePhone } } : {}),
  };
}

export function candidateJson(r: CandidateRow, people: boolean) {
  return {
    id: r.id,
    created_at: iso(r.createdAt),
    city: r.city,
    district: r.place.district,
    sub_district: r.place.subdistrict,
    skills: r.skills,
    has_cv: r.hasCv,
    fast_apply: r.fastApply,
    applications: r.applications,
    first_application_at: iso(r.firstApplicationAt),
    last_application_at: iso(r.lastApplicationAt),
    ...(people ? { name: r.name, email: r.email, phone: r.phone } : {}),
  };
}

type Row = Record<string, unknown>;
const run = async (query: ReturnType<typeof sql>) => (await getDb().execute<Row>(query)).rows;

/** Every change of an application's status, oldest first (status history is kept from 2025 on). */
export async function statusHistory(caseId: string): Promise<{ at: string; from: string | null; to: string | null }[]> {
  const rows = await run(sql`
    SELECT h.created_date, h.old_value, h.new_value FROM sf_case_history h
     WHERE h.case_id = ${caseId} AND h.field = 'Status'
     ORDER BY h.created_date, h.id`);
  return rows.map((r) => ({
    at: new Date(String(r.created_date)).toISOString(),
    from: normStatus(typeof r.old_value === "string" ? r.old_value : null),
    to: normStatus(typeof r.new_value === "string" ? r.new_value : null),
  }));
}

export type ApplicationsBy = "day" | "job" | "job_day";

/**
 * Applications created in inclusive Israel days, counted by day, by job or by both: what links
 * applications to jobs with an aggregates-only key. Counts only, no people.
 */
export async function applicationsByJobDay(fromDay: string, toDay: string, scope: Scope, by: ApplicationsBy) {
  const from = israelMidnight(fromDay);
  const to = israelMidnight(addDays(toDay, 1));
  const paid = applicationPaidSql("a", "j");
  const day = sql`to_char(a.created_date AT TIME ZONE 'Asia/Jerusalem', 'YYYY-MM-DD')`;
  const withDay = by !== "job";
  const withJob = by !== "day";
  const rows = await run(sql`
    SELECT ${withDay ? day : sql`NULL`} AS day,
           ${withJob ? sql`a.parent_id` : sql`NULL`} AS job_id,
           ${withJob ? sql`min(coalesce(nullif(j.data->>'Position_cambium__c', ''), nullif(j.data->>'Subject', '')))` : sql`NULL`} AS job_title,
           ${withJob ? sql`min(nullif(j.data->>'company_cambium__c', ''))` : sql`NULL`} AS company,
           count(*)::int AS n,
           (count(*) FILTER (WHERE ${paid}))::int AS paid
      FROM sf_case a
      JOIN sf_record_type rt ON rt.id = a.record_type_id
      LEFT JOIN sf_case j ON j.id = a.parent_id
     WHERE rt.developer_name IN (${RECORD_TYPES.application}, ${RECORD_TYPES.accepted}) AND NOT a.is_deleted
       AND a.created_date >= ${from} AND a.created_date < ${to}
       ${scope === "paid" ? sql`AND ${paid}` : sql``}
     GROUP BY 1, 2
     ORDER BY 1 NULLS FIRST, 5 DESC, 2`);
  const out = rows.map((r) => ({
    ...(withDay ? { day: String(r.day) } : {}),
    ...(withJob ? { job_id: (r.job_id as string | null) ?? null, job_title: (r.job_title as string | null) ?? null, company: (r.company as string | null) ?? null } : {}),
    applications: Number(r.n),
    paid: Number(r.paid),
  }));
  return { range: { from: fromDay, to: toDay, scope, by }, total: out.reduce((s, r) => s + r.applications, 0), rows: out };
}

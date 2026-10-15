import { sql, type SQL } from "drizzle-orm";
import { placeFilterSql, placeLabel, type PlaceLabel } from "@/lib/geo/filters";
import { GEO_CTES } from "@/lib/geo/localities";
import { RECORD_TYPES } from "@/lib/metrics/candidates";
import { companyKeySql, companyNameOf } from "@/lib/metrics/company";
import { jobPlaceSql } from "@/lib/metrics/geo";
import { jobPaidSql } from "@/lib/metrics/paid";
import { skillNames, SKILLS } from "@/lib/skills";
import { JOB_STATUS_LABELS } from "./companies";
import { asDate, containsPattern, dayBounds, isTrue, num, PAGE_SIZE, run, str } from "./search";
import { orderBy, type Sort, type SortColumn } from "./sort";

/**
 * Jobs as a record list (/positions): every job Case (RecordType `Position`), searchable by
 * title, company or Case number, and filterable by site status, paid, place (CBS district and
 * sub-district) and required skill. Each row opens the job card, /positions/[id].
 */

export const JOB_STATUS_VALUES = [...Object.keys(JOB_STATUS_LABELS), "none"] as const;

export interface PositionFilters {
  q: string;
  /** `PStatus__c` on the site, or "none" for jobs without one. */
  status: (typeof JOB_STATUS_VALUES)[number] | "";
  paid: "paid" | "free" | "";
  /** CBS district, or nationwide / from home / unknown (lib/geo/filters.ts). */
  area: string;
  napa: string;
  skill: string;
  fromDay: string;
  toDay: string;
}

export interface PositionRow {
  id: string;
  caseNumber: string | null;
  title: string | null;
  company: string | null;
  companyKey: string | null;
  status: string | null;
  paid: boolean;
  marked: boolean;
  location: string | null;
  place: PlaceLabel;
  skills: string[];
  applications: number;
  createdAt: Date | null;
}

const PLACE = jobPlaceSql("p");
const COMPANY_NAME = companyNameOf();

const POSITIONS = sql`
  WITH ${GEO_CTES},
  job_apps AS (
    SELECT a.parent_id, count(*) AS n
      FROM sf_case a JOIN sf_record_type art ON art.id = a.record_type_id
     WHERE art.developer_name IN (${RECORD_TYPES.application}, ${RECORD_TYPES.accepted}) AND NOT a.is_deleted AND a.parent_id IS NOT NULL
     GROUP BY a.parent_id
  ),
  pos AS (
    SELECT p.id, p.created_date, p.data->>'CaseNumber' AS case_number,
           coalesce(nullif(p.data->>'Position_cambium__c', ''), nullif(p.data->>'Position_Name__c', ''), nullif(p.data->>'Subject', '')) AS title,
           ${sql.raw(COMPANY_NAME)} AS company, ${companyKeySql(COMPANY_NAME)} AS company_key,
           nullif(p.data->>'PStatus__c', '') AS p_status,
           ${jobPaidSql("p")} AS paid,
           coalesce(p.data->>'isMarked_cambium__c', 'false') = 'true' AS marked,
           nullif(p.data->>'PLocation_cambium__c', '') AS location,
           p.data->>'PSkills_cambium__c' AS skill_ids,
           ${PLACE.kind} AS place_kind, ${PLACE.napa} AS napa, ${PLACE.locality} AS locality,
           coalesce(ja.n, 0) AS applications
      FROM sf_case p
      JOIN sf_record_type rt ON rt.id = p.record_type_id
      LEFT JOIN sf_account acc ON acc.id = p.account_id
      LEFT JOIN job_apps ja ON ja.parent_id = p.id
      ${PLACE.joins}
     WHERE rt.developer_name = ${RECORD_TYPES.position} AND NOT p.is_deleted
  )`;

/** The columns the list can be sorted by; `created` (newest first) is the default. */
export const POSITION_SORTS: readonly SortColumn[] = [
  { key: "created", kind: "date", by: sql`j.created_date` },
  { key: "title", kind: "text", by: sql`j.title` },
  { key: "company", kind: "text", by: sql`j.company` },
  { key: "status", kind: "text", by: sql`j.p_status` },
  { key: "location", kind: "text", by: sql`j.location` },
  { key: "applications", kind: "number", by: sql`j.applications` },
];

export async function searchPositions(
  f: PositionFilters,
  { page = 1, pageSize = PAGE_SIZE, sort }: { page?: number; pageSize?: number; sort?: Sort } = {},
): Promise<{ rows: PositionRow[]; total: number }> {
  const parts: SQL[] = [sql`true`];
  if (f.q) {
    const p = containsPattern(f.q);
    parts.push(sql`(j.title ILIKE ${p} OR j.company ILIKE ${p} OR j.case_number ILIKE ${p} OR j.location ILIKE ${p})`);
  }
  if (f.status === "none") parts.push(sql`j.p_status IS NULL`);
  else if (f.status) parts.push(sql`j.p_status = ${f.status}`);
  if (f.paid === "paid") parts.push(sql`j.paid`);
  if (f.paid === "free") parts.push(sql`NOT j.paid`);
  parts.push(...placeFilterSql("j", f.area, f.napa));
  if (f.skill) parts.push(sql`EXISTS (SELECT 1 FROM unnest(string_to_array(j.skill_ids, ',')) s WHERE btrim(s) = ${skillId(f.skill)})`);
  const { from, to } = dayBounds(f.fromDay, f.toDay);
  if (from) parts.push(sql`j.created_date >= ${from}`);
  if (to) parts.push(sql`j.created_date < ${to}`);
  const where = sql.join(parts, sql` AND `);

  const [rows, count] = await Promise.all([
    run(sql`${POSITIONS} SELECT j.* FROM pos j WHERE ${where}
             ORDER BY ${orderBy(POSITION_SORTS, sort ?? { key: "created", dir: "desc" }, sql`j.id`)}
             LIMIT ${pageSize} OFFSET ${(page - 1) * pageSize}`),
    run(sql`${POSITIONS} SELECT count(*) AS n FROM pos j WHERE ${where}`),
  ]);
  return {
    rows: rows.map((r) => ({
      id: String(r.id),
      caseNumber: str(r.case_number),
      title: str(r.title),
      company: str(r.company),
      companyKey: str(r.company_key),
      status: str(r.p_status),
      paid: isTrue(r.paid),
      marked: isTrue(r.marked),
      location: str(r.location),
      place: placeLabel(r),
      skills: skillNames(str(r.skill_ids)),
      applications: num(r.applications),
      createdAt: asDate(r.created_date),
    })),
    total: num(count[0]?.n),
  };
}

/** Jobs list skills by id: the filter takes the name and looks for its id. */
const skillId = (label: string) => SKILLS.find((s) => s.label === label)?.id ?? label;

import { sql } from "drizzle-orm";
import { apiJson, withApiToken } from "@/lib/api/inbound";
import { siteFeedTokens } from "@/lib/api/tokens";
import { cached } from "@/lib/cache";
import { getDb } from "@/lib/db/client";
import { RECORD_TYPES } from "@/lib/metrics/candidates";
import { jobPaidSql } from "@/lib/metrics/paid";

export const dynamic = "force-dynamic";

/**
 * The job feed for the new public site (skeelz-site): every job live on the site,
 * with what the public job page shows and nothing more — no employer contact
 * details, no applications, no people. Opened only by SITE_FEED_TOKEN.
 */

const list = (v: unknown) =>
  String(v ?? "")
    .split(/[,;]/)
    .map((s) => s.trim())
    .filter(Boolean);

async function loadFeed() {
  const rows = (
    await getDb().execute(sql`
      SELECT c.id, c.site_job_key, c.data->>'CaseNumber' AS case_number,
             coalesce(nullif(c.data->>'Position_cambium__c', ''), nullif(c.data->>'Subject', '')) AS title,
             coalesce(nullif(c.data->>'company_cambium__c', ''), acc.name) AS company,
             c.data->>'PDescription_cambium__c' AS description_html,
             nullif(c.data->>'PLocation_cambium__c', '') AS city,
             nullif(c.data->>'citySymbol_cambium__c', '') AS city_symbol,
             c.data->>'PTime_cambium__c' AS job_scope,
             c.data->>'PSkills_cambium__c' AS skills,
             coalesce(c.data->>'isMarked_cambium__c', 'false') = 'true' AS hot,
             ${jobPaidSql("c")} AS sponsored,
             coalesce(c.data->>'isSelfApply_cambium__c', 'false') = 'true' AS self_apply,
             coalesce(c.data->>'PCreatedDate_cambium__c', c.created_date::text) AS published_at,
             coalesce(c.data->>'PModifiedDate_cambium__c', c.system_modstamp::text) AS updated_at
        FROM sf_case c
        JOIN sf_record_type rt ON rt.id = c.record_type_id
        LEFT JOIN sf_account acc ON acc.id = c.account_id
       WHERE rt.developer_name = ${RECORD_TYPES.position} AND NOT c.is_deleted
         AND c.site_job_key IS NOT NULL AND (c.data->>'PStatus__c') = 'Active'
       ORDER BY published_at DESC`)
  ).rows as Record<string, unknown>[];

  return rows.map((r) => ({
    id: String(r.site_job_key),
    case_id: String(r.id),
    case_number: r.case_number ?? null,
    title: r.title ?? null,
    company: r.company ?? null,
    description_html: r.description_html ?? null,
    city: r.city ?? null,
    city_symbol: r.city_symbol ? Number(r.city_symbol) : null,
    job_scope: list(r.job_scope),
    skill_ids: list(r.skills),
    hot: r.hot === true,
    sponsored: r.sponsored === true,
    self_apply: r.self_apply === true,
    published_at: r.published_at ?? null,
    updated_at: r.updated_at ?? null,
  }));
}

export const GET = withApiToken(
  "GET /api/v1/site/jobs",
  async () => {
    const jobs = await cached("site-feed", loadFeed);
    return apiJson({ data: jobs, total: jobs.length, generated_at: new Date().toISOString() });
  },
  { tokens: siteFeedTokens, bucket: "site-feed" },
);

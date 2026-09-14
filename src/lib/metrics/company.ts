import { sql } from "drizzle-orm";

/**
 * Who a job belongs to. Jobs from the site all sit under one shared Account and
 * carry the employer only as text (`company_cambium__c`); older jobs have a real
 * Account. So a company is identified by its name, folded into a key.
 */

/** SQL text: a job's company name — the site's, or its Account's. `p` is the job, `acc` its Account. */
export const companyNameOf = (p = "p", acc = "acc") => `coalesce(nullif(${p}.data->>'company_cambium__c', ''), ${acc}.name)`;

/**
 * A company name folded for matching: no quotes or punctuation, no legal-form
 * words (בע"מ, עמותה, ltd …), single spaces. `col` is SQL written in code, never input.
 */
export const companyKeySql = (col: string) =>
  sql.raw(
    `nullif(btrim(regexp_replace(regexp_replace(' ' || regexp_replace(regexp_replace(lower(${col}), '["״׳'']', '', 'g'), '[^a-z0-9א-ת]+', ' ', 'g') || ' ', ' (בעמ|ער|עמותת|עמותה|חברת|ltd|inc) ', ' ', 'g'), ' +', ' ', 'g')), '')`,
  );

/** The employer's contact addresses on the job Case aliased `alias`. */
export const employerEmailsSql = (alias: string) =>
  sql.raw(
    `array_remove(ARRAY[lower(nullif(${alias}.data->>'PEmail_cambium__c', '')), lower(nullif(${alias}.data->>'ContactEmail', '')), lower(nullif(${alias}.data->>'r_mail__c', ''))], NULL)`,
  );

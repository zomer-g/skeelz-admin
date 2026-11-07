import { sql, type SQL } from "drizzle-orm";
import { auditLog } from "@/lib/db/schema";
import { emailPath, normEmail } from "@/lib/entities/emails";
import { isSfId } from "@/lib/entities/search";

/**
 * "Who saw person X, when": the activity-log entries that name one person or record, for the
 * subject filter on /admin/audit. A subject is a Salesforce id (Contact, Case, file) or an email
 * address; it is looked for where the log puts it:
 * - the entry's target: a file open's subject, a record screen (/candidates/<id>, /emails/<address>…);
 * - the record ids and addresses an entry lists (records.shown, mcp/api.people_listed: `ids`);
 * - a file open's contactId / email / documentId;
 * - a CV search's results (`files`, and the page shown, `shown.files`).
 * Every test is an exact match, served by the GIN index on details and the pattern index on target.
 */
export type Subject = { kind: "id"; value: string } | { kind: "email"; value: string };

export function parseSubject(raw: string): Subject | null {
  const v = raw.trim();
  if (!v) return null;
  if (v.includes("@")) {
    const email = normEmail(v);
    return email ? { kind: "email", value: email } : null;
  }
  return isSfId(v) ? { kind: "id", value: v } : null;
}

const RECORD_SCREENS = ["/candidates/", "/applications/", "/cvs/", "/positions/", "/leads/", "/jobs/", "/outreach/"];

export function subjectCondition(s: Subject): SQL {
  const json = (o: unknown) => sql`${auditLog.details} @> ${JSON.stringify(o)}::jsonb`;
  const inDetails =
    s.kind === "email"
      ? [json({ ids: [s.value] }), json({ email: s.value }), json({ files: [{ email: s.value }] }), json({ shown: { files: [{ email: s.value }] } })]
      : [
          json({ ids: [s.value] }),
          json({ contactId: s.value }),
          json({ documentId: s.value }),
          json({ files: [{ documentId: s.value }] }),
          json({ shown: { files: [{ contactId: s.value }] } }),
          json({ shown: { files: [{ documentId: s.value }] } }),
        ];
  const paths = s.kind === "email" ? [emailPath(s.value)] : RECORD_SCREENS.map((p) => p + s.value);
  // The target index covers its first 1,000 characters (schema.ts); a subject's path is far shorter.
  const t = sql`left(${auditLog.target}, 1000)`;
  const inTarget = [
    sql`${t} = ${s.value}`,
    ...paths.flatMap((p) => [sql`${t} = ${p}`, sql`${t} LIKE ${`${likeEscape(p)}?%`}`]),
  ];
  return sql`(${sql.join([...inTarget, ...inDetails], sql` OR `)})`;
}

const likeEscape = (v: string) => v.replace(/[\\%_]/g, (c) => `\\${c}`);

import { sql } from "drizzle-orm";
import { asDate, num, run, str } from "./search";

/**
 * Who opened each candidate file, read back from the audit log: every open through the file
 * routes writes `candidate.file_opened` with the document id (lib/entities/serve-file.ts), and a
 * refusal at the hourly limit writes `candidate.file_rate_limited`. Indexed per document.
 */

const OPENED = "candidate.file_opened";
const REFUSED = "candidate.file_rate_limited";

export interface FileAccessSummary {
  opens: number;
  lastAt: Date | null;
  lastBy: string | null;
}

/** Opens per file, for a page of files. */
export async function loadFileAccess(documentIds: string[]): Promise<Map<string, FileAccessSummary>> {
  if (!documentIds.length) return new Map();
  const rows = await run(sql`
    SELECT details->>'documentId' AS document_id, count(*) AS opens, max(at) AS last_at,
           (array_agg(actor ORDER BY at DESC))[1] AS last_by
      FROM audit_log
     WHERE action = ${OPENED} AND (details->>'documentId') IN ${documentIds}
     GROUP BY 1`);
  return new Map(rows.map((r) => [String(r.document_id), { opens: num(r.opens), lastAt: asDate(r.last_at), lastBy: str(r.last_by) }]));
}

export interface FileAccessEntry {
  at: Date;
  actor: string;
  /** The user's name, when they are a user of the site. */
  actorName: string | null;
  opened: boolean;
  /** Through which page the file was reached: the email address, or the candidate's id. */
  via: string | null;
}

/** Every open (and refusal) of one file, newest first. */
export async function loadFileAccessLog(documentId: string, limit = 500): Promise<FileAccessEntry[]> {
  const rows = await run(sql`
    SELECT a.at, a.actor, a.action, a.target, u.name AS actor_name
      FROM audit_log a
      LEFT JOIN users u ON lower(u.email) = lower(a.actor)
     WHERE a.action IN (${OPENED}, ${REFUSED}) AND (a.details->>'documentId') = ${documentId}
     ORDER BY a.at DESC
     LIMIT ${limit}`);
  return rows.map((r) => ({
    at: asDate(r.at)!,
    actor: String(r.actor),
    actorName: str(r.actor_name),
    opened: r.action === OPENED,
    via: str(r.target),
  }));
}

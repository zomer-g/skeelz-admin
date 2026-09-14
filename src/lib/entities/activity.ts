import { sql } from "drizzle-orm";
import { normStatus } from "@/lib/metrics/candidates";
import { asDate, run, str } from "./search";

/**
 * Everything that happened on one Case, newest first: status, record type and
 * owner changes from the history, emails, and logged calls and tasks.
 * Email-type tasks are skipped — they copy an email that is already listed.
 */

export type ActivityKind = "created" | "status" | "type" | "owner" | "email" | "call" | "task";

export interface ActivityItem {
  at: Date;
  kind: ActivityKind;
  title: string;
  detail: string | null;
  incoming?: boolean;
}

/** Owner and record type history carry the change twice: once as names, once as ids. Keep the names. */
const LOOKS_LIKE_ID = /^[a-zA-Z0-9]{15,18}$/;

export async function loadCaseTimeline(caseId: string): Promise<ActivityItem[]> {
  const [history, emails, tasks] = await Promise.all([
    run(sql`
      SELECT field, old_value, new_value, created_date FROM sf_case_history
       WHERE case_id = ${caseId} AND field IN ('created', 'Status', 'RecordType', 'Owner')`),
    run(sql`
      SELECT message_date, incoming, from_address, to_address, subject FROM sf_email_message
       WHERE parent_id = ${caseId} AND NOT is_deleted`),
    run(sql`
      SELECT coalesce(completed_at, created_date) AS at, task_subtype, type, subject, status, call_party, call_answered::text AS answered
        FROM sf_task
       WHERE what_id = ${caseId} AND NOT is_deleted AND coalesce(task_subtype, '') <> 'Email'`),
  ]);

  const items: ActivityItem[] = [];
  for (const h of history) {
    const at = asDate(h.created_date);
    const next = str(h.new_value);
    const prev = str(h.old_value);
    if (!at) continue;
    if (h.field === "created") items.push({ at, kind: "created", title: "התיק נוצר", detail: null });
    else if (h.field === "Status") items.push({ at, kind: "status", title: `סטטוס: ${normStatus(next) ?? "—"}`, detail: prev ? `מ: ${normStatus(prev)}` : null });
    else if (next && LOOKS_LIKE_ID.test(next)) continue;
    else if (h.field === "RecordType") items.push({ at, kind: "type", title: `סוג התיק: ${next ?? "—"}`, detail: prev ? `מ: ${prev}` : null });
    else if (h.field === "Owner") items.push({ at, kind: "owner", title: `מטפל: ${next ?? "—"}`, detail: prev ? `מ: ${prev}` : null });
  }
  for (const e of emails) {
    const at = asDate(e.message_date);
    if (!at) continue;
    const incoming = e.incoming === true;
    items.push({
      at,
      kind: "email",
      title: str(e.subject) ?? "(ללא נושא)",
      detail: incoming ? `מאת ${str(e.from_address) ?? "—"}` : `אל ${str(e.to_address) ?? "—"}`,
      incoming,
    });
  }
  for (const t of tasks) {
    const at = asDate(t.at);
    if (!at) continue;
    const isCall = t.task_subtype === "Call" || /^call/i.test(String(t.type ?? ""));
    const answered = t.answered === "true" ? "היה מענה" : t.answered === "false" ? "לא היה מענה" : null;
    const party = str(t.call_party);
    items.push({
      at,
      kind: isCall ? "call" : "task",
      title: str(t.subject) ?? (isCall ? "שיחה" : "משימה"),
      detail: [party ? `צד לשיחה: ${party}` : null, isCall ? answered : str(t.status)].filter(Boolean).join(" · ") || null,
    });
  }
  return items.sort((a, b) => b.at.getTime() - a.at.getTime());
}

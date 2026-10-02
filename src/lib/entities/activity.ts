import { sql } from "drizzle-orm";
import { logError } from "@/lib/log";
import { normStatus } from "@/lib/metrics/candidates";
import { salesforceConfigured, sf } from "@/lib/sf/client";
import { asDate, htmlToText, isSfId, run, str } from "./search";

/**
 * Everything that happened on one Case, newest first.
 *
 * From the mirror: status and owner changes (history), emails (metadata), logged calls and tasks
 * with their notes, and meetings. Email-type tasks are skipped — they copy an email already listed.
 *
 * Live from Salesforce (loadFullCaseTimeline, for the record pages): the case's Chatter posts and
 * case comments ("הערות"), and the text of each email. These are read on demand and never copied
 * into the mirror, like candidate files; the page view itself is in the activity log.
 */

export type ActivityKind = "created" | "status" | "owner" | "email" | "call" | "task" | "meeting" | "note" | "comment";

export interface ActivityItem {
  at: Date;
  kind: ActivityKind;
  title: string;
  detail: string | null;
  incoming?: boolean;
  /** Salesforce id: for emails, to attach their text. */
  id?: string;
  /** The full text: an email's body, a note, a call's description. Plain text, never HTML. */
  body?: string | null;
  /** Who wrote it, where Salesforce says. */
  by?: string | null;
}

/** Owner and record type history carry the change twice: once as names, once as ids. Keep the names. */
const LOOKS_LIKE_ID = /^[a-zA-Z0-9]{15,18}$/;
/** A body longer than this is cut: a forwarded thread can run to hundreds of kilobytes. */
const MAX_BODY = 20_000;

const cleanBody = (text: string | null | undefined): string | null => {
  const t = (text ?? "").replace(/\r\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  if (!t) return null;
  return t.length > MAX_BODY ? `${t.slice(0, MAX_BODY)}\n…(הטקסט קוצר)` : t;
};

export async function loadCaseTimeline(caseId: string): Promise<ActivityItem[]> {
  const [history, emails, tasks, events] = await Promise.all([
    run(sql`
      SELECT field, old_value, new_value, created_date FROM sf_case_history
       WHERE case_id = ${caseId} AND field IN ('created', 'Status', 'Owner')`),
    run(sql`
      SELECT id, message_date, incoming, from_address, to_address, cc_address, subject FROM sf_email_message
       WHERE parent_id = ${caseId} AND NOT is_deleted`),
    run(sql`
      SELECT coalesce(t.completed_at, t.created_date) AS at, t.task_subtype, t.type, t.subject, t.status, t.call_party,
             t.call_answered::text AS answered, t.data->>'Description' AS description, u.name AS owner_name
        FROM sf_task t LEFT JOIN sf_user u ON u.id = t.owner_id
       WHERE t.what_id = ${caseId} AND NOT t.is_deleted AND coalesce(t.task_subtype, '') <> 'Email'`),
    run(sql`
      SELECT coalesce(e.start_at, e.created_date) AS at, e.subject, e.type, e.data->>'Description' AS description,
             e.data->>'Location' AS location, u.name AS owner_name
        FROM sf_event e LEFT JOIN sf_user u ON u.id = e.owner_id
       WHERE e.what_id = ${caseId} AND NOT e.is_deleted`),
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
    else if (h.field === "Owner") items.push({ at, kind: "owner", title: `מטפל: ${next ?? "—"}`, detail: prev ? `מ: ${prev}` : null });
  }
  for (const e of emails) {
    const at = asDate(e.message_date);
    if (!at) continue;
    const incoming = e.incoming === true;
    const cc = str(e.cc_address);
    items.push({
      at,
      kind: "email",
      id: String(e.id),
      title: str(e.subject) ?? "(ללא נושא)",
      detail: (incoming ? `מאת ${str(e.from_address) ?? "—"}` : `אל ${str(e.to_address) ?? "—"}`) + (cc ? ` · עותק: ${cc}` : ""),
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
      body: cleanBody(str(t.description)),
      by: str(t.owner_name),
    });
  }
  for (const e of events) {
    const at = asDate(e.at);
    if (!at) continue;
    items.push({
      at,
      kind: "meeting",
      title: str(e.subject) ?? "פגישה",
      detail: [str(e.type), str(e.location)].filter(Boolean).join(" · ") || null,
      body: cleanBody(str(e.description)),
      by: str(e.owner_name),
    });
  }
  return items.sort((a, b) => b.at.getTime() - a.at.getTime());
}

/** Whether the live part could be read: "off" without Salesforce settings, "failed" when the call failed. */
export type LiveStatus = "ok" | "off" | "failed";

type FeedRow = { Id: string; Type: string; Body: string | null; LinkUrl: string | null; CreatedDate: string; CreatedBy: { Name?: string } | null };
type CommentRow = { Id: string; CommentBody: string | null; IsPublished: boolean; CreatedDate: string; CreatedBy: { Name?: string } | null };
type EmailRow = { Id: string; TextBody: string | null; HtmlBody: string | null };

const sfDate = (v: string) => new Date(v.replace(/([+-]\d{2})(\d{2})$/, "$1:$2"));

/** The mirror's timeline plus, live from Salesforce, the case's notes, comments and email texts. */
export async function loadFullCaseTimeline(caseId: string): Promise<{ items: ActivityItem[]; live: LiveStatus }> {
  const items = await loadCaseTimeline(caseId);
  if (!isSfId(caseId) || !salesforceConfigured()) return { items, live: "off" };

  let feed: FeedRow[];
  let comments: CommentRow[];
  let emails: EmailRow[];
  try {
    // caseId passed isSfId above: nothing else reaches the SOQL.
    [feed, comments, emails] = await Promise.all([
      sf.query<FeedRow>(
        `SELECT Id, Type, Body, LinkUrl, CreatedDate, CreatedBy.Name FROM CaseFeed WHERE ParentId = '${caseId}' AND Type IN ('TextPost', 'ChangeStatusPost', 'LinkPost', 'ContentPost') ORDER BY CreatedDate DESC LIMIT 200`,
      ),
      sf.query<CommentRow>(`SELECT Id, CommentBody, IsPublished, CreatedDate, CreatedBy.Name FROM CaseComment WHERE ParentId = '${caseId}' ORDER BY CreatedDate DESC LIMIT 200`),
      sf.query<EmailRow>(`SELECT Id, TextBody, HtmlBody FROM EmailMessage WHERE ParentId = '${caseId}' ORDER BY MessageDate DESC LIMIT 100`),
    ]);
  } catch (err) {
    logError("case timeline live", err);
    return { items, live: "failed" };
  }

  const bodies = new Map(emails.map((e) => [e.Id.slice(0, 15), cleanBody(e.TextBody ?? htmlToText(e.HtmlBody))]));
  for (const item of items) if (item.kind === "email" && item.id) item.body = bodies.get(item.id.slice(0, 15)) ?? null;

  for (const f of feed) {
    const body = cleanBody(htmlToText(f.Body));
    // A status change with nothing written is already in the history.
    if (f.Type === "ChangeStatusPost" && !body) continue;
    items.push({
      at: sfDate(f.CreatedDate),
      kind: "note",
      title: f.Type === "ChangeStatusPost" ? "הערה בשינוי סטטוס" : f.Type === "LinkPost" ? "קישור" : f.Type === "ContentPost" ? "קובץ" : "הערה",
      detail: f.LinkUrl,
      body,
      by: f.CreatedBy?.Name ?? null,
    });
  }
  for (const c of comments) {
    items.push({
      at: sfDate(c.CreatedDate),
      kind: "comment",
      title: c.IsPublished ? "הערה (גלויה ללקוח)" : "הערה פנימית",
      detail: null,
      body: cleanBody(c.CommentBody),
      by: c.CreatedBy?.Name ?? null,
    });
  }
  return { items: items.sort((a, b) => b.at.getTime() - a.at.getTime()), live: "ok" };
}

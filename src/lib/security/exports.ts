import { and, desc, eq, gte, sql } from "drizzle-orm";
import { writeAudit } from "@/lib/audit";
import { israelDay, israelMidnight } from "@/lib/dashboard/params";
import { getDb } from "@/lib/db/client";
import { auditLog, exportQuotaGrants } from "@/lib/db/schema";
import { raiseAlert } from "./files";

/**
 * How many people's details one person may take out of the system in a day (Israel time): the
 * copy buttons on /candidates and /cvs hand over emails or phones in bulk, and the MCP tools
 * that list people return names, emails and phones a page at a time. Each is logged with how
 * many people it returned, and the day's total is counted from those log entries, like the file
 * limit (lib/security/files.ts): 10,000 people a day; at 5,000 the admins get an alert; past the
 * limit a copy is cut to what is left (then refused), a tool call is refused, the admins are
 * asked, and an admin may let the person export another 10,000 that day — as often as needed.
 */
export const EXPORT_LIMITS = { daily: 10_000, alertAt: 5_000, grant: 10_000 } as const;

/** The log entries that carry people out, each with `details.count`. */
export const EXPORT_ACTIONS = ["candidates.contacts_copied", "cvs.contacts_copied", "mcp.people_listed"] as const;
export const MCP_PEOPLE_LISTED = "mcp.people_listed";
export const EXPORT_REFUSED = "export.rate_limited";

export interface ExportUsage {
  day: string;
  /** People handed over so far today. */
  exported: number;
  /** The daily limit plus what admins added today. */
  allowed: number;
  extra: number;
}

export async function dailyExportUsage(email: string, now = new Date()): Promise<ExportUsage> {
  const day = israelDay(now);
  const db = getDb();
  const [[used], [extra]] = await Promise.all([
    db
      .select({ n: sql<number>`coalesce(sum((${auditLog.details}->>'count')::int), 0)::int` })
      .from(auditLog)
      .where(and(eq(auditLog.actor, email), sql`${auditLog.action} IN ${EXPORT_ACTIONS}`, gte(auditLog.at, israelMidnight(day)))),
    db
      .select({ n: sql<number>`coalesce(sum(${exportQuotaGrants.extra}), 0)::int` })
      .from(exportQuotaGrants)
      .where(and(eq(exportQuotaGrants.userEmail, email), eq(exportQuotaGrants.day, day))),
  ]);
  const add = extra?.n ?? 0;
  return { day, exported: used?.n ?? 0, allowed: EXPORT_LIMITS.daily + add, extra: add };
}

/** How much of a request fits in what is left today: `take` people, `limited` when that is fewer than asked. */
export function exportAllowance(usage: Pick<ExportUsage, "exported" | "allowed">, requested: number): { take: number; limited: boolean } {
  const remaining = Math.max(0, usage.allowed - usage.exported);
  const take = Math.max(0, Math.min(requested, remaining));
  return { take, limited: take < requested };
}

/** True when handing over `n` more people crosses the alert threshold. */
export const crossesAlert = (exported: number, n: number, alertAt: number = EXPORT_LIMITS.alertAt) => exported < alertAt && exported + n >= alertAt;

/** After people were handed over: the admins hear about it at the threshold, once a day. */
export async function afterExport(email: string, usage: ExportUsage, n: number): Promise<void> {
  if (crossesAlert(usage.exported, n)) await raiseAlert("export_many", email, usage.day, EXPORT_LIMITS.alertAt);
}

/**
 * When a request is refused (or cut) at the limit: tell the admins once per limit reached, and
 * write one refusal entry a day per person and place, so a script in a loop cannot flood the log.
 */
export async function atExportLimit(email: string, usage: ExportUsage, where: string): Promise<void> {
  await raiseAlert("export_limit", email, usage.day, usage.allowed);
  const [seen] = await getDb()
    .select({ n: sql<number>`count(*)::int` })
    .from(auditLog)
    .where(and(eq(auditLog.actor, email), eq(auditLog.action, EXPORT_REFUSED), eq(auditLog.target, where), gte(auditLog.at, israelMidnight(usage.day))));
  if (!seen?.n) await writeAudit(email, EXPORT_REFUSED, where, { exported: usage.exported, allowed: usage.allowed });
}

/** The message a person sees when the day's budget is gone. */
export const exportLimitMessage = (usage: ExportUsage) =>
  `הגעת למגבלה היומית של ${usage.allowed.toLocaleString("he-IL")} פרטי מועמדים להעתקה. מנהל המערכת קיבל הודעה, והוא יכול לאשר לך עוד ${EXPORT_LIMITS.grant.toLocaleString("he-IL")} להיום.`;

/** An admin lets `email` export another batch today; their open export alerts for today are handled. */
export async function grantMoreExports(admin: string, email: string): Promise<ExportUsage> {
  const day = israelDay();
  const db = getDb();
  await db.insert(exportQuotaGrants).values({ userEmail: email, day, extra: EXPORT_LIMITS.grant, grantedBy: admin });
  await db.execute(sql`
    UPDATE security_alerts SET handled_at = now(), handled_by = ${admin}
     WHERE user_email = ${email} AND day = ${day} AND handled_at IS NULL AND kind IN ('export_many', 'export_limit')`);
  await writeAudit(admin, "exports.quota_granted", email, { day, extra: EXPORT_LIMITS.grant });
  return dailyExportUsage(email);
}

export interface ExportUsageRow {
  email: string;
  exported: number;
  refused: number;
  allowed: number;
  /** Where the people went: the copy buttons, the MCP tools, or both. */
  via: { screen: number; mcp: number };
}

/** Everyone who took people's details out today (or was refused), most first. */
export async function loadExportUsageToday(): Promise<ExportUsageRow[]> {
  const day = israelDay();
  const rows = (
    await getDb().execute<{ email: string; exported: number; screen: number; mcp: number; refused: number; extra: number }>(sql`
      SELECT a.actor AS email,
             coalesce(sum((a.details->>'count')::int) FILTER (WHERE a.action IN ${EXPORT_ACTIONS}), 0)::int AS exported,
             coalesce(sum((a.details->>'count')::int) FILTER (WHERE a.action IN ('candidates.contacts_copied', 'cvs.contacts_copied')), 0)::int AS screen,
             coalesce(sum((a.details->>'count')::int) FILTER (WHERE a.action = ${MCP_PEOPLE_LISTED}), 0)::int AS mcp,
             count(*) FILTER (WHERE a.action = ${EXPORT_REFUSED})::int AS refused,
             coalesce((SELECT sum(g.extra) FROM export_quota_grants g WHERE g.user_email = a.actor AND g.day = ${day}), 0)::int AS extra
        FROM audit_log a
       WHERE a.action IN ${[...EXPORT_ACTIONS, EXPORT_REFUSED]} AND a.at >= ${israelMidnight(day)}
       GROUP BY a.actor
       ORDER BY 2 DESC`)
  ).rows;
  return rows.map((r) => ({
    email: String(r.email),
    exported: Number(r.exported),
    refused: Number(r.refused),
    allowed: EXPORT_LIMITS.daily + Number(r.extra),
    via: { screen: Number(r.screen), mcp: Number(r.mcp) },
  }));
}

/** The grants given today, newest first, for the admin screen. */
export async function loadExportGrantsToday(): Promise<{ email: string; extra: number; grantedBy: string; grantedAt: Date }[]> {
  const rows = await getDb()
    .select()
    .from(exportQuotaGrants)
    .where(eq(exportQuotaGrants.day, israelDay()))
    .orderBy(desc(exportQuotaGrants.grantedAt));
  return rows.map((r) => ({ email: r.userEmail, extra: r.extra, grantedBy: r.grantedBy, grantedAt: r.grantedAt }));
}

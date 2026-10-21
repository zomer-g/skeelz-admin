import { and, desc, eq, gte, isNull, sql } from "drizzle-orm";
import { writeAudit } from "@/lib/audit";
import { israelDay, israelMidnight } from "@/lib/dashboard/params";
import { getDb } from "@/lib/db/client";
import { auditLog, fileQuotaGrants, securityAlerts } from "@/lib/db/schema";

/**
 * How many candidate files one person may open in a day (Israel time), counted from the audit log:
 * 20 a day; at the 10th the admins get an alert; past the limit the open is refused, the admins
 * are asked, and an admin may let the person open another 30 that day — as many times as needed.
 */
export const FILE_LIMITS = { daily: 20, alertAt: 10, grant: 30 } as const;

export const FILE_OPENED = "candidate.file_opened";
export const FILE_REFUSED = "candidate.file_rate_limited";

export type AlertKind = "files_many" | "files_limit";
export const ALERT_LABELS: Record<AlertKind, string> = {
  files_many: `פתח ${FILE_LIMITS.alertAt} קבצי מועמדים היום`,
  files_limit: "הגיע למגבלת הקבצים היומית ומבקש עוד",
};

export interface DailyQuota {
  day: string;
  opened: number;
  /** The daily limit plus what admins added today. */
  allowed: number;
  extra: number;
}

export async function dailyQuota(email: string, now = new Date()): Promise<DailyQuota> {
  const day = israelDay(now);
  const db = getDb();
  const [[opened], [extra]] = await Promise.all([
    db
      .select({ n: sql<number>`count(*)::int` })
      .from(auditLog)
      .where(and(eq(auditLog.actor, email), eq(auditLog.action, FILE_OPENED), gte(auditLog.at, israelMidnight(day)))),
    db
      .select({ n: sql<number>`coalesce(sum(${fileQuotaGrants.extra}), 0)::int` })
      .from(fileQuotaGrants)
      .where(and(eq(fileQuotaGrants.userEmail, email), eq(fileQuotaGrants.day, day))),
  ]);
  const add = extra?.n ?? 0;
  return { day, opened: opened?.n ?? 0, allowed: FILE_LIMITS.daily + add, extra: add };
}

/** Records an alert once per kind, person, day and threshold. */
export async function raiseAlert(kind: AlertKind, email: string, day: string, threshold: number): Promise<void> {
  await getDb().insert(securityAlerts).values({ kind, userEmail: email, day, threshold }).onConflictDoNothing();
}

/** After a file was served: the opens of the day so far, including this one. */
export async function afterOpen(email: string, quota: DailyQuota): Promise<void> {
  if (quota.opened + 1 === FILE_LIMITS.alertAt) await raiseAlert("files_many", email, quota.day, FILE_LIMITS.alertAt);
}

/** When an open is refused at the limit: tell the admins (once per limit reached). */
export async function atLimit(email: string, quota: DailyQuota): Promise<void> {
  await raiseAlert("files_limit", email, quota.day, quota.allowed);
}

/** An admin lets `email` open another batch today; their open alerts for today are handled. */
export async function grantMoreFiles(admin: string, email: string): Promise<DailyQuota> {
  const day = israelDay();
  const db = getDb();
  await db.insert(fileQuotaGrants).values({ userEmail: email, day, extra: FILE_LIMITS.grant, grantedBy: admin });
  await db
    .update(securityAlerts)
    .set({ handledAt: new Date(), handledBy: admin })
    .where(and(eq(securityAlerts.userEmail, email), eq(securityAlerts.day, day), isNull(securityAlerts.handledAt)));
  await writeAudit(admin, "files.quota_granted", email, { day, extra: FILE_LIMITS.grant });
  return dailyQuota(email);
}

export async function dismissAlert(admin: string, id: number): Promise<void> {
  await getDb()
    .update(securityAlerts)
    .set({ handledAt: new Date(), handledBy: admin })
    .where(and(eq(securityAlerts.id, id), isNull(securityAlerts.handledAt)));
  await writeAudit(admin, "security.alert_handled", String(id));
}

export interface AlertRow {
  id: number;
  kind: AlertKind;
  userEmail: string;
  day: string;
  threshold: number;
  createdAt: Date;
  handledAt: Date | null;
  handledBy: string | null;
}

/** Open alerts first, then the last two weeks' handled ones. */
export async function loadAlerts(): Promise<AlertRow[]> {
  const rows = await getDb()
    .select()
    .from(securityAlerts)
    .where(sql`${securityAlerts.handledAt} IS NULL OR ${securityAlerts.createdAt} > now() - interval '14 days'`)
    .orderBy(sql`${securityAlerts.handledAt} IS NOT NULL`, desc(securityAlerts.createdAt))
    .limit(200);
  return rows.map((r) => ({ ...r, kind: r.kind as AlertKind, day: String(r.day) }));
}

export async function countOpenAlerts(): Promise<number> {
  const [r] = await getDb().select({ n: sql<number>`count(*)::int` }).from(securityAlerts).where(isNull(securityAlerts.handledAt));
  return r?.n ?? 0;
}

export interface UsageRow {
  email: string;
  opened: number;
  refused: number;
  allowed: number;
}

/** Everyone who opened (or was refused) candidate files today, most first. */
export async function loadUsageToday(): Promise<UsageRow[]> {
  const day = israelDay();
  const rows = (
    await getDb().execute<{ email: string; opened: number; refused: number; extra: number }>(sql`
      SELECT a.actor AS email,
             count(*) FILTER (WHERE a.action = ${FILE_OPENED})::int AS opened,
             count(*) FILTER (WHERE a.action = ${FILE_REFUSED})::int AS refused,
             coalesce((SELECT sum(g.extra) FROM file_quota_grants g WHERE g.user_email = a.actor AND g.day = ${day}), 0)::int AS extra
        FROM audit_log a
       WHERE a.action IN (${FILE_OPENED}, ${FILE_REFUSED}) AND a.at >= ${israelMidnight(day)}
       GROUP BY a.actor
       ORDER BY 2 DESC`)
  ).rows;
  return rows.map((r) => ({ email: String(r.email), opened: Number(r.opened), refused: Number(r.refused), allowed: FILE_LIMITS.daily + Number(r.extra) }));
}

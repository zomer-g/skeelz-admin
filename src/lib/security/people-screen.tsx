import { and, eq, gte, sql } from "drizzle-orm";
import { PageHeader } from "@/components/ui";
import { RECORDS_SHOWN, writeAudit } from "@/lib/audit";
import { countNewRows, MAX_SHOWN_IDS, recordIds } from "@/lib/audit-ids";
import { israelMidnight } from "@/lib/dashboard/params";
import { getDb } from "@/lib/db/client";
import { auditLog } from "@/lib/db/schema";
import { afterExport, atExportLimit, dailyExportUsage, EXPORT_LIMITS, type ExportUsage } from "./exports";

/**
 * A screen that lists people (candidates, applications, CVs, emails, payments, a job's applicants)
 * spends the same daily budget as the copy buttons, MCP and the API (lib/security/exports.ts): each
 * person it shows counts once a day (countNewRows), so paging through the whole pool stops at the
 * limit while re-opening a page costs nothing. Past the limit the screen shows the refusal instead
 * of the list, the admins are asked, and an admin's grant at /admin/security opens it again.
 *
 *   const people = await peopleScreen(auth.user.email, path);
 *   if (!people.ok) return people.render;
 *   ... load rows ...
 *   await people.shown(rows);
 */
export type PeopleScreen = { ok: true; shown: (rows: unknown) => Promise<void> } | { ok: false; render: React.ReactElement };

export async function peopleScreen(email: string, path: string, title = "הגעת למגבלה היומית"): Promise<PeopleScreen> {
  const usage = await dailyExportUsage(email);
  if (usage.exported >= usage.allowed) {
    await atExportLimit(email, usage, `screen:${path.split("?")[0]}`);
    return { ok: false, render: <PeopleLimit usage={usage} title={title} /> };
  }
  return { ok: true, shown: (rows) => recordShown(email, path, rows, usage) };
}

/** The records.shown entry: which people the screen showed (for "who saw X") and how many were new today. */
async function recordShown(email: string, path: string, rows: unknown, usage: ExportUsage): Promise<void> {
  const { ids, more } = recordIds(rows, MAX_SHOWN_IDS);
  if (!ids.length) return;
  const count = countNewRows(rows, await shownToday(email, usage.day));
  await writeAudit(email, RECORDS_SHOWN, path, { ids, count, ...(more ? { more_ids: true } : {}) });
  if (count > 0) await afterExport(email, usage, count);
}

/** Every id this person's screens showed today. */
async function shownToday(email: string, day: string): Promise<Set<string>> {
  const rows = await getDb()
    .select({ id: sql<string>`jsonb_array_elements_text(${auditLog.details}->'ids')` })
    .from(auditLog)
    .where(and(eq(auditLog.actor, email), eq(auditLog.action, RECORDS_SHOWN), gte(auditLog.at, israelMidnight(day))));
  return new Set(rows.map((r) => r.id));
}

function PeopleLimit({ usage, title }: { usage: ExportUsage; title: string }) {
  return (
    <>
      <PageHeader title={title} />
      <div role="status" className="max-w-2xl rounded-card border-2 border-line bg-surface p-6">
        <p className="text-ink">
          ראית היום פרטים של {usage.exported.toLocaleString("he-IL")} מועמדים, במסכים, בהעתקות ובחיבורים. זו המגבלה היומית (
          {usage.allowed.toLocaleString("he-IL")}).
        </p>
        <p className="mt-2 text-muted">
          מנהל המערכת קיבל הודעה, והוא יכול לאשר לך עוד {EXPORT_LIMITS.grant.toLocaleString("he-IL")} להיום. שאר המסכים, כמו הדשבורד, ממשיכים לעבוד.
        </p>
      </div>
    </>
  );
}

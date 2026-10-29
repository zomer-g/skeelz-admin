import { eq } from "drizzle-orm";
import { effectiveStaffManager } from "@/lib/auth/permissions";
import { envAdmins } from "@/lib/auth/session";
import { getDb } from "@/lib/db/client";
import { users } from "@/lib/db/schema";
import { loadEmployeeHours, loadSfActivity, loadStaffMonth, monthsAround, parseMonth } from "@/lib/staff/data";
import type { ApiKeyIdentity } from "./keys";

/**
 * Staff data over the API (docs/staff.md): the one module of lib/api that reads it, and with the
 * routes under app/api/v1/staff the only API code permissions.test.ts lets do so. A key carries
 * staff:read only if a staff manager issued it, and every call checks that the issuer still is one:
 * active on the site and a staff manager right now. An env (legacy) key never gets staff data.
 * Like the rest of the API, nothing here names candidates: Salesforce tasks are counted, not listed.
 */

export async function staffKeyAllowed(key: ApiKeyIdentity): Promise<boolean> {
  if (key.legacy || !key.createdBy) return false;
  const email = key.createdBy.toLowerCase();
  const envAdmin = envAdmins().includes(email);
  const [row] = await getDb().select({ active: users.active, staffManager: users.staffManager }).from(users).where(eq(users.email, email)).limit(1);
  if (!row && !envAdmin) return false;
  if (row && !row.active && !envAdmin) return false;
  return effectiveStaffManager({ stored: row?.staffManager ?? false, envAdmin, previewing: false });
}

const round = (n: number) => Math.round(n * 100) / 100;

/** Every linked employee's counts for a month; null when the month is not YYYY-MM. */
export async function staffMonthlyJson(monthParam: string | null) {
  const month = monthParam ? parseMonth(monthParam) : monthsAround().current;
  if (!month) return null;
  const rows = await loadStaffMonth(month);
  return {
    month,
    employees: rows.map((r) => ({
      name: r.name,
      email: r.email,
      active: r.active,
      hours: r.mondayLinked ? round(r.hours) : null,
      monday_tasks: r.mondayLinked ? r.mondayTasks : null,
      monday_tasks_without_hours: r.mondayLinked ? r.withoutHours : null,
      salesforce_tasks: r.sfName ? r.sfTasks : null,
      salesforce_emails: r.sfName ? r.sfEmails : null,
      salesforce_calls: r.sfName ? r.sfCalls : null,
      total_tasks: r.mondayTasks + r.sfTasks,
      cases_opened: r.sfName ? r.cases.map((c) => ({ case_type: c.caseType, record_type: c.developerName, count: c.count })) : null,
    })),
  };
}

/** One employee by email; "not_found" when there is no such site user, "bad_month" for a bad month. */
export async function staffEmployeeJson(email: string, monthParam: string | null) {
  if (monthParam && !parseMonth(monthParam)) return "bad_month" as const;
  const [row] = await getDb().select({ id: users.id }).from(users).where(eq(users.email, email.trim().toLowerCase())).limit(1);
  if (!row) return "not_found" as const;
  const data = await loadEmployeeHours(row.id, monthParam ?? "");
  if (!data) return "not_found" as const;
  const sf = data.person.sfUserId ? await loadSfActivity(data.person.sfUserId, data.month, 0) : null;
  return {
    employee: { name: data.person.name, email: data.person.email },
    month: data.month,
    by_month: data.byMonth.map((m) => ({
      month: m.month,
      hours: round(m.hours),
      monday_tasks: m.mondayTasks,
      salesforce_tasks: m.sfTasks,
      salesforce_emails: m.sfEmails,
      salesforce_calls: m.sfCalls,
    })),
    monday: {
      hours: round(data.summary.hours),
      tasks: data.summary.tasks,
      items: data.tasks.map((t) => ({
        title: t.title,
        board: t.boardName,
        done_on: t.doneOn,
        entered_done_at: t.doneAt?.toISOString() ?? null,
        hours: t.hours,
        url: t.url,
      })),
    },
    salesforce: sf
      ? {
          total: sf.total,
          by_case_type: sf.byType.map((t) => ({ case_type: t.caseType, record_type: t.developerName, emails: t.emails, calls: t.calls, other: t.tasks - t.emails - t.calls, total: t.tasks })),
        }
      : null,
  };
}

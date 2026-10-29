import { eq } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { users } from "@/lib/db/schema";
import { loadEmployeeHours, loadSfActivity, loadStaffMonth, monthsAround, parseMonth } from "@/lib/staff/data";
import { ArgError, type ArgValue } from "./args";
import type { Tool, ToolContext } from "./tools";

/**
 * Staff tools: hours and activity per employee (docs/staff.md) — the one MCP module that reads staff
 * data, and the only one permissions.test.ts lets do so. Every tool here is `staff: true`, so
 * tools/list shows it and tools/call runs it only when the connection carries staff data: its person
 * is a staff manager right now and turned staff data on for this connection at /connectors
 * (McpPrincipal.staffData). The role ceiling still applies on top; nothing here writes.
 */

const s = (v: ArgValue) => (typeof v === "string" ? v : "");
const link = (ctx: ToolContext, path: string) => `${ctx.origin}${path}`;
const MONTH_FIELD = { type: "string", description: "Month, YYYY-MM (Israel time). Default: the current month.", pattern: /^\d{4}-(0[1-9]|1[0-2])$/ } as const;
const EMAIL = /^[^\s@]+@[^\s@]+$/;

async function employeeByEmail(email: string) {
  const e = email.trim().toLowerCase();
  if (!EMAIL.test(e)) throw new ArgError("employee must be the person's email on the site");
  const [row] = await getDb().select({ id: users.id }).from(users).where(eq(users.email, e)).limit(1);
  if (!row) throw new ArgError(`no site user with the email ${e}`);
  return row.id;
}

const round = (n: number) => Math.round(n * 100) / 100;

export const STAFF_TOOLS: Tool[] = [
  {
    name: "staff_monthly",
    title: "Staff hours and tasks by month",
    description:
      "Per employee linked to monday.com or Salesforce, for one month: hours and done tasks from the monday board(s), the Salesforce tasks they own (of them emails sent and calls logged), and the Cases opened that month that they own, by type (applications, inquiries…). Staff data: only for staff managers who turned it on for this connection.",
    minRole: "viewer",
    staff: true,
    people: (r) => (r as { employees?: unknown[] }).employees?.length ?? 0,
    fields: {
      month: MONTH_FIELD,
      employee: { type: "string", description: "Only this employee, by their email on the site.", maxLength: 200 },
    },
    run: async (a, ctx) => {
      const month = parseMonth(s(a.month)) ?? monthsAround().current;
      const only = s(a.employee) ? await employeeByEmail(s(a.employee)) : null;
      const rows = (await loadStaffMonth(month)).filter((r) => !only || r.id === only);
      return {
        month,
        employees: rows.map((r) => ({
          name: r.name,
          email: r.email,
          active: r.active,
          monday_linked: r.mondayLinked,
          salesforce_user: r.sfName,
          hours: r.mondayLinked ? round(r.hours) : null,
          monday_tasks: r.mondayLinked ? r.mondayTasks : null,
          monday_tasks_without_hours: r.mondayLinked ? r.withoutHours : null,
          salesforce_tasks: r.sfName ? r.sfTasks : null,
          salesforce_emails: r.sfName ? r.sfEmails : null,
          salesforce_calls: r.sfName ? r.sfCalls : null,
          total_tasks: r.mondayTasks + r.sfTasks,
          cases_opened: r.sfName ? r.cases.map((c) => ({ case_type: c.caseType, record_type: c.developerName, count: c.count })) : null,
          admin_url: link(ctx, `/staff/${r.id}?month=${month}`),
        })),
        definitions:
          "monday: tasks in status Done on the board, by their 'תאריך ביצוע'; hours = the task's hours label. Salesforce: Tasks owned by the employee's Salesforce user, by creation date; emails = TaskSubtype Email (one per email sent from Salesforce), calls = TaskSubtype Call. cases_opened: Salesforce Cases opened in the month whose current owner is the employee's Salesforce user, by record type.",
        admin_url: link(ctx, `/staff?month=${month}`),
      };
    },
  },
  {
    name: "staff_employee",
    title: "One employee's hours and tasks",
    description:
      "One employee: month by month totals; their monday tasks (board, done date, the moment it entered Done, hours, notes); and their Salesforce tasks counted by the type of Case they sit on, with the newest tasks listed. Staff data: only for staff managers who turned it on for this connection.",
    minRole: "viewer",
    staff: true,
    people: () => 1,
    fields: {
      employee: { type: "string", description: "The employee's email on the site.", maxLength: 200 },
      month: { ...MONTH_FIELD, description: "Month, YYYY-MM (Israel time), for the task lists. Default: the latest month with tasks." },
      all_months: { type: "boolean", description: "List the tasks of every month instead of one.", default: false },
      salesforce_limit: { type: "integer", description: "How many of the newest Salesforce tasks to list.", minimum: 0, maximum: 200, default: 50 },
    },
    required: ["employee"],
    run: async (a, ctx) => {
      const userId = await employeeByEmail(s(a.employee));
      const data = await loadEmployeeHours(userId, a.all_months === true ? "all" : s(a.month));
      if (!data) throw new ArgError("employee not found");
      const sf = data.person.sfUserId ? await loadSfActivity(data.person.sfUserId, data.month, typeof a.salesforce_limit === "number" ? a.salesforce_limit : 50) : null;
      return {
        employee: { name: data.person.name, email: data.person.email, monday_linked: Boolean(data.person.mondayUserId), salesforce_user: data.person.sfName },
        month: data.month ?? "all",
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
          without_hours: data.summary.withoutHours,
          items: data.tasks.map((t) => ({
            title: t.title,
            board: t.boardName,
            done_on: t.doneOn,
            entered_done_at: t.doneAt?.toISOString() ?? null,
            hours: t.hours,
            notes: t.notes,
            shared: t.shared,
            url: t.url,
          })),
        },
        salesforce: sf
          ? {
              total: sf.total,
              by_case_type: sf.byType.map((t) => ({ case_type: t.caseType, record_type: t.developerName, emails: t.emails, calls: t.calls, other: t.tasks - t.emails - t.calls, total: t.tasks })),
              tasks: sf.tasks.map((t) => ({
                kind: t.kind,
                subject: t.subject,
                created_at: t.createdAt?.toISOString() ?? null,
                case_type: t.caseType,
                case_number: t.caseNumber,
                admin_url: t.path ? link(ctx, t.path) : null,
              })),
            }
          : null,
        admin_url: link(ctx, `/staff/${userId}${data.month ? `?month=${data.month}` : "?month=all"}`),
      };
    },
  },
];

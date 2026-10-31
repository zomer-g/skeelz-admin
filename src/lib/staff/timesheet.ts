import { and, asc, desc, eq, gte, inArray, isNotNull, lte, or, sql } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { staffTimeEntries, users } from "@/lib/db/schema";
import { run } from "@/lib/entities/search";
import {
  actionCategory,
  actionKind,
  demoWindows,
  mergeWindows,
  parseTimesheet,
  preferReal,
  summarizeWindows,
  type Action,
  type TimeSource,
  type WindowsSummary,
} from "./windows";

/**
 * Timesheets (staff_time_entries) and the "actions per unit of time" dashboard (docs/staff.md).
 * Staff data: every caller is a page or action behind pageAuthStaff / requireStaffManager, and
 * nothing here is imported by the dashboard, MCP or the API. The rules themselves are pure
 * functions in windows.ts.
 */

/** שרית שביט's Salesforce user: the demo timesheet is made from her own tasks. */
export const DEMO_SF_USER_ID = "0058d0000085h1lAAA";

export interface NewTimeEntry {
  workDate: string;
  start: Date;
  end: Date;
  note?: string | null;
}

/**
 * Replaces one employee's rows of one source in a single transaction: all of them, or with `days`
 * only those days (a real file covers the days it lists and leaves the others alone).
 */
export async function replaceTimeEntries(userId: string, source: TimeSource, rows: NewTimeEntry[], days?: string[]): Promise<number> {
  if (days && !days.length) return 0;
  return getDb().transaction(async (tx) => {
    await tx
      .delete(staffTimeEntries)
      .where(and(eq(staffTimeEntries.userId, userId), eq(staffTimeEntries.source, source), days ? inArray(staffTimeEntries.workDate, days) : undefined));
    const values = rows.map((r) => ({ userId, source, workDate: r.workDate, startAt: r.start, endAt: r.end, note: r.note ?? null }));
    for (let i = 0; i < values.length; i += 500) await tx.insert(staffTimeEntries).values(values.slice(i, i + 500));
    return values.length;
  });
}

/** Deletes every row of a source (optionally one employee's). Returns how many. */
export async function deleteTimeEntries(source: TimeSource, userId?: string): Promise<number> {
  const removed = await getDb()
    .delete(staffTimeEntries)
    .where(and(eq(staffTimeEntries.source, source), userId ? eq(staffTimeEntries.userId, userId) : undefined))
    .returning({ id: staffTimeEntries.id });
  return removed.length;
}

/**
 * The FICTITIOUS demo timesheet for the employee linked to DEMO_SF_USER_ID, built from the creation
 * times of her own Salesforce tasks (demoWindows) and stored as source 'demo', replacing the
 * previous demo rows. null when nobody is linked to that Salesforce user.
 */
export async function loadDemoTimesheet(sfUserId = DEMO_SF_USER_ID): Promise<{ userId: string; name: string; windows: number } | null> {
  const db = getDb();
  const [person] = await db.select({ id: users.id, name: users.name, email: users.email }).from(users).where(eq(users.sfUserId, sfUserId)).limit(1);
  if (!person) return null;
  const tasks = await run<{ created_date: Date | string }>(sql`
    SELECT created_date FROM sf_task WHERE owner_id = ${sfUserId} AND NOT is_deleted AND created_date IS NOT NULL`);
  const windows = demoWindows(tasks.map((t) => new Date(t.created_date)));
  await replaceTimeEntries(
    person.id,
    "demo",
    windows.map((w) => ({ ...w, note: "דמו: נבנה ממועדי המשימות ב-Salesforce" })),
  );
  return { userId: person.id, name: person.name ?? person.email, windows: windows.length };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface SheetImportResult {
  rows: number;
  people: number;
  days: number;
  errors: { line: number; message: string }[];
}

/**
 * A real timesheet pasted as text (parseTimesheet): each row's employee by email or site user id;
 * for each employee, the days the file lists replace that employee's 'sheet' rows of those days.
 * Unknown people are errors and nothing of theirs is kept.
 */
export async function importTimesheet(text: string): Promise<SheetImportResult> {
  const { rows, errors } = parseTimesheet(text);
  const whos = [...new Set(rows.map((r) => r.who))];
  const ids = whos.filter((w) => UUID.test(w));
  const known = whos.length
    ? await getDb()
        .select({ id: users.id, email: users.email })
        .from(users)
        .where(or(inArray(users.email, whos), ids.length ? inArray(users.id, ids) : undefined))
    : [];
  const byWho = new Map<string, string>();
  for (const u of known) {
    byWho.set(u.email.toLowerCase(), u.id);
    byWho.set(u.id.toLowerCase(), u.id);
  }
  const perUser = new Map<string, typeof rows>();
  for (const r of rows) {
    const userId = byWho.get(r.who);
    if (!userId) {
      errors.push({ line: r.line, message: `אין משתמש במערכת עם המייל או המזהה "${r.who}"` });
      continue;
    }
    perUser.set(userId, [...(perUser.get(userId) ?? []), r]);
  }
  let stored = 0;
  let days = 0;
  for (const [userId, list] of perUser) {
    const listDays = [...new Set(list.map((r) => r.workDate))];
    days += listDays.length;
    stored += await replaceTimeEntries(userId, "sheet", list, listDays);
  }
  return { rows: stored, people: perUser.size, days, errors: errors.sort((a, b) => a.line - b.line) };
}

/* ------------------------------------------------------------ dashboard */

export interface EmployeeWindows {
  id: string;
  name: string;
  active: boolean;
  sfLinked: boolean;
  /** Some windows shown are from the demo timesheet. */
  demo: boolean;
  summary: WindowsSummary;
}

export interface WindowsDashboard {
  employees: EmployeeWindows[];
  /** Job titles for the submissions' positions, by Case id. */
  positions: Map<string, { title: string | null; caseNumber: string | null }>;
  /** Anybody in the range is on the demo timesheet. */
  demo: boolean;
}

/**
 * Per employee in the Israel-day range [fromDay, toDay]: their windows (a real timesheet beats the
 * demo, overlaps merged) and the Salesforce tasks they own in the range or inside one of those
 * windows, attributed by summarizeWindows. Every employee linked to Salesforce or with a timesheet
 * in the range is listed.
 */
export async function loadWindowsDashboard(fromDay: string, toDay: string, from: Date, to: Date): Promise<WindowsDashboard> {
  const db = getDb();
  const entries = await db
    .select({
      userId: staffTimeEntries.userId,
      source: staffTimeEntries.source,
      workDate: staffTimeEntries.workDate,
      start: staffTimeEntries.startAt,
      end: staffTimeEntries.endAt,
    })
    .from(staffTimeEntries)
    .where(and(gte(staffTimeEntries.workDate, fromDay), lte(staffTimeEntries.workDate, toDay)));
  const used = preferReal(entries);
  const withEntries = [...new Set(used.map((e) => e.userId))];

  const people = await db
    .select({ id: users.id, name: users.name, email: users.email, active: users.active, sfUserId: users.sfUserId })
    .from(users)
    .where(or(isNotNull(users.sfUserId), withEntries.length ? inArray(users.id, withEntries) : undefined))
    .orderBy(desc(users.active), asc(users.name));

  let lo = from.getTime();
  let hi = to.getTime();
  for (const e of used) {
    lo = Math.min(lo, e.start.getTime());
    hi = Math.max(hi, e.end.getTime() + 1);
  }
  const sfIds = people.map((p) => p.sfUserId).filter((s): s is string => Boolean(s));
  const tasks = sfIds.length
    ? await run<{
        id: string;
        owner_id: string;
        created_date: Date | string;
        task_subtype: string | null;
        type: string | null;
        subject: string | null;
        case_id: string | null;
        developer_name: string | null;
        parent_id: string | null;
      }>(sql`
        SELECT t.id, t.owner_id, t.created_date, t.task_subtype, t.type, t.subject, c.id AS case_id, rt.developer_name, c.parent_id
          FROM sf_task t
          LEFT JOIN sf_case c ON c.id = t.what_id
          LEFT JOIN sf_record_type rt ON rt.id = c.record_type_id
         WHERE t.owner_id IN ${sfIds} AND NOT t.is_deleted AND t.created_date >= ${new Date(lo)} AND t.created_date < ${new Date(hi)}`)
    : [];

  const actionsBySf = new Map<string, Action[]>();
  for (const t of tasks) {
    const list = actionsBySf.get(t.owner_id) ?? [];
    list.push({
      id: t.id,
      at: new Date(t.created_date),
      kind: actionKind(t.task_subtype, t.type),
      category: actionCategory(t.developer_name, t.subject),
      caseId: t.case_id,
      caseType: t.developer_name,
      positionId: t.parent_id,
    });
    actionsBySf.set(t.owner_id, list);
  }

  const inRange = (d: Date) => d.getTime() >= from.getTime() && d.getTime() < to.getTime();
  const employees: EmployeeWindows[] = people.map((p) => {
    const windows = mergeWindows(used.filter((e) => e.userId === p.id));
    // Just outside the range's days, an action counts only when one of the range's windows holds it.
    const actions = (p.sfUserId ? (actionsBySf.get(p.sfUserId) ?? []) : []).filter(
      (a) => inRange(a.at) || windows.some((w) => w.start.getTime() <= a.at.getTime() && a.at.getTime() <= w.end.getTime()),
    );
    return {
      id: p.id,
      name: p.name ?? p.email,
      active: p.active,
      sfLinked: Boolean(p.sfUserId),
      demo: windows.some((w) => w.demo),
      summary: summarizeWindows(windows, actions),
    };
  });

  const positionIds = [...new Set(employees.flatMap((e) => e.summary.positions.map((x) => x.positionId)).filter((x): x is string => Boolean(x)))].slice(0, 500);
  const positionRows = positionIds.length
    ? await run<{ id: string; title: string | null; case_number: string | null }>(sql`
        SELECT p.id, coalesce(nullif(p.data->>'Position_cambium__c', ''), nullif(p.data->>'Position_Name__c', ''), nullif(p.data->>'Subject', '')) AS title,
               p.data->>'CaseNumber' AS case_number
          FROM sf_case p WHERE p.id IN ${positionIds}`)
    : [];
  return {
    employees,
    positions: new Map(positionRows.map((r) => [r.id, { title: r.title, caseNumber: r.case_number }])),
    demo: employees.some((e) => e.demo),
  };
}

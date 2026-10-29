import { and, asc, desc, eq, gte, inArray, isNotNull, lt, or, sql } from "drizzle-orm";
import { israelDay } from "@/lib/dashboard/params";
import { getDb } from "@/lib/db/client";
import { sfTask, sfUser, staffWorkItems, users } from "@/lib/db/schema";
import { casePath } from "@/lib/entities/emails";
import { run } from "@/lib/entities/search";
import { summarize, type HoursSummary } from "./hours";

/**
 * What the staff screens show (docs/staff.md). Every caller is a page or action that already passed
 * pageAuthStaff / requireStaffManager; nothing here is imported by the dashboard, MCP or the API.
 */

const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;

/** "2026-10" and the month before it, by the Israel day. */
export function monthsAround(day = israelDay()): { current: string; previous: string } {
  const [y, m] = day.split("-").map(Number) as [number, number];
  const prev = m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, "0")}`;
  return { current: day.slice(0, 7), previous: prev };
}

/** The last `n` months up to the current one, newest first ("2026-10", "2026-09", …). */
export function recentMonths(n = 12, day = israelDay()): string[] {
  const [y, m] = day.split("-").map(Number) as [number, number];
  return Array.from({ length: n }, (_, i) => {
    const t = y * 12 + (m - 1) - i;
    return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, "0")}`;
  });
}

/** One employee's month: monday tasks and hours, and what they logged in Salesforce. */
export interface MonthCounts {
  hours: number;
  mondayTasks: number;
  /** monday tasks closed without hours: counted as tasks, not as hours. */
  withoutHours: number;
  sfEmails: number;
  sfCalls: number;
  /** Every Salesforce task the employee owns that month: the emails, the calls and the rest. */
  sfTasks: number;
}

const EMPTY: MonthCounts = { hours: 0, mondayTasks: 0, withoutHours: 0, sfEmails: 0, sfCalls: 0, sfTasks: 0 };

/**
 * Counts per site user and month (YYYY-MM, Israel time), keyed "<user id>|<month>". monday by
 * תאריך ביצוע; Salesforce by the Task's creation, owned by the employee's linked Salesforce user.
 * Salesforce logs every email sent from it as a Task of subtype Email, so emails are counted there
 * (sf_email_message has no sender). Calls are subtype Call (or a Type starting with "Call").
 */
async function monthCounts(people: { id: string; sfUserId: string | null }[], months?: string[]): Promise<Map<string, MonthCounts>> {
  const out = new Map<string, MonthCounts>();
  if (!people.length) return out;
  const db = getDb();
  const userIds = people.map((p) => p.id);
  const bySf = new Map(people.filter((p) => p.sfUserId).map((p) => [p.sfUserId!, p.id]));
  const monday = sql`to_char(${staffWorkItems.doneOn}, 'YYYY-MM')`;
  const sfMonth = sql`to_char(${sfTask.createdDate} AT TIME ZONE 'Asia/Jerusalem', 'YYYY-MM')`;

  const [work, sf] = await Promise.all([
    db
      .select({
        userId: staffWorkItems.userId,
        month: sql<string>`${monday}`,
        hours: sql<number>`coalesce(sum(${staffWorkItems.hours}), 0)::float`,
        tasks: sql<number>`count(*)::int`,
        withoutHours: sql<number>`(count(*) FILTER (WHERE ${staffWorkItems.hours} IS NULL))::int`,
      })
      .from(staffWorkItems)
      .where(and(inArray(staffWorkItems.userId, userIds), isNotNull(staffWorkItems.doneOn), months ? sql`${monday} IN ${months}` : undefined))
      .groupBy(staffWorkItems.userId, sql`2`),
    bySf.size
      ? db
          .select({
            ownerId: sfTask.ownerId,
            month: sql<string>`${sfMonth}`,
            emails: sql<number>`(count(*) FILTER (WHERE ${sfTask.taskSubtype} = 'Email'))::int`,
            calls: sql<number>`(count(*) FILTER (WHERE ${sfTask.taskSubtype} = 'Call' OR (${sfTask.taskSubtype} IS DISTINCT FROM 'Email' AND ${sfTask.type} ILIKE 'call%')))::int`,
            tasks: sql<number>`count(*)::int`,
          })
          .from(sfTask)
          .where(
            and(
              inArray(sfTask.ownerId, [...bySf.keys()]),
              eq(sfTask.isDeleted, false),
              isNotNull(sfTask.createdDate),
              months ? sql`${sfMonth} IN ${months}` : undefined,
            ),
          )
          .groupBy(sfTask.ownerId, sql`2`)
      : Promise.resolve([]),
  ]);

  const at = (userId: string, month: string) => {
    const key = `${userId}|${month}`;
    let row = out.get(key);
    if (!row) out.set(key, (row = { ...EMPTY }));
    return row;
  };
  for (const w of work) Object.assign(at(w.userId, w.month), { hours: Number(w.hours), mondayTasks: w.tasks, withoutHours: w.withoutHours });
  for (const r of sf) {
    const userId = r.ownerId ? bySf.get(r.ownerId) : undefined;
    if (userId) Object.assign(at(userId, r.month), { sfEmails: r.emails, sfCalls: r.calls, sfTasks: r.tasks });
  }
  return out;
}

/** Cases of one record type an employee owns that were opened in the month. */
export interface OwnedCases {
  /** The record type's label ("הגשות קמביום", "פניות"…), or "בלי סוג". */
  caseType: string;
  developerName: string | null;
  count: number;
}

/**
 * Cases opened in a month (Israel time; null: ever) whose owner is the employee's linked Salesforce user, by
 * record type, keyed by site user id. The owner is the Case's current owner: a Case passed on to
 * someone else counts for them.
 */
export async function loadOwnedCases(people: { id: string; sfUserId: string | null }[], month: string | null): Promise<Map<string, OwnedCases[]>> {
  const out = new Map<string, OwnedCases[]>();
  const bySf = new Map(people.filter((p) => p.sfUserId).map((p) => [p.sfUserId!, p.id]));
  if (!bySf.size) return out;
  const rows = await run<{ owner_id: string; developer_name: string | null; type_label: string | null; n: number }>(sql`
    SELECT c.owner_id, rt.developer_name, rt.name AS type_label, count(*)::int AS n
      FROM sf_case c
      LEFT JOIN sf_record_type rt ON rt.id = c.record_type_id
     WHERE c.owner_id IN ${[...bySf.keys()]} AND NOT c.is_deleted AND c.created_date IS NOT NULL
       ${month ? sql`AND to_char(c.created_date AT TIME ZONE 'Asia/Jerusalem', 'YYYY-MM') = ${month}` : sql``}
     GROUP BY 1, 2, 3
     ORDER BY n DESC`);
  for (const r of rows) {
    const userId = bySf.get(r.owner_id);
    if (!userId) continue;
    const list = out.get(userId) ?? [];
    list.push({ caseType: r.type_label ?? "בלי סוג", developerName: r.developer_name, count: Number(r.n) });
    out.set(userId, list);
  }
  return out;
}

export interface StaffMonthRow extends MonthCounts {
  id: string;
  name: string | null;
  email: string;
  active: boolean;
  mondayLinked: boolean;
  sfName: string | null;
  /** Cases opened in the month that the employee owns, by type, most first; empty when not linked to Salesforce. */
  cases: OwnedCases[];
}

/** Every employee linked to monday or Salesforce, with their counts for one month. */
export async function loadStaffMonth(month: string): Promise<StaffMonthRow[]> {
  const people = await getDb()
    .select({
      id: users.id,
      name: users.name,
      email: users.email,
      active: users.active,
      mondayUserId: users.mondayUserId,
      sfUserId: users.sfUserId,
      sfName: sfUser.name,
    })
    .from(users)
    .leftJoin(sfUser, eq(sfUser.id, users.sfUserId))
    .where(or(isNotNull(users.mondayUserId), isNotNull(users.sfUserId)))
    .orderBy(desc(users.active), asc(users.name));
  const [counts, cases] = await Promise.all([monthCounts(people, [month]), loadOwnedCases(people, month)]);
  return people.map((p) => ({
    id: p.id,
    name: p.name,
    email: p.email,
    active: p.active,
    mondayLinked: Boolean(p.mondayUserId),
    sfName: p.sfName ?? (p.sfUserId ? p.sfUserId : null),
    ...(counts.get(`${p.id}|${month}`) ?? EMPTY),
    cases: cases.get(p.id) ?? [],
  }));
}

/** A valid YYYY-MM, or null. */
export const parseMonth = (month: string): string | null => (MONTH.test(month) ? month : null);

export interface EmployeeHours {
  person: { id: string; name: string | null; email: string; mondayUserId: string | null; sfUserId: string | null; sfName: string | null };
  /** Month by month, newest first: every month with anything in it, and the current one. */
  byMonth: ({ month: string } & MonthCounts)[];
  /** Every month the employee has tasks in, newest first, for the month picker. */
  months: string[];
  month: string | null;
  summary: HoursSummary;
  tasks: {
    id: string;
    title: string | null;
    url: string | null;
    boardName: string | null;
    doneOn: string | null;
    /** When it entered Done in monday. */
    doneAt: Date | null;
    hours: number | null;
    notes: string | null;
    shared: boolean;
  }[];
}

/** One employee's tasks and totals, for a month (YYYY-MM) or, with "all", everything. */
export async function loadEmployeeHours(userId: string, month: string): Promise<EmployeeHours | null> {
  const db = getDb();
  const [person] = await db
    .select({ id: users.id, name: users.name, email: users.email, mondayUserId: users.mondayUserId, sfUserId: users.sfUserId, sfName: sfUser.name })
    .from(users)
    .leftJoin(sfUser, eq(sfUser.id, users.sfUserId))
    .where(eq(users.id, userId))
    .limit(1);
  if (!person) return null;

  const counts = await monthCounts([person]);
  const current = monthsAround().current;
  const months = [...new Set([current, ...[...counts.keys()].map((k) => k.split("|")[1]!)])].sort().reverse();
  const byMonth = months.map((m) => ({ month: m, ...(counts.get(`${person.id}|${m}`) ?? EMPTY) }));

  const picked = month === "all" ? null : MONTH.test(month) ? month : (months[0] ?? monthsAround().current);
  const range = picked
    ? and(gte(staffWorkItems.doneOn, `${picked}-01`), lt(staffWorkItems.doneOn, nextMonthStart(picked)))
    : undefined;
  const tasks = await db
    .select({
      id: staffWorkItems.id,
      title: staffWorkItems.title,
      url: staffWorkItems.url,
      boardName: staffWorkItems.boardName,
      doneOn: staffWorkItems.doneOn,
      doneAt: staffWorkItems.doneAt,
      hours: staffWorkItems.hours,
      notes: staffWorkItems.notes,
      shared: staffWorkItems.shared,
    })
    .from(staffWorkItems)
    .where(and(eq(staffWorkItems.userId, userId), range))
    .orderBy(sql`${staffWorkItems.doneOn} DESC NULLS FIRST`, asc(staffWorkItems.title));

  return { person, byMonth, months, month: picked, summary: summarize(tasks), tasks: tasks.map((t) => ({ ...t, hours: t.hours == null ? null : Number(t.hours) })) };
}

function nextMonthStart(month: string): string {
  const [y, m] = month.split("-").map(Number) as [number, number];
  return m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, "0")}-01`;
}

/* ------------------------------------------------- Salesforce activity in detail */

const ACCOUNT_PREFIX = "001";

/** A Salesforce task's kind, as the monthly counts classify it. */
const KIND_SQL = sql`CASE WHEN t.task_subtype = 'Email' THEN 'email'
  WHEN t.task_subtype = 'Call' OR t.type ILIKE 'call%' THEN 'call' ELSE 'task' END`;

/** Where a task sits: the Case's record type, or an Account (an employer), or nothing. */
function caseTypeLabel(typeLabel: string | null, whatId: string | null): string {
  if (typeLabel) return typeLabel;
  if (whatId?.startsWith(ACCOUNT_PREFIX)) return "חשבון (מעסיק)";
  return whatId ? "אחר" : "בלי מקרה";
}

export interface SfTypeRow {
  /** The Case's record type label ("הגשות קמביום", "משרה"…), "חשבון (מעסיק)", "אחר" or "בלי מקרה". */
  caseType: string;
  developerName: string | null;
  emails: number;
  calls: number;
  tasks: number;
}

export interface SfTaskRow {
  id: string;
  kind: "email" | "call" | "task";
  subject: string | null;
  createdAt: Date | null;
  caseType: string;
  developerName: string | null;
  caseId: string | null;
  caseNumber: string | null;
  /** The site's record page for the Case, when it has one. */
  path: string | null;
}

/**
 * One Salesforce user's tasks for a month (YYYY-MM, Israel time) or every month (null): counts by
 * the type of the Case each sits on, and the newest `limit` tasks themselves.
 */
export async function loadSfActivity(sfUserId: string, month: string | null, limit = 200): Promise<{ byType: SfTypeRow[]; tasks: SfTaskRow[]; total: number }> {
  const inMonth = month ? sql`AND to_char(t.created_date AT TIME ZONE 'Asia/Jerusalem', 'YYYY-MM') = ${month}` : sql``;
  const base = sql`FROM sf_task t
    LEFT JOIN sf_case c ON c.id = t.what_id
    LEFT JOIN sf_record_type rt ON rt.id = c.record_type_id
    WHERE t.owner_id = ${sfUserId} AND NOT t.is_deleted AND t.created_date IS NOT NULL ${inMonth}`;
  const [types, rows] = await Promise.all([
    run<{ developer_name: string | null; type_label: string | null; account: boolean; any_what: boolean; emails: number; calls: number; tasks: number }>(sql`
      SELECT rt.developer_name, rt.name AS type_label,
             bool_or(t.what_id LIKE ${`${ACCOUNT_PREFIX}%`}) AS account, bool_or(t.what_id IS NOT NULL) AS any_what,
             count(*) FILTER (WHERE (${KIND_SQL}) = 'email')::int AS emails,
             count(*) FILTER (WHERE (${KIND_SQL}) = 'call')::int AS calls,
             count(*)::int AS tasks
      ${base}
      GROUP BY rt.developer_name, rt.name, (t.what_id LIKE ${`${ACCOUNT_PREFIX}%`}), (t.what_id IS NULL)
      ORDER BY tasks DESC`),
    run<{ id: string; kind: SfTaskRow["kind"]; subject: string | null; created_date: Date | string | null; what_id: string | null; case_id: string | null; case_number: string | null; developer_name: string | null; type_label: string | null }>(sql`
      SELECT t.id, ${KIND_SQL} AS kind, t.subject, t.created_date, t.what_id, c.id AS case_id,
             c.data->>'CaseNumber' AS case_number, rt.developer_name, rt.name AS type_label
      ${base}
      ORDER BY t.created_date DESC
      LIMIT ${limit}`),
  ]);
  const byType = types.map((r) => ({
    caseType: caseTypeLabel(r.type_label, r.account ? ACCOUNT_PREFIX : r.any_what ? "x" : null),
    developerName: r.developer_name,
    emails: Number(r.emails),
    calls: Number(r.calls),
    tasks: Number(r.tasks),
  }));
  return {
    byType,
    total: byType.reduce((t, r) => t + r.tasks, 0),
    tasks: rows.map((r) => ({
      id: r.id,
      kind: r.kind,
      subject: r.subject,
      createdAt: r.created_date ? new Date(r.created_date) : null,
      caseType: caseTypeLabel(r.type_label, r.what_id),
      developerName: r.developer_name,
      caseId: r.case_id,
      caseNumber: r.case_number,
      path: r.case_id ? casePath({ id: r.case_id, recordType: r.developer_name }) : null,
    })),
  };
}

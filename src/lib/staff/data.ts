import { and, asc, desc, eq, gte, inArray, isNotNull, lt, or, sql } from "drizzle-orm";
import { israelDay } from "@/lib/dashboard/params";
import { getDb } from "@/lib/db/client";
import { sfTask, sfUser, staffWorkItems, users } from "@/lib/db/schema";
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

export interface StaffMonthRow extends MonthCounts {
  id: string;
  name: string | null;
  email: string;
  active: boolean;
  mondayLinked: boolean;
  sfName: string | null;
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
  const counts = await monthCounts(people, [month]);
  return people.map((p) => ({
    id: p.id,
    name: p.name,
    email: p.email,
    active: p.active,
    mondayLinked: Boolean(p.mondayUserId),
    sfName: p.sfName ?? (p.sfUserId ? p.sfUserId : null),
    ...(counts.get(`${p.id}|${month}`) ?? EMPTY),
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
  tasks: { id: string; title: string | null; url: string | null; doneOn: string | null; hours: number | null; notes: string | null; shared: boolean }[];
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
      doneOn: staffWorkItems.doneOn,
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

import { and, asc, desc, eq, gte, lt, sql } from "drizzle-orm";
import { israelDay } from "@/lib/dashboard/params";
import { getDb } from "@/lib/db/client";
import { sfUser, staffWorkItems, users } from "@/lib/db/schema";
import { summarize, type HoursSummary } from "./hours";

/**
 * What the staff screens show (docs/staff.md). Every caller is a page or action that already passed
 * pageAuthStaff / requireStaffManager; nothing here is imported by the dashboard, MCP or the API.
 */

/** "2026-10" and the month before it, by the Israel day. */
export function monthsAround(day = israelDay()): { current: string; previous: string } {
  const [y, m] = day.split("-").map(Number) as [number, number];
  const prev = m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, "0")}`;
  return { current: day.slice(0, 7), previous: prev };
}

export interface StaffRow {
  id: string;
  name: string | null;
  email: string;
  role: string;
  active: boolean;
  lastLoginAt: Date | null;
  sfName: string | null;
  mondayUserId: string | null;
  hoursThisMonth: number;
  hoursLastMonth: number;
  withoutHours: number;
}

export async function loadStaffOverview(): Promise<StaffRow[]> {
  const { current, previous } = monthsAround();
  const db = getDb();
  const [people, totals] = await Promise.all([
    db
      .select({
        id: users.id,
        name: users.name,
        email: users.email,
        role: users.role,
        active: users.active,
        lastLoginAt: users.lastLoginAt,
        sfName: sfUser.name,
        mondayUserId: users.mondayUserId,
      })
      .from(users)
      .leftJoin(sfUser, eq(sfUser.id, users.sfUserId))
      .orderBy(asc(users.name)),
    db
      .select({
        userId: staffWorkItems.userId,
        thisMonth: sql<number>`coalesce(sum(${staffWorkItems.hours}) FILTER (WHERE to_char(${staffWorkItems.doneOn}, 'YYYY-MM') = ${current}), 0)::float`,
        lastMonth: sql<number>`coalesce(sum(${staffWorkItems.hours}) FILTER (WHERE to_char(${staffWorkItems.doneOn}, 'YYYY-MM') = ${previous}), 0)::float`,
        withoutHours: sql<number>`(count(*) FILTER (WHERE ${staffWorkItems.hours} IS NULL))::int`,
      })
      .from(staffWorkItems)
      .groupBy(staffWorkItems.userId),
  ]);
  const byUser = new Map(totals.map((t) => [t.userId, t]));
  return people.map((p) => ({
    ...p,
    hoursThisMonth: Number(byUser.get(p.id)?.thisMonth ?? 0),
    hoursLastMonth: Number(byUser.get(p.id)?.lastMonth ?? 0),
    withoutHours: Number(byUser.get(p.id)?.withoutHours ?? 0),
  }));
}

export interface EmployeeHours {
  person: { id: string; name: string | null; email: string; mondayUserId: string | null };
  /** Every month the employee has tasks in, newest first, for the month picker. */
  months: string[];
  month: string | null;
  summary: HoursSummary;
  tasks: { id: string; title: string | null; url: string | null; doneOn: string | null; hours: number | null; notes: string | null; shared: boolean }[];
}

const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;

/** One employee's tasks and totals, for a month (YYYY-MM) or, with "all", everything. */
export async function loadEmployeeHours(userId: string, month: string): Promise<EmployeeHours | null> {
  const db = getDb();
  const [person] = await db
    .select({ id: users.id, name: users.name, email: users.email, mondayUserId: users.mondayUserId })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  if (!person) return null;

  const all = await db
    .select({ month: sql<string>`to_char(${staffWorkItems.doneOn}, 'YYYY-MM')` })
    .from(staffWorkItems)
    .where(and(eq(staffWorkItems.userId, userId), sql`${staffWorkItems.doneOn} IS NOT NULL`))
    .groupBy(sql`1`)
    .orderBy(desc(sql`1`));
  const months = all.map((m) => m.month);

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

  return { person, months, month: picked, summary: summarize(tasks), tasks: tasks.map((t) => ({ ...t, hours: t.hours == null ? null : Number(t.hours) })) };
}

function nextMonthStart(month: string): string {
  const [y, m] = month.split("-").map(Number) as [number, number];
  return m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, "0")}-01`;
}

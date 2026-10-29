import type { Metadata } from "next";
import Link from "next/link";
import { BarList, type BarItem } from "@/components/dashboard/BarList";
import { Badge, Card, formatDateTime, PageHeader, Table } from "@/components/ui";
import { pageAuthStaff } from "@/lib/auth/guard";
import { loadStaffMonth, parseMonth, recentMonths, type MonthCounts, type StaffMonthRow } from "@/lib/staff/data";
import { mondayConfigured, staffSourceStatus } from "@/lib/staff/monday";
import { fmtCount, fmtHours, monthLabel } from "./format";
import { SyncButton } from "./SyncButton";

export const metadata: Metadata = { title: "עובדים" };
export const dynamic = "force-dynamic";

/**
 * The staff area: only staff managers (pageAuthStaff — never a role, never during a preview).
 * Per employee and month: hours and tasks from monday, emails and calls logged in Salesforce, and the
 * Cases opened that month that they own, by type — as bars, each with its table. Who is
 * which user is set at /admin/staff-links. Nothing here is offered over MCP or the API (docs/staff.md).
 */
export default async function StaffPage({ searchParams }: { searchParams: Promise<{ month?: string }> }) {
  const { month = "" } = await searchParams;
  const auth = await pageAuthStaff(`/staff${month ? `?month=${encodeURIComponent(month)}` : ""}`);
  if (!auth.ok) return auth.render;

  const months = recentMonths(12);
  const picked = parseMonth(month) ?? months[0]!;
  const [rows, state] = await Promise.all([loadStaffMonth(picked), staffSourceStatus()]);
  const total = rows.reduce<MonthCounts>(
    (t, r) => ({
      hours: t.hours + r.hours,
      mondayTasks: t.mondayTasks + r.mondayTasks,
      withoutHours: t.withoutHours + r.withoutHours,
      sfEmails: t.sfEmails + r.sfEmails,
      sfCalls: t.sfCalls + r.sfCalls,
      sfTasks: t.sfTasks + r.sfTasks,
    }),
    { hours: 0, mondayTasks: 0, withoutHours: 0, sfEmails: 0, sfCalls: 0, sfTasks: 0 },
  );

  return (
    <>
      <PageHeader title="עובדים" subtitle="שעות ומשימות לפי עובד ולפי חודש. גלוי למנהלי עובדים בלבד" />

      <nav aria-label="חודש" className="mb-6 flex flex-wrap gap-2">
        {months.map((m) => (
          <Link
            key={m}
            href={`/staff?month=${m}`}
            aria-current={m === picked ? "page" : undefined}
            className={`rounded-full px-4 py-1.5 text-sm font-medium ${m === picked ? "bg-accent text-white" : "bg-panel text-ink hover:bg-accent/10"}`}
          >
            {monthLabel(m)}
          </Link>
        ))}
      </nav>

      <div className="flex flex-col gap-8">
        <Card title={`פעילות לפי עובד · ${monthLabel(picked)}`}>
          <div className="grid gap-x-10 gap-y-8 lg:grid-cols-2">
            <Bars title="שעות (מאנדיי)" items={bars(rows.filter((r) => r.mondayLinked), (r) => r.hours, (r) => fmtHours(r.hours))} />
            <Bars title="משימות מאנדיי" items={bars(rows.filter((r) => r.mondayLinked), (r) => r.mondayTasks)} />
            <Bars title="משימות Salesforce" items={bars(rows.filter((r) => r.sfName), (r) => r.sfTasks)} />
            <Bars title="מיילים שנשלחו" items={bars(rows.filter((r) => r.sfName), (r) => r.sfEmails)} />
            <Bars title="שיחות" items={bars(rows.filter((r) => r.sfName), (r) => r.sfCalls)} />
            <Bars title="מקרים שנפתחו (כל הסוגים)" items={bars(rows.filter((r) => r.sfName), caseTotal)} />
          </div>
        </Card>

        <CasesByType rows={rows} month={picked} />

        <Card title={`משימות ושעות · ${monthLabel(picked)}`}>
          <p className="mb-4 text-sm text-muted">
            מאנדיי: המשימות ותת-המשימות שהעובד סגר (Done) בכל לוח שיש בו עמודת &quot;שעות (בחירה)&quot;, לפי &quot;תאריך ביצוע&quot;, והשעות שסומנו בהן. Salesforce: המשימות שהעובד תיעד לפי
            תאריך היצירה, ומתוכן המיילים שנשלחו והשיחות. עובד מופיע כאן כשהוא מקושר לאחד המקורות ב
            <Link href="/admin/staff-links" className="font-medium text-accent-dark underline underline-offset-4">
              ניהול › קישור עובדים
            </Link>
            .
          </p>
          <Table
            head={["עובד", "שעות", "משימות מאנדיי", "משימות Salesforce", "מיילים", "שיחות", "סה״כ משימות", "מקרים שנפתחו"]}
            empty={rows.length ? undefined : "אף עובד עוד לא מקושר למאנדיי או ל-Salesforce"}
          >
            {rows.map((r) => (
              <tr key={r.id} className={r.active ? "" : "bg-panel"}>
                <td className="px-3 py-3">
                  <Link href={`/staff/${r.id}?month=${picked}`} className="font-medium text-accent-dark underline underline-offset-4">
                    {r.name ?? r.email}
                  </Link>
                  {r.active ? null : (
                    <>
                      {" "}
                      <Badge>מושבת</Badge>
                    </>
                  )}
                </td>
                <td className="px-3 py-3 tabular-nums">
                  {r.mondayLinked ? fmtHours(r.hours) : "—"}
                  {r.withoutHours ? <p className="text-xs text-muted">{r.withoutHours} משימות בלי שעות</p> : null}
                </td>
                <td className="px-3 py-3 tabular-nums">{r.mondayLinked ? fmtCount(r.mondayTasks) : <NotLinked />}</td>
                <td className="px-3 py-3 tabular-nums">{r.sfName ? fmtCount(r.sfTasks) : <NotLinked />}</td>
                <td className="px-3 py-3 tabular-nums">{r.sfName ? fmtCount(r.sfEmails) : "—"}</td>
                <td className="px-3 py-3 tabular-nums">{r.sfName ? fmtCount(r.sfCalls) : "—"}</td>
                <td className="px-3 py-3 font-medium tabular-nums">{fmtCount(r.mondayTasks + r.sfTasks)}</td>
                <td className="px-3 py-3 tabular-nums">{r.sfName ? fmtCount(caseTotal(r)) : "—"}</td>
              </tr>
            ))}
            {rows.length > 1 ? (
              <tr className="border-t-2 border-line font-medium">
                <td className="px-3 py-3">סה״כ</td>
                <td className="px-3 py-3 tabular-nums">{fmtHours(total.hours)}</td>
                <td className="px-3 py-3 tabular-nums">{fmtCount(total.mondayTasks)}</td>
                <td className="px-3 py-3 tabular-nums">{fmtCount(total.sfTasks)}</td>
                <td className="px-3 py-3 tabular-nums">{fmtCount(total.sfEmails)}</td>
                <td className="px-3 py-3 tabular-nums">{fmtCount(total.sfCalls)}</td>
                <td className="px-3 py-3 tabular-nums">{fmtCount(total.mondayTasks + total.sfTasks)}</td>
                <td className="px-3 py-3 tabular-nums">{fmtCount(rows.reduce((t, r) => t + caseTotal(r), 0))}</td>
              </tr>
            ) : null}
          </Table>
          <p className="mt-3 text-xs text-muted">
            &quot;משימות Salesforce&quot; כוללות את המיילים והשיחות ואת שאר המשימות שתועדו. Salesforce מתעדכן כאן כל 10 דקות.
          </p>
        </Card>

        <Card title="סנכרון מאנדיי" tone="accent-light">
          {mondayConfigured() ? (
            <dl className="mb-4 grid gap-1 text-sm sm:grid-cols-[auto_1fr] sm:gap-x-4">
              <dt className="text-muted">סנכרון אחרון שהצליח</dt>
              <dd>{formatDateTime(state?.lastSuccessAt ?? null)}</dd>
              <dt className="text-muted">משימות שנשמרו</dt>
              <dd>{state?.items ?? "—"}</dd>
              {state?.lastError ? (
                <>
                  <dt className="text-muted">שגיאה אחרונה</dt>
                  <dd className="text-danger">{state.lastError}</dd>
                </>
              ) : null}
            </dl>
          ) : (
            <p className="mb-4 text-sm text-muted">
              החיבור למאנדיי עוד לא הוגדר. צריך לשמור את הטוקן האישי של מאנדיי כסוד בשרת, במשתנה MONDAY_TOKEN.
            </p>
          )}
          <p className="mb-4 text-xs text-muted">הסנכרון רץ אוטומטית כל שעה, ומחליף את כל המשימות השמורות במה שיש עכשיו בלוח.</p>
          <SyncButton />
        </Card>
      </div>
    </>
  );
}

const who = (r: StaffMonthRow) => r.name ?? r.email;
const caseTotal = (r: StaffMonthRow) => r.cases.reduce((t, c) => t + c.count, 0);

/** One bar per employee, most first. */
function bars(rows: StaffMonthRow[], value: (r: StaffMonthRow) => number, display?: (r: StaffMonthRow) => string): BarItem[] {
  return rows.map((r) => ({ label: who(r), value: value(r), display: display?.(r) })).sort((a, b) => b.value - a.value);
}

function Bars({ title, items }: { title: string; items: BarItem[] }) {
  return (
    <div>
      <h3 className="mb-3 font-medium">{title}</h3>
      {items.length ? <BarList items={items} caption={title} /> : <p className="text-sm text-muted">אף עובד לא מקושר למקור הזה</p>}
    </div>
  );
}

/**
 * The Cases each employee owns that were opened in the month, one chart per record type (the
 * busiest type first), so "who handled how many applications, how many inquiries" reads at a glance.
 */
function CasesByType({ rows, month }: { rows: StaffMonthRow[]; month: string }) {
  const linked = rows.filter((r) => r.sfName);
  const types = new Map<string, number>();
  for (const r of linked) for (const c of r.cases) types.set(c.caseType, (types.get(c.caseType) ?? 0) + c.count);
  const ordered = [...types.entries()].sort((a, b) => b[1] - a[1]).map(([t]) => t);
  const countOf = (r: StaffMonthRow, type: string) => r.cases.find((c) => c.caseType === type)?.count ?? 0;
  return (
    <Card title={`מקרים שנפתחו לפי סוג · ${monthLabel(month)}`}>
      <p className="mb-6 text-sm text-muted">
        מקרים (Cases) ב-Salesforce שנפתחו בחודש, לפי סוג הרשומה, אצל העובד שהוא הבעלים שלהם היום. מקרה שהועבר לעובד אחר נספר אצל הבעלים הנוכחי.
      </p>
      {!linked.length ? (
        <p className="text-sm text-muted">אף עובד לא מקושר למשתמש Salesforce</p>
      ) : !ordered.length ? (
        <p className="text-sm text-muted">לא נפתחו בחודש הזה מקרים שבבעלות העובדים המקושרים</p>
      ) : (
        <>
          <div className="grid gap-x-10 gap-y-8 lg:grid-cols-2">
            {ordered.map((type) => (
              <Bars
                key={type}
                title={`${type} (${fmtCount(types.get(type) ?? 0)})`}
                items={bars(
                  linked.filter((r) => countOf(r, type) > 0),
                  (r) => countOf(r, type),
                )}
              />
            ))}
          </div>
          <details className="mt-8 text-sm">
            <summary className="cursor-pointer text-accent-dark underline-offset-4 hover:underline">כל הסוגים בטבלה אחת</summary>
            <div className="mt-3">
              <Table head={["עובד", ...ordered, "סה״כ"]}>
                {linked.map((r) => (
                  <tr key={r.id}>
                    <td className="px-3 py-2">{who(r)}</td>
                    {ordered.map((t) => (
                      <td key={t} className="px-3 py-2 tabular-nums">
                        {fmtCount(countOf(r, t))}
                      </td>
                    ))}
                    <td className="px-3 py-2 font-medium tabular-nums">{fmtCount(caseTotal(r))}</td>
                  </tr>
                ))}
              </Table>
            </div>
          </details>
        </>
      )}
    </Card>
  );
}

function NotLinked() {
  return <span className="text-xs text-muted">לא מקושר</span>;
}

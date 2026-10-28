import type { Metadata } from "next";
import Link from "next/link";
import { Badge, Card, formatDateTime, PageHeader, Table } from "@/components/ui";
import { pageAuthStaff } from "@/lib/auth/guard";
import { loadStaffMonth, parseMonth, recentMonths, type MonthCounts } from "@/lib/staff/data";
import { mondayConfigured, staffSourceStatus } from "@/lib/staff/monday";
import { fmtCount, fmtHours, monthLabel } from "./format";
import { SyncButton } from "./SyncButton";

export const metadata: Metadata = { title: "עובדים" };
export const dynamic = "force-dynamic";

/**
 * The staff area: only staff managers (pageAuthStaff — never a role, never during a preview).
 * Per employee and month: hours and tasks from monday, emails and calls logged in Salesforce. Who is
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
        <Card title={`משימות ושעות · ${monthLabel(picked)}`}>
          <p className="mb-4 text-sm text-muted">
            מאנדיי: המשימות שהעובד סגר (Done) בלוח &quot;משימות סיילספורס&quot;, לפי &quot;תאריך ביצוע&quot;, והשעות שסומנו בהן. Salesforce: המשימות שהעובד תיעד לפי
            תאריך היצירה, ומתוכן המיילים שנשלחו והשיחות. עובד מופיע כאן כשהוא מקושר לאחד המקורות ב
            <Link href="/admin/staff-links" className="font-medium text-accent-dark underline underline-offset-4">
              ניהול › קישור עובדים
            </Link>
            .
          </p>
          <Table
            head={["עובד", "שעות", "משימות מאנדיי", "משימות Salesforce", "מיילים", "שיחות", "סה״כ משימות"]}
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

function NotLinked() {
  return <span className="text-xs text-muted">לא מקושר</span>;
}

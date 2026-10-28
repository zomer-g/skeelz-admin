import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge, Card, formatDateTime, PageHeader, Table } from "@/components/ui";
import { pageAuthStaff } from "@/lib/auth/guard";
import { loadEmployeeHours, loadSfActivity } from "@/lib/staff/data";
import { dayLabel, fmtCount, fmtHours, monthLabel } from "../format";

export const metadata: Metadata = { title: "שעות עובד" };
export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-f-]{36}$/i;
const SF_KIND = { email: "מייל", call: "שיחה", task: "משימה" } as const;

/** One employee's hours: staff managers only (docs/staff.md). The audit log records the view, never the hours. */
export default async function EmployeeHoursPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ month?: string }> }) {
  const [{ id }, { month = "" }] = await Promise.all([params, searchParams]);
  const auth = await pageAuthStaff(`/staff/${id}${month ? `?month=${encodeURIComponent(month)}` : ""}`);
  if (!auth.ok) return auth.render;
  if (!UUID_RE.test(id)) notFound();

  const data = await loadEmployeeHours(id, month);
  if (!data) notFound();
  const { person, byMonth, months, summary, tasks } = data;
  const sf = data.month ? byMonth.find((m) => m.month === data.month) : null;
  const activity = person.sfUserId ? await loadSfActivity(person.sfUserId, data.month) : null;
  const title = person.name ?? person.email;
  const period = data.month ? monthLabel(data.month) : "כל התקופה";

  return (
    <>
      <PageHeader title={`שעות · ${title}`} subtitle={`${period}. משימות ושעות ממאנדיי, מיילים ושיחות מ-Salesforce`} />
      <p className="mb-6">
        <Link href="/staff" className="text-sm font-medium text-accent-dark underline underline-offset-4">
          חזרה לרשימת העובדים
        </Link>
      </p>

      {!person.mondayUserId || !person.sfUserId ? (
        <p className="mb-6 rounded-card bg-panel px-4 py-3 text-sm" role="status">
          {!person.mondayUserId && !person.sfUserId
            ? "העובד לא מקושר למאנדיי ולא ל-Salesforce."
            : !person.mondayUserId
              ? "העובד לא מקושר למשתמש מאנדיי, ולכן אין לו שעות."
              : "העובד לא מקושר למשתמש Salesforce, ולכן אין לו מיילים ושיחות."}{" "}
          את הקישור מגדירים בניהול › קישור עובדים.
        </p>
      ) : null}

      <nav aria-label="חודש" className="mb-6 flex flex-wrap gap-2">
        {[...months, "all"].map((m) => {
          const active = (data.month ?? "all") === m;
          return (
            <Link
              key={m}
              href={`/staff/${id}?month=${m}`}
              aria-current={active ? "page" : undefined}
              className={`rounded-full px-4 py-1.5 text-sm font-medium ${active ? "bg-accent text-white" : "bg-panel text-ink hover:bg-accent/10"}`}
            >
              {m === "all" ? "הכול" : monthLabel(m)}
            </Link>
          );
        })}
      </nav>

      <div className="flex flex-col gap-8">
        <Card title={`סיכום · ${period}`}>
          <dl className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
            <div>
              <dt className="text-sm text-muted">שעות</dt>
              <dd className="text-3xl font-bold">{fmtHours(summary.hours)}</dd>
            </div>
            <div>
              <dt className="text-sm text-muted">משימות מאנדיי</dt>
              <dd className="text-3xl font-bold">{summary.tasks}</dd>
            </div>
            <div>
              <dt className="text-sm text-muted">משימות בלי שעות</dt>
              <dd className="text-3xl font-bold">{summary.withoutHours}</dd>
            </div>
            {sf ? (
              <>
                <div>
                  <dt className="text-sm text-muted">משימות Salesforce</dt>
                  <dd className="text-3xl font-bold">{fmtCount(sf.sfTasks)}</dd>
                </div>
                <div>
                  <dt className="text-sm text-muted">מיילים</dt>
                  <dd className="text-3xl font-bold">{fmtCount(sf.sfEmails)}</dd>
                </div>
                <div>
                  <dt className="text-sm text-muted">שיחות</dt>
                  <dd className="text-3xl font-bold">{fmtCount(sf.sfCalls)}</dd>
                </div>
              </>
            ) : null}
          </dl>
          {summary.withoutHours || summary.withoutDate ? (
            <p className="mt-4 text-sm text-muted">
              משימה שנסגרה בלי שעות נספרת כמשימה ולא כשעות. משימה בלי תאריך ביצוע לא שייכת לאף חודש, ומופיעה רק תחת &quot;הכול&quot;
              {summary.withoutDate ? ` (${summary.withoutDate} כאלה)` : ""}.
            </p>
          ) : null}
        </Card>

        <Card title="לפי חודש" level={2}>
          <Table head={["חודש", "שעות", "משימות מאנדיי", "משימות Salesforce", "מיילים", "שיחות", "סה״כ משימות"]}>
            {byMonth.map((m) => (
              <tr key={m.month}>
                <td className="px-3 py-2">
                  <Link href={`/staff/${id}?month=${m.month}`} className="text-accent-dark underline underline-offset-4">
                    {monthLabel(m.month)}
                  </Link>
                </td>
                <td className="px-3 py-2 tabular-nums">{person.mondayUserId ? fmtHours(m.hours) : "—"}</td>
                <td className="px-3 py-2 tabular-nums">{person.mondayUserId ? fmtCount(m.mondayTasks) : "—"}</td>
                <td className="px-3 py-2 tabular-nums">{person.sfUserId ? fmtCount(m.sfTasks) : "—"}</td>
                <td className="px-3 py-2 tabular-nums">{person.sfUserId ? fmtCount(m.sfEmails) : "—"}</td>
                <td className="px-3 py-2 tabular-nums">{person.sfUserId ? fmtCount(m.sfCalls) : "—"}</td>
                <td className="px-3 py-2 font-medium tabular-nums">{fmtCount(m.mondayTasks + m.sfTasks)}</td>
              </tr>
            ))}
          </Table>
        </Card>

        {summary.byWeek.length ? (
          <Card title="לפי שבוע" level={2}>
            <Table head={["שבוע (מיום ראשון)", "שעות", "משימות"]}>
              {summary.byWeek.map((w) => (
                <tr key={w.week}>
                  <td className="px-3 py-2">{dayLabel(w.week)}</td>
                  <td className="px-3 py-2">{fmtHours(w.hours)}</td>
                  <td className="px-3 py-2">{w.tasks}</td>
                </tr>
              ))}
            </Table>
          </Card>
        ) : null}

        {activity ? (
          <Card title={`Salesforce לפי סוג מקרה · ${period}`}>
            <Table head={["סוג מקרה", "מיילים", "שיחות", "משימות אחרות", "סה״כ"]} empty={activity.byType.length ? undefined : "אין משימות בתקופה הזו"}>
              {activity.byType.map((t) => (
                <tr key={`${t.caseType}|${t.developerName ?? ""}`}>
                  <td className="px-3 py-2">{t.caseType}</td>
                  <td className="px-3 py-2 tabular-nums">{fmtCount(t.emails)}</td>
                  <td className="px-3 py-2 tabular-nums">{fmtCount(t.calls)}</td>
                  <td className="px-3 py-2 tabular-nums">{fmtCount(t.tasks - t.emails - t.calls)}</td>
                  <td className="px-3 py-2 font-medium tabular-nums">{fmtCount(t.tasks)}</td>
                </tr>
              ))}
            </Table>
            {activity.tasks.length ? (
              <div className="mt-6">
                <h3 className="mb-2 text-base font-bold">
                  המשימות{activity.total > activity.tasks.length ? ` (${activity.tasks.length} האחרונות מתוך ${fmtCount(activity.total)})` : ""}
                </h3>
                <Table head={["נוצרה", "סוג", "נושא", "סוג מקרה", "מקרה"]}>
                  {activity.tasks.map((t) => (
                    <tr key={t.id}>
                      <td className="px-3 py-2 whitespace-nowrap">{formatDateTime(t.createdAt)}</td>
                      <td className="px-3 py-2">{SF_KIND[t.kind]}</td>
                      <td className="px-3 py-2">{t.subject ?? "—"}</td>
                      <td className="px-3 py-2">{t.caseType}</td>
                      <td className="px-3 py-2">
                        {t.path ? (
                          <Link href={t.path} className="text-accent-dark underline underline-offset-4">
                            {t.caseNumber ?? "מקרה"}
                          </Link>
                        ) : (
                          (t.caseNumber ?? "—")
                        )}
                      </td>
                    </tr>
                  ))}
                </Table>
              </div>
            ) : null}
          </Card>
        ) : null}

        <Card title="משימות מאנדיי">
          <Table head={["תאריך ביצוע", "נכנסה ל-Done", "משימה", "לוח", "שעות", "הערות"]} empty={tasks.length ? undefined : "אין משימות בתקופה הזו"}>
            {tasks.map((t) => (
              <tr key={t.id}>
                <td className="px-3 py-2 whitespace-nowrap">{t.doneOn ? dayLabel(t.doneOn) : <Badge tone="warning">בלי תאריך</Badge>}</td>
                <td className="px-3 py-2 whitespace-nowrap text-sm">{formatDateTime(t.doneAt)}</td>
                <td className="px-3 py-2">
                  {t.url ? (
                    <a href={t.url} target="_blank" rel="noopener noreferrer" className="text-accent-dark underline underline-offset-4">
                      {t.title ?? "משימה"}
                      <span className="sr-only"> (במאנדיי, נפתח בלשונית חדשה)</span>
                    </a>
                  ) : (
                    (t.title ?? "משימה")
                  )}
                  {t.shared ? (
                    <>
                      {" "}
                      <Badge>משותפת</Badge>
                    </>
                  ) : null}
                </td>
                <td className="px-3 py-2 text-sm">{t.boardName ?? "—"}</td>
                <td className="px-3 py-2">{t.hours == null ? <Badge tone="warning">בלי שעות</Badge> : fmtHours(t.hours)}</td>
                <td className="px-3 py-2 text-sm text-muted">{t.notes ?? ""}</td>
              </tr>
            ))}
          </Table>
        </Card>
      </div>
    </>
  );
}

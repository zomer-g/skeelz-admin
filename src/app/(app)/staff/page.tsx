import type { Metadata } from "next";
import Link from "next/link";
import { Badge, buttonClass, Card, formatDateTime, PageHeader, smallFieldClass, Table } from "@/components/ui";
import { pageAuthStaff } from "@/lib/auth/guard";
import { ROLE_LABELS, type Role } from "@/lib/auth/roles";
import { loadStaffOverview, monthsAround } from "@/lib/staff/data";
import { mondayConfigured, staffSourceStatus } from "@/lib/staff/monday";
import { setMondayUser } from "./actions";
import { fmtHours, monthLabel } from "./format";
import { SyncButton } from "./SyncButton";

export const metadata: Metadata = { title: "עובדים" };
export const dynamic = "force-dynamic";

/**
 * The staff area: only staff managers (pageAuthStaff — never a role, never during a preview).
 * Hours per employee from monday.com, and who is which Salesforce / monday user. Nothing on this page
 * is offered over MCP or the API (docs/staff.md).
 */
export default async function StaffPage() {
  const auth = await pageAuthStaff("/staff");
  if (!auth.ok) return auth.render;

  const [rows, state] = await Promise.all([loadStaffOverview(), staffSourceStatus()]);
  const { current, previous } = monthsAround();
  const configured = mondayConfigured();

  return (
    <>
      <PageHeader title="עובדים" subtitle="שעות עבודה ופעילות לפי עובד. גלוי למנהלי עובדים בלבד" />
      <div className="flex flex-col gap-8">
        <Card title="עובדים במערכת">
          <p className="mb-4 text-sm text-muted">
            השעות נלקחות מהמשימות שהעובד סגר בלוח &quot;משימות סיילספורס&quot; במאנדיי (סטטוס Done), לפי &quot;תאריך ביצוע&quot; ו&quot;שעות (בחירה)&quot;. רק משימות של עובד
            שמקושר למשתמש מאנדיי נשמרות. את הקישור לסיילספורס מגדירים בניהול › משתמשים והרשאות.
          </p>
          <Table
            head={["עובד", "הרשאה", "משתמש Salesforce", "משתמש מאנדיי", `שעות ${monthLabel(current)}`, `שעות ${monthLabel(previous)}`, "כניסה אחרונה"]}
            empty={rows.length ? undefined : "אין משתמשים"}
          >
            {rows.map((r) => (
              <tr key={r.id} className={r.active ? "" : "bg-panel"}>
                <td className="px-3 py-3">
                  {r.mondayUserId ? (
                    <Link href={`/staff/${r.id}`} className="font-medium text-accent-dark underline underline-offset-4">
                      {r.name ?? r.email}
                    </Link>
                  ) : (
                    <p className="font-medium">{r.name ?? "—"}</p>
                  )}
                  <p className="text-xs text-muted" dir="ltr">
                    {r.email}
                  </p>
                </td>
                <td className="px-3 py-3">
                  {ROLE_LABELS[r.role as Role]}
                  {r.active ? null : (
                    <>
                      {" "}
                      <Badge>מושבת</Badge>
                    </>
                  )}
                </td>
                <td className="px-3 py-3">{r.sfName ?? <span className="text-muted">לא מקושר</span>}</td>
                <td className="px-3 py-3">
                  <form action={setMondayUser} className="flex items-center gap-2">
                    <input type="hidden" name="id" value={r.id} />
                    <input
                      name="mondayUserId"
                      defaultValue={r.mondayUserId ?? ""}
                      inputMode="numeric"
                      pattern="\d{1,15}"
                      dir="ltr"
                      placeholder="מזהה"
                      className={`${smallFieldClass} w-32 text-start`}
                      aria-label={`מזהה משתמש מאנדיי · ${r.name ?? r.email}`}
                    />
                    <button className={buttonClass("secondary", "sm")}>
                      שמירה<span className="sr-only"> · {r.name ?? r.email}</span>
                    </button>
                  </form>
                </td>
                <td className="px-3 py-3">{r.mondayUserId ? fmtHours(r.hoursThisMonth) : "—"}</td>
                <td className="px-3 py-3">
                  {r.mondayUserId ? fmtHours(r.hoursLastMonth) : "—"}
                  {r.withoutHours ? <p className="text-xs text-muted">{r.withoutHours} משימות בלי שעות</p> : null}
                </td>
                <td className="px-3 py-3">{formatDateTime(r.lastLoginAt)}</td>
              </tr>
            ))}
          </Table>
        </Card>

        <Card title="סנכרון מאנדיי" tone="accent-light">
          {configured ? (
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

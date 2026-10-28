import { asc, eq } from "drizzle-orm";
import type { Metadata } from "next";
import { Badge, Card, formatDateTime, PageHeader, Table } from "@/components/ui";
import { pageAuthStaff } from "@/lib/auth/guard";
import { ROLE_LABELS } from "@/lib/auth/roles";
import { getDb } from "@/lib/db/client";
import { sfUser, users } from "@/lib/db/schema";

export const metadata: Metadata = { title: "עובדים" };

/**
 * The staff area: only staff managers (pageAuthStaff — never a role, never during a preview).
 * Hours and per-employee activity will live here; until then, who is linked to which Salesforce
 * user, which that report will rely on. Nothing on this page is offered over MCP or the API.
 */
export default async function StaffPage() {
  const auth = await pageAuthStaff("/staff");
  if (!auth.ok) return auth.render;

  const rows = await getDb()
    .select({ id: users.id, name: users.name, email: users.email, role: users.role, active: users.active, lastLoginAt: users.lastLoginAt, sfName: sfUser.name })
    .from(users)
    .leftJoin(sfUser, eq(sfUser.id, users.sfUserId))
    .orderBy(asc(users.name));

  return (
    <>
      <PageHeader title="עובדים" subtitle="שעות עבודה ופעילות לפי עובד. גלוי למנהלי עובדים בלבד" />
      <div className="flex flex-col gap-8">
        <Card title="עובדים במערכת">
          <p className="mb-4 text-sm text-muted">
            הדוח ישייך לכל עובד את הפעילות המתועדת בסיילספורס לפי משתמש ה-Salesforce המקושר אליו. את הקישור מגדירים בניהול › משתמשים והרשאות.
          </p>
          <Table head={["עובד", "הרשאה", "משתמש Salesforce", "כניסה אחרונה"]} empty={rows.length ? undefined : "אין משתמשים"}>
            {rows.map((r) => (
              <tr key={r.id} className={r.active ? "" : "bg-panel"}>
                <td className="px-3 py-3">
                  <p className="font-medium">{r.name ?? "—"}</p>
                  <p className="text-xs text-muted" dir="ltr">
                    {r.email}
                  </p>
                </td>
                <td className="px-3 py-3">
                  {ROLE_LABELS[r.role]}
                  {r.active ? null : <> <Badge>מושבת</Badge></>}
                </td>
                <td className="px-3 py-3">{r.sfName ?? <span className="text-muted">לא מקושר</span>}</td>
                <td className="px-3 py-3">{formatDateTime(r.lastLoginAt)}</td>
              </tr>
            ))}
          </Table>
        </Card>
      </div>
    </>
  );
}

import { and, desc, gt, isNull } from "drizzle-orm";
import type { Metadata } from "next";
import { Badge, buttonClass, Card, formatDateTime, PageHeader, Table } from "@/components/ui";
import { pageAuth } from "@/lib/auth/guard";
import { categoriesOf, CATEGORY_HINTS, CATEGORY_LABELS } from "@/lib/auth/permissions";
import { ROLE_LABELS } from "@/lib/auth/roles";
import { envAdmins } from "@/lib/auth/session";
import { getDb } from "@/lib/db/client";
import { accessRequests, invites, users } from "@/lib/db/schema";
import { AdminTabs } from "../AdminTabs";
import { loadReviewStatus, reviewMonth } from "@/lib/security/reviews";
import { approveRequest, confirmUserAccess, dismissRequest, revokeInvite, setActive } from "./actions";
import { InviteForm } from "./InviteForm";
import { PermissionBoxes, PermissionFields } from "./PermissionBoxes";

export const metadata: Metadata = { title: "משתמשים והרשאות" };

export default async function UsersPage() {
  const auth = await pageAuth("admin", "/admin/users");
  if (!auth.ok) return auth.render;

  const db = getDb();
  const [userRows, inviteRows, requestRows, reviews] = await Promise.all([
    db.select().from(users).orderBy(desc(users.lastLoginAt)),
    db
      .select()
      .from(invites)
      .where(and(isNull(invites.acceptedAt), isNull(invites.revokedAt), gt(invites.expiresAt, new Date())))
      .orderBy(desc(invites.createdAt)),
    db.select().from(accessRequests).orderBy(desc(accessRequests.lastAt)).limit(100),
    loadReviewStatus(),
  ]);
  const due = [...reviews.values()].filter((r) => r.due).length;
  const [year, month] = reviewMonth().split("-");
  const configuredAdmins = envAdmins();

  return (
    <>
      <PageHeader title="ניהול · משתמשים והרשאות" subtitle="מי נכנס למערכת ובאיזו הרשאה" />
      <AdminTabs />

      <div className="flex flex-col gap-8">
        <Card title="הזמנת משתמש">
          <InviteForm />
          <p className="mt-4 text-xs text-muted">
            {CATEGORY_LABELS.view}: {CATEGORY_HINTS.view} · {CATEGORY_LABELS.edit}: {CATEGORY_HINTS.edit} · {CATEGORY_LABELS.admin}: {CATEGORY_HINTS.admin}.
            הרשאת {CATEGORY_LABELS.staff} לא ניתנת בהזמנה: מנהל עובדים מסמן אותה בטבלת המשתמשים אחרי שהמשתמש נכנס.
          </p>
        </Card>

        {requestRows.length > 0 ? (
          <Card title={`בקשות גישה (${requestRows.length})`} tone="accent-light">
            <Table head={["אימייל", "שם", "ניסיונות", "ניסיון אחרון", ""]}>
              {requestRows.map((r) => (
                <tr key={r.email}>
                  <td className="px-3 py-3" dir="ltr">
                    {r.email}
                  </td>
                  <td className="px-3 py-3">{r.name ?? "—"}</td>
                  <td className="px-3 py-3">{r.attempts}</td>
                  <td className="px-3 py-3">{formatDateTime(r.lastAt)}</td>
                  <td className="px-3 py-3">
                    <div className="flex flex-wrap items-center justify-end gap-2">
                      <form action={approveRequest} className="flex flex-wrap items-center gap-2">
                        <input type="hidden" name="email" value={r.email} />
                        <PermissionFields who={r.email} />
                        <button className={buttonClass("primary", "sm")}>
                          אישור<span className="sr-only"> · {r.email}</span>
                        </button>
                      </form>
                      <form action={dismissRequest}>
                        <input type="hidden" name="email" value={r.email} />
                        <button className={buttonClass("quiet", "sm")}>
                          הסרה<span className="sr-only"> · {r.email}</span>
                        </button>
                      </form>
                    </div>
                  </td>
                </tr>
              ))}
            </Table>
          </Card>
        ) : null}

        <Card title={`משתמשים (${userRows.length})`}>
          <p
            className={`mb-4 rounded-card px-4 py-3 text-sm ring-1 ${due ? "bg-hot/20 ring-hot" : "bg-success-soft ring-success/30"}`}
            role="status"
          >
            {due
              ? `אישור ההרשאות של ${month}/${year}: נותרו ${due} משתמשים פעילים לאשר. עברו על כל משתמש, וודאו שהוא עדיין צריך גישה ושההרשאות שלו נכונות, ולחצו "אישור". משתמש שלא צריך גישה — השביתו אותו.`
              : `כל ההרשאות אושרו לחודש ${month}/${year}.`}
          </p>
          <Table head={["משתמש", "הרשאות", "סטטוס", "כניסה אחרונה", "אישור חודשי", ""]}>
            {userRows.map((u) => {
              const isSelf = u.id === auth.user.id;
              const isConfigured = configuredAdmins.includes(u.email);
              const locked = isSelf || isConfigured;
              return (
                <tr key={u.id} className={u.active ? "" : "bg-panel"}>
                  <td className="px-3 py-3">
                    <p className="font-medium">{u.name ?? "—"}</p>
                    <p className="text-xs text-muted" dir="ltr">
                      {u.email}
                    </p>
                  </td>
                  <td className="px-3 py-3">
                    {locked ? (
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge tone={u.role === "admin" ? "brand" : "accent"}>{ROLE_LABELS[u.role]}</Badge>
                        {u.staffManager || isConfigured ? <Badge tone="accent">{CATEGORY_LABELS.staff}</Badge> : null}
                        {isConfigured ? <span className="text-xs text-muted">מוגדר בהגדרות השרת</span> : null}
                        {isSelf && !isConfigured ? <span className="text-xs text-muted">(את/ה)</span> : null}
                      </div>
                    ) : (
                      <PermissionBoxes
                        userId={u.id}
                        who={u.name ?? u.email}
                        boxes={categoriesOf(u.role, u.staffManager)}
                        canGrantStaff={auth.user.staffManager}
                      />
                    )}
                  </td>
                  <td className="px-3 py-3">
                    {u.active ? <Badge tone="success">פעיל</Badge> : <Badge>מושבת</Badge>}
                    {!u.sub ? <span className="ms-2 text-xs text-muted">טרם התחבר</span> : null}
                  </td>
                  <td className="px-3 py-3">{formatDateTime(u.lastLoginAt)}</td>
                  <td className="px-3 py-3">
                    {u.active ? (
                      reviews.get(u.id)?.due ? (
                        <form action={confirmUserAccess} className="flex flex-col items-start gap-1">
                          <input type="hidden" name="id" value={u.id} />
                          <button className={buttonClass("primary", "sm")}>
                            אישור<span className="sr-only"> ההרשאה של {u.email} לחודש הזה</span>
                          </button>
                          <span className="text-xs text-muted">
                            {reviews.get(u.id)?.lastReviewedAt ? `אחרון: ${formatDateTime(reviews.get(u.id)!.lastReviewedAt)}` : "לא אושר עדיין"}
                          </span>
                        </form>
                      ) : (
                        <span className="text-xs">
                          <Badge tone="success">אושר</Badge>
                          <span className="ms-1 text-muted">{formatDateTime(reviews.get(u.id)?.lastReviewedAt ?? null)}</span>
                        </span>
                      )
                    ) : (
                      <span className="text-xs text-muted">—</span>
                    )}
                  </td>
                  <td className="px-3 py-3 text-end">
                    {locked ? null : (
                      <form action={setActive}>
                        <input type="hidden" name="id" value={u.id} />
                        <input type="hidden" name="active" value={String(!u.active)} />
                        <button className={buttonClass(u.active ? "danger" : "secondary", "sm")}>
                          {u.active ? "השבתה" : "הפעלה מחדש"}
                          <span className="sr-only"> · {u.email}</span>
                        </button>
                      </form>
                    )}
                  </td>
                </tr>
              );
            })}
          </Table>
        </Card>

        <Card title={`הזמנות פתוחות (${inviteRows.length})`} tone="accent-light">
          <Table
            head={["אימייל", "תפקיד", "הוזמן ע״י", "בתוקף עד", ""]}
            empty={inviteRows.length === 0 ? "אין הזמנות פתוחות" : undefined}
          >
            {inviteRows.map((i) => (
              <tr key={i.id}>
                <td className="px-3 py-3" dir="ltr">
                  {i.email}
                </td>
                <td className="px-3 py-3">{ROLE_LABELS[i.role]}</td>
                <td className="px-3 py-3" dir="ltr">
                  {i.invitedBy}
                </td>
                <td className="px-3 py-3">{formatDateTime(i.expiresAt)}</td>
                <td className="px-3 py-3 text-end">
                  <form action={revokeInvite}>
                    <input type="hidden" name="id" value={i.id} />
                    <button className={buttonClass("danger", "sm")}>
                      ביטול<span className="sr-only"> · {i.email}</span>
                    </button>
                  </form>
                </td>
              </tr>
            ))}
          </Table>
        </Card>
      </div>
    </>
  );
}

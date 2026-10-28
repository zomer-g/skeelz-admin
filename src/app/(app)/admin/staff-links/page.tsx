import { asc, desc } from "drizzle-orm";
import type { Metadata } from "next";
import { Badge, buttonClass, Card, PageHeader, smallFieldClass, Table } from "@/components/ui";
import { pageAuth } from "@/lib/auth/guard";
import { getDb } from "@/lib/db/client";
import { sfUser, users } from "@/lib/db/schema";
import { safeErrorMessage } from "@/lib/log";
import { listMondayUsers, mondayConfigured, type MondayUser } from "@/lib/staff/monday";
import { AdminTabs } from "../AdminTabs";
import { linkMondayUser, linkSfUser } from "./actions";

export const metadata: Metadata = { title: "קישור עובדים" };
export const dynamic = "force-dynamic";

type Option = { id: string; label: string; email: string | null };

/**
 * Which Salesforce User and which monday user each site user is (docs/staff.md). The links only say
 * who is who; the hours and activity behind them are on /staff, for staff managers. Changing a link
 * takes an admin who is also a staff manager; other admins see the table read-only.
 */
export default async function StaffLinksPage() {
  const auth = await pageAuth("admin", "/admin/staff-links");
  if (!auth.ok) return auth.render;
  const canEdit = auth.user.staffManager;

  const db = getDb();
  const [people, sfUsers, monday] = await Promise.all([
    db.select().from(users).orderBy(desc(users.active), asc(users.name)),
    db.select({ id: sfUser.id, name: sfUser.name, email: sfUser.email, isActive: sfUser.isActive }).from(sfUser).orderBy(desc(sfUser.isActive), asc(sfUser.name)),
    loadMonday(),
  ]);

  const sfOptions: Option[] = sfUsers.map((s) => ({
    id: s.id,
    label: `${s.name ?? s.id}${s.email ? ` · ${s.email}` : ""}${s.isActive ? "" : " (לא פעיל)"}`,
    email: s.email?.toLowerCase() ?? null,
  }));
  const mondayOptions: Option[] = (monday.users ?? []).map((u) => ({ id: u.id, label: `${u.name}${u.email && u.email !== u.name ? ` · ${u.email}` : ""}`, email: u.email }));
  const sfTaken = new Map(people.filter((p) => p.sfUserId).map((p) => [p.sfUserId!, p.id]));
  const mondayTaken = new Map(people.filter((p) => p.mondayUserId).map((p) => [p.mondayUserId!, p.id]));

  return (
    <>
      <PageHeader title="ניהול · קישור עובדים" subtitle="איזה משתמש Salesforce ואיזה משתמש מאנדיי שייכים לכל משתמש במערכת" />
      <AdminTabs />

      <Card title="טבלת קישור עובדים">
        <p className="mb-4 text-sm text-muted">
          לפי הקישור, הלשונית &quot;עובדים&quot; מצרפת לכל עובד את המיילים והשיחות שתיעד ב-Salesforce ואת המשימות והשעות שסגר במאנדיי. כל משתמש Salesforce וכל משתמש מאנדיי
          שייכים לעובד אחד לכל היותר. הצעה לפי מייל זהה מסומנת, ונשמרת רק אחרי &quot;שמירה&quot;.
        </p>
        <p className="mb-4 text-sm" role="status">
          {canEdit ? "" : "שינוי קישור דורש הרשאת מנהל עובדים. הטבלה מוצגת לקריאה בלבד."}
          {monday.error ? ` רשימת המשתמשים של מאנדיי לא נטענה (${monday.error}), אפשר להזין מזהה ידנית.` : ""}
        </p>
        <Table head={["עובד", "משתמש Salesforce", "משתמש מאנדיי"]} empty={people.length ? undefined : "אין משתמשים"}>
          {people.map((p) => {
            const who = p.name ?? p.email;
            return (
              <tr key={p.id} className={p.active ? "" : "bg-panel"}>
                <td className="px-3 py-3">
                  <p className="font-medium">
                    {p.name ?? "—"}
                    {p.active ? null : (
                      <>
                        {" "}
                        <Badge>מושבת</Badge>
                      </>
                    )}
                  </p>
                  <p className="text-xs text-muted" dir="ltr">
                    {p.email}
                  </p>
                </td>
                <td className="px-3 py-3">
                  <LinkForm
                    action={linkSfUser}
                    field="sfUserId"
                    label="משתמש Salesforce"
                    userId={p.id}
                    who={who}
                    email={p.email}
                    current={p.sfUserId}
                    options={sfOptions}
                    taken={sfTaken}
                    canEdit={canEdit}
                  />
                </td>
                <td className="px-3 py-3">
                  {monday.users ? (
                    <LinkForm
                      action={linkMondayUser}
                      field="mondayUserId"
                      label="משתמש מאנדיי"
                      userId={p.id}
                      who={who}
                      email={p.email}
                      current={p.mondayUserId}
                      options={mondayOptions}
                      taken={mondayTaken}
                      canEdit={canEdit}
                    />
                  ) : (
                    <form action={linkMondayUser} className="flex flex-wrap items-center gap-2">
                      <input type="hidden" name="id" value={p.id} />
                      <input
                        name="mondayUserId"
                        defaultValue={p.mondayUserId ?? ""}
                        inputMode="numeric"
                        pattern="\d{1,15}"
                        dir="ltr"
                        placeholder="מזהה"
                        disabled={!canEdit}
                        className={`${smallFieldClass} w-32 text-start`}
                        aria-label={`מזהה משתמש מאנדיי · ${who}`}
                      />
                      {canEdit ? (
                        <button className={buttonClass("secondary", "sm")}>
                          שמירה<span className="sr-only"> · {who}</span>
                        </button>
                      ) : null}
                    </form>
                  )}
                </td>
              </tr>
            );
          })}
        </Table>
      </Card>
    </>
  );
}

/** monday's member list for the dropdown; null (with why) when it can't be read, so the id is typed instead. */
async function loadMonday(): Promise<{ users: MondayUser[] | null; error: string | null }> {
  if (!mondayConfigured()) return { users: null, error: "MONDAY_TOKEN לא הוגדר" };
  try {
    return { users: await listMondayUsers(), error: null };
  } catch (err) {
    return { users: null, error: safeErrorMessage(err) };
  }
}

/**
 * One link: a select of the accounts not linked to anyone else, saved with a button (WCAG 3.2.2).
 * An unlinked person whose email matches a free account gets it preselected as a suggestion.
 */
function LinkForm({
  action,
  field,
  label,
  userId,
  who,
  email,
  current,
  options,
  taken,
  canEdit,
}: {
  action: (form: FormData) => Promise<void>;
  field: string;
  label: string;
  userId: string;
  who: string;
  email: string;
  current: string | null;
  options: Option[];
  taken: Map<string, string>;
  canEdit: boolean;
}) {
  const free = options.filter((o) => !taken.has(o.id) || taken.get(o.id) === userId);
  const suggested = current ? null : (free.find((o) => o.email === email)?.id ?? null);
  const known = !current || options.some((o) => o.id === current);
  return (
    <form action={action} className="flex flex-wrap items-center gap-2">
      <input type="hidden" name="id" value={userId} />
      <select
        name={field}
        defaultValue={current ?? suggested ?? ""}
        disabled={!canEdit}
        className={`${smallFieldClass} max-w-[16rem]`}
        aria-label={`${label} · ${who}`}
      >
        <option value="">— לא מקושר —</option>
        {known ? null : <option value={current!}>{current}</option>}
        {free.map((o) => (
          <option key={o.id} value={o.id}>
            {o.label}
          </option>
        ))}
      </select>
      {canEdit ? (
        <button className={buttonClass("secondary", "sm")}>
          שמירה<span className="sr-only"> · {who}</span>
        </button>
      ) : null}
      {suggested ? <span className="text-xs text-muted">הצעה לפי המייל, טרם נשמרה</span> : null}
    </form>
  );
}

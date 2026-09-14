import { and, desc, eq, gte, ne, sql, type SQL } from "drizzle-orm";
import type { Metadata } from "next";
import Link from "next/link";
import { Badge, Card, formatDateTime, PageHeader, Table } from "@/components/ui";
import { pageAuth } from "@/lib/auth/guard";
import { ROLE_LABELS } from "@/lib/auth/roles";
import { getDb } from "@/lib/db/client";
import { auditLog, users } from "@/lib/db/schema";
import { AdminTabs } from "../AdminTabs";

export const metadata: Metadata = { title: "יומן פעילות" };

const ACTION_LABELS: Record<string, string> = {
  "page.view": "צפייה במסך",
  login: "כניסה",
  "user.bootstrap_admin": "אדמין ראשוני נוצר",
  "invite.created": "הזמנה נוצרה",
  "invite.accepted": "הזמנה מומשה",
  "invite.revoked": "הזמנה בוטלה",
  "user.role_changed": "שינוי תפקיד",
  "user.deactivated": "משתמש הושבת",
  "user.reactivated": "משתמש הופעל מחדש",
  "access_request.approved": "בקשת גישה אושרה",
  "access_request.dismissed": "בקשת גישה הוסרה",
  "salesforce.connection_test": "בדיקת חיבור Salesforce",
  "salesforce.schema_report": "דו״ח מבנה Salesforce",
  "sync.requested": "בקשת סנכרון",
  "integration.test": "בדיקת חיבור",
  "smoov.campaign_added": "קמפיין SMOOV נוסף למעקב",
  "smoov.campaign_removed": "קמפיין SMOOV הוסר ממעקב",
  "campaign.updated": "עדכון הגדרות קמפיין",
  "preview.started": "צפייה בהרשאה נמוכה",
  "preview.ended": "יציאה ממצב צפייה",
  "campaign.job_linked": "קישור משרה לקמפיין",
  "campaign.job_unlinked": "הסרת קישור משרה מקמפיין",
};

const SCREEN_LABELS: [prefix: string, label: string][] = [
  ["/admin/users", "ניהול · משתמשים והרשאות"],
  ["/admin/integrations", "ניהול · חיבורים"],
  ["/admin/salesforce", "ניהול · Salesforce"],
  ["/admin/sync", "ניהול · סנכרון"],
  ["/admin/audit", "ניהול · יומן פעילות"],
  ["/jobs/", "דשבורד · משרה"],
  ["/jobs", "דשבורד · משרות"],
  ["/marketing", "דשבורד · שיווק"],
  ["/campaigns/", "דשבורד · דיוור"],
  ["/campaigns", "דשבורד · דיוורים"],
  ["/", "דשבורד · מועמדים"],
];

const RANGE_LABELS: Record<string, string> = {
  "7d": "7 ימים",
  "30d": "30 יום",
  "90d": "90 יום",
  mtd: "מתחילת החודש",
  ytd: "מתחילת השנה",
  all: "הכל",
  custom: "טווח אחר",
};

function describeScreen(target: string | null): { screen: string; detail: string } {
  if (!target) return { screen: "—", detail: "" };
  const [path = "/", query = ""] = target.split("?");
  const screen = SCREEN_LABELS.find(([prefix]) => (prefix === "/" ? path === "/" : path.startsWith(prefix)))?.[1] ?? path;
  const q = new URLSearchParams(query);
  const parts: string[] = [];
  const range = q.get("range");
  if (range) parts.push(range === "custom" ? `${q.get("from") ?? ""}–${q.get("to") ?? ""}` : (RANGE_LABELS[range] ?? range));
  if (q.get("basis")) parts.push(q.get("basis") === "event" ? "לפי תאריך אירוע" : "לפי תאריך הגשה");
  return { screen, detail: parts.join(" · ") };
}

type SearchParams = Record<string, string | string[] | undefined>;
const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

export default async function ActivityPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const search = await searchParams;
  const userFilter = first(search.user)?.toLowerCase() || "";
  const typeFilter = first(search.type) === "views" ? "views" : first(search.type) === "actions" ? "actions" : "all";

  const auth = await pageAuth("admin", "/admin/audit");
  if (!auth.ok) return auth.render;

  const db = getDb();
  const since = new Date(Date.now() - 30 * 86_400_000);

  const conditions: SQL[] = [];
  if (userFilter) conditions.push(eq(auditLog.actor, userFilter));
  if (typeFilter === "views") conditions.push(eq(auditLog.action, "page.view"));
  if (typeFilter === "actions") conditions.push(ne(auditLog.action, "page.view"));

  const [events, perUser, people] = await Promise.all([
    db
      .select()
      .from(auditLog)
      .where(conditions.length ? and(...conditions) : undefined)
      .orderBy(desc(auditLog.at))
      .limit(500),
    db
      .select({
        actor: auditLog.actor,
        lastAt: sql<Date>`max(${auditLog.at})`,
        views: sql<number>`count(*) FILTER (WHERE ${auditLog.action} = 'page.view')::int`,
        actions: sql<number>`count(*) FILTER (WHERE ${auditLog.action} <> 'page.view')::int`,
      })
      .from(auditLog)
      .where(gte(auditLog.at, since))
      .groupBy(auditLog.actor)
      .orderBy(desc(sql`max(${auditLog.at})`)),
    db.select({ email: users.email, name: users.name, role: users.role }).from(users),
  ]);
  const personByEmail = new Map(people.map((p) => [p.email, p]));

  const filterHref = (next: { user?: string; type?: string }) => {
    const q = new URLSearchParams();
    const u = next.user ?? userFilter;
    const t = next.type ?? typeFilter;
    if (u) q.set("user", u);
    if (t !== "all") q.set("type", t);
    const s = q.toString();
    return `/admin/audit${s ? `?${s}` : ""}`;
  };

  const pill = (active: boolean) =>
    `rounded-full px-4 py-2 text-sm font-medium ${active ? "bg-ink text-white" : "bg-white text-ink ring-1 ring-line hover:bg-surface"}`;

  return (
    <>
      <PageHeader title="ניהול" subtitle="מי נכנס, באילו מסכים צפה ואילו פעולות ביצע" />
      <AdminTabs />

      <div className="flex flex-col gap-8">
        <Card title="לפי משתמש · 30 הימים האחרונים">
          <Table head={["משתמש", "תפקיד", "פעילות אחרונה", "צפיות במסכים", "פעולות", ""]} empty={perUser.length === 0 ? "אין פעילות" : undefined}>
            {perUser.map((u) => {
              const person = personByEmail.get(u.actor);
              return (
                <tr key={u.actor} className={u.actor === userFilter ? "bg-accent/5" : ""}>
                  <td className="px-3 py-2">
                    <p className="font-medium">{person?.name ?? "—"}</p>
                    <p className="text-xs text-muted" dir="ltr">
                      {u.actor}
                    </p>
                  </td>
                  <td className="px-3 py-2">{person ? ROLE_LABELS[person.role] : <span className="text-muted">לא משתמש</span>}</td>
                  <td className="px-3 py-2">{formatDateTime(new Date(u.lastAt))}</td>
                  <td className="px-3 py-2 tabular-nums">{u.views}</td>
                  <td className="px-3 py-2 tabular-nums">{u.actions}</td>
                  <td className="px-3 py-2 text-end">
                    <Link href={filterHref({ user: u.actor })} className="text-sm font-medium text-accent-dark underline underline-offset-4">
                      היומן שלו
                    </Link>
                  </td>
                </tr>
              );
            })}
          </Table>
        </Card>

        <Card title={userFilter ? `יומן · ${personByEmail.get(userFilter)?.name ?? userFilter}` : "יומן · כל המשתמשים"} tone="accent-light">
          <div className="mb-4 flex flex-wrap items-center gap-2">
            <Link href={filterHref({ type: "all" })} className={pill(typeFilter === "all")}>
              הכל
            </Link>
            <Link href={filterHref({ type: "views" })} className={pill(typeFilter === "views")}>
              צפיות במסכים
            </Link>
            <Link href={filterHref({ type: "actions" })} className={pill(typeFilter === "actions")}>
              פעולות
            </Link>
            {userFilter ? (
              <Link href={filterHref({ user: "" })} className="ms-2 text-sm font-medium text-accent-dark underline underline-offset-4">
                הצגת כל המשתמשים
              </Link>
            ) : null}
            <span className="ms-auto text-xs text-muted">500 האירועים האחרונים</span>
          </div>

          <Table head={["מתי", "משתמש", "סוג", "מסך / פעולה", "פרטים"]} empty={events.length === 0 ? "אין אירועים" : undefined}>
            {events.map((e) => {
              const isView = e.action === "page.view";
              const view = isView ? describeScreen(e.target) : null;
              return (
                <tr key={e.id}>
                  <td className="whitespace-nowrap px-3 py-2">{formatDateTime(e.at)}</td>
                  <td className="px-3 py-2">
                    <Link href={filterHref({ user: e.actor })} className="hover:underline" dir="ltr">
                      {personByEmail.get(e.actor)?.name ?? e.actor}
                    </Link>
                  </td>
                  <td className="px-3 py-2">{isView ? <Badge>צפייה</Badge> : <Badge tone="accent">פעולה</Badge>}</td>
                  <td className="px-3 py-2">{isView ? view!.screen : (ACTION_LABELS[e.action] ?? e.action)}</td>
                  <td className="px-3 py-2 text-xs text-muted">
                    {isView ? (
                      view!.detail
                    ) : (
                      <span dir="ltr">
                        {e.target ?? ""}
                        {e.details ? ` ${JSON.stringify(e.details)}` : ""}
                      </span>
                    )}
                  </td>
                </tr>
              );
            })}
          </Table>
        </Card>
      </div>
    </>
  );
}

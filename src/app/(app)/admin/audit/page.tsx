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
  "candidate.file_opened": "פתיחת קובץ של מועמד",
  "text.updated": "עדכון טקסט",
  "text.restored": "שחזור גרסת טקסט",
  "preview.started": "צפייה בהרשאה נמוכה",
  "preview.ended": "יציאה ממצב צפייה",
  "campaign.job_linked": "קישור משרה לקמפיין",
  "campaign.job_unlinked": "הסרת קישור משרה מקמפיין",
  "api_key.created": "מפתח API נוצר",
  "api_key.revoked": "מפתח API בוטל",
  "api.used": "שימוש ב-API",
  "api.denied": "גישה ל-API נדחתה",
  "api.rate_limited": "חריגה ממגבלת ה-API",
  "connection.updated": "עדכון חיבור למערכת אחרת",
  "connection.checked": "בדיקת חיבור למערכת אחרת",
  "mcp.call": "MCP · שימוש בכלי",
  "mcp.authorized": "MCP · חיבור אושר",
  "mcp.refused": "MCP · חיבור נדחה",
  "mcp.connected": "MCP · חיבור הופעל",
  "mcp.initialize": "MCP · לקוח התחבר",
  "mcp.denied": "MCP · כלי נחסם (אין הרשאה)",
  "mcp.revoked": "MCP · חיבור נותק",
};

const isMcp = (action: string) => action.startsWith("mcp.");
const MCP_ACTION = sql`starts_with(${auditLog.action}, 'mcp.')`;

/** An MCP entry's details in words: the tool's arguments, the app and the role it ran with. */
function describeMcp(action: string, target: string | null, details: unknown): { what: string; detail: string } {
  const d = (details ?? {}) as Record<string, unknown>;
  const parts: string[] = [];
  if (action === "mcp.call" && d.args && typeof d.args === "object") {
    const args = Object.entries(d.args as Record<string, unknown>).filter(([, v]) => v !== undefined && v !== null && v !== "");
    if (args.length) parts.push(args.map(([k, v]) => `${k}=${String(v)}`).join(", "));
  }
  if (typeof d.client === "string") parts.push(`אפליקציה: ${d.client}`);
  if (action !== "mcp.call" && target && !/^[0-9a-f-]{36}$/i.test(target)) parts.push(target);
  if (typeof d.role === "string") parts.push(`הרשאה: ${ROLE_LABELS[d.role as keyof typeof ROLE_LABELS] ?? d.role}`);
  if (typeof d.maxRole === "string") parts.push(`תקרה: ${ROLE_LABELS[d.maxRole as keyof typeof ROLE_LABELS] ?? d.maxRole}`);
  if (typeof d.required === "string") parts.push(`נדרש: ${ROLE_LABELS[d.required as keyof typeof ROLE_LABELS] ?? d.required}`);
  if (typeof d.ip === "string") parts.push(d.ip);
  const what = action === "mcp.call" || action === "mcp.denied" ? `${ACTION_LABELS[action]}: ${target ?? ""}` : (ACTION_LABELS[action] ?? action);
  return { what, detail: parts.join(" · ") };
}

const SCREEN_LABELS: [prefix: string, label: string][] = [
  ["/admin/users", "ניהול · משתמשים והרשאות"],
  ["/admin/integrations", "ניהול · מקורות נתונים"],
  ["/admin/api", "ניהול · API ומפתחות"],
  ["/admin/connections", "ניהול · חיבורים"],
  ["/admin/salesforce", "ניהול · Salesforce"],
  ["/admin/sync", "ניהול · סנכרון"],
  ["/admin/audit", "ניהול · יומן פעילות"],
  ["/admin/texts", "ניהול · טקסטים"],
  ["/admin/mcp", "ניהול · חיבורי MCP"],
  ["/mcp/oauth/authorize", "MCP · מסך אישור חיבור"],
  ["/connectors", "חיבור ל-Claude"],
  ["/api-docs", "תיעוד API"],
  ["/emails/", "רשומות · כתובת מייל"],
  ["/emails", "רשומות · כתובות מייל"],
  ["/applications/", "רשומות · הגשה"],
  ["/applications", "רשומות · הגשות"],
  ["/companies/", "רשומות · מעסיק"],
  ["/companies", "רשומות · מעסיקים"],
  ["/candidates/", "רשומות · מועמד"],
  ["/candidates", "רשומות · מועמדים"],
  ["/positions/", "רשומות · משרה"],
  ["/payments", "רשומות · מעקב תשלומים"],
  ["/talent", "דשבורד · מועמדים"],
  ["/jobs/", "דשבורד · משרה"],
  ["/jobs", "דשבורד · משרות"],
  ["/pipeline", "דשבורד · הגשות"],
  ["/marketing", "דשבורד · שיווק"],
  ["/employers", "דשבורד · מעסיקים"],
  ["/campaigns/", "דשבורד · דיוור"],
  ["/campaigns", "דשבורד · דיוורים"],
  ["/", "דשבורד · תקציר מנהלים"],
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
  if (q.get("scope") === "all") parts.push("כל המשרות, כולל שלא בתשלום");
  return { screen, detail: parts.join(" · ") };
}

type SearchParams = Record<string, string | string[] | undefined>;
const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

export default async function ActivityPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const search = await searchParams;
  const userFilter = first(search.user)?.toLowerCase() || "";
  const rawType = first(search.type);
  const typeFilter = rawType === "views" || rawType === "actions" || rawType === "mcp" ? rawType : "all";

  const auth = await pageAuth("admin", "/admin/audit");
  if (!auth.ok) return auth.render;

  const db = getDb();
  const since = new Date(Date.now() - 30 * 86_400_000);

  const conditions: SQL[] = [];
  if (userFilter) conditions.push(eq(auditLog.actor, userFilter));
  if (typeFilter === "views") conditions.push(eq(auditLog.action, "page.view"));
  if (typeFilter === "actions") conditions.push(and(ne(auditLog.action, "page.view"), sql`NOT ${MCP_ACTION}`)!);
  if (typeFilter === "mcp") conditions.push(MCP_ACTION);

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
        actions: sql<number>`count(*) FILTER (WHERE ${auditLog.action} <> 'page.view' AND NOT ${MCP_ACTION})::int`,
        mcp: sql<number>`count(*) FILTER (WHERE ${auditLog.action} = 'mcp.call')::int`,
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
      <PageHeader title="ניהול · יומן פעילות" subtitle="מי נכנס, באילו מסכים צפה, אילו פעולות ביצע ומה נשאל דרך MCP" />
      <AdminTabs />

      <div className="flex flex-col gap-8">
        <Card title="לפי משתמש · 30 הימים האחרונים">
          <Table head={["משתמש", "תפקיד", "פעילות אחרונה", "צפיות במסכים", "פעולות", "קריאות MCP", ""]} empty={perUser.length === 0 ? "אין פעילות" : undefined}>
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
                  <td className="px-3 py-2 tabular-nums">
                    {u.mcp ? (
                      <Link href={filterHref({ user: u.actor, type: "mcp" })} className="font-medium text-accent-dark underline underline-offset-4">
                        {u.mcp}
                        <span className="sr-only"> קריאות MCP של {person?.name ?? u.actor}</span>
                      </Link>
                    ) : (
                      0
                    )}
                  </td>
                  <td className="px-3 py-2 text-end">
                    <Link href={filterHref({ user: u.actor })} className="text-sm font-medium text-accent-dark underline underline-offset-4">
                      היומן שלו<span className="sr-only"> · {person?.name ?? u.actor}</span>
                    </Link>
                  </td>
                </tr>
              );
            })}
          </Table>
        </Card>

        <Card title={userFilter ? `יומן · ${personByEmail.get(userFilter)?.name ?? userFilter}` : "יומן · כל המשתמשים"} tone="accent-light">
          <div className="mb-4 flex flex-wrap items-center gap-2">
            <Link href={filterHref({ type: "all" })} aria-current={typeFilter === "all" ? "true" : undefined} className={pill(typeFilter === "all")}>
              הכל
            </Link>
            <Link href={filterHref({ type: "views" })} aria-current={typeFilter === "views" ? "true" : undefined} className={pill(typeFilter === "views")}>
              צפיות במסכים
            </Link>
            <Link href={filterHref({ type: "actions" })} aria-current={typeFilter === "actions" ? "true" : undefined} className={pill(typeFilter === "actions")}>
              פעולות
            </Link>
            <Link href={filterHref({ type: "mcp" })} aria-current={typeFilter === "mcp" ? "true" : undefined} className={pill(typeFilter === "mcp")}>
              MCP
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
              const mcp = isMcp(e.action) ? describeMcp(e.action, e.target, e.details) : null;
              return (
                <tr key={e.id}>
                  <td className="whitespace-nowrap px-3 py-2">{formatDateTime(e.at)}</td>
                  <td className="px-3 py-2">
                    <Link href={filterHref({ user: e.actor })} className="hover:underline" dir="ltr">
                      {personByEmail.get(e.actor)?.name ?? e.actor}
                    </Link>
                  </td>
                  <td className="px-3 py-2">
                    {isView ? <Badge>צפייה</Badge> : mcp ? <Badge tone="brand">MCP</Badge> : <Badge tone="accent">פעולה</Badge>}
                  </td>
                  <td className="px-3 py-2">{isView ? view!.screen : mcp ? mcp.what : (ACTION_LABELS[e.action] ?? e.action)}</td>
                  <td className="px-3 py-2 text-xs text-muted">
                    {isView ? (
                      view!.detail
                    ) : mcp ? (
                      <span dir="auto">{mcp.detail}</span>
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

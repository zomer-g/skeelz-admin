import { and, desc, eq } from "drizzle-orm";
import type { Metadata } from "next";
import Link from "next/link";
import { Badge, buttonClass, Card, formatDateTime, PageHeader, Table } from "@/components/ui";
import { pageAuth } from "@/lib/auth/guard";
import { getDb } from "@/lib/db/client";
import { auditLog } from "@/lib/db/schema";
import { fmtInt } from "@/lib/format";
import { ALERT_LABELS, FILE_LIMITS, loadAlerts, loadUsageToday } from "@/lib/security/files";
import { AdminTabs } from "../AdminTabs";
import { grantFiles, handleAlert } from "./actions";

export const metadata: Metadata = { title: "אבטחה" };
export const dynamic = "force-dynamic";

const MAX_SEARCHES = 200;

const FILTER_LABELS: Record<string, string> = {
  q: "שם/מייל/קובץ",
  unhandled: "לא טופל",
  source: "איפה הקובץ",
  kind: "סוג קבצים",
  fromDay: "מתאריך",
  toDay: "עד תאריך",
};
const VALUE_LABELS: Record<string, string> = { yes: "כן", no: "לא", all: "כל הקבצים", contact: "באיש הקשר", case: "ב-Case", email: "במייל" };

interface SearchDetails {
  via?: string;
  filters?: Record<string, string>;
  matched?: number | null;
  results?: number;
  files?: { documentId: string; title: string | null; name: string | null; email: string | null }[];
}

/**
 * Who reaches candidate files: the alerts (many files today, or the day's limit reached), every
 * user's opens today with a button that lets them open another batch, and every search inside the
 * CVs with what it returned. Definitions in docs/cv-security.md.
 */
export default async function SecurityPage() {
  const auth = await pageAuth("admin", "/admin/security");
  if (!auth.ok) return auth.render;

  const [alerts, usage, searches] = await Promise.all([
    loadAlerts(),
    loadUsageToday(),
    getDb()
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.action, "cvs.text_search")))
      .orderBy(desc(auditLog.at))
      .limit(MAX_SEARCHES),
  ]);
  const open = alerts.filter((a) => !a.handledAt);

  return (
    <>
      <PageHeader title="ניהול · אבטחה" subtitle="פתיחת קבצי מועמדים, התראות, וחיפושים בתוך קורות חיים" />
      <AdminTabs />

      <div className="flex flex-col gap-8">
        <Card title={`התראות פתוחות (${open.length})`} tone={open.length ? "accent-light" : undefined}>
          <p className="mb-4 text-sm text-muted">
            כל משתמש יכול לפתוח עד {FILE_LIMITS.daily} קבצי מועמדים ביום. בקובץ ה-{FILE_LIMITS.alertAt} נוצרת התראה; מעבר למגבלה הפתיחה נחסמת ונוצרת בקשה. כל
            אישור מוסיף {FILE_LIMITS.grant} קבצים לאותו יום, ואפשר לאשר שוב.
          </p>
          <Table head={["מתי", "משתמש", "מה קרה", "סטטוס", ""]} empty={alerts.length === 0 ? "אין התראות בשבועיים האחרונים" : undefined}>
            {alerts.map((a) => (
              <tr key={a.id} className={a.handledAt ? "" : "bg-hot/20"}>
                <td className="whitespace-nowrap px-3 py-2 tabular-nums">{formatDateTime(a.createdAt)}</td>
                <td className="px-3 py-2" dir="ltr">
                  {a.userEmail}
                </td>
                <td className="px-3 py-2">
                  {ALERT_LABELS[a.kind] ?? a.kind}
                  {a.kind === "files_limit" ? <span className="text-xs text-muted"> ({fmtInt(a.threshold)} קבצים)</span> : null}
                </td>
                <td className="px-3 py-2 text-xs">
                  {a.handledAt ? (
                    <>
                      <Badge tone="success">טופל</Badge> <span className="text-muted">{a.handledBy}</span>
                    </>
                  ) : (
                    <Badge tone="warning">פתוח</Badge>
                  )}
                </td>
                <td className="px-3 py-2">
                  {a.handledAt ? null : (
                    <div className="flex flex-wrap justify-end gap-2">
                      <form action={grantFiles}>
                        <input type="hidden" name="email" value={a.userEmail} />
                        <button className={buttonClass("primary", "sm")}>
                          אישור עוד {FILE_LIMITS.grant} להיום<span className="sr-only"> · {a.userEmail}</span>
                        </button>
                      </form>
                      <form action={handleAlert}>
                        <input type="hidden" name="id" value={a.id} />
                        <button className={buttonClass("quiet", "sm")}>
                          ראיתי<span className="sr-only"> · {a.userEmail}</span>
                        </button>
                      </form>
                    </div>
                  )}
                </td>
              </tr>
            ))}
          </Table>
        </Card>

        <Card title={`פתיחת קבצי מועמדים היום (${usage.length} משתמשים)`}>
          <Table head={["משתמש", "נפתחו", "מותר היום", "נחסמו", ""]} empty={usage.length === 0 ? "אף אחד לא פתח קבצים היום" : undefined}>
            {usage.map((u) => (
              <tr key={u.email}>
                <td className="px-3 py-2" dir="ltr">
                  {u.email}
                </td>
                <td className="px-3 py-2 tabular-nums">{fmtInt(u.opened)}</td>
                <td className="px-3 py-2 tabular-nums">{fmtInt(u.allowed)}</td>
                <td className="px-3 py-2 tabular-nums">{u.refused ? <Badge tone="brand">{fmtInt(u.refused)}</Badge> : "0"}</td>
                <td className="px-3 py-2 text-end">
                  <form action={grantFiles}>
                    <input type="hidden" name="email" value={u.email} />
                    <button className={buttonClass("secondary", "sm")}>
                      עוד {FILE_LIMITS.grant}<span className="sr-only"> להיום · {u.email}</span>
                    </button>
                  </form>
                </td>
              </tr>
            ))}
          </Table>
          <p className="mt-3 text-xs text-muted">
            מי פתח כל קובץ: בעמודת &quot;פתיחות&quot; ב<Link href="/cvs" className="underline underline-offset-2">רשימת קורות החיים</Link> ובדף של כל קובץ.
          </p>
        </Card>

        <Card title={`חיפושים בתוך קורות חיים (${fmtInt(searches.length)} אחרונים)`}>
          <Table head={["מתי", "מי", "חיפש", "מסננים", "תוצאות", "מה קיבל"]} empty={searches.length === 0 ? "עדיין לא חיפשו בתוך קורות חיים" : undefined}>
            {searches.map((s) => {
              const d = (s.details ?? {}) as SearchDetails;
              const files = d.files ?? [];
              return (
                <tr key={s.id}>
                  <td className="whitespace-nowrap px-3 py-2 tabular-nums">{formatDateTime(s.at)}</td>
                  <td className="px-3 py-2 text-xs" dir="ltr">
                    {s.actor}
                    <p className="text-muted">{d.via === "mcp" ? "דרך MCP" : "במסך"}</p>
                  </td>
                  <td className="px-3 py-2 font-medium" dir="auto">
                    {s.target}
                  </td>
                  <td className="px-3 py-2 text-xs" dir="auto">
                    {d.filters && Object.keys(d.filters).length ? Object.entries(d.filters).map(([k, v]) => `${FILTER_LABELS[k] ?? k}: ${VALUE_LABELS[v] ?? v}`).join(" · ") : "—"}
                  </td>
                  <td className="px-3 py-2 tabular-nums">{fmtInt(d.results ?? 0)}</td>
                  <td className="px-3 py-2 text-xs">
                    {files.length ? (
                      <details>
                        <summary className="cursor-pointer text-accent-dark underline-offset-4 hover:underline">
                          {fmtInt(files.length)} קבצים<span className="sr-only"> · {s.target}</span>
                        </summary>
                        <ul className="mt-1 flex flex-col gap-0.5">
                          {files.map((f) => (
                            <li key={f.documentId}>
                              <Link href={`/cvs/${f.documentId}`} className="underline underline-offset-2" dir="auto">
                                {f.name ?? f.email ?? "—"} · {f.title ?? "קובץ"}
                              </Link>
                            </li>
                          ))}
                        </ul>
                      </details>
                    ) : (
                      "—"
                    )}
                  </td>
                </tr>
              );
            })}
          </Table>
          <p className="mt-3 text-xs text-muted">
            כל חיפוש בתוך קורות החיים — במסך או דרך MCP — נרשם עם מה שחיפשו, המסננים, כמה קבצים נמצאו, ושמות המועמדים והקבצים שהתקבלו (עד 200 לחיפוש).
          </p>
        </Card>
      </div>
    </>
  );
}

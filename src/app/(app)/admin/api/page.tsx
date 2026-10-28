import { desc, getTableColumns, sql } from "drizzle-orm";
import type { Metadata } from "next";
import Link from "next/link";
import { McpConnectInfo } from "@/components/McpConnectInfo";
import { Badge, buttonClass, Card, formatDateTime, PageHeader, Table } from "@/components/ui";
import { legacyKeys } from "@/lib/api/keys";
import { KEY_PREFIX, LEGACY_KEYS } from "@/lib/api/spec";
import { pageAuth } from "@/lib/auth/guard";
import { getDb } from "@/lib/db/client";
import { apiCalls, apiKeys } from "@/lib/db/schema";
import { AdminTabs } from "../AdminTabs";
import { revokeApiKey } from "./actions";
import { CreateKeyForm } from "./CreateKeyForm";

export const metadata: Metadata = { title: "API ומפתחות" };

function Scopes({ scopes }: { scopes: string[] }) {
  return (
    <ul className="flex flex-wrap gap-1" dir="ltr">
      {scopes.map((s) => (
        <li key={s} className="rounded-full bg-white px-2 py-0.5 font-mono text-xs ring-1 ring-line">
          {s}
        </li>
      ))}
    </ul>
  );
}

/** A key's calls in the last 30 days, linking to its log. */
function Calls({ usage, href, name }: { usage?: { month: number; errors: number; last: Date | null }; href: string; name: string }) {
  if (!usage) return <span className="text-xs text-muted">אין</span>;
  return (
    <Link href={href} className="text-sm text-accent-dark underline underline-offset-4">
      {usage.month.toLocaleString("he-IL")}
      {usage.errors ? <span className="ms-1 text-xs text-danger">({usage.errors.toLocaleString("he-IL")} שגיאות)</span> : null}
      <span className="sr-only"> · יומן הקריאות של {name}</span>
    </Link>
  );
}

export default async function ApiKeysPage() {
  const auth = await pageAuth("admin", "/admin/api");
  if (!auth.ok) return auth.render;

  // Every column but the hash: it is never shown, so it is never read.
  const { hash: _hash, ...shown } = getTableColumns(apiKeys);
  const [keys, usage] = await Promise.all([
    getDb().select(shown).from(apiKeys).orderBy(desc(apiKeys.createdAt)),
    getDb()
      .select({
        keyId: apiCalls.keyId,
        month: sql<number>`(count(*) FILTER (WHERE ${apiCalls.at} > now() - interval '30 days'))::int`,
        errors: sql<number>`(count(*) FILTER (WHERE ${apiCalls.at} > now() - interval '30 days' AND ${apiCalls.status} >= 400))::int`,
        last: sql<Date | null>`max(${apiCalls.at})`.mapWith(apiCalls.at),
      })
      .from(apiCalls)
      .groupBy(apiCalls.keyId),
  ]);
  const callsOf = new Map(usage.map((u) => [u.keyId, u]));
  const configured = new Set(legacyKeys().map((k) => k.env));
  const now = Date.now();

  return (
    <>
      <PageHeader title="ניהול · API ומפתחות" subtitle="מפתחות שמערכות אחרות משתמשות בהם כדי לקרוא מה-API של המערכת הזו" />
      <AdminTabs />

      <div className="flex flex-col gap-8">
        <Card title="מפתח חדש">
          <p className="mb-4 text-sm text-muted">
            המפתח מוצג פעם אחת בלבד, מיד אחרי היצירה. במערכת נשמר רק טביעת אצבע (hash) שלו, ולכן אי אפשר לשחזר מפתח שאבד: יוצרים חדש ומבטלים את
            הישן. המפתח נשלח בכותרת <code dir="ltr">Authorization: Bearer</code>, ונותן גישה רק לנתיבים של ההרשאות שנבחרו. פירוט הנתיבים ב
            <Link href="/api-docs" className="font-medium text-accent-dark underline underline-offset-4">
              תיעוד ה-API
            </Link>
            .
          </p>
          <CreateKeyForm staffScopes={auth.user.staffManager} />
        </Card>

        <Card title="מפתחות">
          <Table
            head={["שם", "מפתח", "הרשאות", "נוצר", "תפוגה", "שימוש אחרון", "קריאות (30 יום)", "מצב", ""]}
            empty={keys.length === 0 ? "עוד לא נוצרו מפתחות" : undefined}
            caption="מפתחות API"
          >
            {keys.map((k) => {
              const expired = Boolean(k.expiresAt && k.expiresAt.getTime() <= now);
              return (
                <tr key={k.id}>
                  <td className="px-3 py-2 font-medium" dir="auto">
                    <Link href={`/admin/api/${k.id}`} className="text-accent-dark underline underline-offset-4">
                      {k.name}
                    </Link>
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 font-mono text-xs" dir="ltr">
                    {KEY_PREFIX}
                    {k.prefix}…
                  </td>
                  <td className="px-3 py-2">
                    <Scopes scopes={k.scopes} />
                  </td>
                  <td className="px-3 py-2 text-xs">
                    <span className="whitespace-nowrap">{formatDateTime(k.createdAt)}</span>
                    <span className="block text-muted" dir="ltr">
                      {k.createdBy}
                    </span>
                  </td>
                  <td className="whitespace-nowrap px-3 py-2">{k.expiresAt ? formatDateTime(k.expiresAt) : "ללא"}</td>
                  <td className="px-3 py-2 text-xs">
                    <span className="whitespace-nowrap">{formatDateTime(k.lastUsedAt)}</span>
                    {k.lastUsedIp ? (
                      <span className="block text-muted" dir="ltr">
                        {k.lastUsedIp}
                      </span>
                    ) : null}
                  </td>
                  <td className="px-3 py-2">
                    <Calls usage={callsOf.get(k.id)} href={`/admin/api/${k.id}`} name={k.name} />
                  </td>
                  <td className="px-3 py-2">
                    {k.revokedAt ? <Badge>בוטל</Badge> : expired ? <Badge tone="warning">פג תוקף</Badge> : <Badge tone="success">פעיל</Badge>}
                  </td>
                  <td className="px-3 py-2 text-end">
                    {k.revokedAt ? (
                      <span className="text-xs text-muted">{formatDateTime(k.revokedAt)}</span>
                    ) : (
                      <form action={revokeApiKey}>
                        <input type="hidden" name="id" value={k.id} />
                        <button className={buttonClass("danger", "sm")}>
                          ביטול<span className="sr-only"> המפתח {k.name}</span>
                        </button>
                      </form>
                    )}
                  </td>
                </tr>
              );
            })}
          </Table>
        </Card>

        <Card title="שרת MCP (Claude וכלי AI)">
          <p className="mb-4 text-sm text-muted">
            חיבור MCP לא צריך מפתח מכאן: כל משתמש מתחבר עם חשבון Google שלו ומקבל את ההרשאות שלו במערכת. החיבורים הפעילים וניתוקם ב
            <Link href="/admin/mcp" className="font-medium text-accent-dark underline underline-offset-4">
              חיבורי MCP
            </Link>
            , והפירוט המלא ב
            <Link href="/api-docs" className="font-medium text-accent-dark underline underline-offset-4">
              תיעוד ה-API
            </Link>
            .
          </p>
          <McpConnectInfo />
        </Card>

        <Card title="מפתחות מהגדרות השרת (env)">
          <p className="mb-4 text-sm text-muted">
            טוקנים משותפים שהוגדרו כמשתני סביבה סודיים ב-xhostd לפני שהמפתחות עברו לכאן. הם ממשיכים לעבוד כמפתחות עם ההרשאות שבטבלה, ואי אפשר
            לבטל אותם מכאן: מבטלים אותם במחיקת המשתנה בשרת.
          </p>
          <Table head={["משתנה", "הרשאות", "תפקיד", "קריאות (30 יום)", "מצב"]} caption="מפתחות מהגדרות השרת">
            {LEGACY_KEYS.map((k) => (
              <tr key={k.env}>
                <td className="px-3 py-2 font-mono text-xs" dir="ltr">
                  {k.env}
                </td>
                <td className="px-3 py-2">
                  <Scopes scopes={k.scopes} />
                </td>
                <td className="px-3 py-2 text-sm">
                  <span className="block text-xs text-muted">מפתח מהגדרות השרת (env)</span>
                  {k.note}
                </td>
                <td className="px-3 py-2">
                  <Calls usage={callsOf.get(`env:${k.env}`)} href={`/admin/api/env:${k.env}`} name={k.env} />
                </td>
                <td className="px-3 py-2">{configured.has(k.env) ? <Badge tone="success">מוגדר</Badge> : <Badge>לא מוגדר</Badge>}</td>
              </tr>
            ))}
          </Table>
        </Card>
      </div>
    </>
  );
}

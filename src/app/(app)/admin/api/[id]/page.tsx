import { and, desc, eq, getTableColumns, gte, sql } from "drizzle-orm";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge, Card, formatDateTime, PageHeader, Table } from "@/components/ui";
import { KEY_PREFIX, LEGACY_KEYS } from "@/lib/api/spec";
import { legacyKeyName } from "@/lib/api/keys";
import { pageAuth } from "@/lib/auth/guard";
import { getDb } from "@/lib/db/client";
import { apiCalls, apiKeys } from "@/lib/db/schema";
import { AdminTabs } from "../../AdminTabs";

export const metadata: Metadata = { title: "יומן מפתח API" };
export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-f-]{36}$/i;
const PAGE = 100;
const STATUS = ["all", "ok", "error"] as const;
type StatusFilter = (typeof STATUS)[number];

const fmt = (n: number) => n.toLocaleString("he-IL");

/** One API key: what it is, how much it is used, and every call made with it (api_calls). Admins only. */
export default async function ApiKeyLogPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ page?: string; status?: string }> }) {
  const [{ id: raw }, q] = await Promise.all([params, searchParams]);
  const id = decodeURIComponent(raw);
  const auth = await pageAuth("admin", `/admin/api/${raw}`);
  if (!auth.ok) return auth.render;

  const legacy = id.startsWith("env:") ? LEGACY_KEYS.find((k) => `env:${k.env}` === id) : null;
  if (!legacy && !UUID_RE.test(id)) notFound();
  const db = getDb();
  const { hash: _hash, ...shown } = getTableColumns(apiKeys);
  const [key] = legacy ? [null] : await db.select(shown).from(apiKeys).where(eq(apiKeys.id, id)).limit(1);
  if (!legacy && !key) notFound();

  const page = Math.max(1, Math.min(1000, Number(q.page) || 1));
  const status: StatusFilter = STATUS.includes(q.status as StatusFilter) ? (q.status as StatusFilter) : "all";
  const byStatus = status === "ok" ? sql`${apiCalls.status} < 400` : status === "error" ? sql`${apiCalls.status} >= 400` : undefined;
  const mine = eq(apiCalls.keyId, id);

  const [[totals], endpoints, calls, [{ n: filtered } = { n: 0 }]] = await Promise.all([
    db
      .select({
        day: sql<number>`(count(*) FILTER (WHERE ${apiCalls.at} > now() - interval '1 day'))::int`,
        week: sql<number>`(count(*) FILTER (WHERE ${apiCalls.at} > now() - interval '7 days'))::int`,
        month: sql<number>`(count(*) FILTER (WHERE ${apiCalls.at} > now() - interval '30 days'))::int`,
        all: sql<number>`count(*)::int`,
        errors: sql<number>`(count(*) FILTER (WHERE ${apiCalls.status} >= 400 AND ${apiCalls.at} > now() - interval '30 days'))::int`,
        first: sql<Date | null>`min(${apiCalls.at})`.mapWith(apiCalls.at),
      })
      .from(apiCalls)
      .where(mine),
    db
      .select({
        path: sql<string>`split_part(${apiCalls.path}, '?', 1)`,
        calls: sql<number>`count(*)::int`,
        errors: sql<number>`(count(*) FILTER (WHERE ${apiCalls.status} >= 400))::int`,
        avgMs: sql<number>`round(avg(${apiCalls.ms}))::int`,
        last: sql<Date>`max(${apiCalls.at})`.mapWith(apiCalls.at),
      })
      .from(apiCalls)
      .where(and(mine, gte(apiCalls.at, sql`now() - interval '30 days'`)))
      .groupBy(sql`1`)
      .orderBy(desc(sql`2`)),
    db
      .select()
      .from(apiCalls)
      .where(and(mine, byStatus))
      .orderBy(desc(apiCalls.at))
      .limit(PAGE)
      .offset((page - 1) * PAGE),
    db.select({ n: sql<number>`count(*)::int` }).from(apiCalls).where(and(mine, byStatus)),
  ]);

  const name = legacy ? legacyKeyName(legacy.env) : key!.name;
  const scopes = legacy ? legacy.scopes : key!.scopes;
  const pages = Math.max(1, Math.ceil(filtered / PAGE));
  const href = (p: number, st: StatusFilter = status) => `/admin/api/${raw}?${new URLSearchParams({ ...(st !== "all" ? { status: st } : {}), ...(p > 1 ? { page: String(p) } : {}) })}`;

  return (
    <>
      <PageHeader title={`ניהול · מפתח API · ${name}`} subtitle="כל הקריאות שבוצעו עם המפתח: מתי, לאיזה נתיב, מה נענה ומאיפה" />
      <AdminTabs />
      <p className="mb-6">
        <Link href="/admin/api" className="text-sm font-medium text-accent-dark underline underline-offset-4">
          חזרה לרשימת המפתחות
        </Link>
      </p>

      <div className="flex flex-col gap-8">
        <Card title="המפתח">
          <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-[auto_1fr]">
            <dt className="text-muted">מפתח</dt>
            <dd className="font-mono text-xs" dir="ltr">
              {legacy ? `${legacy.env} (env)` : `${KEY_PREFIX}${key!.prefix}…`}
            </dd>
            <dt className="text-muted">הרשאות</dt>
            <dd className="flex flex-wrap gap-1" dir="ltr">
              {scopes.map((sc) => (
                <span key={sc} className="rounded-full bg-white px-2 py-0.5 font-mono text-xs ring-1 ring-line">
                  {sc}
                </span>
              ))}
            </dd>
            {key ? (
              <>
                <dt className="text-muted">נוצר</dt>
                <dd>
                  {formatDateTime(key.createdAt)} · <span dir="ltr">{key.createdBy}</span>
                </dd>
                <dt className="text-muted">תפוגה</dt>
                <dd>{key.expiresAt ? formatDateTime(key.expiresAt) : "ללא"}</dd>
                <dt className="text-muted">מצב</dt>
                <dd>
                  {key.revokedAt ? (
                    <Badge>בוטל {formatDateTime(key.revokedAt)}</Badge>
                  ) : key.expiresAt && key.expiresAt.getTime() <= Date.now() ? (
                    <Badge tone="warning">פג תוקף</Badge>
                  ) : (
                    <Badge tone="success">פעיל</Badge>
                  )}
                </dd>
              </>
            ) : (
              <>
                <dt className="text-muted">מקור</dt>
                <dd>{legacy!.note}</dd>
              </>
            )}
          </dl>
        </Card>

        <Card title="שימוש">
          <dl className="grid grid-cols-2 gap-4 sm:grid-cols-5">
            {[
              ["24 שעות", totals?.day ?? 0],
              ["7 ימים", totals?.week ?? 0],
              ["30 יום", totals?.month ?? 0],
              ["שגיאות (30 יום)", totals?.errors ?? 0],
              ["מאז שנרשם", totals?.all ?? 0],
            ].map(([label, n]) => (
              <div key={label as string}>
                <dt className="text-sm text-muted">{label}</dt>
                <dd className="text-3xl font-bold tabular-nums">{fmt(n as number)}</dd>
              </div>
            ))}
          </dl>
          <p className="mt-3 text-xs text-muted">
            נרשם מ-{formatDateTime(totals?.first ?? null)}. היומן נשמר 24 חודשים. קריאות בלי מפתח תקין לא נרשמות כאן אלא ביומן הפעילות (api.denied).
          </p>
          <h3 className="mb-2 mt-6 text-base font-bold">לפי נתיב (30 יום)</h3>
          <Table head={["נתיב", "קריאות", "שגיאות", "זמן ממוצע", "אחרונה"]} empty={endpoints.length ? undefined : "אין קריאות ב-30 הימים האחרונים"}>
            {endpoints.map((e) => (
              <tr key={e.path}>
                <td className="px-3 py-2 font-mono text-xs" dir="ltr">
                  {e.path}
                </td>
                <td className="px-3 py-2 tabular-nums">{fmt(e.calls)}</td>
                <td className="px-3 py-2 tabular-nums">{e.errors ? <span className="text-danger">{fmt(e.errors)}</span> : "0"}</td>
                <td className="px-3 py-2 tabular-nums">{e.avgMs == null ? "—" : `${fmt(e.avgMs)} ms`}</td>
                <td className="whitespace-nowrap px-3 py-2 text-sm">{formatDateTime(e.last)}</td>
              </tr>
            ))}
          </Table>
        </Card>

        <Card title="יומן קריאות">
          <nav aria-label="סינון לפי תשובה" className="mb-4 flex flex-wrap gap-2">
            {(
              [
                ["all", "הכול"],
                ["ok", "הצליחו"],
                ["error", "שגיאות"],
              ] as const
            ).map(([st, label]) => (
              <Link
                key={st}
                href={href(1, st)}
                aria-current={st === status ? "page" : undefined}
                className={`rounded-full px-4 py-1.5 text-sm font-medium ${st === status ? "bg-accent text-white" : "bg-panel text-ink hover:bg-accent/10"}`}
              >
                {label}
              </Link>
            ))}
          </nav>
          <Table head={["זמן", "נתיב", "תשובה", "כתובת", "משך"]} empty={calls.length ? undefined : "אין קריאות"} caption="יומן הקריאות של המפתח">
            {calls.map((c) => (
              <tr key={c.id}>
                <td className="whitespace-nowrap px-3 py-2 text-sm">{formatDateTime(c.at)}</td>
                <td className="px-3 py-2 font-mono text-xs" dir="ltr">
                  {c.method} {c.path}
                </td>
                <td className="px-3 py-2">
                  <Badge tone={c.status < 400 ? "success" : c.status === 429 ? "warning" : "neutral"}>{c.status}</Badge>
                </td>
                <td className="px-3 py-2 font-mono text-xs" dir="ltr">
                  {c.ip ?? "—"}
                </td>
                <td className="px-3 py-2 tabular-nums text-sm">{c.ms == null ? "—" : `${fmt(c.ms)} ms`}</td>
              </tr>
            ))}
          </Table>
          {pages > 1 ? (
            <nav aria-label="עמודים" className="mt-4 flex flex-wrap items-center gap-3 text-sm">
              {page > 1 ? (
                <Link href={href(page - 1)} className="text-accent-dark underline underline-offset-4">
                  הקודם
                </Link>
              ) : null}
              <span>
                עמוד {fmt(page)} מתוך {fmt(pages)} · {fmt(filtered)} קריאות
              </span>
              {page < pages ? (
                <Link href={href(page + 1)} className="text-accent-dark underline underline-offset-4">
                  הבא
                </Link>
              ) : null}
            </nav>
          ) : null}
        </Card>
      </div>
    </>
  );
}

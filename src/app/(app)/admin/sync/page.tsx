import { asc, desc, isNull } from "drizzle-orm";
import type { Metadata } from "next";
import { Badge, buttonClass, Card, formatDateTime, PageHeader, Table } from "@/components/ui";
import { pageAuth } from "@/lib/auth/guard";
import { getDb } from "@/lib/db/client";
import { syncRequests, syncRuns, syncState } from "@/lib/db/schema";
import { AdminTabs } from "../AdminTabs";
import { requestSync } from "./actions";

export const metadata: Metadata = { title: "סנכרון" };

const MODE_LABELS: Record<string, string> = {
  incremental: "עדכונים",
  full: "טעינה מלאה",
  reconcile: "התאמה לילית",
  marketing: "Google ו-SMOOV",
};

function duration(start: Date, end: Date | null): string {
  if (!end) return "רץ…";
  const s = Math.round((end.getTime() - start.getTime()) / 1000);
  return s < 60 ? `${s} שנ׳` : `${Math.floor(s / 60)} דק׳ ${s % 60} שנ׳`;
}

export default async function SyncPage() {
  const auth = await pageAuth("admin", "/admin/sync");
  if (!auth.ok) return auth.render;

  const db = getDb();
  const [states, runs, pending] = await Promise.all([
    db.select().from(syncState).orderBy(asc(syncState.object)),
    db.select().from(syncRuns).orderBy(desc(syncRuns.startedAt)).limit(40),
    db.select().from(syncRequests).where(isNull(syncRequests.doneAt)).orderBy(asc(syncRequests.requestedAt)),
  ]);
  const workerOn = process.env.SYNC_WORKER === "true";

  return (
    <>
      <PageHeader title="ניהול · סנכרון" subtitle="סנכרון Salesforce לבסיס הנתונים המקומי (קריאה בלבד)" />
      <AdminTabs />

      <div className="flex flex-col gap-8">
        <Card title="פעולות">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <p className="text-sm text-muted">
              {workerOn ? (
                <>
                  Salesforce מתעדכן כל {process.env.SYNC_INTERVAL_MIN ?? 10} דקות (והתאמה מלאה פעם בלילה); Google ו-SMOOV כל{" "}
                  {Math.round(Number(process.env.MARKETING_SYNC_INTERVAL_MIN ?? 360) / 60)} שעות. בקשה ידנית תתחיל תוך דקה.
                </>
              ) : (
                <>תהליך הסנכרון כבוי בשרת הזה (SYNC_WORKER).</>
              )}
            </p>
            <div className="flex flex-wrap gap-2">
              <form action={requestSync}>
                <input type="hidden" name="mode" value="incremental" />
                <button className={buttonClass("primary")} disabled={!workerOn}>
                  סנכרון עכשיו
                </button>
              </form>
              <form action={requestSync}>
                <input type="hidden" name="mode" value="full" />
                <button className={buttonClass("secondary")} disabled={!workerOn}>
                  טעינה מלאה
                </button>
              </form>
              <form action={requestSync}>
                <input type="hidden" name="mode" value="marketing" />
                <button className={buttonClass("secondary")} disabled={!workerOn}>
                  Google ו-SMOOV
                </button>
              </form>
            </div>
          </div>
          {pending.length ? (
            <p className="mt-4 text-sm">
              {pending.map((p) => (
                <Badge key={p.id} tone="warning">
                  {MODE_LABELS[p.mode] ?? p.mode}: {p.pickedAt ? "רץ עכשיו" : "ממתין"}
                </Badge>
              ))}
            </p>
          ) : null}
        </Card>

        <Card title="מצב לפי אובייקט">
          <Table
            head={["אובייקט", "רשומות", "עדכון אחרון", "סמן", "שגיאה"]}
            empty={states.length === 0 ? "עוד לא רץ סנכרון" : undefined}
          >
            {states.map((s) => (
              <tr key={s.object}>
                <td className="px-3 py-2 font-medium" dir="ltr">
                  {s.object}
                </td>
                <td className="px-3 py-2">{s.rowCount?.toLocaleString("he-IL") ?? "—"}</td>
                <td className="px-3 py-2">{formatDateTime(s.lastSuccessAt)}</td>
                <td className="px-3 py-2 text-xs text-muted">{formatDateTime(s.cursor)}</td>
                <td className="px-3 py-2 text-xs">
                  {s.lastError ? (
                    <span className="text-danger" dir="ltr">
                      {s.lastError.slice(0, 160)}
                    </span>
                  ) : (
                    <Badge tone="success">תקין</Badge>
                  )}
                </td>
              </tr>
            ))}
          </Table>
        </Card>

        <Card title="ריצות אחרונות" tone="accent-light">
          <Table head={["התחלה", "אובייקט", "סוג", "נוספו/עודכנו", "נמחקו", "משך", "הערה"]} empty={runs.length === 0 ? "אין ריצות" : undefined}>
            {runs.map((r) => (
              <tr key={r.id}>
                <td className="whitespace-nowrap px-3 py-2">{formatDateTime(r.startedAt)}</td>
                <td className="px-3 py-2" dir="ltr">
                  {r.object}
                </td>
                <td className="px-3 py-2">{MODE_LABELS[r.mode] ?? r.mode}</td>
                <td className="px-3 py-2">{r.upserted?.toLocaleString("he-IL") ?? "—"}</td>
                <td className="px-3 py-2">{r.deleted ?? "—"}</td>
                <td className="px-3 py-2">{duration(r.startedAt, r.finishedAt)}</td>
                <td className="px-3 py-2 text-xs text-muted" dir="ltr">
                  {r.error ? r.error.slice(0, 120) : r.trigger}
                </td>
              </tr>
            ))}
          </Table>
        </Card>
      </div>
    </>
  );
}

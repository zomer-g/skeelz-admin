import { asc, desc, isNull } from "drizzle-orm";
import type { Metadata } from "next";
import type { ReactNode } from "react";
import { Badge, buttonClass, Card, formatDateTime, PageHeader, Table } from "@/components/ui";
import { pageAuth } from "@/lib/auth/guard";
import { getDb } from "@/lib/db/client";
import { syncRequests, syncRuns, syncState } from "@/lib/db/schema";
import { marketingGroupConfigured } from "@/lib/integrations/marketing-sync";
import { salesforceConfigured } from "@/lib/sf/client";
import { mondayConfigured, staffSourceStatus } from "@/lib/staff/monday";
import { groupRuns, OBJECT_LABELS, SOURCE_LABELS, sourceOf, sourcesOfRequest, triggerLabel, type SourceId } from "@/lib/sync/sources";
import { SyncButton as MondaySyncButton } from "../../staff/SyncButton";
import { AdminTabs } from "../AdminTabs";
import { requestSync } from "./actions";

export const metadata: Metadata = { title: "סנכרון" };

const KIND_LABELS: Record<string, string> = {
  incremental: "עדכון",
  full: "טעינה מלאה",
  reconcile: "התאמה לילית",
  marketing: "עדכון",
  staff: "עדכון",
};

/** One SF incremental writes a row per object (about a dozen): enough rows for 40 log entries. */
const LOG_ENTRIES = 40;
const LOG_ROWS = 800;

interface ObjectState {
  object: string;
  rowCount: number | null;
  lastSuccessAt: Date | null;
  lastError: string | null;
}

function duration(start: Date, end: Date | null): string {
  if (!end) return "רץ…";
  const s = Math.round((end.getTime() - start.getTime()) / 1000);
  return s < 60 ? `${s} שנ׳` : `${Math.floor(s / 60)} דק׳ ${s % 60} שנ׳`;
}

function latest(dates: (Date | null)[]): Date | null {
  return dates.reduce<Date | null>((a, d) => (d && (!a || d > a) ? d : a), null);
}

function ErrorText({ text }: { text: string }) {
  return (
    <span className="text-danger" dir="ltr">
      {text.slice(0, 160)}
    </span>
  );
}

function ObjectName({ object }: { object: string }) {
  return (
    <>
      {OBJECT_LABELS[object] ?? object}{" "}
      <span className="text-xs text-muted" dir="ltr">
        {object}
      </span>
    </>
  );
}

function QueueButton({ mode, label, variant, disabled, source }: { mode: string; label: string; variant: "primary" | "secondary"; disabled: boolean; source: string }) {
  return (
    <form action={requestSync}>
      <input type="hidden" name="mode" value={mode} />
      <button className={buttonClass(variant, "sm")} disabled={disabled}>
        {label}
        <span className="sr-only"> · {source}</span>
      </button>
    </form>
  );
}

/** A source: when it last completed, how often it runs, its refresh button, and its objects when it has several. */
function SourceCard({
  id,
  configured,
  schedule,
  objects,
  pending,
  actions,
}: {
  id: SourceId;
  configured: boolean;
  schedule: string;
  objects: ObjectState[];
  pending: string | null;
  actions: ReactNode;
}) {
  const failed = objects.filter((o) => o.lastError);
  return (
    <Card title={SOURCE_LABELS[id]}>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <dl className="grid gap-1 text-sm sm:grid-cols-[auto_1fr] sm:gap-x-4">
          <dt className="text-muted">עדכון אחרון שהושלם</dt>
          <dd className="font-medium">{formatDateTime(latest(objects.map((o) => o.lastSuccessAt)))}</dd>
          <dt className="text-muted">מצב</dt>
          <dd className="flex flex-wrap gap-2">
            {!configured ? (
              <Badge>לא הוגדר</Badge>
            ) : failed.length ? (
              <span className="text-danger">שגיאה ב-{failed.map((o) => OBJECT_LABELS[o.object] ?? o.object).join(", ")}</span>
            ) : (
              <Badge tone="success">תקין</Badge>
            )}
            {pending ? <Badge tone="warning">{pending}</Badge> : null}
          </dd>
          <dt className="text-muted">תזמון</dt>
          <dd>{schedule}</dd>
        </dl>
        {configured ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
      </div>

      {objects.length > 1 ? (
        <div className="mt-4">
          <Table head={["אובייקט", "רשומות", "עדכון אחרון", "מצב"]} caption={`האובייקטים של ${SOURCE_LABELS[id]}`}>
            {objects.map((o) => (
              <tr key={o.object}>
                <td className="px-3 py-2 font-medium">
                  <ObjectName object={o.object} />
                </td>
                <td className="px-3 py-2">{o.rowCount?.toLocaleString("he-IL") ?? "—"}</td>
                <td className="whitespace-nowrap px-3 py-2">{formatDateTime(o.lastSuccessAt)}</td>
                <td className="px-3 py-2 text-xs">{o.lastError ? <ErrorText text={o.lastError} /> : <Badge tone="success">תקין</Badge>}</td>
              </tr>
            ))}
          </Table>
        </div>
      ) : objects[0]?.lastError ? (
        <p className="mt-3 text-sm">
          <ErrorText text={objects[0].lastError} />
        </p>
      ) : null}
    </Card>
  );
}

export default async function SyncPage() {
  const auth = await pageAuth("admin", "/admin/sync");
  if (!auth.ok) return auth.render;

  const db = getDb();
  const [states, runRows, requests, monday] = await Promise.all([
    db.select().from(syncState).orderBy(asc(syncState.object)),
    db.select().from(syncRuns).orderBy(desc(syncRuns.startedAt)).limit(LOG_ROWS),
    db.select().from(syncRequests).where(isNull(syncRequests.doneAt)).orderBy(asc(syncRequests.requestedAt)),
    // Kept apart from sync_state (which MCP's sync_status reads); docs/staff.md.
    staffSourceStatus(),
  ]);
  const workerOn = process.env.SYNC_WORKER === "true";
  const log = groupRuns(runRows, LOG_ENTRIES);

  const objectsOf = (id: SourceId): ObjectState[] => states.filter((s) => sourceOf(s.object) === id);
  const pendingOf = (id: SourceId): string | null => {
    const r = requests.find((q) => sourcesOfRequest(q.mode).includes(id));
    return r ? (r.pickedAt ? "רץ עכשיו" : "ממתין לתור") : null;
  };
  const off = !workerOn;
  const every = (min: number) => (min % 60 === 0 ? `כל ${min / 60 === 1 ? "שעה" : `${min / 60} שעות`}` : `כל ${min} דקות`);
  const sfMin = Number(process.env.SYNC_INTERVAL_MIN ?? 10);
  const marketingMin = Number(process.env.MARKETING_SYNC_INTERVAL_MIN ?? 360);
  const mondayMin = Number(process.env.STAFF_SYNC_INTERVAL_MIN ?? 60);
  const gtmShown = marketingGroupConfigured("GTM") || objectsOf("gtm").length > 0;

  return (
    <>
      <PageHeader title="ניהול · סנכרון" subtitle="כל מקורות הנתונים שהמערכת קוראת, מתי כל אחד עודכן, ויומן העדכונים" />
      <AdminTabs />

      <div className="flex flex-col gap-8">
        <p className="text-sm text-muted">
          {workerOn ? (
            <>כפתור עדכון שולח בקשה לתהליך הסנכרון, והיא מתחילה תוך דקה. Salesforce נשאר לקריאה בלבד.</>
          ) : (
            <>תהליך הסנכרון כבוי בשרת הזה (SYNC_WORKER), ולכן אי אפשר לבקש עדכון מכאן.</>
          )}
        </p>

        <SourceCard
          id="salesforce"
          configured={salesforceConfigured()}
          schedule={`${every(sfMin)}, והתאמה מלאה פעם בלילה`}
          objects={objectsOf("salesforce")}
          pending={pendingOf("salesforce")}
          actions={
            <>
              <QueueButton mode="incremental" label="עדכון" variant="primary" disabled={off} source="Salesforce" />
              <QueueButton mode="full" label="טעינה מלאה" variant="secondary" disabled={off} source="Salesforce" />
            </>
          }
        />

        <SourceCard
          id="ga"
          configured={marketingGroupConfigured("GA4")}
          schedule={every(marketingMin)}
          objects={objectsOf("ga")}
          pending={pendingOf("ga")}
          actions={<QueueButton mode="marketing:GA4" label="עדכון" variant="primary" disabled={off} source="Google Analytics" />}
        />

        {gtmShown ? (
          <SourceCard
            id="gtm"
            configured={marketingGroupConfigured("GTM")}
            schedule={every(marketingMin)}
            objects={objectsOf("gtm")}
            pending={pendingOf("gtm")}
            actions={<QueueButton mode="marketing:GTM" label="עדכון" variant="primary" disabled={off} source="Google Tag Manager" />}
          />
        ) : null}

        <SourceCard
          id="smoov"
          configured={marketingGroupConfigured("SMOOV")}
          schedule={`רשימות וקמפיינים ${every(marketingMin)}; הדחיפה לרשימה פעמיים ביום (בעדכון ידני היא רצה מיד)`}
          objects={objectsOf("smoov")}
          pending={pendingOf("smoov")}
          actions={<QueueButton mode="marketing:SMOOV" label="עדכון" variant="primary" disabled={off} source="SMOOV" />}
        />

        <SourceCard
          id="monday"
          configured={mondayConfigured()}
          schedule={every(mondayMin)}
          objects={
            monday || mondayConfigured()
              ? [{ object: "monday", rowCount: monday?.items ?? null, lastSuccessAt: monday?.lastSuccessAt ?? null, lastError: monday?.lastError ?? null }]
              : []
          }
          pending={null}
          actions={
            // Runs here and now, not through the worker; only staff managers may pull the hours.
            auth.user.staffManager ? <MondaySyncButton /> : <p className="text-xs text-muted">עדכון ידני של מאנדיי זמין למנהלי עובדים.</p>
          }
        />

        <Card title="יומן עדכונים" tone="accent-light">
          <Table
            head={["זמן", "מקור", "סוג", "הופעל על ידי", "רשומות", "משך", "מצב ופרטים"]}
            empty={log.length === 0 ? "עוד לא רץ עדכון" : undefined}
          >
            {log.map((g) => (
              <tr key={g.id}>
                <td className="whitespace-nowrap px-3 py-2">{formatDateTime(g.startedAt)}</td>
                <td className="whitespace-nowrap px-3 py-2 font-medium">{SOURCE_LABELS[g.source]}</td>
                <td className="whitespace-nowrap px-3 py-2">{KIND_LABELS[g.mode] ?? g.mode}</td>
                <td className="px-3 py-2 text-xs">{triggerLabel(g.trigger)}</td>
                <td className="px-3 py-2">
                  {g.upserted.toLocaleString("he-IL")}
                  {g.deleted ? <span className="text-xs text-muted"> · {g.deleted.toLocaleString("he-IL")} נמחקו</span> : null}
                </td>
                <td className="whitespace-nowrap px-3 py-2">{duration(g.startedAt, g.finishedAt)}</td>
                <td className="px-3 py-2 text-xs">
                  {!g.finishedAt ? (
                    <Badge tone="warning">רץ עכשיו</Badge>
                  ) : g.failed.length ? (
                    <span className="text-danger">נכשל: {g.failed.map((o) => OBJECT_LABELS[o] ?? o).join(", ")}</span>
                  ) : (
                    <Badge tone="success">הושלם</Badge>
                  )}
                  <details className="mt-1">
                    <summary className="cursor-pointer text-muted">
                      {g.runs.length === 1 ? "פרטים" : `${g.runs.length} אובייקטים`}
                    </summary>
                    <ul className="mt-1 flex flex-col gap-1">
                      {g.runs.map((r) => (
                        <li key={r.id}>
                          <ObjectName object={r.object} />: {r.upserted?.toLocaleString("he-IL") ?? "—"}
                          {r.error ? (
                            <>
                              {" "}
                              <ErrorText text={r.error} />
                            </>
                          ) : r.note ? (
                            <span className="block text-muted" dir="ltr">
                              {r.note}
                            </span>
                          ) : null}
                        </li>
                      ))}
                    </ul>
                  </details>
                </td>
              </tr>
            ))}
          </Table>
        </Card>
      </div>
    </>
  );
}

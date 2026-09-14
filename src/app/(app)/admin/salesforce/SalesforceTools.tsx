"use client";

import { useActionState } from "react";
import { Badge, buttonClass } from "@/components/ui";
import { generateSchemaReport, testSalesforceConnection, type ConnectionState, type ReportState } from "./actions";

export function SalesforceTools({ configured }: { configured: boolean }) {
  const [conn, testAction, testing] = useActionState<ConnectionState, FormData>(testSalesforceConnection, null);
  const [report, reportAction, reporting] = useActionState<ReportState, FormData>(generateSchemaReport, null);

  return (
    <div className="flex flex-col gap-8">
      <section className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="font-medium">בדיקת חיבור</h3>
            <p className="text-sm text-muted">מבקש אסימון גישה ובודק הרשאת קריאה ל-Account, Contact ו-Case.</p>
          </div>
          <form action={testAction}>
            <button type="submit" disabled={!configured || testing} className={buttonClass("secondary")}>
              {testing ? "בודק…" : "בדיקת חיבור"}
            </button>
          </form>
        </div>

        {conn && !conn.ok ? (
          <p role="status" className="rounded-card bg-danger-soft/40 px-4 py-3 text-sm text-danger" dir="auto">
            {conn.message}
          </p>
        ) : null}

        {conn && conn.ok ? (
          <div role="status" className="rounded-card bg-white p-4 text-sm ring-1 ring-line">
            <p className="mb-3 flex flex-wrap items-center gap-2">
              <Badge tone="success">החיבור תקין</Badge>
              <span dir="ltr" className="text-muted">
                {conn.instanceUrl} · {conn.ms}ms
              </span>
              {conn.runAs ? (
                <span className="text-muted">
                  · פועל בשם <span dir="ltr">{conn.runAs}</span>
                </span>
              ) : null}
              {conn.apiVersionAvailable === false ? (
                <Badge tone="warning">גרסת API {conn.apiVersion} לא זמינה</Badge>
              ) : null}
              {conn.apiUsage ? (
                <span className="text-muted">
                  · API היום: {conn.apiUsage.used.toLocaleString("he-IL")} / {conn.apiUsage.max.toLocaleString("he-IL")}
                </span>
              ) : null}
            </p>
            <ul className="divide-y divide-line">
              {conn.objects.map((o) => (
                <li key={o.name} className="flex flex-wrap items-center justify-between gap-2 py-2">
                  <span className="font-medium" dir="ltr">
                    {o.name}
                  </span>
                  {o.ok ? (
                    <span>{o.count?.toLocaleString("he-IL")} רשומות</span>
                  ) : (
                    <span className="text-danger" dir="ltr">
                      {o.error}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </section>

      <section className="flex flex-col gap-4 border-t-2 border-line pt-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="font-medium">דו״ח מבנה נתונים</h3>
            <p className="text-sm text-muted">
              סוגי Case, שדה קישור המשרה, שדות היסטוריה, שדות ורשימות בחירה. קריאה בלבד, עד דקה.
            </p>
          </div>
          <form action={reportAction}>
            <button type="submit" disabled={!configured || reporting} className={buttonClass("primary")}>
              {reporting ? "מפיק דו״ח…" : "הפקת דו״ח"}
            </button>
          </form>
        </div>
        {report ? (
          <p role="status" className={`text-sm ${report.ok ? "text-success" : "text-danger"}`} dir="auto">
            {report.message}
          </p>
        ) : null}
      </section>
    </div>
  );
}

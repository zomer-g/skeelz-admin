import { desc } from "drizzle-orm";
import type { Metadata } from "next";
import { Badge, Card, formatDateTime, PageHeader } from "@/components/ui";
import { pageAuth } from "@/lib/auth/guard";
import { getDb } from "@/lib/db/client";
import { sfSchemaReports } from "@/lib/db/schema";
import { salesforceConfigured } from "@/lib/sf/client";
import { AdminTabs } from "../AdminTabs";
import { SalesforceTools } from "./SalesforceTools";

export const metadata: Metadata = { title: "Salesforce" };

export default async function SalesforcePage() {
  const auth = await pageAuth("admin", "/admin/salesforce");
  if (!auth.ok) return auth.render;

  const configured = salesforceConfigured();
  // Values are never shown except the login URL, which is not a secret.
  const env = [
    { key: "SF_LOGIN_URL", set: Boolean(process.env.SF_LOGIN_URL), shown: process.env.SF_LOGIN_URL },
    { key: "SF_CLIENT_ID", set: Boolean(process.env.SF_CLIENT_ID) },
    { key: "SF_CLIENT_SECRET", set: Boolean(process.env.SF_CLIENT_SECRET) },
  ];

  const [last] = await getDb()
    .select({
      id: sfSchemaReports.id,
      createdAt: sfSchemaReports.createdAt,
      createdBy: sfSchemaReports.createdBy,
      markdown: sfSchemaReports.markdown,
    })
    .from(sfSchemaReports)
    .orderBy(desc(sfSchemaReports.createdAt))
    .limit(1);

  return (
    <>
      <PageHeader title="ניהול" subtitle="חיבור Salesforce (קריאה בלבד)" />
      <AdminTabs />

      <div className="flex flex-col gap-8">
        <Card title="הגדרות">
          <ul className="divide-y divide-line">
            {env.map((e) => (
              <li key={e.key} className="flex flex-wrap items-center justify-between gap-3 py-2">
                <span className="font-mono text-sm" dir="ltr">
                  {e.key}
                </span>
                <span className="flex items-center gap-2">
                  {e.shown ? (
                    <span className="text-sm text-muted" dir="ltr">
                      {e.shown}
                    </span>
                  ) : null}
                  {e.set ? <Badge tone="success">הוגדר</Badge> : <Badge>חסר</Badge>}
                </span>
              </li>
            ))}
          </ul>
          <p className="mt-4 text-xs text-muted">
            את SF_CLIENT_ID ו-SF_CLIENT_SECRET מגדירים כ-Secret בקונסולת xhostd. שינוי משתני סביבה נכנס לתוקף רק אחרי פריסה מחדש.
          </p>
        </Card>

        <Card title="כלים">
          <SalesforceTools configured={configured} />
        </Card>

        <Card title="דו״ח אחרון" tone="accent-light">
          {last ? (
            <>
              <p className="mb-4 text-sm text-muted">
                הופק {formatDateTime(last.createdAt)} ע״י <span dir="ltr">{last.createdBy}</span> · מס׳ {last.id}
              </p>
              <pre dir="ltr" className="max-h-[40rem] overflow-auto rounded-card bg-white p-4 text-start text-xs leading-relaxed ring-1 ring-line">
                {last.markdown}
              </pre>
            </>
          ) : (
            <p className="text-muted">עוד לא הופק דו״ח.</p>
          )}
        </Card>
      </div>
    </>
  );
}

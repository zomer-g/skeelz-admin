import type { Metadata } from "next";
import { Badge, Card, PageHeader } from "@/components/ui";
import { pageAuth } from "@/lib/auth/guard";
import { integrationStatus } from "@/lib/integrations";
import { AdminTabs } from "../AdminTabs";

export const metadata: Metadata = { title: "חיבורים" };

export default async function IntegrationsPage() {
  const auth = await pageAuth("admin", "/admin/integrations");
  if (!auth.ok) return auth.render;

  const integrations = integrationStatus();

  return (
    <>
      <PageHeader title="ניהול" subtitle="חיבורים למערכות חיצוניות" />
      <AdminTabs />

      <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
        {integrations.map((i) => (
          <Card key={i.key} title={i.name} tone={i.configured ? "accent" : "accent-light"}>
            <div className="flex flex-col gap-4">
              <div className="flex items-center justify-between gap-3">
                <p className="text-muted">{i.scope}</p>
                {i.configured ? <Badge tone="success">הוגדר</Badge> : <Badge>לא הוגדר</Badge>}
              </div>
              <div>
                <p className="mb-2 text-sm font-medium text-muted">משתני סביבה נדרשים</p>
                <ul className="flex flex-wrap gap-2" dir="ltr">
                  {i.envVars.map((v) => (
                    <li key={v} className="rounded-full bg-white px-3 py-1 font-mono text-xs text-ink ring-1 ring-line">
                      {v}
                    </li>
                  ))}
                </ul>
              </div>
              <p className="text-sm text-muted">
                מדריך הקמה: <span dir="ltr" className="font-mono text-xs">{i.guide}</span> · שלב {i.milestone}
              </p>
            </div>
          </Card>
        ))}
      </div>
    </>
  );
}

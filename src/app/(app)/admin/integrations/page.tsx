import { asc, desc, eq } from "drizzle-orm";
import type { Metadata } from "next";
import { Badge, buttonClass, Card, formatDateTime, PageHeader, Table } from "@/components/ui";
import { pageAuth } from "@/lib/auth/guard";
import { getDb } from "@/lib/db/client";
import { gtmVersions, smoovCampaigns, smoovCampaignStats, syncState } from "@/lib/db/schema";
import { serviceAccountEmail } from "@/lib/google/auth";
import { integrationStatus } from "@/lib/integrations";
import { AdminTabs } from "../AdminTabs";
import { removeSmoovCampaign } from "./actions";
import { AddCampaignForm, TestButton } from "./IntegrationTools";

export const metadata: Metadata = { title: "חיבורים" };

const fmt = (n: number | null | undefined) => (n == null ? "—" : new Intl.NumberFormat("he-IL").format(n));
const pct = (part: number | null, whole: number | null) => (part == null || !whole ? "—" : `${Math.round((part / whole) * 100)}%`);

const STATE_OBJECT = { salesforce: "Case", ga4: "GA4", gtm: "GTM", smoov: "SMOOV" } as const;

export default async function IntegrationsPage() {
  const auth = await pageAuth("admin", "/admin/integrations");
  if (!auth.ok) return auth.render;

  const db = getDb();
  const [states, campaigns, [liveGtm]] = await Promise.all([
    db.select().from(syncState),
    db
      .select({ campaign: smoovCampaigns, stats: smoovCampaignStats })
      .from(smoovCampaigns)
      .leftJoin(smoovCampaignStats, eq(smoovCampaignStats.campaignId, smoovCampaigns.id))
      .where(eq(smoovCampaigns.active, true))
      .orderBy(asc(smoovCampaigns.addedAt)),
    db.select().from(gtmVersions).orderBy(desc(gtmVersions.lastSeenAt)).limit(1),
  ]);
  const stateByObject = new Map(states.map((s) => [s.object, s]));
  const integrations = integrationStatus();
  const saEmail = serviceAccountEmail();

  return (
    <>
      <PageHeader title="ניהול" subtitle="חיבורים למערכות חיצוניות" />
      <AdminTabs />

      <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
        {integrations.map((i) => {
          const state = stateByObject.get(STATE_OBJECT[i.key]);
          return (
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
                {(i.key === "ga4" || i.key === "gtm") && saEmail ? (
                  <p className="text-xs text-muted">
                    חשבון השירות להוספה ב-Google: <span dir="ltr" className="font-mono">{saEmail}</span>
                  </p>
                ) : null}
                {i.key === "gtm" && liveGtm ? (
                  <p className="text-xs text-muted">
                    גרסה מפורסמת אחרונה: {liveGtm.name || liveGtm.versionId} · {liveGtm.tagCount} תגים ·{" "}
                    {liveGtm.sendsJobId ? "job_id נשלח" : "job_id לא נשלח"}
                  </p>
                ) : null}
                <p className="text-xs text-muted">
                  סנכרון אחרון: {formatDateTime(state?.lastSuccessAt)}
                  {state?.lastError ? <span className="ms-2 text-danger" dir="ltr">{state.lastError.slice(0, 120)}</span> : null}
                </p>
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <p className="text-sm text-muted">
                    מדריך: <span dir="ltr" className="font-mono text-xs">{i.guide}</span>
                  </p>
                  {i.key !== "salesforce" ? <TestButton integration={i.key} disabled={!i.configured} /> : null}
                </div>
              </div>
            </Card>
          );
        })}
      </div>

      <Card title="קמפיינים במעקב ב-SMOOV" className="mt-8">
        <p className="mb-4 text-sm text-muted">
          ה-API של SMOOV לא מחזיר רשימת קמפיינים, ולכן מוסיפים כאן את מזהי הקמפיינים שרוצים לעקוב אחריהם. המזהה מופיע בכתובת הדפדפן בדף הקמפיין ב-SMOOV.
        </p>
        <AddCampaignForm />
        <div className="mt-6">
          <Table
            head={["קמפיין", "מזהה", "נשלח", "נמענים", "פתיחות", "הקלקות", "הסרות", "עודכן", ""]}
            empty={campaigns.length === 0 ? "אין קמפיינים במעקב" : undefined}
          >
            {campaigns.map(({ campaign, stats }) => (
              <tr key={campaign.id}>
                <td className="px-3 py-2 font-medium">{campaign.label}</td>
                <td className="px-3 py-2 tabular-nums" dir="ltr">
                  {campaign.id}
                </td>
                <td className="whitespace-nowrap px-3 py-2">{formatDateTime(stats?.sentAt)}</td>
                <td className="px-3 py-2 tabular-nums">{fmt(stats?.sent)}</td>
                <td className="px-3 py-2 tabular-nums">
                  {fmt(stats?.opens)} <span className="text-xs text-muted">{pct(stats?.opens ?? null, stats?.sent ?? null)}</span>
                </td>
                <td className="px-3 py-2 tabular-nums">
                  {fmt(stats?.clicks)} <span className="text-xs text-muted">{pct(stats?.clicks ?? null, stats?.sent ?? null)}</span>
                </td>
                <td className="px-3 py-2 tabular-nums">{fmt(stats?.unsubscribes)}</td>
                <td className="whitespace-nowrap px-3 py-2 text-xs text-muted">{formatDateTime(stats?.fetchedAt)}</td>
                <td className="px-3 py-2 text-end">
                  <form action={removeSmoovCampaign}>
                    <input type="hidden" name="id" value={campaign.id} />
                    <button className={buttonClass("quiet", "sm")}>הסרה</button>
                  </form>
                </td>
              </tr>
            ))}
          </Table>
        </div>
      </Card>
    </>
  );
}

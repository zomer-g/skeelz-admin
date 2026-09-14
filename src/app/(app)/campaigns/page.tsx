import type { Metadata } from "next";
import Link from "next/link";
import { DashboardShell } from "@/components/dashboard/DashboardShell";
import { DashboardTabs } from "@/components/dashboard/DashboardTabs";
import { Badge, Card, StatCard, Table } from "@/components/ui";
import { pageAuth } from "@/lib/auth/guard";
import { formatDay, parseDashboardParams, rangeQuery, viewPath } from "@/lib/dashboard/params";
import { fmtInt, fmtPercent } from "@/lib/format";
import { campaignLabel, isMailing, loadCampaignSummaries } from "@/lib/metrics/campaigns";

export const metadata: Metadata = { title: "דיוורים" };
export const dynamic = "force-dynamic";

const MIN_SESSIONS = 5;

export default async function CampaignsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const search = await searchParams;
  const auth = await pageAuth("viewer", viewPath("/campaigns", search));
  if (!auth.ok) return auth.render;

  const params = parseDashboardParams(search, new Date(), "90d");
  const query = rangeQuery(params);
  const q = typeof search.q === "string" ? search.q.trim().toLowerCase() : "";
  const all = (await loadCampaignSummaries(params.fromDay, params.toDay)).filter((c) => c.sessions >= MIN_SESSIONS);
  const campaigns = q ? all.filter((c) => `${c.key} ${c.label ?? ""}`.toLowerCase().includes(q)) : all;
  const mailings = all.filter(isMailing);

  return (
    <>
      <DashboardTabs active="campaigns" query={query} />
      <DashboardShell
        preset={params.preset}
        scope={params.scope}
        showScope={false}
        fromDay={params.fromDay}
        toDay={params.toDay}
        showBasis={false}
        search={{ value: typeof search.q === "string" ? search.q : "", placeholder: "חיפוש קמפיין לפי שם" }}
      >
        <p className="mb-6 text-sm text-muted">
          {formatDay(params.fromDay)} – {formatDay(params.toDay)} · קמפיינים מתגיות UTM ב-Google Analytics. יום השליחה = יום השיא של הקמפיין, אלא אם עורך תיקן אותו.
        </p>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard label="קמפיינים בטווח" value={fmtInt(all.length)} hint={`מתוכם ${fmtInt(mailings.length)} דיוורים (SMS / מייל)`} />
          <StatCard label="כניסות מקמפיינים" value={fmtInt(all.reduce((s, c) => s + c.sessions, 0))} />
          <StatCard label="פתיחות משרה מקמפיינים" value={fmtInt(all.reduce((s, c) => s + c.opens, 0))} />
          <StatCard label='לחיצות "הגש מועמדות"' value={fmtInt(all.reduce((s, c) => s + c.applyClicks, 0))} />
        </div>

        <Card title={`קמפיינים · ${fmtInt(campaigns.length)}`} className="mt-8">
          <Table
            head={["קמפיין", "ערוץ", "יום שליחה", "כניסות", "מעורבות", "פתיחות משרה", "לחיצות הגשה", "משרות מקושרות", "SMOOV"]}
            empty={campaigns.length === 0 ? "אין קמפיינים בטווח" : undefined}
          >
            {campaigns.map((c) => (
              <tr key={c.key}>
                <td className="px-3 py-2">
                  <Link href={`/campaigns/${encodeURIComponent(c.key)}?${query}`} className="font-medium underline-offset-4 hover:underline" dir="auto">
                    {campaignLabel(c)}
                  </Link>
                  {c.label ? (
                    <p className="text-xs text-muted" dir="ltr">
                      {c.key}
                    </p>
                  ) : null}
                </td>
                <td className="px-3 py-2">{isMailing(c) ? <Badge tone="brand">{c.medium}</Badge> : <Badge>{c.medium}</Badge>}</td>
                <td className="whitespace-nowrap px-3 py-2 tabular-nums">{formatDay(c.sendDay)}</td>
                <td className="px-3 py-2 tabular-nums">{fmtInt(c.sessions)}</td>
                <td className="px-3 py-2 tabular-nums">{fmtPercent(c.engaged, c.sessions)}</td>
                <td className="px-3 py-2 tabular-nums">{fmtInt(c.opens)}</td>
                <td className="px-3 py-2 tabular-nums">{fmtInt(c.applyClicks)}</td>
                <td className="px-3 py-2 tabular-nums">{c.linkedJobs ? fmtInt(c.linkedJobs) : "—"}</td>
                <td className="px-3 py-2 tabular-nums" dir="ltr">
                  {c.smoovCampaignId ?? "—"}
                </td>
              </tr>
            ))}
          </Table>
          <p className="mt-3 text-xs text-muted">מוצגים קמפיינים עם {MIN_SESSIONS} כניסות ומעלה בטווח.</p>
        </Card>
      </DashboardShell>
    </>
  );
}

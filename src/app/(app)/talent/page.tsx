import type { Metadata } from "next";
import Link from "next/link";
import { SectionTitle } from "@/components/dashboard/ApplicationPipeline";
import { BarList } from "@/components/dashboard/BarList";
import { DashboardShell } from "@/components/dashboard/DashboardShell";
import { DashboardTabs } from "@/components/dashboard/DashboardTabs";
import { LineChart } from "@/components/dashboard/LineChart";
import { PaidSplit } from "@/components/dashboard/PaidSplit";
import { Card, StatCard, Table } from "@/components/ui";
import { pageAuth } from "@/lib/auth/guard";
import { EXPLAIN } from "@/lib/dashboard/explain";
import { eachDay, formatDay, parseDashboardParams, rangeQuery, viewPath } from "@/lib/dashboard/params";
import { fmtDecimal, fmtInt, fmtPercent, fmtRelative } from "@/lib/format";
import { campaignLabel, isMailing, loadCampaignSummaries } from "@/lib/metrics/campaigns";
import { syncFreshness } from "@/lib/metrics/candidates";
import { loadTalentMetrics, OTHER_ACCOUNT } from "@/lib/metrics/talent";

export const metadata: Metadata = { title: "דשבורד מועמדים" };
export const dynamic = "force-dynamic";

export default async function TalentPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const search = await searchParams;
  const auth = await pageAuth("viewer", viewPath("/talent", search));
  if (!auth.ok) return auth.render;

  const params = parseDashboardParams(search);
  const query = rangeQuery(params);
  const [t, freshness, campaigns] = await Promise.all([loadTalentMetrics(params), syncFreshness(), loadCampaignSummaries(params.fromDay, params.toDay)]);
  const paidOnly = params.scope === "paid";

  const days = eachDay(params.fromDay, params.toDay);
  const markers = campaigns
    .filter((c) => isMailing(c) && c.sessions >= 20)
    .map((c) => ({ day: c.sendDay, label: `${campaignLabel(c)} (${fmtInt(c.sessions)} כניסות)` }));

  return (
    <>
      <DashboardTabs active="candidates" query={query} />
      <DashboardShell preset={params.preset} scope={params.scope} fromDay={params.fromDay} toDay={params.toDay} showBasis={false}>
        <PaidSplit scope={params.scope} items={[{ label: "מועמדים שהגישו", paid: t.appliedSplit.paid, total: t.appliedSplit.all }]} />
        <p className="mb-6 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted">
          <span>
            {formatDay(params.fromDay)} – {formatDay(params.toDay)}
          </span>
          {freshness.casesSyncedAt ? <span>נתונים מ-Salesforce עודכנו {fmtRelative(freshness.casesSyncedAt)}</span> : null}
          <Link href="/candidates" className="font-medium text-accent-dark underline underline-offset-4">
            לרשימת המועמדים
          </Link>
        </p>

        <SectionTitle hint="אנשי הקשר ב-Accounts של המועמדים, וכל מי שהגיש מועמדות">מאגר המועמדים</SectionTitle>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard
            label="מועמדים במאגר"
            value={fmtInt(t.candidates)}
            hint={`${fmtInt(t.cambium)} מתוכם ב-Account קמביום · ${fmtPercent(t.withCv, t.candidates)} עם קו"ח`}
            info={EXPLAIN.candidates}
          />
          <StatCard label="מועמדים חדשים" value={fmtInt(t.newInRange)} hint="נוספו ל-Salesforce בטווח" info={EXPLAIN.newCandidates} />
          <StatCard
            label="מועמדים פעילים"
            value={fmtInt(t.active)}
            hint={paidOnly ? "הגישו למשרה בתשלום, או שהיה איתם מגע עליה" : "הגישו, היה איתם מגע, או שנרשמה עליהם פעילות"}
            info={EXPLAIN.activeCandidates}
          />
          <StatCard
            label="הגישו מועמדות"
            value={fmtInt(t.applicants)}
            hint={`${fmtInt(t.applications)} הגשות · ${fmtDecimal(t.applicants ? t.applications / t.applicants : null)} למועמד`}
            info={EXPLAIN.applicants}
          />
        </div>
        <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
          <StatCard
            label="מגישים חוזרים"
            value={fmtInt(t.returning)}
            hint={`${fmtPercent(t.returning, t.applicants)} מהמגישים הגישו גם לפני הטווח`}
            info={EXPLAIN.returningApplicants}
          />
          <StatCard
            label='מגישים עם קו"ח'
            value={fmtPercent(t.applicantsWithCv, t.applicants)}
            hint={`${fmtInt(t.applicantsWithCv)} מתוך ${fmtInt(t.applicants)} מגישים`}
            info={EXPLAIN.applicantsWithCv}
          />
        </div>

        <Card level={3} title="מועמדים לפי Account" className="mt-4">
          <Table head={["Account", "מועמדים", "חדשים בטווח", "פעילים", "הגישו", 'עם קו"ח', "שיעור מגישים"]} empty={t.accounts.length === 0 ? "אין מועמדים" : undefined}>
            {t.accounts.map((a) => (
              <tr key={a.account}>
                <td className="px-3 py-2 font-medium">{a.account === OTHER_ACCOUNT ? "מגישים מחוץ ל-Accounts של המועמדים" : a.account}</td>
                <td className="px-3 py-2 tabular-nums">{fmtInt(a.candidates)}</td>
                <td className="px-3 py-2 tabular-nums">{fmtInt(a.newInRange)}</td>
                <td className="px-3 py-2 tabular-nums">{fmtInt(a.active)}</td>
                <td className="px-3 py-2 tabular-nums">{fmtInt(a.applicants)}</td>
                <td className="px-3 py-2 tabular-nums">{fmtPercent(a.withCv, a.candidates)}</td>
                <td className="px-3 py-2 tabular-nums">{fmtPercent(a.applicants, a.candidates)}</td>
              </tr>
            ))}
          </Table>
        </Card>

        <SectionTitle hint="לפי יום, עם ימי הדיוור">לאורך זמן</SectionTitle>
        <Card level={3} title="מועמדים חדשים ומגישים">
          <LineChart
            unit="מועמדים"
            markers={markers}
            series={[
              { label: "מועמדים חדשים", color: "var(--color-series-1)", points: days.map((day) => ({ day, value: t.dailyNew.get(day) ?? 0 })) },
              { label: "מועמדים שהגישו", color: "var(--color-series-2)", points: days.map((day) => ({ day, value: t.dailyApplicants.get(day) ?? 0 })) },
            ]}
          />
        </Card>

        <SectionTitle hint="המועמדים שהגישו בטווח">מי מגיש</SectionTitle>
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <Card level={3} title="לפי מחוז">
            <BarList caption="מגישים לפי מחוז" items={t.districts.map((d) => ({ label: d.district, value: d.count }))} showShareOf={t.applicants || undefined} />
          </Card>
          <Card level={3} title="כישורים נפוצים">
            <BarList caption="כישורים נפוצים אצל המגישים" items={t.skills.map((s) => ({ label: s.skill, value: s.count }))} showShareOf={t.applicants || undefined} />
            <p className="mt-3 text-xs text-muted">מתוך הכישורים שהמועמד סימן באתר. מועמד עם כמה כישורים נספר בכל אחד.</p>
          </Card>
        </div>

        <p className="mt-8 text-xs text-muted">
          המאגר: אנשי הקשר ב-Accounts ששמם כולל &quot;מועמד&quot;, וכל מי שהגיש מועמדות. פעיל בטווח: הגיש, או שנשלח אליו מייל או נרשמה שיחה איתו על אחת ההגשות
          שלו{paidOnly ? " (בהגשות למשרות בתשלום)" : ', או ש-Salesforce רשם עליו פעילות ("Last Activity")'}. תהליך ההגשה עצמו (קו&quot;ח, ראיונות, השמות) נמצא
          בלשונית המשרות.
        </p>
      </DashboardShell>
    </>
  );
}

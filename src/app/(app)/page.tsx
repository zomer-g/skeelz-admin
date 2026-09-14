import type { Metadata } from "next";
import Link from "next/link";
import { BarList } from "@/components/dashboard/BarList";
import { DashboardShell } from "@/components/dashboard/DashboardShell";
import { DashboardTabs } from "@/components/dashboard/DashboardTabs";
import { LineChart } from "@/components/dashboard/LineChart";
import { PaidSplit } from "@/components/dashboard/PaidSplit";
import { Card, StatCard } from "@/components/ui";
import { pageAuth } from "@/lib/auth/guard";
import { EXPLAIN } from "@/lib/dashboard/explain";
import { eachDay, formatDay, israelDay, parseDashboardParams, rangeQuery, viewPath } from "@/lib/dashboard/params";
import { searchCompanies } from "@/lib/entities/companies";
import { fmtInt, fmtPercent, fmtRelative } from "@/lib/format";
import { campaignLabel, isMailing, loadCampaignSummaries } from "@/lib/metrics/campaigns";
import { computeCandidateMetrics, countNewJobs, loadApplicationFacts, syncFreshness } from "@/lib/metrics/candidates";
import { computeLeadMetrics, loadLeadFacts } from "@/lib/metrics/employers";
import { loadPositions } from "@/lib/metrics/jobs";
import { loadMarketingMetrics, SITE_EVENTS } from "@/lib/metrics/marketing";
import { inScope } from "@/lib/metrics/paid";
import { loadTalentMetrics } from "@/lib/metrics/talent";

export const metadata: Metadata = { title: "תקציר מנהלים" };
export const dynamic = "force-dynamic";

const FUNNEL = ["var(--color-funnel-1)", "var(--color-funnel-2)", "var(--color-funnel-3)", "var(--color-funnel-4)", "var(--color-funnel-5)", "var(--color-funnel-6)"];

function Section({ title, hint, href, children }: { title: string; hint?: string; href?: string; children: React.ReactNode }) {
  return (
    <section className="mt-10 first:mt-0">
      <div className="mb-4 flex flex-wrap items-baseline gap-3">
        <h2 className="text-xl font-bold">{title}</h2>
        {hint ? <span className="text-sm text-muted">{hint}</span> : null}
        {href ? (
          <Link href={href} className="ms-auto text-sm font-medium text-accent-dark underline underline-offset-4">
            לפירוט<span className="sr-only"> · {title}</span>
          </Link>
        ) : null}
      </div>
      {children}
    </section>
  );
}

/**
 * Executive summary: the headline of every tab on one page. Pipeline figures use
 * the event basis — what happened in the range — which is how a summary reads.
 */
export default async function SummaryPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const search = await searchParams;
  const auth = await pageAuth("viewer", viewPath("/", search));
  if (!auth.ok) return auth.render;

  const params = parseDashboardParams(search);
  const query = rangeQuery(params);
  const withQuery = (path: string) => (query ? `${path}?${query}` : path);
  const freshness = await syncFreshness();

  if (!freshness.casesSyncedAt) {
    return (
      <>
        <DashboardTabs active="summary" />
        <Card title="הנתונים עוד לא סונכרנו">
          <p className="text-muted">הסנכרון הראשון מ-Salesforce עוד לא הסתיים. הדשבורד יתמלא אחריו.</p>
          {auth.user.role === "admin" ? (
            <Link href="/admin/sync" className="mt-3 inline-block font-medium text-accent-dark underline underline-offset-4">
              מצב הסנכרון
            </Link>
          ) : null}
        </Card>
      </>
    );
  }

  const paidOnly = params.scope === "paid";
  const [facts, newJobs, marketing, campaigns, talent, positions, leads, companies] = await Promise.all([
    loadApplicationFacts(),
    countNewJobs(params.from, params.to),
    loadMarketingMetrics(params),
    loadCampaignSummaries(params.fromDay, params.toDay),
    loadTalentMetrics(params),
    loadPositions(),
    loadLeadFacts(),
    searchCompanies({ q: "", location: "", paid: paidOnly ? "paid" : "", sort: "", all: false }, { pageSize: 1 }),
  ]);

  const scoped = facts.filter(inScope(params.scope));
  const pipeline = computeCandidateMetrics(scoped, paidOnly ? newJobs.paid : newJobs.all, { ...params, basis: "event" });
  const leadMetrics = computeLeadMetrics(leads, params.from, params.to);
  const activeJobs = positions.filter((p) => p.active);
  const activeInScope = activeJobs.filter(inScope(params.scope));

  const mailings = campaigns.filter((c) => isMailing(c) && c.sessions >= 20);
  const markers = mailings.map((c) => ({ day: c.sendDay, label: `${campaignLabel(c)} (${fmtInt(c.sessions)} כניסות)` }));
  const days = eachDay(params.fromDay, params.toDay);
  const dailyHires = new Map<string, number>();
  for (const f of scoped) {
    if (!f.acceptedAt || f.acceptedAt < params.from || f.acceptedAt >= params.to) continue;
    const day = israelDay(f.acceptedAt);
    dailyHires.set(day, (dailyHires.get(day) ?? 0) + 1);
  }
  const ev = (name: string) => marketing.events.get(name) ?? 0;
  const hasGa = Boolean(marketing.gaSyncedAt);

  return (
    <>
      <DashboardTabs active="summary" query={query} />
      <DashboardShell preset={params.preset} scope={params.scope} fromDay={params.fromDay} toDay={params.toDay} showBasis={false}>
        <PaidSplit
          scope={params.scope}
          items={[
            { label: "משרות פעילות באתר", paid: activeJobs.filter((p) => p.paid).length, total: activeJobs.length },
            { label: "הגשות", paid: marketing.split.applications.paid, total: marketing.split.applications.all },
          ]}
        />
        <p className="mb-6 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted">
          <span>
            {formatDay(params.fromDay)} – {formatDay(params.toDay)}
          </span>
          <span>Salesforce עודכן {fmtRelative(freshness.casesSyncedAt)}</span>
          {marketing.gaSyncedAt ? <span>Google Analytics עודכן {fmtRelative(marketing.gaSyncedAt)}</span> : null}
        </p>

        <Section title="מועמדים" hint="המאגר ומה קרה בו בטווח" href={withQuery("/talent")}>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard
              label="מועמדים במאגר"
              value={fmtInt(talent.candidates)}
              hint={`${fmtInt(talent.cambium)} מתוכם ב-Account קמביום · ${fmtPercent(talent.withCv, talent.candidates)} עם קו"ח`}
              info={EXPLAIN.candidates}
            />
            <StatCard label="מועמדים חדשים" value={fmtInt(talent.newInRange)} info={EXPLAIN.newCandidates} />
            <StatCard label="מועמדים פעילים" value={fmtInt(talent.active)} info={EXPLAIN.activeCandidates} />
            <StatCard label="הגישו מועמדות" value={fmtInt(talent.applicants)} hint={`${fmtInt(talent.returning)} מהם מגישים חוזרים`} info={EXPLAIN.applicants} />
          </div>
        </Section>

        <Section title="משרות והגשות" hint="מה קרה בטווח" href={withQuery("/jobs")}>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard label="משרות פעילות באתר" value={fmtInt(activeInScope.length)} hint={`${fmtInt(pipeline.newJobs)} משרות חדשות בטווח`} info={EXPLAIN.activeJobs} />
            <StatCard
              label="הגשות"
              value={fmtInt(pipeline.applications)}
              hint={hasGa ? `${fmtPercent(pipeline.applications, ev(SITE_EVENTS.openJob))} מפתיחות המשרה` : undefined}
              info={EXPLAIN.applications}
            />
            <StatCard label='קו"ח שנשלחו למעסיקים' value={fmtInt(pipeline.sentToEmployer)} hint={`${fmtInt(pipeline.employerResponded)} קיבלו תגובה`} info={EXPLAIN.cvSent} />
            <StatCard label="התקבלו לעבודה" value={fmtInt(pipeline.accepted)} hint={`${fmtInt(pipeline.interviews)} זומנו לראיון`} info={EXPLAIN.hired} />
          </div>
          <Card level={3} title="מהאתר ועד השמה" className="mt-4">
            <BarList
              caption="משפך מפתיחת משרה ועד השמה"
              showShareOf={hasGa ? ev(SITE_EVENTS.openJob) || undefined : pipeline.applications || undefined}
              items={[
                ...(hasGa
                  ? [
                      { label: "פתיחות משרה באתר", value: ev(SITE_EVENTS.openJob) },
                      { label: 'לחיצות "הגש מועמדות"', value: ev(SITE_EVENTS.applyClick) },
                    ]
                  : []),
                { label: "הגשות ב-Salesforce", value: pipeline.applications },
                { label: 'קו"ח נשלחו למעסיק', value: pipeline.sentToEmployer },
                { label: "זומנו לראיון", value: pipeline.interviews },
                { label: "התקבלו", value: pipeline.accepted },
              ].map((s, i, all) => ({ ...s, color: FUNNEL[i + (FUNNEL.length - all.length)] }))}
            />
            <p className="mt-3 text-xs text-muted">כל שלב נספר לפי מתי שקרה בטווח. פתיחות ולחיצות מ-Google Analytics, השאר מ-Salesforce.</p>
          </Card>
        </Section>

        <Section title="מעסיקים" hint="לידים, חוזים ומעסיקים עם משרות פעילות" href={withQuery("/employers")}>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <StatCard
              label="מעסיקים עם משרות פעילות"
              value={fmtInt(companies.total)}
              hint={paidOnly ? "עם משרה פעילה בתשלום" : undefined}
              info={EXPLAIN.companiesWithActiveJobs}
            />
            <StatCard label="לידים חדשים של מעסיקים" value={fmtInt(leadMetrics.newLeads)} info={EXPLAIN.newLeads} />
            <StatCard label="חוזים שנחתמו" value={fmtInt(leadMetrics.signed.length)} info={EXPLAIN.signedContracts} />
          </div>
        </Section>

        <Section title="אתר ודיוור" hint="Google Analytics ו-SMOOV, עם ימי הדיוור מסומנים" href={withQuery("/marketing")}>
          {hasGa ? (
            <>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
                <StatCard
                  label="כניסות לאתר"
                  value={fmtInt(marketing.sessions)}
                  hint={`${fmtPercent(marketing.engagedSessions, marketing.sessions)} עם מעורבות`}
                  info={EXPLAIN.sessions}
                />
                <StatCard label="משתמשים חדשים" value={fmtInt(marketing.newUsers)} info={EXPLAIN.newUsers} />
                <StatCard label="פתיחות משרה" value={fmtInt(ev(SITE_EVENTS.openJob))} hint={paidOnly ? "של משרות בתשלום" : undefined} info={EXPLAIN.jobOpens} />
                <StatCard
                  label="דיוורים בטווח"
                  value={fmtInt(mailings.length)}
                  hint={mailings.length ? `${fmtInt(mailings.reduce((s, c) => s + c.sessions, 0))} כניסות מהם` : undefined}
                  info={EXPLAIN.mailings}
                />
              </div>
              <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
                <Card level={3} title="כניסות לאתר">
                  <LineChart unit="כניסות" markers={markers} series={[{ label: "כניסות", color: "var(--color-accent)", points: days.map((day) => ({ day, value: marketing.dailySessions.get(day) ?? 0 })) }]} />
                </Card>
                <Card level={3} title="הגשות והשמות">
                  <LineChart
                    unit="הגשות"
                    markers={markers}
                    series={[
                      { label: "הגשות", color: "var(--color-series-1)", points: days.map((day) => ({ day, value: marketing.dailyApplications.get(day) ?? 0 })) },
                      { label: "התקבלו לעבודה", color: "var(--color-series-3)", points: days.map((day) => ({ day, value: dailyHires.get(day) ?? 0 })) },
                    ]}
                  />
                </Card>
              </div>
            </>
          ) : (
            <Card>
              <p className="text-muted">Google Analytics עוד לא סונכרן.</p>
            </Card>
          )}
        </Section>
      </DashboardShell>
    </>
  );
}

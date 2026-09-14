import type { Metadata } from "next";
import Link from "next/link";
import { BarList } from "@/components/dashboard/BarList";
import { DashboardShell } from "@/components/dashboard/DashboardShell";
import { DashboardTabs } from "@/components/dashboard/DashboardTabs";
import { PaidSplit } from "@/components/dashboard/PaidSplit";
import { Badge, Card, StatCard, Table } from "@/components/ui";
import { pageAuth } from "@/lib/auth/guard";
import { formatDay, parseDashboardParams, rangeQuery, viewPath } from "@/lib/dashboard/params";
import { fmtDate, fmtDecimal, fmtInt } from "@/lib/format";
import {
  computeLeadMetrics,
  daysSince,
  loadJobActivity,
  loadJobsPerEmployer,
  loadLeadFacts,
  loadSignedEmployers,
  NO_TOUCH_DAYS,
  type ActivityKind,
  type SignedEmployer,
} from "@/lib/metrics/employers";
import { loadPositions } from "@/lib/metrics/jobs";
import { inScope } from "@/lib/metrics/paid";

export const metadata: Metadata = { title: "מעסיקים" };
export const dynamic = "force-dynamic";

// Ordinal ramp for the lead pipeline: one hue, darker as it narrows.
const FUNNEL = ["var(--color-funnel-1)", "var(--color-funnel-2)", "var(--color-funnel-3)", "var(--color-funnel-4)", "var(--color-funnel-5)"];
const MAX_ROWS = 200;
const KIND_LABEL: Record<ActivityKind, string> = { call: "שיחה", email: "מייל", task: "משימה" };

function SectionTitle({ children, hint }: { children: string; hint?: string }) {
  return (
    <div className="mb-4 mt-10 flex flex-wrap items-baseline gap-3 first:mt-0">
      <h2 className="text-xl font-bold">{children}</h2>
      {hint ? <span className="text-sm text-muted">{hint}</span> : null}
    </div>
  );
}

export default async function EmployersPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const search = await searchParams;
  const auth = await pageAuth("viewer", viewPath("/employers", search));
  if (!auth.ok) return auth.render;

  const params = parseDashboardParams(search, new Date(), "90d");
  const query = rangeQuery(params);
  const paidOnly = params.scope === "paid";
  const now = new Date();
  const sfBase = process.env.SF_LOGIN_URL?.replace(/\/+$/, "");

  const [leads, employers, perEmployer, positions, activity] = await Promise.all([
    loadLeadFacts(),
    loadSignedEmployers(),
    loadJobsPerEmployer(params.from, params.to),
    loadPositions(),
    loadJobActivity(),
  ]);
  const m = computeLeadMetrics(leads, params.from, params.to);

  // Employers with a contract: job counts follow the paid scope.
  const jobsOf = (e: SignedEmployer) => (paidOnly ? e.paidJobsSinceSigned : e.jobsSinceSigned);
  const activeOf = (e: SignedEmployer) => (paidOnly ? e.paidActiveJobs : e.activeJobs);
  const noJob = employers.filter((e) => jobsOf(e) === 0);
  const avgJobs = employers.length ? employers.reduce((s, e) => s + jobsOf(e), 0) / employers.length : null;
  const rangeAvg = paidOnly
    ? perEmployer.paidEmployers
      ? perEmployer.paidJobs / perEmployer.paidEmployers
      : null
    : perEmployer.employers
      ? perEmployer.jobs / perEmployer.employers
      : null;
  const noTouch = employers
    .filter((e) => (daysSince(e.lastTouchAt, now) ?? Infinity) > NO_TOUCH_DAYS)
    .sort((a, b) => (a.lastTouchAt?.getTime() ?? 0) - (b.lastTouchAt?.getTime() ?? 0));
  const signedWithoutAccount = leads.filter((l) => l.signedAt && !l.accountId).length;

  // Active jobs, least recently verified first; a job with no activity at all leads the list.
  const activeAll = positions.filter((p) => p.active);
  const activeJobs = activeAll
    .filter(inScope(params.scope))
    .map((position) => ({ position, last: activity.get(position.id) ?? null }))
    .sort((a, b) => (a.last?.at.getTime() ?? 0) - (b.last?.at.getTime() ?? 0));
  const neverTouched = activeJobs.filter((j) => !j.last).length;
  const stale = activeJobs.filter((j) => (daysSince(j.last?.at ?? null, now) ?? Infinity) > NO_TOUCH_DAYS).length;

  const pipeline = [
    { label: "פנייה ראשונה", value: m.stages.first },
    { label: "פנייה שנייה", value: m.stages.second },
    { label: "פנייה שלישית", value: m.stages.third },
    { label: "תשובה חיובית, נשלח חוזה", value: m.stages.contractSent },
    { label: "נחתם חוזה", value: m.stages.signed },
  ].map((s, i) => ({ ...s, color: FUNNEL[i] }));

  const sfLink = (id: string) =>
    sfBase ? (
      <a href={`${sfBase}/${id}`} target="_blank" rel="noreferrer" className="text-sm font-medium text-accent-dark underline underline-offset-4">
        Salesforce
      </a>
    ) : null;

  return (
    <>
      <DashboardTabs active="employers" query={query} />
      <DashboardShell preset={params.preset} scope={params.scope} fromDay={params.fromDay} toDay={params.toDay} showBasis={false}>
        <PaidSplit
          scope={params.scope}
          items={[
            { label: "משרות פעילות באתר", paid: activeAll.filter((p) => p.paid).length, total: activeAll.length },
            { label: "משרות שנפתחו בטווח", paid: perEmployer.paidJobs, total: perEmployer.jobs },
          ]}
        />
        <p className="mb-6 text-sm text-muted">
          {formatDay(params.fromDay)} – {formatDay(params.toDay)} · לידים מסוג &quot;ליד מעסיק&quot;. הבורר &quot;בתשלום&quot; חל על המשרות, לא על הלידים.
        </p>

        <SectionTitle hint="לידים שנכנסו וחוזים שנחתמו בטווח">לידים וחוזים</SectionTitle>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard label="לידים חדשים" value={fmtInt(m.newLeads)} hint="לידי מעסיק שנוצרו בטווח" />
          <StatCard label="חוזים שנחתמו" value={fmtInt(m.signed.length)} hint='הסטטוס עבר ל"נחתם חוזה" בטווח' />
          <StatCard
            label="מגעים עד חתימה"
            value={fmtDecimal(m.touchesToSign.avg)}
            hint={`ממוצע · מיילים ${fmtDecimal(m.touchMix.emails)} · שיחות ${fmtDecimal(m.touchMix.calls)} · ${fmtInt(m.touchesToSign.count)} חוזים`}
          />
          <StatCard
            label="ימים מליד ראשון עד חתימה"
            value={m.daysToSign.avg == null ? "—" : `${fmtDecimal(m.daysToSign.avg)} ימים`}
            hint={m.daysToSign.count ? `ממוצע · חציון ${fmtDecimal(m.daysToSign.median)} · ${fmtInt(m.daysToSign.count)} חוזים` : "אין חוזים בטווח"}
          />
        </div>
        <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
          <Card title="שלבי הפנייה · הלידים שנכנסו בטווח">
            <BarList caption="לידים לפי השלבים שהגיעו אליהם" items={pipeline} showShareOf={m.newLeads || undefined} />
            <p className="mt-3 text-xs text-muted">ליד נספר בכל שלב שהגיע אליו, לפי היסטוריית הסטטוסים.</p>
          </Card>
          <Card title="תוצאות וסטטוס נוכחי">
            <BarList
              caption="לידים שהגיעו לתוצאה אחרת"
              items={[
                { label: "לפנות בהמשך", value: m.stages.later },
                { label: "תשובה שלילית", value: m.stages.negative },
                { label: "אין תשובה", value: m.stages.noAnswer },
              ]}
            />
            <p className="mb-2 mt-5 text-sm font-medium text-muted">הסטטוס כרגע</p>
            <BarList caption="לידים לפי סטטוס נוכחי" items={m.currentStatus.map((s) => ({ label: s.status, value: s.count }))} />
          </Card>
        </div>

        <SectionTitle hint="כל המעסיקים שחתמו, נכון להיום">מעסיקים עם חוזה</SectionTitle>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard
            label="מעסיקים שחתמו"
            value={fmtInt(employers.length)}
            hint={signedWithoutAccount ? `עוד ${fmtInt(signedWithoutAccount)} חוזים בלי Account לא נכללים` : 'לידים ב"נחתם חוזה" עם Account'}
          />
          <StatCard label="חוזים שלא יצאה מהם משרה" value={fmtInt(noJob.length)} hint={`לא נפתחה ${paidOnly ? "משרה בתשלום" : "משרה"} מאז החתימה`} />
          <StatCard
            label="ממוצע משרות למעסיק"
            value={fmtDecimal(avgJobs)}
            hint={`מאז החתימה · בכל המעסיקים שפתחו משרות בטווח: ${fmtDecimal(rangeAvg)}`}
          />
          <StatCard label={`בלי מגע מעל ${NO_TOUCH_DAYS} יום`} value={fmtInt(noTouch.length)} hint="שיחה או מייל יוצא, בליד, במשרות או בהגשות" />
        </div>

        <Card title={`חוזים שלא יצאה מהם משרה · ${fmtInt(noJob.length)}`} className="mt-4">
          <Table
            head={["מעסיק", "נחתם", "ימים מאז החתימה", "מטפל", ""]}
            empty={noJob.length === 0 ? (employers.length ? "לכל המעסיקים שחתמו נפתחה משרה" : "עדיין אין מעסיקים שחתמו") : undefined}
          >
            {noJob.map((e) => (
              <tr key={e.accountId}>
                <td className="px-3 py-2 font-medium">{e.name ?? "—"}</td>
                <td className="whitespace-nowrap px-3 py-2 tabular-nums">{fmtDate(e.signedAt)}</td>
                <td className="px-3 py-2 tabular-nums">{fmtInt(daysSince(e.signedAt, now) ?? 0)}</td>
                <td className="px-3 py-2">{e.ownerName ?? "—"}</td>
                <td className="px-3 py-2 text-end">{sfLink(e.leadId)}</td>
              </tr>
            ))}
          </Table>
          <p className="mt-3 text-xs text-muted">
            משרה משויכת למעסיק לפי ה-Account שלה, ומשרה מהאתר (תחת ה-Account המשותף) לפי שם החברה. אם שם החברה במשרה כתוב אחרת משם ה-Account של
            הליד, המשרה לא תימצא והמעסיק יופיע כאן.
          </p>
        </Card>

        <Card title={`מעסיקים בלי מגע מעל ${NO_TOUCH_DAYS} יום · ${fmtInt(noTouch.length)}`} tone="accent-light" className="mt-4">
          <Table
            head={["מעסיק", "נחתם", "מגע אחרון", "ימים בלי מגע", "משרות פעילות", "מטפל", ""]}
            empty={noTouch.length === 0 ? (employers.length ? `עם כל המעסיקים היה מגע ב-${NO_TOUCH_DAYS} הימים האחרונים` : "עדיין אין מעסיקים שחתמו") : undefined}
          >
            {noTouch.map((e) => {
              const days = daysSince(e.lastTouchAt, now);
              return (
                <tr key={e.accountId}>
                  <td className="px-3 py-2 font-medium">{e.name ?? "—"}</td>
                  <td className="whitespace-nowrap px-3 py-2 tabular-nums">{fmtDate(e.signedAt)}</td>
                  <td className="whitespace-nowrap px-3 py-2 tabular-nums">{e.lastTouchAt ? fmtDate(e.lastTouchAt) : "—"}</td>
                  <td className="whitespace-nowrap px-3 py-2">
                    {days == null ? <Badge tone="brand">לא נרשם מגע</Badge> : <Badge tone="warning">⏳ {fmtInt(days)} ימים</Badge>}
                  </td>
                  <td className="px-3 py-2 tabular-nums">{fmtInt(activeOf(e))}</td>
                  <td className="px-3 py-2">{e.ownerName ?? "—"}</td>
                  <td className="px-3 py-2 text-end">{sfLink(e.accountId)}</td>
                </tr>
              );
            })}
          </Table>
        </Card>

        <SectionTitle hint="משרות שסטטוס האתר שלהן Active · אימות = הקשר האחרון עם המעסיק על המשרה, כולל בהגשות אליה">אימות משרות פעילות</SectionTitle>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <StatCard label="משרות פעילות" value={fmtInt(activeJobs.length)} hint={paidOnly ? "בתשלום" : "כל המשרות"} />
          <StatCard label={`לא אומתו מעל ${NO_TOUCH_DAYS} יום`} value={fmtInt(stale)} hint="כולל משרות שלא נרשמה עליהן פעילות" />
          <StatCard label="לא נרשמה פעילות מעולם" value={fmtInt(neverTouched)} hint="אין פעילות על המשרה, ואין מייל או שיחה מול המעסיק בהגשות" />
        </div>
        <Card title={`משרות פעילות לפי אימות אחרון · ${fmtInt(activeJobs.length)}`} className="mt-4">
          <Table head={["משרה", "נפתחה", "אימות אחרון", "ימים מאז", ""]} empty={activeJobs.length === 0 ? "אין משרות פעילות" : undefined}>
            {activeJobs.slice(0, MAX_ROWS).map(({ position: p, last }) => {
              const days = daysSince(last?.at ?? null, now);
              return (
                <tr key={p.id}>
                  <td className="px-3 py-2">
                    <Link href={`/jobs/${p.id}?${query}`} className="font-medium text-ink underline-offset-4 hover:underline">
                      {p.title ?? "(ללא שם)"}
                    </Link>{" "}
                    {p.paid ? <Badge tone="brand">בתשלום</Badge> : null}
                    <p className="text-xs text-muted">
                      {p.company ?? "—"}
                      {p.caseNumber ? ` · ${p.caseNumber}` : ""}
                    </p>
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 tabular-nums">{fmtDate(p.createdAt)}</td>
                  <td className="whitespace-nowrap px-3 py-2 tabular-nums">
                    {last ? `${fmtDate(last.at)} · ${KIND_LABEL[last.kind]}${last.onApplication ? " בהגשה" : ""}` : "—"}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2">
                    {days == null ? (
                      <Badge tone="brand">לא נרשמה פעילות</Badge>
                    ) : days > NO_TOUCH_DAYS ? (
                      <Badge tone="warning">⏳ {fmtInt(days)} ימים</Badge>
                    ) : (
                      <span className="tabular-nums">{fmtInt(days)}</span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-end">{sfLink(p.id)}</td>
                </tr>
              );
            })}
          </Table>
          {activeJobs.length > MAX_ROWS ? <p className="mt-3 text-xs text-muted">מוצגות {MAX_ROWS} המשרות שאומתו הכי מזמן.</p> : null}
        </Card>
      </DashboardShell>
    </>
  );
}

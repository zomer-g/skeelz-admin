import Link from "next/link";
import { BarList } from "@/components/dashboard/BarList";
import { DashboardShell } from "@/components/dashboard/DashboardShell";
import { DashboardTabs } from "@/components/dashboard/DashboardTabs";
import { Meter } from "@/components/dashboard/Meter";
import { PaidSplit } from "@/components/dashboard/PaidSplit";
import { Badge, Card, StatCard, Table } from "@/components/ui";
import { pageAuth } from "@/lib/auth/guard";
import { formatDay, parseDashboardParams, rangeQuery, viewPath } from "@/lib/dashboard/params";
import { fmtDate, fmtDecimal, fmtInt, fmtPercent, fmtRelative } from "@/lib/format";
import {
  computeCandidateMetrics,
  countNewJobs,
  loadApplicationFacts,
  STATUS_HISTORY_START,
  syncFreshness,
  WAITING_DAYS,
  type Stats,
} from "@/lib/metrics/candidates";
import { inScope } from "@/lib/metrics/paid";

export const dynamic = "force-dynamic";

// Ordinal ramp for funnel stages: one hue, lighter to darker as the pipeline narrows.
const FUNNEL_COLORS = [
  "var(--color-funnel-1)",
  "var(--color-funnel-2)",
  "var(--color-funnel-3)",
  "var(--color-funnel-4)",
  "var(--color-funnel-5)",
  "var(--color-funnel-6)",
];

function statsHint(s: Stats, unit: string): string {
  if (!s.count) return "אין נתונים";
  return `ממוצע ${fmtDecimal(s.avg)} ${unit} · מתוך ${fmtInt(s.count)} הגשות`;
}

function SectionTitle({ children, hint }: { children: string; hint?: string }) {
  return (
    <div className="mb-4 mt-10 flex flex-wrap items-baseline gap-3 first:mt-0">
      <h2 className="text-xl font-bold">{children}</h2>
      {hint ? <span className="text-sm text-muted">{hint}</span> : null}
    </div>
  );
}

export default async function DashboardPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const search = await searchParams;
  const auth = await pageAuth("viewer", viewPath("/", search));
  if (!auth.ok) return auth.render;

  const params = parseDashboardParams(search);
  const freshness = await syncFreshness();

  if (!freshness.casesSyncedAt) {
    return (
      <>
        <DashboardTabs active="candidates" />
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

  const [facts, newJobs] = await Promise.all([loadApplicationFacts(), countNewJobs(params.from, params.to)]);
  const m = computeCandidateMetrics(facts.filter(inScope(params.scope)), params.scope === "paid" ? newJobs.paid : newJobs.all, params);
  const created = facts.filter((f) => f.createdAt >= params.from && f.createdAt < params.to);
  const hired = facts.filter((f) => f.acceptedAt && f.acceptedAt >= params.from && f.acceptedAt < params.to);
  const nowScope = params.basis === "application" ? "מתוך ההגשות בטווח, כרגע" : "כרגע, בכל ההגשות";
  const sfBase = process.env.SF_LOGIN_URL?.replace(/\/+$/, "");

  const funnel = [
    { label: "הגשות", value: m.applications },
    { label: 'התבקשו לשלוח קו"ח', value: m.requestedCv },
    { label: 'קו"ח נשלחו למעסיק', value: m.sentToEmployer },
    { label: "קיבלו תגובה מהמעסיק", value: m.employerResponded },
    { label: "זומנו לראיון", value: m.interviews },
    { label: "התקבלו", value: m.accepted },
  ].map((s, i) => ({ ...s, color: FUNNEL_COLORS[i] }));

  return (
    <>
      <DashboardTabs active="candidates" query={rangeQuery(params)} />

      <DashboardShell preset={params.preset} basis={params.basis} scope={params.scope} fromDay={params.fromDay} toDay={params.toDay}>
        <PaidSplit
          scope={params.scope}
          items={[
            { label: "משרות חדשות", paid: newJobs.paid, total: newJobs.all },
            { label: "הגשות", paid: created.filter((f) => f.paid).length, total: created.length },
            { label: "התקבלו לעבודה", paid: hired.filter((f) => f.paid).length, total: hired.length },
          ]}
        />
        <p className="mb-6 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted">
          <span>
            {formatDay(params.fromDay)} – {formatDay(params.toDay)}
          </span>
          <span>נתונים מ-Salesforce עודכנו {fmtRelative(freshness.casesSyncedAt)}</span>
          {!freshness.callsAvailable ? <Badge tone="warning">שיחות עדיין לא נכללות במגעים</Badge> : null}
        </p>

        <SectionTitle hint="משרות והגשות שנכנסו">קליטה</SectionTitle>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard label="משרות חדשות" value={fmtInt(m.newJobs)} hint="משרות שנפתחו בטווח" />
          <StatCard label="הגשות שהתקבלו" value={fmtInt(m.applications)} hint="הגשות שנוצרו בטווח" />
          <StatCard label='הגשות בסטטוס "חדש"' value={fmtInt(m.statusNew)} hint={nowScope} />
          <StatCard
            label="זמן למגע ראשון"
            value={m.firstTouchHours.median == null ? "—" : `${fmtDecimal(m.firstTouchHours.median)} שע׳`}
            hint={`חציון · ${statsHint(m.firstTouchHours, "שע׳")}`}
          />
        </div>

        <SectionTitle hint="מההגשה ועד קורות החיים">מול המועמד</SectionTitle>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard label='התבקשו לשלוח קו"ח' value={fmtInt(m.requestedCv)} />
          <StatCard label="שלחו בפועל" value={fmtInt(m.cvReceived)} hint={`${fmtPercent(m.cvReceived, m.requestedCv)} מאלה שהתבקשו`} />
          <StatCard label="בטיפול מועמד/מעסיק" value={fmtInt(m.inHandling)} hint={nowScope} />
          <StatCard
            label='מגעים עד שליחת קו"ח'
            value={fmtDecimal(m.touchesUntilSent.avg)}
            hint={`ממוצע · מיילים ${fmtDecimal(m.touchMix.candidate.emails)} · שיחות ${fmtDecimal(m.touchMix.candidate.calls)} · ${fmtInt(m.touchesUntilSent.count)} הגשות`}
          />
        </div>
        <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-3">
          <Card title="בקשות קורות חיים">
            <Meter label='שלחו קו"ח מתוך אלה שהתבקשו' part={m.cvReceived} whole={m.requestedCv} partLabel="שלחו" restLabel="לא שלחו (עדיין)" />
          </Card>
          <Card title={`נדחו על ידינו · ${fmtInt(m.rejectedByUs)}`} className="lg:col-span-2">
            <BarList
              caption="נדחו על ידינו לפי סיבת הדחייה"
              items={m.rejectReasons.map((r) => ({ label: r.reason, value: r.count }))}
            />
            <p className="mt-3 text-xs text-muted">הגשה עם כמה סיבות נספרת בכל אחת מהן.</p>
          </Card>
        </div>

        <SectionTitle hint="מהשליחה ועד התשובה">מול המעסיק</SectionTitle>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard label='קו"ח שנשלחו למעסיק' value={fmtInt(m.sentToEmployer)} />
          <StatCard
            label="זמן להעברה"
            value={m.daysToTransfer.median == null ? "—" : `${fmtDecimal(m.daysToTransfer.median)} ימים`}
            hint={`חציון · ${statsHint(m.daysToTransfer, "ימים")}`}
          />
          <StatCard label="זומנו לראיון" value={fmtInt(m.interviews)} hint={`${fmtPercent(m.interviews, m.sentToEmployer)} מהנשלחים`} />
          <StatCard label="התקבלו לעבודה" value={fmtInt(m.accepted)} hint={`${fmtPercent(m.accepted, m.sentToEmployer)} מהנשלחים`} />
        </div>
        <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
          <Card title="תגובת מעסיק">
            <Meter label="קיבלו תגובה כלשהי מהמעסיק" part={m.employerResponded} whole={m.sentToEmployer} partLabel="קיבלו תגובה" restLabel="ללא תגובה" />
          </Card>
          <Card title="מגעים עם המעסיק">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <p className="text-sm font-medium text-muted">עד שהמעסיק ענה</p>
                <p className="text-3xl font-bold">{fmtDecimal(m.touchesUntilResponse.responded.avg)}</p>
                <p className="text-xs text-muted">ממוצע · {fmtInt(m.touchesUntilResponse.responded.count)} הגשות</p>
              </div>
              <div>
                <p className="text-sm font-medium text-muted">כשהמעסיק לא ענה</p>
                <p className="text-3xl font-bold">{fmtDecimal(m.touchesUntilResponse.notResponded.avg)}</p>
                <p className="text-xs text-muted">ממוצע · {fmtInt(m.touchesUntilResponse.notResponded.count)} הגשות</p>
              </div>
            </div>
            <p className="mt-4 text-xs text-muted">
              בממוצע להגשה שנשלחה: מיילים {fmtDecimal(m.touchMix.employer.emails)} · שיחות {fmtDecimal(m.touchMix.employer.calls)}
            </p>
          </Card>
        </div>

        <SectionTitle hint={params.basis === "application" ? "ההגשות שנוצרו בטווח" : "האירועים שקרו בטווח"}>משפך</SectionTitle>
        <Card>
          <BarList caption="משפך ההגשות" items={funnel} showShareOf={m.applications || undefined} />
        </Card>

        <SectionTitle hint={`נשלחו קו"ח לפני יותר מ-${WAITING_DAYS} ימים ואין עדיין תגובה · בכל ההגשות, לא רק בטווח`}>
          ממתינים לתגובת מעסיק
        </SectionTitle>
        <Card title={`${fmtInt(m.waiting.length)} הגשות ממתינות`} tone="accent-light">
          <Table
            head={["מועמד", "משרה", "חברה", "נשלח", "ממתין", "מטפל", ""]}
            empty={m.waiting.length === 0 ? "אין הגשות שממתינות מעל 5 ימים" : undefined}
          >
            {m.waiting.map((w) => (
              <tr key={w.id}>
                <td className="px-3 py-2 font-medium">{w.candidateName ?? "—"}</td>
                <td className="px-3 py-2">{w.jobTitle ?? "—"}</td>
                <td className="px-3 py-2">{w.company ?? "—"}</td>
                <td className="whitespace-nowrap px-3 py-2 tabular-nums">{fmtDate(w.sentAt)}</td>
                <td className="whitespace-nowrap px-3 py-2">
                  <Badge tone={w.daysWaiting > 14 ? "brand" : "warning"}>⏳ {fmtInt(w.daysWaiting)} ימים</Badge>
                </td>
                <td className="px-3 py-2">{w.ownerName ?? "—"}</td>
                <td className="px-3 py-2 text-end">
                  {sfBase ? (
                    <a href={`${sfBase}/${w.id}`} target="_blank" rel="noreferrer" className="text-sm font-medium text-accent-dark underline underline-offset-4">
                      Salesforce
                    </a>
                  ) : null}
                </td>
              </tr>
            ))}
          </Table>
        </Card>

        <p className="mt-8 text-xs text-muted">
          היסטוריית הסטטוסים ב-Salesforce נשמרת מ-{fmtDate(STATUS_HISTORY_START)}: מדדי שלבים והזמנים מחושבים רק להגשות שיש להן היסטוריה.
          מגעים = מיילים יוצאים{freshness.callsAvailable ? ' ושיחות (Log a Call) שנרשמו על ההגשה. שיחה משויכת למועמד או למעסיק לפי השדה "צד לשיחה"' : " שנרשמו על ההגשה"}.
        </p>
      </DashboardShell>
    </>
  );
}

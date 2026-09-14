import type { Metadata } from "next";
import { BarList } from "@/components/dashboard/BarList";
import { DashboardShell } from "@/components/dashboard/DashboardShell";
import { DashboardTabs } from "@/components/dashboard/DashboardTabs";
import { LineChart } from "@/components/dashboard/LineChart";
import { Badge, Card, StatCard, Table } from "@/components/ui";
import { pageAuth } from "@/lib/auth/guard";
import { eachDay, formatDay, israelDay, parseDashboardParams, rangeQuery, viewPath } from "@/lib/dashboard/params";
import { fmtInt, fmtPercent, fmtRelative } from "@/lib/format";
import { campaignLabel, isMailing, loadCampaignSummaries } from "@/lib/metrics/campaigns";
import { loadApplicationFacts } from "@/lib/metrics/candidates";
import { CHANNEL_LABELS, loadMarketingMetrics, SITE_EVENTS } from "@/lib/metrics/marketing";

export const metadata: Metadata = { title: "שיווק" };
export const dynamic = "force-dynamic";

const FUNNEL = ["var(--color-funnel-1)", "var(--color-funnel-2)", "var(--color-funnel-3)", "var(--color-funnel-4)", "var(--color-funnel-5)", "var(--color-funnel-6)"];

function SectionTitle({ children, hint }: { children: string; hint?: string }) {
  return (
    <div className="mb-4 mt-10 flex flex-wrap items-baseline gap-3 first:mt-0">
      <h2 className="text-xl font-bold">{children}</h2>
      {hint ? <span className="text-sm text-muted">{hint}</span> : null}
    </div>
  );
}

export default async function MarketingPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const search = await searchParams;
  const auth = await pageAuth("viewer", viewPath("/marketing", search));
  if (!auth.ok) return auth.render;

  const params = parseDashboardParams(search);
  const query = rangeQuery(params);
  const [m, facts, campaigns] = await Promise.all([
    loadMarketingMetrics(params),
    loadApplicationFacts(),
    loadCampaignSummaries(params.fromDay, params.toDay),
  ]);
  // Mailings worth marking: tagged SMS / email / WhatsApp sends (or SMOOV-linked) that brought real traffic.
  const mailings = campaigns.filter((c) => isMailing(c) && c.sessions >= 20);
  const mailingMarkers = mailings.map((c) => ({ day: c.sendDay, label: `${campaignLabel(c)} (${fmtInt(c.sessions)} כניסות)` }));
  // Hires by the day they happened (status "התקבל" or the switch to the placement record type).
  const acceptedInRange = facts.filter((f) => f.acceptedAt && f.acceptedAt >= params.from && f.acceptedAt < params.to);
  const dailyAccepted = new Map<string, number>();
  for (const f of acceptedInRange) {
    const day = israelDay(f.acceptedAt!);
    dailyAccepted.set(day, (dailyAccepted.get(day) ?? 0) + 1);
  }

  if (!m.gaSyncedAt) {
    return (
      <>
        <DashboardTabs active="marketing" query={query} />
        <Card title="Google Analytics עוד לא סונכרן">
          <p className="text-muted">הנתונים יופיעו כאן אחרי הסנכרון הראשון מ-Google Analytics.</p>
        </Card>
      </>
    );
  }

  const ev = (name: string) => m.events.get(name) ?? 0;
  const days = eachDay(params.fromDay, params.toDay);
  const series = days.map((day) => ({ day, value: m.dailySessions.get(day) ?? 0 }));
  const candidateTotals = m.candidateAccounts.reduce(
    (t, a) => ({ contacts: t.contacts + a.contacts, newInRange: t.newInRange + a.newInRange, applicants: t.applicants + a.applicants }),
    { contacts: 0, newInRange: 0, applicants: 0 },
  );

  return (
    <>
      <DashboardTabs active="marketing" query={query} />
      <DashboardShell preset={params.preset} fromDay={params.fromDay} toDay={params.toDay} showBasis={false}>
        <p className="mb-6 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted">
          <span>
            {formatDay(params.fromDay)} – {formatDay(params.toDay)}
          </span>
          <span>נתוני Google Analytics עודכנו {fmtRelative(m.gaSyncedAt)}</span>
          <Badge>הימים האחרונים עוד עשויים להשתנות ב-GA</Badge>
        </p>

        <SectionTitle hint="כל האתר">תנועה</SectionTitle>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard label="כניסות לאתר" value={fmtInt(m.sessions)} hint="Sessions" />
          <StatCard label="משתמשים חדשים" value={fmtInt(m.newUsers)} hint="ביקור ראשון באתר" />
          <StatCard label="צפיות בדפים" value={fmtInt(m.pageViews)} />
          <StatCard label="שיעור מעורבות" value={fmtPercent(m.engagedSessions, m.sessions)} hint="כניסות עם מעורבות (10 שניות ומעלה, או פעולה)" />
        </div>

        <Card title="כניסות לאורך זמן" className="mt-4">
          <LineChart series={[{ label: "כניסות", color: "var(--color-accent)", points: series }]} unit="כניסות" markers={mailingMarkers} />
        </Card>

        <Card title={`דיוורים בטווח · ${fmtInt(mailings.length)}`} className="mt-4">
          <Table head={["דיוור", "ערוץ", "יום שליחה", "כניסות", "פתיחות משרה", "לחיצות הגשה"]} empty={mailings.length === 0 ? "לא זוהו דיוורים בטווח" : undefined}>
            {mailings.slice(0, 10).map((c) => (
              <tr key={c.key}>
                <td className="px-3 py-2">
                  <a href={`/campaigns/${encodeURIComponent(c.key)}?${query}`} className="font-medium underline-offset-4 hover:underline" dir="auto">
                    {campaignLabel(c)}
                  </a>
                </td>
                <td className="px-3 py-2">{c.medium}</td>
                <td className="whitespace-nowrap px-3 py-2 tabular-nums">{formatDay(c.sendDay)}</td>
                <td className="px-3 py-2 tabular-nums">{fmtInt(c.sessions)}</td>
                <td className="px-3 py-2 tabular-nums">{fmtInt(c.opens)}</td>
                <td className="px-3 py-2 tabular-nums">{fmtInt(c.applyClicks)}</td>
              </tr>
            ))}
          </Table>
          <p className="mt-3 text-xs text-muted">
            דיוורים מזוהים מתגיות UTM (SMS / מייל) עם 20 כניסות ומעלה. הם מסומנים על הגרפים ביום השליחה. קישור למשרות ול-SMOOV נעשה בלשונית &quot;דיוורים&quot;.
          </p>
        </Card>

        <SectionTitle hint="מאיפה מגיעים">ערוצים ומקורות</SectionTitle>
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <Card title="ערוצי הגעה">
            <BarList
              caption="כניסות לפי ערוץ"
              showShareOf={m.sessions || undefined}
              items={m.channels.map((c) => ({ label: CHANNEL_LABELS[c.channel] ? `${CHANNEL_LABELS[c.channel]} (${c.channel})` : c.channel, value: c.sessions }))}
            />
          </Card>
          <Card title="מקורות מובילים">
            <Table head={["מקור / אמצעי", "כניסות", "חדשים", "מעורבות"]} empty={m.sources.length === 0 ? "אין נתונים" : undefined}>
              {m.sources.map((s) => (
                <tr key={`${s.source}/${s.medium}`}>
                  <td className="px-3 py-2" dir="ltr">
                    {s.source} / {s.medium}
                  </td>
                  <td className="px-3 py-2 tabular-nums">{fmtInt(s.sessions)}</td>
                  <td className="px-3 py-2 tabular-nums">{fmtInt(s.newUsers)}</td>
                  <td className="px-3 py-2 tabular-nums">{fmtPercent(s.engaged, s.sessions)}</td>
                </tr>
              ))}
            </Table>
          </Card>
        </div>

        <SectionTitle hint="Salesforce במקביל ל-Google Analytics">הגשות ומועמדים</SectionTitle>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard label="הגשות ב-Salesforce" value={fmtInt(m.applications)} hint="הגשות שנוצרו בטווח" />
          <StatCard label="התקבלו לעבודה" value={fmtInt(acceptedInRange.length)} hint="לפי תאריך הקבלה" />
          <StatCard label="מועמדים שהגישו" value={fmtInt(m.applicantsTotal)} hint="מועמדים שונים עם הגשה בטווח" />
          <StatCard
            label="אישורי הגשה ב-Analytics"
            value={fmtInt(ev(SITE_EVENTS.applyYes))}
            hint={`מול ${fmtInt(m.applications)} הגשות שנקלטו ב-Salesforce`}
          />
        </div>

        <Card title="הגשות לאורך זמן · Salesforce מול Analytics" className="mt-4">
          <LineChart
            unit="הגשות"
            markers={mailingMarkers}
            series={[
              { label: "הגשות ב-Salesforce", color: "var(--color-series-1)", points: days.map((day) => ({ day, value: m.dailyApplications.get(day) ?? 0 })) },
              { label: "אישורי הגשה ב-Analytics", color: "var(--color-series-2)", points: days.map((day) => ({ day, value: m.dailyApplyConfirmations.get(day) ?? 0 })) },
              { label: "התקבלו לעבודה", color: "var(--color-series-3)", points: days.map((day) => ({ day, value: dailyAccepted.get(day) ?? 0 })) },
            ]}
          />
          <p className="mt-3 text-xs text-muted">
            פער בין Analytics ל-Salesforce נובע בדרך כלל מחוסמי פרסומות ומסירוב לעוגיות (אירוע שלא נמדד), או מהגשות שנוצרו ב-Salesforce שלא דרך האתר.
          </p>
        </Card>

        <Card title="מועמדים לפי Account ב-Salesforce" className="mt-4">
          <Table head={["Account", "מועמדים", "נוספו בטווח", "הגישו בטווח", "שיעור מגישים"]} empty={m.candidateAccounts.length === 0 ? "לא נמצאו Accounts של מועמדים" : undefined}>
            {m.candidateAccounts.map((a) => (
              <tr key={a.account}>
                <td className="px-3 py-2 font-medium">{a.account}</td>
                <td className="px-3 py-2 tabular-nums">{fmtInt(a.contacts)}</td>
                <td className="px-3 py-2 tabular-nums">{fmtInt(a.newInRange)}</td>
                <td className="px-3 py-2 tabular-nums">{fmtInt(a.applicants)}</td>
                <td className="px-3 py-2 tabular-nums">{fmtPercent(a.applicants, a.contacts)}</td>
              </tr>
            ))}
            {m.candidateAccounts.length > 1 ? (
              <tr className="border-t-2 border-line font-medium">
                <td className="px-3 py-2">סה״כ</td>
                <td className="px-3 py-2 tabular-nums">{fmtInt(candidateTotals.contacts)}</td>
                <td className="px-3 py-2 tabular-nums">{fmtInt(candidateTotals.newInRange)}</td>
                <td className="px-3 py-2 tabular-nums">{fmtInt(candidateTotals.applicants)}</td>
                <td className="px-3 py-2 tabular-nums">{fmtPercent(candidateTotals.applicants, candidateTotals.contacts)}</td>
              </tr>
            ) : null}
          </Table>
          <p className="mt-3 text-xs text-muted">
            כל ה-Accounts ששמם כולל &quot;מועמד&quot;. מגישים = מועמדים עם הגשה (הגשות קמביום או השמה) שנוצרה בטווח. בסה״כ בטווח הגישו{" "}
            {fmtInt(m.applicantsTotal)} מועמדים שונים
            {m.applicantsTotal > candidateTotals.applicants ? `, מתוכם ${fmtInt(m.applicantsTotal - candidateTotals.applicants)} מחוץ ל-Accounts האלה` : ""}.
          </p>
        </Card>

        <SectionTitle hint="מהכניסה ועד הגשה שנקלטה">פעולות באתר</SectionTitle>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard label="פתיחות משרה" value={fmtInt(ev(SITE_EVENTS.openJob))} hint="open_job_page" />
          <StatCard label='לחיצות "הגש מועמדות"' value={fmtInt(ev(SITE_EVENTS.applyClick))} hint="Job_application_click_1" />
          <StatCard label="השלמת הרשמה" value={fmtInt(ev(SITE_EVENTS.signUpSecond))} hint="sign_up_second_phase_complete" />
          <StatCard label="הגשות שנקלטו ב-Salesforce" value={fmtInt(m.applications)} hint="הגשות שנוצרו בטווח" />
        </div>
        <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
          <Card title="משפך האתר">
            <BarList
              caption="משפך האתר"
              showShareOf={m.sessions || undefined}
              items={[
                { label: "כניסות", value: m.sessions },
                { label: "פתיחות משרה", value: ev(SITE_EVENTS.openJob) },
                { label: 'לחיצות "הגש מועמדות"', value: ev(SITE_EVENTS.applyClick) },
                { label: "אישור הגשה", value: ev(SITE_EVENTS.applyYes) },
                { label: "הגשות ב-Salesforce", value: m.applications },
              ].map((s, i) => ({ ...s, color: FUNNEL[i] }))}
            />
            <p className="mt-3 text-xs text-muted">האחוזים ביחס לכניסות. משתמש יכול לפתוח כמה משרות בכניסה אחת.</p>
          </Card>
          <Card title="הרשמה לאתר">
            <BarList
              caption="משפך ההרשמה"
              showShareOf={ev(SITE_EVENTS.signUpFirst) || undefined}
              items={[
                { label: "סיום שלב ראשון", value: ev(SITE_EVENTS.signUpFirst) },
                { label: "סיום שלב שני", value: ev(SITE_EVENTS.signUpSecond) },
              ].map((s, i) => ({ ...s, color: FUNNEL[i * 2 + 1] }))}
            />
            <p className="mt-3 text-sm text-muted">
              כניסות לחשבון קיים: {fmtInt(ev(SITE_EVENTS.login))} · לחיצות על כפתור ההרשמה בדף הבית: {fmtInt(ev(SITE_EVENTS.signUpClick))}
            </p>
            <p className="mt-1 text-xs text-muted">אירוע הלחיצה נמדד רק מכפתור אחד, ולכן המשפך מתחיל בסיום השלב הראשון.</p>
          </Card>
        </div>

        <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
          <Card title="חיפוש וסינון">
            <BarList
              caption="שימוש בחיפוש וסינון"
              items={[
                { label: "חיפוש", value: ev(SITE_EVENTS.search) },
                { label: "סינון לפי כישורים", value: ev(SITE_EVENTS.skillsFilter) },
                { label: "סינון לפי היקף משרה", value: ev(SITE_EVENTS.jobTypeFilter) },
              ]}
            />
          </Card>
          <Card title="דפים מובילים">
            <Table head={["דף", "צפיות"]}>
              <tr>
                <td className="px-3 py-2">
                  דפי משרות <span className="text-xs text-muted">({fmtInt(m.jobPages.jobs)} משרות)</span>
                </td>
                <td className="px-3 py-2 tabular-nums">{fmtInt(m.jobPages.views)}</td>
              </tr>
              {m.topPages.map((p) => (
                <tr key={p.path}>
                  <td className="px-3 py-2" dir="ltr">
                    {p.path}
                  </td>
                  <td className="px-3 py-2 tabular-nums">{fmtInt(p.views)}</td>
                </tr>
              ))}
            </Table>
            <p className="mt-3 text-xs text-muted">משרה נפתחת באתר בחלון, ולכן צפייה בדף משרה נספרת רק בכניסה ישירה לקישור שלה. החשיפה האמיתית היא &quot;פתיחות משרה&quot;.</p>
          </Card>
        </div>
      </DashboardShell>
    </>
  );
}

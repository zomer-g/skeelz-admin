import type { Metadata } from "next";
import { BarList } from "@/components/dashboard/BarList";
import { DashboardShell } from "@/components/dashboard/DashboardShell";
import { DashboardTabs } from "@/components/dashboard/DashboardTabs";
import { LineChart } from "@/components/dashboard/LineChart";
import { Badge, Card, StatCard, Table } from "@/components/ui";
import { pageAuth } from "@/lib/auth/guard";
import { eachDay, formatDay, parseDashboardParams, rangeQuery, viewPath } from "@/lib/dashboard/params";
import { fmtInt, fmtPercent, fmtRelative } from "@/lib/format";
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
  const m = await loadMarketingMetrics(params);

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
  const series = eachDay(params.fromDay, params.toDay).map((day) => ({ day, value: m.dailySessions.get(day) ?? 0 }));

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
          <LineChart points={series} unit="כניסות" />
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

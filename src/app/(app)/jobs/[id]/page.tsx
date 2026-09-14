import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { BarList } from "@/components/dashboard/BarList";
import { DashboardShell } from "@/components/dashboard/DashboardShell";
import { DashboardTabs } from "@/components/dashboard/DashboardTabs";
import { LineChart } from "@/components/dashboard/LineChart";
import { Badge, Card, StatCard, Table } from "@/components/ui";
import { pageAuth } from "@/lib/auth/guard";
import { eachDay, formatDay, israelDay, parseDashboardParams, rangeQuery, viewPath } from "@/lib/dashboard/params";
import { fmtDate, fmtDecimal, fmtInt, fmtPercent } from "@/lib/format";
import { loadApplicationFacts } from "@/lib/metrics/candidates";
import { applicationFunnel, loadJobDailyOpens, loadJobEvents, loadJobGa, loadPosition, siteJobUrl } from "@/lib/metrics/jobs";

export const metadata: Metadata = { title: "משרה" };
export const dynamic = "force-dynamic";

const FUNNEL = ["var(--color-funnel-1)", "var(--color-funnel-2)", "var(--color-funnel-3)", "var(--color-funnel-4)", "var(--color-funnel-5)", "var(--color-funnel-6)"];
const SF_ID = /^[A-Za-z0-9]{15,18}$/;

function Stage({ reached, label }: { reached: boolean; label: string }) {
  return reached ? <Badge tone="accent">{label}</Badge> : null;
}

export default async function JobPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { id } = await params;
  const search = await searchParams;
  if (!SF_ID.test(id)) notFound();

  const auth = await pageAuth("viewer", viewPath(`/jobs/${id}`, search));
  if (!auth.ok) return auth.render;

  const position = await loadPosition(id);
  if (!position) notFound();

  const range = parseDashboardParams(search, new Date(), "all");
  const query = rangeQuery(range);
  const key = position.siteJobKey;
  // A job's chart starts when the job did, not at the start of an "all time" range.
  const createdDay = position.createdAt ? israelDay(position.createdAt) : range.fromDay;
  const chartFrom = createdDay > range.fromDay ? createdDay : range.fromDay;

  const [facts, gaMap, dailyOpens, events] = await Promise.all([
    loadApplicationFacts(),
    key ? loadJobGa(range.fromDay, range.toDay, key) : Promise.resolve(new Map()),
    key ? loadJobDailyOpens(key, chartFrom, range.toDay) : Promise.resolve(new Map<string, number>()),
    key ? loadJobEvents(key, range.fromDay, range.toDay) : Promise.resolve([]),
  ]);
  const ga = (key && gaMap.get(key)) || { pageViews: 0, opens: 0, applyClicks: 0, applyYes: 0 };
  const apps = facts
    .filter((f) => f.parentId === id && f.createdAt >= range.from && f.createdAt < range.to)
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  const funnel = applicationFunnel(apps);
  const statuses = new Map<string, number>();
  for (const a of apps) statuses.set(a.status ?? "ללא סטטוס", (statuses.get(a.status ?? "ללא סטטוס") ?? 0) + 1);
  const sfBase = process.env.SF_LOGIN_URL?.replace(/\/+$/, "");
  const series = eachDay(chartFrom, range.toDay).map((day) => ({ day, value: dailyOpens.get(day) ?? 0 }));

  return (
    <>
      <DashboardTabs active="jobs" query={query} />
      <p className="mb-4">
        <Link href={`/jobs?${query}`} className="text-sm font-medium text-accent-dark underline underline-offset-4">
          → כל המשרות
        </Link>
      </p>

      <section className="mb-6 overflow-hidden rounded-card border-2 border-line">
        <header className="bg-accent px-6 py-4 text-white">
          <h1 className="text-2xl font-bold">{position.title ?? "(ללא שם)"}</h1>
          <p className="text-white/85">{position.company ?? "—"}</p>
        </header>
        <div className="flex flex-wrap items-center gap-x-6 gap-y-2 bg-surface px-6 py-4 text-sm">
          <span>
            נפתחה: <span className="font-medium">{fmtDate(position.createdAt)}</span>
          </span>
          {position.caseNumber ? (
            <span>
              Case: <span className="font-medium tabular-nums">{position.caseNumber}</span>
            </span>
          ) : null}
          {position.paid ? <Badge tone="brand">משרה בתשלום</Badge> : <Badge>לא בתשלום</Badge>}
          {position.status ? <Badge>{position.status}</Badge> : null}
          {position.manageStatus ? <Badge tone="accent">ניהול משרה: {position.manageStatus}</Badge> : null}
          <span className="ms-auto flex gap-4">
            {key ? (
              <a href={siteJobUrl(key)} target="_blank" rel="noreferrer" className="font-medium text-accent-dark underline underline-offset-4">
                דף המשרה באתר
              </a>
            ) : (
              <span className="text-muted">המשרה לא עלתה לאתר</span>
            )}
            {sfBase ? (
              <a href={`${sfBase}/${position.id}`} target="_blank" rel="noreferrer" className="font-medium text-accent-dark underline underline-offset-4">
                Salesforce
              </a>
            ) : null}
          </span>
        </div>
      </section>

      {/* One job is paid or it is not: the scope is only carried along, not offered here. */}
      <DashboardShell preset={range.preset} scope={range.scope} fromDay={range.fromDay} toDay={range.toDay} showBasis={false} showScope={false}>
        <p className="mb-6 text-sm text-muted">
          {formatDay(range.fromDay)} – {formatDay(range.toDay)} · הגשות שנוצרו בטווח, והשלבים שהגיעו אליהם
        </p>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard label="פתיחות משרה באתר" value={key ? fmtInt(ga.opens) : "—"} hint={key ? `צפיות ישירות בדף: ${fmtInt(ga.pageViews)}` : "לא באתר"} />
          <StatCard label='לחיצות "הגש מועמדות"' value={key ? fmtInt(ga.applyClicks) : "—"} hint={key ? `${fmtPercent(ga.applyClicks, ga.opens)} מהפתיחות` : undefined} />
          <StatCard label="הגשות" value={fmtInt(funnel.applications)} hint={key ? `${fmtPercent(funnel.applications, ga.opens)} מהפתיחות` : undefined} />
          <StatCard label="התקבלו לעבודה" value={fmtInt(funnel.accepted)} hint={`${fmtPercent(funnel.accepted, funnel.applications)} מההגשות`} />
        </div>

        <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
          <Card title="באתר">
            {key ? (
              <BarList
                caption="משפך המשרה באתר"
                showShareOf={ga.opens || undefined}
                items={[
                  { label: "פתיחות משרה", value: ga.opens },
                  { label: 'לחיצות "הגש מועמדות"', value: ga.applyClicks },
                  { label: "אישור הגשה", value: ga.applyYes },
                  { label: "הגשות ב-Salesforce", value: funnel.applications },
                ].map((s, i) => ({ ...s, color: FUNNEL[i + 2] }))}
              />
            ) : (
              <p className="text-muted">למשרה אין מזהה באתר, ולכן אין לה נתוני Google Analytics.</p>
            )}
          </Card>
          <Card title="תהליך ההגשה">
            <BarList
              caption="משפך תהליך ההגשה"
              showShareOf={funnel.applications || undefined}
              items={[
                { label: "הגשות", value: funnel.applications },
                { label: 'התבקשו לשלוח קו"ח', value: funnel.requestedCv },
                { label: 'קו"ח נשלחו למעסיק', value: funnel.sent },
                { label: "תגובת מעסיק", value: funnel.responded },
                { label: "זומנו לראיון", value: funnel.interview },
                { label: "התקבלו", value: funnel.accepted },
              ].map((s, i) => ({ ...s, color: FUNNEL[i] }))}
            />
          </Card>
        </div>

        {key ? (
          <Card title="פתיחות המשרה לאורך זמן" className="mt-4">
            <LineChart series={[{ label: "פתיחות משרה", color: "var(--color-accent)", points: series }]} unit="פתיחות משרה" />
          </Card>
        ) : null}

        <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
          <Card title="סטטוס נוכחי של ההגשות">
            <BarList
              caption="הגשות לפי סטטוס נוכחי"
              items={[...statuses.entries()].sort((a, b) => b[1] - a[1]).map(([label, value]) => ({ label, value }))}
            />
          </Card>
          <Card title="כל האירועים באתר">
            <Table head={["אירוע", "כמות"]} empty={events.length === 0 ? "אין אירועים בטווח" : undefined}>
              {events.map((e) => (
                <tr key={e.event}>
                  <td className="px-3 py-2" dir="ltr">
                    {e.event}
                  </td>
                  <td className="px-3 py-2 tabular-nums">{fmtInt(e.count)}</td>
                </tr>
              ))}
            </Table>
          </Card>
        </div>

        <Card title={`ההגשות למשרה · ${fmtInt(apps.length)}`} tone="accent-light" className="mt-4">
          <Table head={["מועמד", "הוגשה", "סטטוס נוכחי", "שלבים", "מגעים", ""]} empty={apps.length === 0 ? "אין הגשות בטווח" : undefined}>
            {apps.map((a) => (
              <tr key={a.id}>
                <td className="px-3 py-2 font-medium">{a.candidateName ?? "—"}</td>
                <td className="whitespace-nowrap px-3 py-2 tabular-nums">{fmtDate(a.createdAt)}</td>
                <td className="px-3 py-2">{a.status ?? "—"}</td>
                <td className="px-3 py-2">
                  <div className="flex flex-wrap gap-1">
                    <Stage reached={Boolean(a.requestedCvAt)} label='ביקשנו קו"ח' />
                    <Stage reached={Boolean(a.sentAt)} label="נשלח למעסיק" />
                    <Stage reached={Boolean(a.employerResponseAt)} label="תגובת מעסיק" />
                    <Stage reached={Boolean(a.interviewAt)} label="ראיון" />
                    {a.acceptedAt ? <Badge tone="success">התקבל</Badge> : null}
                  </div>
                </td>
                <td className="whitespace-nowrap px-3 py-2 text-xs text-muted">
                  מועמד {fmtDecimal(a.candidateTouchesBeforeSent)} · מעסיק {fmtDecimal(a.employerTouchesAfterSent)}
                </td>
                <td className="px-3 py-2 text-end">
                  {sfBase ? (
                    <a href={`${sfBase}/${a.id}`} target="_blank" rel="noreferrer" className="text-sm font-medium text-accent-dark underline underline-offset-4">
                      Salesforce
                    </a>
                  ) : null}
                </td>
              </tr>
            ))}
          </Table>
        </Card>
      </DashboardShell>
    </>
  );
}

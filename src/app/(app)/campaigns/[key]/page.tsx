import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { LineChart } from "@/components/dashboard/LineChart";
import { DashboardTabs } from "@/components/dashboard/DashboardTabs";
import { Badge, buttonClass, Card, formatDateTime, StatCard, Table } from "@/components/ui";
import { pageAuth } from "@/lib/auth/guard";
import { hasRole } from "@/lib/auth/roles";
import { addDays, eachDay, formatDay, israelDay, parseDashboardParams, rangeQuery, viewPath } from "@/lib/dashboard/params";
import { fmtInt, fmtPercent } from "@/lib/format";
import {
  campaignLabel,
  IMPACT_DAYS,
  isMailing,
  loadCampaignDailySessions,
  loadCampaignLandingPages,
  loadCampaignSummaries,
  loadJobImpacts,
  loadLinkedJobIds,
  loadSmoovStats,
} from "@/lib/metrics/campaigns";
import { loadApplicationFacts } from "@/lib/metrics/candidates";
import { loadPositionsByIds, loadPositionsByJobKeys } from "@/lib/metrics/jobs";
import { linkJob, unlinkJob } from "../actions";
import { CampaignSettingsForm, JobLinker } from "../CampaignEditor";

export const metadata: Metadata = { title: "דיוור" };
export const dynamic = "force-dynamic";

const ALL_FROM = "2025-02-01";

function Delta({ before, after }: { before: number; after: number }) {
  const diff = after - before;
  return (
    <span className="tabular-nums">
      {fmtInt(before)} → <span className="font-bold">{fmtInt(after)}</span>
      {diff !== 0 ? <span className={`ms-1 text-xs ${diff > 0 ? "text-success" : "text-danger"}`}>({diff > 0 ? "+" : ""}{fmtInt(diff)})</span> : null}
    </span>
  );
}

export default async function CampaignPage({
  params,
  searchParams,
}: {
  params: Promise<{ key: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const key = decodeURIComponent((await params).key);
  const search = await searchParams;
  const auth = await pageAuth("viewer", viewPath(`/campaigns/${encodeURIComponent(key)}`, search));
  if (!auth.ok) return auth.render;

  const query = rangeQuery(parseDashboardParams(search, new Date(), "90d"));
  const today = israelDay();
  const [summary] = await loadCampaignSummaries(ALL_FROM, today, key);
  if (!summary) notFound();

  const canEdit = hasRole(auth.user.role, "editor");
  const chartFrom = addDays(summary.sendDay, -21) < summary.firstDay ? addDays(summary.sendDay, -21) : addDays(summary.firstDay, -3);
  const chartTo = addDays(summary.lastDay, 7) > today ? today : addDays(summary.lastDay, 7);

  const [daily, landing, linkedIds, facts, smoov] = await Promise.all([
    loadCampaignDailySessions(key, chartFrom, chartTo),
    loadCampaignLandingPages(key),
    loadLinkedJobIds(key),
    loadApplicationFacts(),
    summary.smoovCampaignId ? loadSmoovStats(summary.smoovCampaignId) : Promise.resolve(null),
  ]);
  const [linkedJobs, landingJobs] = await Promise.all([
    loadPositionsByIds(linkedIds),
    loadPositionsByJobKeys(landing.map((l) => l.siteJobKey).filter((k): k is string => Boolean(k))),
  ]);
  const impacts = await loadJobImpacts(key, summary.sendDay, linkedJobs, facts);
  const jobByKey = new Map(landingJobs.map((p) => [p.siteJobKey, p]));
  const series = eachDay(chartFrom, chartTo).map((day) => ({ day, value: daily.get(day) ?? 0 }));
  const afterTo = addDays(summary.sendDay, IMPACT_DAYS - 1);

  return (
    <>
      <DashboardTabs active="campaigns" query={query} />
      <p className="mb-4">
        <Link href={`/campaigns?${query}`} className="text-sm font-medium text-accent-dark underline underline-offset-4">
          → כל הקמפיינים
        </Link>
      </p>

      <section className="mb-6 overflow-hidden rounded-card border-2 border-line">
        <header className="bg-accent px-6 py-4 text-white">
          <h1 className="text-2xl font-bold" dir="auto">
            {campaignLabel(summary)}
          </h1>
          {summary.label ? (
            <p className="text-white/85" dir="ltr">
              {summary.key}
            </p>
          ) : null}
        </header>
        <div className="flex flex-wrap items-center gap-x-6 gap-y-2 bg-surface px-6 py-4 text-sm">
          {isMailing(summary) ? <Badge tone="brand">דיוור · {summary.medium}</Badge> : <Badge>{summary.medium}</Badge>}
          <span>
            יום שליחה: <span className="font-medium">{formatDay(summary.sendDay)}</span>
            {summary.sendDay !== summary.detectedSendDay ? <span className="text-xs text-muted"> (תוקן ידנית; יום השיא {formatDay(summary.detectedSendDay)})</span> : null}
          </span>
          <span>
            פעילות: {formatDay(summary.firstDay)} – {formatDay(summary.lastDay)}
          </span>
          {summary.smoovCampaignId ? <span dir="ltr">SMOOV #{summary.smoovCampaignId}</span> : null}
        </div>
      </section>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="כניסות מהקמפיין" value={fmtInt(summary.sessions)} hint={`${fmtInt(summary.newUsers)} משתמשים חדשים · מעורבות ${fmtPercent(summary.engaged, summary.sessions)}`} />
        <StatCard label="פתיחות משרה" value={fmtInt(summary.opens)} hint="בכניסות מהקמפיין" />
        <StatCard label='לחיצות "הגש מועמדות"' value={fmtInt(summary.applyClicks)} hint={`אישורי הגשה: ${fmtInt(summary.applyYes)}`} />
        <StatCard
          label="SMOOV"
          value={smoov?.sent != null ? fmtInt(smoov.sent) : "—"}
          hint={
            smoov
              ? `נמענים · פתיחות ${fmtPercent(smoov.opens ?? 0, smoov.sent ?? 0)} · הקלקות ${fmtPercent(smoov.clicks ?? 0, smoov.sent ?? 0)} · הסרות ${fmtInt(smoov.unsubscribes ?? 0)}`
              : summary.smoovCampaignId
                ? "הסטטיסטיקות יתעדכנו בסנכרון הבא של SMOOV"
                : "לא מקושר לקמפיין ב-SMOOV"
          }
        />
      </div>

      <Card title="כניסות מהקמפיין לאורך זמן" className="mt-4">
        <LineChart
          series={[{ label: "כניסות מהקמפיין", color: "var(--color-accent)", points: series }]}
          unit="כניסות"
          markers={[{ day: summary.sendDay, label: `יום השליחה · ${campaignLabel(summary)}` }]}
        />
      </Card>

      <Card title={`משרות מקושרות · ${fmtInt(impacts.length)}`} className="mt-4">
        <p className="mb-3 text-sm text-muted">
          {IMPACT_DAYS} הימים שמיום השליחה ({formatDay(summary.sendDay)}–{formatDay(afterTo)}) מול {IMPACT_DAYS} הימים שלפניו. פתיחות ולחיצות מכל התנועה לאתר, לא רק מהקמפיין.
        </p>
        <Table
          head={["משרה", "כניסות מהקמפיין לדף המשרה", "פתיחות משרה", "לחיצות הגשה", "הגשות", ""]}
          empty={impacts.length === 0 ? "עדיין לא קושרו משרות לקמפיין" : undefined}
        >
          {impacts.map((i) => (
            <tr key={i.position.id}>
              <td className="px-3 py-2">
                <Link href={`/jobs/${i.position.id}`} className="font-medium underline-offset-4 hover:underline">
                  {i.position.title ?? "(ללא שם)"}
                </Link>
                <p className="text-xs text-muted">{i.position.company ?? "—"}</p>
              </td>
              <td className="px-3 py-2 tabular-nums">{i.position.siteJobKey ? fmtInt(i.campaignSessions) : "—"}</td>
              <td className="px-3 py-2">{i.position.siteJobKey ? <Delta before={i.before.opens} after={i.after.opens} /> : "—"}</td>
              <td className="px-3 py-2">{i.position.siteJobKey ? <Delta before={i.before.applyClicks} after={i.after.applyClicks} /> : "—"}</td>
              <td className="px-3 py-2">
                <Delta before={i.before.applications} after={i.after.applications} />
              </td>
              <td className="px-3 py-2 text-end">
                {canEdit ? (
                  <form action={unlinkJob}>
                    <input type="hidden" name="key" value={key} />
                    <input type="hidden" name="jobId" value={i.position.id} />
                    <button className={buttonClass("quiet", "sm")}>הסרת קישור</button>
                  </form>
                ) : null}
              </td>
            </tr>
          ))}
        </Table>
        {canEdit ? (
          <div className="mt-4 border-t-2 border-line pt-4">
            <JobLinker campaignKey={key} linkedIds={linkedIds} />
          </div>
        ) : null}
      </Card>

      <Card title="דפי נחיתה מהקמפיין" tone="accent-light" className="mt-4">
        <Table head={["דף", "כניסות", ""]} empty={landing.length === 0 ? "אין נתונים" : undefined}>
          {landing.map((l) => {
            const job = l.siteJobKey ? jobByKey.get(l.siteJobKey) : undefined;
            return (
              <tr key={l.page}>
                <td className="px-3 py-2">
                  {job ? (
                    <>
                      <span className="font-medium">{job.title}</span> <span className="text-xs text-muted">· {job.company ?? "—"}</span>
                    </>
                  ) : (
                    <span dir="ltr">{l.page}</span>
                  )}
                </td>
                <td className="px-3 py-2 tabular-nums">{fmtInt(l.sessions)}</td>
                <td className="px-3 py-2 text-end">
                  {job && canEdit && !linkedIds.includes(job.id) ? (
                    <form action={linkJob}>
                      <input type="hidden" name="key" value={key} />
                      <input type="hidden" name="jobId" value={job.id} />
                      <button className={buttonClass("secondary", "sm")}>קישור המשרה</button>
                    </form>
                  ) : job && linkedIds.includes(job.id) ? (
                    <span className="text-xs text-success">מקושרת</span>
                  ) : null}
                </td>
              </tr>
            );
          })}
        </Table>
      </Card>

      {canEdit ? (
        <Card title="הגדרות הקמפיין" className="mt-4">
          <CampaignSettingsForm
            campaignKey={key}
            label={summary.label}
            smoovCampaignId={summary.smoovCampaignId}
            sendDay={summary.sendDay !== summary.detectedSendDay ? summary.sendDay : null}
            detectedSendDay={summary.detectedSendDay}
          />
          {smoov?.fetchedAt ? <p className="mt-3 text-xs text-muted">נתוני SMOOV עודכנו {formatDateTime(smoov.fetchedAt)}</p> : null}
        </Card>
      ) : null}
    </>
  );
}

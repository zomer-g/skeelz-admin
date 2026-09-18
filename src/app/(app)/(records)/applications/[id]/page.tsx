import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { EntityHeader, FieldList, Timeline } from "@/components/entities/EntityParts";
import { InfoTip } from "@/components/Explained";
import { Badge, Card } from "@/components/ui";
import { EXPLAIN } from "@/lib/dashboard/explain";
import { pageAuth } from "@/lib/auth/guard";
import { loadCaseTimeline } from "@/lib/entities/activity";
import { APPLICATION_TYPES, loadApplication } from "@/lib/entities/applications";
import { loadJobDetails } from "@/lib/entities/companies";
import { isSfId, sfRecordUrl } from "@/lib/entities/search";
import { fmtDate } from "@/lib/format";
import { siteJobUrl } from "@/lib/metrics/jobs";

export const metadata: Metadata = { title: "הגשה" };
export const dynamic = "force-dynamic";

export default async function ApplicationPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isSfId(id)) notFound();
  const auth = await pageAuth("viewer", `/applications/${id}`);
  if (!auth.ok) return auth.render;

  const app = await loadApplication(id);
  if (!app) notFound();
  const [timeline, job] = await Promise.all([loadCaseTimeline(id), app.jobId ? loadJobDetails(app.jobId) : Promise.resolve(null)]);

  return (
    <>
      <EntityHeader
        back={{ href: "/applications", label: "כל ההגשות" }}
        title={app.candidateName ?? "הגשה"}
        subtitle={
          <span>
            {app.jobTitle ?? "—"} · {app.company ?? "—"}
          </span>
        }
        badges={
          <>
            <Badge tone="accent">{app.status ?? "ללא סטטוס"}</Badge>
            <Badge tone={app.type === "accepted" ? "success" : "neutral"}>{APPLICATION_TYPES.find((t) => t.key === app.type)?.label}</Badge>
            <InfoTip label='סטטוס "התקבל" מול "השמה"' text={EXPLAIN.statusVsPlacement} />
            {app.paid ? <Badge tone="brand">בתשלום</Badge> : <Badge>לא בתשלום</Badge>}
            <span className="tabular-nums text-muted">Case {app.caseNumber}</span>
          </>
        }
        links={[
          { href: sfRecordUrl(app.id), label: "Salesforce", external: true },
          { href: app.siteJobKey ? siteJobUrl(app.siteJobKey) : null, label: "המשרה באתר", external: true },
        ]}
      />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card title="ההגשה" className="lg:col-span-2">
          <FieldList
            items={[
              ["הוגשה", fmtDate(app.createdAt)],
              ["נסגרה", app.closedAt ? fmtDate(app.closedAt) : null],
              ["סטטוס", app.status],
              ["מטפל", app.ownerName],
              ["סיבות דחייה", app.rejectReasons.length ? app.rejectReasons.join(" · ") : null],
              ["הגשה מהירה", app.fastApplied ? "כן" : null],
              ["סטטוס מועמד", app.candidateStatus],
              ["תאריך השמה", app.placementDate],
            ]}
          />
        </Card>
        <Card title="מועמד">
          <FieldList
            items={[
              [
                "שם",
                app.candidateId ? (
                  <Link href={`/candidates/${app.candidateId}`} className="underline underline-offset-4">
                    {app.candidateName ?? "(ללא שם)"}
                  </Link>
                ) : (
                  app.candidateName
                ),
              ],
              ["מייל", app.candidateEmail ? <a href={`mailto:${app.candidateEmail}`} dir="ltr">{app.candidateEmail}</a> : null],
              ["טלפון", app.candidatePhone ? <a href={`tel:${app.candidatePhone}`} dir="ltr">{app.candidatePhone}</a> : null],
            ]}
          />
        </Card>
      </div>

      <Card title="משרה" className="mt-4">
        <FieldList
          items={[
            [
              "משרה",
              app.jobId ? (
                <Link href={`/positions/${app.jobId}`} className="underline underline-offset-4">
                  {app.jobTitle ?? "(ללא שם)"}
                </Link>
              ) : (
                app.jobTitle
              ),
            ],
            [
              "מעסיק",
              job?.companyKey ? (
                <Link href={`/companies/${encodeURIComponent(job.companyKey)}`} className="underline underline-offset-4">
                  {job.companyName ?? app.company}
                </Link>
              ) : (
                app.company
              ),
            ],
            ["מיקום", job?.location],
            ["איש קשר", job?.contactName],
            ["מייל איש הקשר", job?.contactEmail ? <span dir="ltr">{job.contactEmail}</span> : null],
          ]}
        />
      </Card>

      {app.description ? (
        <Card title="פרטי הפנייה" tone="accent-light" className="mt-4">
          <p className="whitespace-pre-line" dir="auto">
            {app.description}
          </p>
        </Card>
      ) : null}

      <Card title="ציר זמן" className="mt-4">
        <Timeline items={timeline} />
        <p className="mt-3 text-xs text-muted">שינויי סטטוס, סוג ומטפל מהיסטוריית Salesforce (מ-13.3.2025), מיילים ושיחות שנרשמו על ההגשה.</p>
      </Card>
    </>
  );
}

import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { EntityHeader, FieldList, Timeline } from "@/components/entities/EntityParts";
import { Badge, Card, formatDateTime } from "@/components/ui";
import { pageAuth } from "@/lib/auth/guard";
import { loadCaseTimeline } from "@/lib/entities/activity";
import { loadApplication } from "@/lib/entities/applications";
import { loadJobDetails } from "@/lib/entities/companies";
import { isSfId, sfRecordUrl } from "@/lib/entities/search";
import { fmtDate, fmtInt } from "@/lib/format";
import { siteJobUrl } from "@/lib/metrics/jobs";

export const metadata: Metadata = { title: "הגשה" };
export const dynamic = "force-dynamic";

const yesNo = (v: boolean) => (v ? "כן" : "לא");
const day = (v: string | null) => (v ? fmtDate(new Date(`${v}T00:00:00`)) : null);

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
              ["Case Number", app.caseNumber],
              ["סוג רשומה (Case Record Type)", app.recordType],
              ["הוגשה", fmtDate(app.createdAt)],
              ["נסגרה", app.closedAt ? fmtDate(app.closedAt) : null],
              ["אורך חיי המקרה", app.ageDays != null ? `${fmtInt(app.ageDays)} ימים` : null],
              ["סטטוס", app.status],
              ["סטטוס השמה", app.placementStatus],
              ["מטפל (Case Owner)", app.ownerName],
              ["חוסר התאמה", app.rejectReasons.length ? app.rejectReasons.join(" · ") : null],
              ["הגשה מהירה", yesNo(app.fastApplied)],
              ["הגשה למשרה בתשלום (שדה)", yesNo(app.paidApplicationFlag)],
              ["משרה של זהר", yesNo(app.zohar)],
              ["פולו-אפ", day(app.followUp)],
              ["Subject", app.subject],
              ["Account Name", app.accountName],
              ["Case Type", app.type],
              ["Case Origin", app.origin],
              ["Case Reason", app.reason],
              ["Priority", app.priority],
              ["Case Source", app.sourceId],
              ["Web Email", app.webEmail ? <a href={`mailto:${app.webEmail}`} dir="ltr">{app.webEmail}</a> : null],
              ["נוצרה על ידי (Created By)", app.createdByName],
              ["עודכנה לאחרונה (Last Modified By)", app.lastModifiedByName ? `${app.lastModifiedByName}${app.lastModifiedAt ? ` · ${formatDateTime(app.lastModifiedAt)}` : ""}` : null],
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
            ["Parent Case", app.jobCaseNumber],
            ["מיקום", job?.location],
            ["איש קשר", job?.contactName],
            ["מייל איש הקשר", job?.contactEmail ? <span dir="ltr">{job.contactEmail}</span> : null],
          ]}
        />
      </Card>

      <Card title="השמה ופיננסי" tone="accent-light" className="mt-4">
        <FieldList
          items={[
            ["תאריך תחילת עבודה", day(app.startDate)],
            ["תאריך השמה", day(app.placementDate)],
            ["התקבל/ה (לפי הסטטוס)", app.acceptedAt ? fmtDate(app.acceptedAt) : null],
            ["אחוז משכר", app.salaryPercent != null ? `${app.salaryPercent}%` : null],
            ['לגביה לפני מע"מ',app.collectionBeforeVat != null ? `₪${app.collectionBeforeVat.toLocaleString("he-IL")}` : null],
            ["עמלה 7.5%", app.commission],
            ["תאריך החשבונית", day(app.invoiceDate)],
            ["תאריך לתשלום", day(app.paymentDate)],
            ["סטטוס פרויקט", app.projectStatus],
            ["סטטוס מועמד", app.candidateStatus],
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
        <p className="mt-3 text-xs text-muted">שינויי סטטוס ומטפל מהיסטוריית Salesforce (מ-13.3.2025), מיילים ושיחות שנרשמו על ההגשה.</p>
      </Card>
    </>
  );
}

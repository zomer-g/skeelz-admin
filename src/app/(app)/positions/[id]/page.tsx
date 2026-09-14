import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ApplicationsTable, EntityHeader, FieldList, Timeline } from "@/components/entities/EntityParts";
import { Badge, Card } from "@/components/ui";
import { pageAuth } from "@/lib/auth/guard";
import { loadCaseTimeline } from "@/lib/entities/activity";
import { searchApplications } from "@/lib/entities/applications";
import { jobStatusLabel, loadJobDetails } from "@/lib/entities/companies";
import { isSfId, sfRecordUrl } from "@/lib/entities/search";
import { fmtDate, fmtInt } from "@/lib/format";
import { loadJobActivity } from "@/lib/metrics/employers";
import { loadPosition, siteJobUrl } from "@/lib/metrics/jobs";

export const metadata: Metadata = { title: "משרה" };
export const dynamic = "force-dynamic";

const MAX_APPLICATIONS = 100;
const ACTIVITY_LABEL = { call: "שיחה", email: "מייל", task: "משימה" } as const;

/**
 * A job as an entity, reached from its employer or its applications: its fields,
 * applications and activity. The job's analytics (site funnel, GA) stay on the
 * dashboard's /jobs/[id].
 */
export default async function PositionPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isSfId(id)) notFound();
  const auth = await pageAuth("viewer", `/positions/${id}`);
  if (!auth.ok) return auth.render;

  const [position, details] = await Promise.all([loadPosition(id), loadJobDetails(id)]);
  if (!position) notFound();
  const [timeline, applications, activity] = await Promise.all([
    loadCaseTimeline(id),
    searchApplications({ q: "", status: "", type: "", paid: "", owner: "", fromDay: "", toDay: "", jobId: id }, { pageSize: MAX_APPLICATIONS }),
    loadJobActivity([id]),
  ]);
  const last = activity.get(id) ?? null;
  const companyHref = details?.companyKey ? `/companies/${encodeURIComponent(details.companyKey)}` : null;
  const companyName = position.company ?? details?.companyName ?? null;

  return (
    <>
      <EntityHeader
        back={companyHref ? { href: companyHref, label: `כל המשרות של ${companyName ?? "המעסיק"}` } : { href: "/companies", label: "כל המעסיקים" }}
        title={position.title ?? "(ללא שם)"}
        subtitle={
          companyHref ? (
            <Link href={companyHref} className="text-white underline underline-offset-4 focus-visible:outline-white">
              {companyName}
            </Link>
          ) : (
            (companyName ?? undefined)
          )
        }
        badges={
          <>
            {position.paid ? <Badge tone="brand">משרה בתשלום</Badge> : <Badge>לא בתשלום</Badge>}
            {details?.status ? <Badge tone={details.status === "Active" ? "success" : "neutral"}>באתר: {jobStatusLabel(details.status)}</Badge> : null}
            {position.caseNumber ? <span className="tabular-nums text-muted">Case {position.caseNumber}</span> : null}
          </>
        }
        links={[
          { href: position.siteJobKey ? siteJobUrl(position.siteJobKey) : null, label: "דף המשרה באתר", external: true },
          { href: sfRecordUrl(position.id), label: "Salesforce", external: true },
          { href: `/jobs/${position.id}`, label: "ניתוח המשרה בדשבורד" },
        ]}
      />

      <Card title="פרטי המשרה">
        <FieldList
          items={[
            ["מעסיק", companyHref ? <Link href={companyHref} className="underline underline-offset-4">{companyName}</Link> : companyName],
            ["מיקום", details?.location],
            ["היקף", details?.time],
            ["נפתחה", fmtDate(position.createdAt)],
            ["עודכנה באתר", details?.siteUpdatedAt ? fmtDate(details.siteUpdatedAt) : null],
            ["הגשה עצמית באתר", details?.selfApply ? "כן" : null],
            ["איש קשר", details?.contactName],
            ["מייל איש הקשר", details?.contactEmail ? <a href={`mailto:${details.contactEmail}`} dir="ltr">{details.contactEmail}</a> : null],
            ["טלפון איש הקשר", details?.contactPhone ? <a href={`tel:${details.contactPhone}`} dir="ltr">{details.contactPhone}</a> : null],
            [
              "אימות אחרון",
              last ? `${fmtDate(last.at)} · ${ACTIVITY_LABEL[last.kind]}${last.onApplication ? " בהגשה" : ""}` : "לא נרשם קשר עם המעסיק על המשרה",
            ],
          ]}
        />
        {details?.comments ? (
          <div className="mt-4">
            <p className="text-xs text-muted">הערות פנימיות</p>
            <p className="whitespace-pre-line" dir="auto">
              {details.comments}
            </p>
          </div>
        ) : null}
        {details?.description ? (
          <details className="mt-4">
            <summary className="cursor-pointer text-sm font-medium text-accent-dark">תיאור המשרה</summary>
            <p className="mt-2 whitespace-pre-line text-sm" dir="auto">
              {details.description}
            </p>
          </details>
        ) : null}
      </Card>

      <Card title={`הגשות · ${fmtInt(applications.total)}`} tone="accent-light" className="mt-4">
        <ApplicationsTable rows={applications.rows} hide={["job"]} empty="אין הגשות למשרה" />
        {applications.total ? (
          <p className="mt-3 text-sm">
            <Link href={`/applications?job=${position.id}`} className="font-medium text-accent-dark underline underline-offset-4">
              ההגשות למשרה בחיפוש המתקדם
            </Link>
          </p>
        ) : null}
      </Card>

      <Card title="פעילות על המשרה" className="mt-4">
        <Timeline items={timeline} empty="לא נרשמה פעילות על המשרה עצמה" />
        <p className="mt-3 text-xs text-muted">שיחות, מיילים ומשימות שנרשמו על ה-Case של המשרה. קשר מול המעסיק בתוך ההגשות מופיע בדף כל הגשה.</p>
      </Card>
    </>
  );
}

import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ApplicationsTable, EntityHeader, FieldList, Timeline } from "@/components/entities/EntityParts";
import { JobTexts, jobFieldItems, MarkedBadge } from "@/components/entities/JobFields";
import { Badge, Card } from "@/components/ui";
import { pageAuth } from "@/lib/auth/guard";
import { loadFullCaseTimeline } from "@/lib/entities/activity";
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
  const [{ items: timeline, live }, applications, activity] = await Promise.all([
    loadFullCaseTimeline(id),
    searchApplications({ q: "", status: "", paid: "", owner: "", fromDay: "", toDay: "", jobId: id }, { pageSize: MAX_APPLICATIONS }),
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
            {position.marked ? <MarkedBadge /> : null}
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
            ...jobFieldItems(position, details),
            [
              "אימות אחרון",
              last ? `${fmtDate(last.at)} · ${ACTIVITY_LABEL[last.kind]}${last.onApplication ? " בהגשה" : ""}` : "לא נרשם קשר עם המעסיק על המשרה",
            ],
          ]}
        />
        <JobTexts details={details} />
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
        <p className="mt-3 text-xs text-muted">
          שיחות, מיילים, משימות, פגישות והערות שנרשמו על ה-Case של המשרה; ההערות ותוכן המיילים נקראים ישירות מ-Salesforce. קשר מול המעסיק בתוך ההגשות
          מופיע בדף כל הגשה.{live === "failed" ? " התוכן המלא (הערות ותוכן המיילים) לא נטען כרגע מ-Salesforce; אפשר לרענן את הדף." : ""}
        </p>
      </Card>
    </>
  );
}

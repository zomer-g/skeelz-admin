import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ApplicationsTable, EntityHeader, FieldList } from "@/components/entities/EntityParts";
import { Badge, Card, Table } from "@/components/ui";
import { pageAuth } from "@/lib/auth/guard";
import { searchApplications } from "@/lib/entities/applications";
import { jobStatusLabel, loadCompany } from "@/lib/entities/companies";
import { sfRecordUrl } from "@/lib/entities/search";
import { fmtDate, fmtInt } from "@/lib/format";
import { daysSince, loadJobActivity, NO_TOUCH_DAYS } from "@/lib/metrics/employers";
import { siteJobUrl } from "@/lib/metrics/jobs";

export const metadata: Metadata = { title: "מעסיק" };
export const dynamic = "force-dynamic";

const RECENT_APPLICATIONS = 25;

export default async function CompanyPage({ params }: { params: Promise<{ key: string }> }) {
  let key: string;
  try {
    key = decodeURIComponent((await params).key);
  } catch {
    notFound(); // a stray "%" in the URL
  }
  const auth = await pageAuth("viewer", `/companies/${encodeURIComponent(key)}`);
  if (!auth.ok) return auth.render;

  const found = await loadCompany(key);
  if (!found) notFound();
  const { company, jobs } = found;

  const [activity, applications] = await Promise.all([
    loadJobActivity(jobs.map((j) => j.id)),
    searchApplications({ q: "", status: "", type: "", paid: "", owner: "", fromDay: "", toDay: "", companyKey: key }, { pageSize: RECENT_APPLICATIONS }),
  ]);
  const now = new Date();

  return (
    <>
      <EntityHeader
        back={{ href: "/companies", label: "כל המעסיקים" }}
        title={company.name}
        subtitle={company.locations.slice(0, 4).join(" · ") || undefined}
        badges={
          <>
            <Badge tone={company.activeJobs ? "accent" : "neutral"}>{fmtInt(company.activeJobs)} משרות פעילות</Badge>
            {company.paidJobs ? <Badge tone="brand">{fmtInt(company.paidJobs)} משרות בתשלום</Badge> : null}
          </>
        }
        links={[{ href: `/applications?company=${encodeURIComponent(key)}`, label: "כל ההגשות למעסיק" }]}
      />

      <Card title="פרטי המעסיק">
        <FieldList
          items={[
            ["איש קשר", company.contactName],
            ["מייל", company.contactEmail ? <a href={`mailto:${company.contactEmail}`} dir="ltr">{company.contactEmail}</a> : null],
            ["טלפון", company.contactPhone ? <a href={`tel:${company.contactPhone}`} dir="ltr">{company.contactPhone}</a> : null],
            ["מיקומי משרות", company.locations.join(" · ")],
            ["משרות", `${fmtInt(company.activeJobs)} פעילות מתוך ${fmtInt(company.jobs)}`],
            ["משרות בתשלום", company.paidJobs ? `${fmtInt(company.paidActiveJobs)} פעילות מתוך ${fmtInt(company.paidJobs)}` : null],
            ["הגשות", fmtInt(company.applications)],
            ["משרה ראשונה", fmtDate(company.firstJobAt)],
            ["משרה אחרונה", fmtDate(company.lastJobAt)],
          ]}
        />
        <p className="mt-3 text-xs text-muted">פרטי הקשר מהמשרה האחרונה של המעסיק.</p>
      </Card>

      <Card title={`משרות · ${fmtInt(jobs.length)}`} className="mt-4">
        <Table head={["משרה", "סטטוס באתר", "מיקום והיקף", "נפתחה", "הגשות", "אימות אחרון", ""]} empty={jobs.length === 0 ? "אין משרות" : undefined}>
          {jobs.map((j) => {
            const last = activity.get(j.id) ?? null;
            const days = daysSince(last?.at ?? null, now);
            return (
              <tr key={j.id}>
                <td className="px-3 py-2">
                  <Link href={`/positions/${j.id}`} className="font-medium underline-offset-4 hover:underline">
                    {j.title ?? "(ללא שם)"}
                  </Link>{" "}
                  {j.paid ? <Badge tone="brand">בתשלום</Badge> : null}
                  <p className="text-xs tabular-nums text-muted">
                    {j.caseNumber}
                    {j.contactName ? ` · ${j.contactName}` : ""}
                  </p>
                </td>
                <td className="px-3 py-2">
                  <Badge tone={j.status === "Active" ? "success" : j.status === "Suspended" ? "warning" : "neutral"}>{jobStatusLabel(j.status)}</Badge>
                </td>
                <td className="px-3 py-2 text-xs">
                  {j.location ?? "—"}
                  {j.time ? <p className="text-muted">{j.time}</p> : null}
                </td>
                <td className="whitespace-nowrap px-3 py-2 tabular-nums">{fmtDate(j.createdAt)}</td>
                <td className="px-3 py-2 tabular-nums">
                  {j.applications ? (
                    <Link href={`/applications?job=${j.id}`} className="underline underline-offset-4">
                      {fmtInt(j.applications)}
                    </Link>
                  ) : (
                    "0"
                  )}
                </td>
                <td className="whitespace-nowrap px-3 py-2 text-xs">
                  {last ? (
                    days != null && days > NO_TOUCH_DAYS && j.status === "Active" ? (
                      <span className="flex flex-wrap items-center gap-1">
                        <span className="font-medium text-[#93370d]">{fmtDate(last.at)}</span>
                        <Badge tone="warning">מעל {NO_TOUCH_DAYS} יום</Badge>
                      </span>
                    ) : (
                      <span>{fmtDate(last.at)}</span>
                    )
                  ) : (
                    <span className="text-muted">—</span>
                  )}
                </td>
                <td className="whitespace-nowrap px-3 py-2 text-end text-sm">
                  <span className="flex justify-end gap-3">
                    {j.siteJobKey ? (
                      <a href={siteJobUrl(j.siteJobKey)} target="_blank" rel="noreferrer" className="font-medium text-accent-dark underline underline-offset-4">
                        באתר<span className="sr-only"> · {j.title ?? ""} (נפתח בלשונית חדשה)</span>
                      </a>
                    ) : null}
                    {sfRecordUrl(j.id) ? (
                      <a href={sfRecordUrl(j.id)!} target="_blank" rel="noreferrer" className="font-medium text-accent-dark underline underline-offset-4">
                        Salesforce<span className="sr-only"> · {j.title ?? ""} (נפתח בלשונית חדשה)</span>
                      </a>
                    ) : null}
                  </span>
                </td>
              </tr>
            );
          })}
        </Table>
      </Card>

      <Card title={`הגשות אחרונות · ${fmtInt(applications.total)}`} tone="accent-light" className="mt-4">
        <ApplicationsTable rows={applications.rows} />
        {applications.total > RECENT_APPLICATIONS ? (
          <p className="mt-3 text-sm">
            <Link href={`/applications?company=${encodeURIComponent(key)}`} className="font-medium text-accent-dark underline underline-offset-4">
              לכל {fmtInt(applications.total)} ההגשות, עם חיפוש
            </Link>
          </p>
        ) : null}
      </Card>
    </>
  );
}

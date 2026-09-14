import type { Metadata } from "next";
import Link from "next/link";
import { ApplicationsTable } from "@/components/entities/EntityParts";
import { Pager, SearchForm } from "@/components/entities/Search";
import { Card, PageHeader } from "@/components/ui";
import { pageAuth } from "@/lib/auth/guard";
import { viewPath } from "@/lib/dashboard/params";
import { APPLICATION_TYPES, loadApplicationFilterOptions, searchApplications, type ApplicationFilters } from "@/lib/entities/applications";
import { loadCandidate } from "@/lib/entities/candidates";
import { choice, dayParam, isSfId, PAGE_SIZE, pageParam, param, type SearchParams } from "@/lib/entities/search";
import { fmtInt } from "@/lib/format";
import { loadPosition } from "@/lib/metrics/jobs";

export const metadata: Metadata = { title: "הגשות" };
export const dynamic = "force-dynamic";

const ACTION = "/applications";
const KEYS = ["q", "status", "type", "paid", "owner", "from", "to", "job", "candidate", "company", "page"];

export default async function ApplicationsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const search = await searchParams;
  const auth = await pageAuth("viewer", viewPath(ACTION, search, KEYS));
  if (!auth.ok) return auth.render;

  const jobId = isSfId(param(search, "job")) ? param(search, "job") : "";
  const contactId = isSfId(param(search, "candidate")) ? param(search, "candidate") : "";
  const companyKey = param(search, "company", 300);
  const filters: ApplicationFilters = {
    q: param(search, "q"),
    status: param(search, "status"),
    type: choice(search, "type", ["application", "accepted"] as const),
    paid: choice(search, "paid", ["paid", "unpaid"] as const),
    owner: param(search, "owner"),
    fromDay: dayParam(search, "from"),
    toDay: dayParam(search, "to"),
    jobId,
    contactId,
    companyKey,
  };
  const page = pageParam(search);

  const [{ rows, total }, options, job, candidate] = await Promise.all([
    searchApplications(filters, { page }),
    loadApplicationFilterOptions(),
    jobId ? loadPosition(jobId) : Promise.resolve(null),
    contactId ? loadCandidate(contactId) : Promise.resolve(null),
  ]);

  // Scope parameters (a job, a candidate, an employer) are kept across searches but are not form fields.
  const scope = { job: jobId, candidate: contactId, company: companyKey };
  const values: Record<string, string> = {
    q: filters.q,
    status: filters.status,
    type: filters.type,
    paid: filters.paid,
    owner: filters.owner,
    from: filters.fromDay,
    to: filters.toDay,
  };
  const scopeLabel = job ? `משרה: ${job.title ?? "(ללא שם)"}` : candidate ? `מועמד: ${candidate.name ?? "(ללא שם)"}` : companyKey ? `מעסיק: ${companyKey}` : null;

  return (
    <>
      <PageHeader title="הגשות" subtitle="הגשות מהאתר והשמות, עם חיפוש לפי מועמד, משרה, חברה, סטטוס ותאריכים" />
      {scopeLabel ? (
        <p className="mb-4 flex flex-wrap items-center gap-3 text-sm">
          <span className="rounded-full bg-accent/10 px-3 py-1 font-medium text-accent-dark">מסונן לפי {scopeLabel}</span>
          <Link href={ACTION} className="font-medium text-accent-dark underline underline-offset-4">
            כל ההגשות
          </Link>
        </p>
      ) : null}
      <SearchForm
        action={ACTION}
        values={values}
        hidden={scope}
        fields={[
          { kind: "text", name: "q", label: "חיפוש", placeholder: "שם, מייל, טלפון, משרה, חברה או מספר Case", wide: true },
          { kind: "select", name: "status", label: "סטטוס", options: options.statuses },
          { kind: "select", name: "type", label: "סוג", options: APPLICATION_TYPES.map((t) => ({ value: t.key, label: t.label })) },
          { kind: "select", name: "paid", label: "תשלום", options: [{ value: "paid", label: "בתשלום" }, { value: "unpaid", label: "לא בתשלום" }] },
          { kind: "select", name: "owner", label: "מטפל", options: options.owners },
          { kind: "date", name: "from", label: "הוגשה מתאריך" },
          { kind: "date", name: "to", label: "עד תאריך" },
        ]}
      />
      <Card title={`הגשות · ${fmtInt(total)}`}>
        <ApplicationsTable rows={rows} empty="לא נמצאו הגשות" />
        <Pager action={ACTION} values={{ ...values, ...scope }} page={page} pageSize={PAGE_SIZE} total={total} />
      </Card>
    </>
  );
}

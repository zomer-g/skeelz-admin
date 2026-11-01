import type { Metadata } from "next";
import Link from "next/link";
import { MarkedBadge } from "@/components/entities/JobFields";
import { Pager, SearchForm } from "@/components/entities/Search";
import { Badge, Card, PageHeader, Table } from "@/components/ui";
import { pageAuth } from "@/lib/auth/guard";
import { viewPath } from "@/lib/dashboard/params";
import { JOB_STATUS_LABELS, jobStatusLabel } from "@/lib/entities/companies";
import { POSITION_SORTS, positionFilters, searchPositions } from "@/lib/entities/positions";
import { PAGE_SIZE, pageParam, type SearchParams } from "@/lib/entities/search";
import { listQuery } from "@/lib/export/query";
import { sortParam, tableSort } from "@/lib/entities/sort";
import { areaOptions, napaOptions, placeText } from "@/lib/geo/filters";
import { fmtDate, fmtInt } from "@/lib/format";
import { SKILLS } from "@/lib/skills";

export const metadata: Metadata = { title: "משרות" };
export const dynamic = "force-dynamic";

const ACTION = "/positions";
const KEYS = ["q", "status", "paid", "area", "napa", "skill", "from", "to", "sort", "dir", "page"];

export default async function PositionsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const search = await searchParams;
  const auth = await pageAuth("viewer", viewPath(ACTION, search, KEYS));
  if (!auth.ok) return auth.render;

  const filters = positionFilters(search);
  const page = pageParam(search);
  const sort = sortParam(search, POSITION_SORTS, "created");
  const { rows, total } = await searchPositions(filters, { page, sort });

  const values: Record<string, string> = {
    q: filters.q,
    status: filters.status,
    paid: filters.paid,
    area: filters.area,
    napa: filters.napa,
    skill: filters.skill,
    from: filters.fromDay,
    to: filters.toDay,
  };

  return (
    <>
      <PageHeader title="משרות" subtitle="כל המשרות ב-Salesforce, עם המיקום שלהן במחוזות ובנפות והכישורים שהן דורשות" />
      <SearchForm
        action={ACTION}
        values={values}
        fields={[
          { kind: "text", name: "q", label: "חיפוש", placeholder: "שם משרה, חברה, מיקום או מספר Case", wide: true },
          {
            kind: "select",
            name: "status",
            label: "סטטוס באתר",
            options: [...Object.entries(JOB_STATUS_LABELS).map(([value, label]) => ({ value, label })), { value: "none", label: "ללא סטטוס" }],
          },
          { kind: "select", name: "paid", label: "תשלום", options: [{ value: "paid", label: "בתשלום" }, { value: "free", label: "לא בתשלום" }] },
          { kind: "select", name: "area", label: "מחוז", options: areaOptions(["national", "remote", "unknown"]) },
          { kind: "select", name: "napa", label: "נפה", options: napaOptions(filters.area) },
          { kind: "select", name: "skill", label: "כישור נדרש", options: SKILLS.map((s) => s.label) },
          { kind: "date", name: "from", label: "נפתחו מתאריך" },
          { kind: "date", name: "to", label: "עד תאריך" },
        ]}
      />
      <Card title={`משרות · ${fmtInt(total)}`}>
        <Table
          head={[
            { label: "משרה", sort: "title" },
            { label: "מעסיק", sort: "company" },
            { label: "סטטוס באתר", sort: "status" },
            { label: "מיקום", sort: "location" },
            "כישורים נדרשים",
            { label: "הגשות", sort: "applications" },
            { label: "נפתחה", sort: "created" },
          ]}
          sort={tableSort(POSITION_SORTS, sort, ACTION, values)}
          download={{ name: "משרות", list: "positions", query: listQuery({ ...values, sort: sort.key, dir: sort.dir }) }}
          empty={rows.length === 0 ? "לא נמצאו משרות" : undefined}
        >
          {rows.map((j) => (
            <tr key={j.id}>
              <td className="px-3 py-2">
                <Link href={`/positions/${j.id}`} className="font-medium underline-offset-4 hover:underline" dir="auto">
                  {j.title ?? "(ללא שם)"}
                </Link>
                <p className="mt-1 flex flex-wrap items-center gap-1 text-xs">
                  {j.paid ? <Badge tone="brand">בתשלום</Badge> : null}
                  {j.marked ? <MarkedBadge /> : null}
                  {j.caseNumber ? <span className="tabular-nums text-muted">Case {j.caseNumber}</span> : null}
                </p>
              </td>
              <td className="px-3 py-2 text-xs">
                {j.companyKey ? (
                  <Link href={`/companies/${encodeURIComponent(j.companyKey)}`} className="underline-offset-4 hover:underline" dir="auto">
                    {j.company}
                  </Link>
                ) : (
                  (j.company ?? "—")
                )}
              </td>
              <td className="px-3 py-2">
                {j.status ? <Badge tone={j.status === "Active" ? "success" : "neutral"}>{jobStatusLabel(j.status)}</Badge> : <span className="text-muted">—</span>}
              </td>
              <td className="px-3 py-2 text-xs">
                {j.location ?? j.place.locality ?? "—"}
                {placeText(j.place, true) && placeText(j.place, true) !== j.location ? <p className="text-muted">{placeText(j.place, true)}</p> : null}
              </td>
              <td className="px-3 py-2 text-xs">{j.skills.length ? j.skills.join(" · ") : <span className="text-muted">—</span>}</td>
              <td className="px-3 py-2 tabular-nums">
                {j.applications ? (
                  <Link href={`/applications?job=${j.id}`} className="underline-offset-4 hover:underline">
                    {fmtInt(j.applications)}
                    <span className="sr-only"> הגשות ל{j.title ?? "משרה"}</span>
                  </Link>
                ) : (
                  "0"
                )}
              </td>
              <td className="whitespace-nowrap px-3 py-2 tabular-nums">{j.createdAt ? fmtDate(j.createdAt) : "—"}</td>
            </tr>
          ))}
        </Table>
        <Pager action={ACTION} values={{ ...values, sort: sort.key, dir: sort.dir }} page={page} pageSize={PAGE_SIZE} total={total} />
      </Card>
    </>
  );
}

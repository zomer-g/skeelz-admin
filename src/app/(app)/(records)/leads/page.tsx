import type { Metadata } from "next";
import Link from "next/link";
import { Pager, SearchForm } from "@/components/entities/Search";
import { Badge, Card, PageHeader, Table } from "@/components/ui";
import { pageAuth } from "@/lib/auth/guard";
import { viewPath } from "@/lib/dashboard/params";
import { LEAD_SORTS, loadLeadFilterOptions, searchLeads, type LeadFilters } from "@/lib/entities/leads";
import { dayParam, PAGE_SIZE, pageParam, param, type SearchParams } from "@/lib/entities/search";
import { sortParam, tableSort } from "@/lib/entities/sort";
import { fmtDate, fmtInt } from "@/lib/format";

export const metadata: Metadata = { title: "לידי מעסיקים" };
export const dynamic = "force-dynamic";

const ACTION = "/leads";
const KEYS = ["q", "status", "owner", "from", "to", "sort", "dir", "page"];

export default async function LeadsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const search = await searchParams;
  const auth = await pageAuth("viewer", viewPath(ACTION, search, KEYS));
  if (!auth.ok) return auth.render;

  const options = await loadLeadFilterOptions();
  const filters: LeadFilters = {
    q: param(search, "q"),
    status: options.statuses.some((s) => s.value === param(search, "status")) ? param(search, "status") : "",
    owner: options.owners.includes(param(search, "owner")) ? param(search, "owner") : "",
    fromDay: dayParam(search, "from"),
    toDay: dayParam(search, "to"),
  };
  const page = pageParam(search);
  const sort = sortParam(search, LEAD_SORTS, "created");
  const { rows, total } = await searchLeads(filters, { page, sort });
  const values: Record<string, string> = { q: filters.q, status: filters.status, owner: filters.owner, from: filters.fromDay, to: filters.toDay };

  return (
    <>
      <PageHeader title="לידי מעסיקים" subtitle='Cases מסוג "ליד מעסיק": הפנייה, המעסיק, איש הקשר והסטטוס' />
      <SearchForm
        action={ACTION}
        values={values}
        fields={[
          { kind: "text", name: "q", label: "חיפוש", placeholder: "מעסיק, נושא, איש קשר, מייל או מספר Case", wide: true },
          { kind: "select", name: "status", label: "סטטוס", options: options.statuses.map((s) => ({ value: s.value, label: `${s.value} (${fmtInt(s.count)})` })) },
          { kind: "select", name: "owner", label: "מטפל", options: options.owners },
          { kind: "date", name: "from", label: "נפתחו מתאריך" },
          { kind: "date", name: "to", label: "עד תאריך" },
        ]}
      />
      <Card title={`לידים · ${fmtInt(total)}`}>
        <Table
          head={[
            { label: "מעסיק", sort: "account" },
            "איש קשר",
            { label: "סטטוס", sort: "status" },
            { label: "מטפל", sort: "owner" },
            { label: "נפתח", sort: "created" },
            { label: "שינוי סטטוס אחרון", sort: "changed" },
          ]}
          sort={tableSort(LEAD_SORTS, sort, ACTION, values)}
          empty={rows.length === 0 ? "לא נמצאו לידים" : undefined}
        >
          {rows.map((l) => (
            <tr key={l.id}>
              <td className="px-3 py-2">
                <Link href={`/leads/${l.id}`} className="font-medium underline-offset-4 hover:underline" dir="auto">
                  {l.accountName ?? l.subject ?? "(ללא שם)"}
                </Link>
                <p className="text-xs text-muted" dir="auto">
                  {[l.subject && l.accountName ? l.subject : null, l.caseNumber ? `Case ${l.caseNumber}` : null].filter(Boolean).join(" · ")}
                </p>
              </td>
              <td className="px-3 py-2 text-xs">
                {l.contactName ?? "—"}
                {l.contactEmail ? (
                  <p className="text-muted" dir="ltr">
                    {l.contactEmail}
                  </p>
                ) : null}
              </td>
              <td className="px-3 py-2">{l.status ? <Badge tone={l.status === "נחתם חוזה" ? "success" : "neutral"}>{l.status}</Badge> : "—"}</td>
              <td className="px-3 py-2 text-xs">{l.ownerName ?? "—"}</td>
              <td className="whitespace-nowrap px-3 py-2 tabular-nums">{l.createdAt ? fmtDate(l.createdAt) : "—"}</td>
              <td className="whitespace-nowrap px-3 py-2 tabular-nums">{l.statusChangedAt ? fmtDate(l.statusChangedAt) : "—"}</td>
            </tr>
          ))}
        </Table>
        <Pager action={ACTION} values={{ ...values, sort: sort.key, dir: sort.dir }} page={page} pageSize={PAGE_SIZE} total={total} />
      </Card>
    </>
  );
}

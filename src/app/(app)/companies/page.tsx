import type { Metadata } from "next";
import Link from "next/link";
import { Pager, SearchForm } from "@/components/entities/Search";
import { Badge, Card, PageHeader, Table } from "@/components/ui";
import { pageAuth } from "@/lib/auth/guard";
import { viewPath } from "@/lib/dashboard/params";
import { searchCompanies, type CompanyFilters } from "@/lib/entities/companies";
import { choice, PAGE_SIZE, pageParam, param, type SearchParams } from "@/lib/entities/search";
import { fmtDate, fmtInt } from "@/lib/format";

export const metadata: Metadata = { title: "מעסיקים" };
export const dynamic = "force-dynamic";

const ACTION = "/companies";
const KEYS = ["q", "location", "paid", "sort", "all", "page"];

export default async function CompaniesPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const search = await searchParams;
  const auth = await pageAuth("viewer", viewPath(ACTION, search, KEYS));
  if (!auth.ok) return auth.render;

  const filters: CompanyFilters = {
    q: param(search, "q"),
    location: param(search, "location"),
    paid: choice(search, "paid", ["paid"] as const),
    sort: choice(search, "sort", ["active", "recent", "applications", "name"] as const),
    all: param(search, "all") === "1",
  };
  const page = pageParam(search);
  const { rows, total, withoutActive } = await searchCompanies(filters, { page });

  const values: Record<string, string> = {
    q: filters.q,
    location: filters.location,
    paid: filters.paid,
    sort: filters.sort,
    all: filters.all ? "1" : "",
  };
  const showAllHref = `${ACTION}?${new URLSearchParams(Object.entries({ ...values, all: "1" }).filter(([, v]) => v)).toString()}`;

  return (
    <>
      <PageHeader title="מעסיקים" subtitle="המשרות מקובצות לפי שם החברה, עם פרטי המעסיק והמשרות שלו" />
      <SearchForm
        action={ACTION}
        values={values}
        fields={[
          { kind: "text", name: "q", label: "חיפוש", placeholder: "שם חברה, איש קשר, מייל או טלפון", wide: true },
          { kind: "text", name: "location", label: "מיקום משרה", placeholder: "למשל: תל אביב" },
          { kind: "select", name: "paid", label: "תשלום", options: [{ value: "paid", label: "עם משרות בתשלום" }] },
          {
            kind: "select",
            name: "sort",
            label: "מיון",
            any: "משרות פעילות",
            options: [
              { value: "recent", label: "משרה אחרונה" },
              { value: "applications", label: "הכי הרבה הגשות" },
              { value: "name", label: "שם" },
            ],
          },
          { kind: "check", name: "all", label: "כולל מעסיקים בלי משרות פעילות" },
        ]}
      />
      <Card title={`${filters.all ? "מעסיקים" : "מעסיקים עם משרות פעילות"} · ${fmtInt(total)}`}>
        <Table head={["מעסיק", "משרות פעילות", "כל המשרות", "הגשות", "משרה אחרונה", "איש קשר", "מיקומים"]} empty={rows.length === 0 ? "לא נמצאו מעסיקים" : undefined}>
          {rows.map((c) => (
            <tr key={c.key}>
              <td className="px-3 py-2">
                <Link href={`/companies/${encodeURIComponent(c.key)}`} className="font-medium underline-offset-4 hover:underline">
                  {c.name}
                </Link>
              </td>
              <td className="px-3 py-2 tabular-nums">
                {c.activeJobs ? <span className="font-bold">{fmtInt(c.activeJobs)}</span> : <span className="text-muted">0</span>}
                {c.paidActiveJobs ? (
                  <span className="ms-2">
                    <Badge tone="brand">{fmtInt(c.paidActiveJobs)} בתשלום</Badge>
                  </span>
                ) : null}
              </td>
              <td className="px-3 py-2 tabular-nums">{fmtInt(c.jobs)}</td>
              <td className="px-3 py-2 tabular-nums">{fmtInt(c.applications)}</td>
              <td className="whitespace-nowrap px-3 py-2 tabular-nums">{fmtDate(c.lastJobAt)}</td>
              <td className="px-3 py-2">
                {c.contactName ?? "—"}
                <p className="text-xs text-muted" dir="ltr">
                  {c.contactEmail ?? ""}
                </p>
              </td>
              <td className="px-3 py-2 text-xs">{c.locations.slice(0, 3).join(" · ") || "—"}</td>
            </tr>
          ))}
        </Table>
        <Pager action={ACTION} values={values} page={page} pageSize={PAGE_SIZE} total={total} />
        {!filters.all && withoutActive > 0 ? (
          <p className="mt-3 text-sm text-muted">
            עוד {fmtInt(withoutActive)} מעסיקים בלי משרות פעילות לא מוצגים.{" "}
            <Link href={showAllHref} className="font-medium text-accent-dark underline underline-offset-4">
              להצגת כולם
            </Link>
          </p>
        ) : null}
      </Card>
    </>
  );
}

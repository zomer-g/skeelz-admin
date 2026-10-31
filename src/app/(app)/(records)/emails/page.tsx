import type { Metadata } from "next";
import Link from "next/link";
import { CopyContacts } from "@/components/entities/CopyContacts";
import { Pager, SearchForm } from "@/components/entities/Search";
import { Badge, Card, PageHeader, Table } from "@/components/ui";
import { pageAuth } from "@/lib/auth/guard";
import { viewPath } from "@/lib/dashboard/params";
import { EMAIL_SORTS, emailFilters, emailPath, loadCaseTypes, searchEmails } from "@/lib/entities/emails";
import { PAGE_SIZE, pageParam, type SearchParams } from "@/lib/entities/search";
import { sortParam, tableSort } from "@/lib/entities/sort";
import { areaOptions, napaOptions, placeText } from "@/lib/geo/filters";
import { fmtDate, fmtInt } from "@/lib/format";

export const metadata: Metadata = { title: "כתובות דוא״ל" };
export const dynamic = "force-dynamic";

const ACTION = "/emails";
const KEYS = ["q", "multi", "type", "applied", "files", "area", "napa", "sort", "dir", "page"];

export default async function EmailsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const search = await searchParams;
  const auth = await pageAuth("viewer", viewPath(ACTION, search, KEYS));
  if (!auth.ok) return auth.render;

  const types = await loadCaseTypes();
  const parsed = emailFilters(search);
  const filters = { ...parsed, type: types.some((t) => t.value === parsed.type) ? parsed.type : "" };
  const page = pageParam(search);
  const sort = sortParam(search, EMAIL_SORTS, "last");
  const { rows, total } = await searchEmails(filters, { page, sort });

  const values: Record<string, string> = {
    q: filters.q,
    multi: filters.multi ? "1" : "",
    type: filters.type,
    applied: filters.applied,
    files: filters.files,
    area: filters.area,
    napa: filters.napa,
  };

  return (
    <>
      <PageHeader
        title="כתובות דוא״ל"
        subtitle="אדם אחד לכל כתובת: כל אנשי הקשר ב-Salesforce עם אותו מייל, וכל הפניות, ההגשות וקורות החיים שלהם"
      />
      <SearchForm
        action={ACTION}
        values={values}
        fields={[
          { kind: "text", name: "q", label: "חיפוש", placeholder: "מייל, שם או טלפון", wide: true },
          { kind: "select", name: "type", label: "יש פנייה מסוג", options: types },
          { kind: "select", name: "applied", label: "הגשות", options: [{ value: "yes", label: "הגישו" }, { value: "no", label: "לא הגישו" }] },
          { kind: "select", name: "files", label: "קבצים מצורפים", options: [{ value: "yes", label: "יש קבצים" }, { value: "no", label: "אין קבצים" }] },
          { kind: "select", name: "area", label: "מחוז", options: areaOptions(["unknown"]) },
          { kind: "select", name: "napa", label: "נפה", options: napaOptions(filters.area) },
          { kind: "check", name: "multi", label: "רק כתובות עם כמה אנשי קשר" },
        ]}
      />
      <Card title={`כתובות · ${fmtInt(total)}`}>
        <Table
          head={[
            { label: "כתובת", sort: "email" },
            { label: "שם", sort: "name" },
            "טלפון",
            "מגורים",
            { label: "אנשי קשר", sort: "contacts" },
            { label: "פניות", sort: "cases" },
            { label: "הגשות", sort: "applications" },
            { label: "קבצים", sort: "files" },
            { label: "ראשונה", sort: "first" },
            { label: "אחרונה", sort: "last" },
          ]}
          sort={tableSort(EMAIL_SORTS, sort, ACTION, values)}
          empty={rows.length === 0 ? "לא נמצאו כתובות" : undefined}
        >
          {rows.map((r) => (
            <tr key={r.email}>
              <td className="px-3 py-2">
                <Link href={emailPath(r.email)} className="font-medium underline-offset-4 hover:underline" dir="ltr">
                  {r.email}
                </Link>
              </td>
              <td className="px-3 py-2" dir="auto">
                {r.names[0] ?? "—"}
                {r.names.length > 1 ? (
                  <p className="text-xs text-muted" dir="auto">
                    {r.names.slice(1, 4).join(" · ")}
                    {r.names.length > 4 ? ` ועוד ${fmtInt(r.names.length - 4)}` : ""}
                  </p>
                ) : null}
              </td>
              <td className="whitespace-nowrap px-3 py-2 tabular-nums" dir="ltr">
                {r.phone ?? "—"}
              </td>
              <td className="px-3 py-2 text-xs">
                {r.place.locality ?? placeText(r.place, true) ?? "—"}
                {r.place.locality && placeText(r.place, true) ? <p className="text-muted">{placeText(r.place, true)}</p> : null}
              </td>
              <td className="px-3 py-2 tabular-nums">{r.contacts > 1 ? <Badge tone="warning">{fmtInt(r.contacts)}</Badge> : fmtInt(r.contacts)}</td>
              <td className="px-3 py-2 tabular-nums">{fmtInt(r.cases)}</td>
              <td className="px-3 py-2 tabular-nums">{r.applications ? fmtInt(r.applications) : <span className="text-muted">—</span>}</td>
              <td className="px-3 py-2">
                {r.files ? (
                  <Link href={`${emailPath(r.email)}?tab=files`} className="underline-offset-4 hover:underline">
                    <Badge tone="accent">{fmtInt(r.files)}</Badge>
                    <span className="sr-only"> קבצים של {r.email}</span>
                  </Link>
                ) : (
                  <span className="text-muted">—</span>
                )}
              </td>
              <td className="whitespace-nowrap px-3 py-2 tabular-nums">{fmtDate(r.firstCaseAt)}</td>
              <td className="whitespace-nowrap px-3 py-2 tabular-nums">{fmtDate(r.lastCaseAt)}</td>
            </tr>
          ))}
        </Table>
        <Pager action={ACTION} values={{ ...values, sort: sort.key, dir: sort.dir }} page={page} pageSize={PAGE_SIZE} total={total} />
        {total ? (
          <CopyContacts
            query={new URLSearchParams(Object.entries(values).filter(([, v]) => v)).toString()}
            total={total}
            endpoint="/api/emails/contacts"
            subject={`כל ${total.toLocaleString("he-IL")} הכתובות בחיפוש`}
          />
        ) : null}
      </Card>
    </>
  );
}

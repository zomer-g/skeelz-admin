import type { Metadata } from "next";
import Link from "next/link";
import { Pager, SearchForm } from "@/components/entities/Search";
import { Badge, Card, PageHeader, Table } from "@/components/ui";
import { pageAuth } from "@/lib/auth/guard";
import { viewPath } from "@/lib/dashboard/params";
import { emailPath, loadCaseTypes, searchEmails, type EmailFilters } from "@/lib/entities/emails";
import { PAGE_SIZE, pageParam, param, type SearchParams } from "@/lib/entities/search";
import { fmtDate, fmtInt } from "@/lib/format";

export const metadata: Metadata = { title: "כתובות דוא״ל" };
export const dynamic = "force-dynamic";

const ACTION = "/emails";
const KEYS = ["q", "multi", "type", "page"];

export default async function EmailsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const search = await searchParams;
  const auth = await pageAuth("viewer", viewPath(ACTION, search, KEYS));
  if (!auth.ok) return auth.render;

  const types = await loadCaseTypes();
  const type = param(search, "type");
  const filters: EmailFilters = {
    q: param(search, "q"),
    multi: param(search, "multi") === "1",
    type: types.some((t) => t.value === type) ? type : "",
  };
  const page = pageParam(search);
  const { rows, total } = await searchEmails(filters, { page });

  const values: Record<string, string> = { q: filters.q, multi: filters.multi ? "1" : "", type: filters.type };

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
          { kind: "check", name: "multi", label: "רק כתובות עם כמה אנשי קשר" },
        ]}
      />
      <Card title={`כתובות · ${fmtInt(total)}`}>
        <Table head={["כתובת", "שם", "טלפון", "אנשי קשר", "פניות", "ראשונה", "אחרונה"]} empty={rows.length === 0 ? "לא נמצאו כתובות" : undefined}>
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
              <td className="px-3 py-2 tabular-nums">{r.contacts > 1 ? <Badge tone="warning">{fmtInt(r.contacts)}</Badge> : fmtInt(r.contacts)}</td>
              <td className="px-3 py-2 tabular-nums">{fmtInt(r.cases)}</td>
              <td className="whitespace-nowrap px-3 py-2 tabular-nums">{fmtDate(r.firstCaseAt)}</td>
              <td className="whitespace-nowrap px-3 py-2 tabular-nums">{fmtDate(r.lastCaseAt)}</td>
            </tr>
          ))}
        </Table>
        <Pager action={ACTION} values={values} page={page} pageSize={PAGE_SIZE} total={total} />
      </Card>
    </>
  );
}

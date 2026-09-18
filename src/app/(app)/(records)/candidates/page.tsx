import type { Metadata } from "next";
import Link from "next/link";
import { Pager, SearchForm } from "@/components/entities/Search";
import { Badge, Card, PageHeader, Table } from "@/components/ui";
import { pageAuth } from "@/lib/auth/guard";
import { viewPath } from "@/lib/dashboard/params";
import { loadCandidateFilterOptions, searchCandidates, type CandidateFilters } from "@/lib/entities/candidates";
import { choice, dayParam, PAGE_SIZE, pageParam, param, type SearchParams } from "@/lib/entities/search";
import { fmtDate, fmtInt } from "@/lib/format";

export const metadata: Metadata = { title: "מועמדים" };
export const dynamic = "force-dynamic";

const ACTION = "/candidates";
const KEYS = ["q", "district", "city", "account", "cv", "applied", "from", "to", "page"];

export default async function CandidatesPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const search = await searchParams;
  const auth = await pageAuth("viewer", viewPath(ACTION, search, KEYS));
  if (!auth.ok) return auth.render;

  const filters: CandidateFilters = {
    q: param(search, "q"),
    district: param(search, "district"),
    city: param(search, "city"),
    account: param(search, "account"),
    cv: choice(search, "cv", ["yes", "no"] as const),
    applied: choice(search, "applied", ["yes", "no"] as const),
    fromDay: dayParam(search, "from"),
    toDay: dayParam(search, "to"),
  };
  const page = pageParam(search);
  const [{ rows, total }, options] = await Promise.all([searchCandidates(filters, { page }), loadCandidateFilterOptions()]);

  const values: Record<string, string> = {
    q: filters.q,
    district: filters.district,
    city: filters.city,
    account: filters.account,
    cv: filters.cv,
    applied: filters.applied,
    from: filters.fromDay,
    to: filters.toDay,
  };

  return (
    <>
      <PageHeader title="מועמדים" subtitle="אנשי הקשר ב-Accounts של המועמדים, וכל מי שהגיש מועמדות" />
      <SearchForm
        action={ACTION}
        values={values}
        fields={[
          { kind: "text", name: "q", label: "חיפוש", placeholder: "שם, מייל או טלפון", wide: true },
          { kind: "select", name: "district", label: "מחוז", options: options.districts },
          { kind: "text", name: "city", label: "עיר" },
          { kind: "select", name: "account", label: "Account", options: options.accounts },
          { kind: "select", name: "cv", label: 'קו"ח', options: [{ value: "yes", label: 'יש קו"ח' }, { value: "no", label: 'אין קו"ח' }] },
          { kind: "select", name: "applied", label: "הגשות", options: [{ value: "yes", label: "הגישו" }, { value: "no", label: "לא הגישו" }] },
          { kind: "date", name: "from", label: "נוספו מתאריך" },
          { kind: "date", name: "to", label: "עד תאריך" },
        ]}
      />
      <Card title={`מועמדים · ${fmtInt(total)}`}>
        <Table head={["מועמד", "טלפון", "עיר", "Account", 'קו"ח', "הגשות", "הגשה אחרונה"]} empty={rows.length === 0 ? "לא נמצאו מועמדים" : undefined}>
          {rows.map((c) => (
            <tr key={c.id}>
              <td className="px-3 py-2">
                <Link href={`/candidates/${c.id}`} className="font-medium underline-offset-4 hover:underline" dir="auto">
                  {c.name ?? "(ללא שם)"}
                </Link>
                <p className="text-xs text-muted" dir="ltr">
                  {c.email ?? ""}
                </p>
              </td>
              <td className="whitespace-nowrap px-3 py-2 tabular-nums" dir="ltr">
                {c.phone ?? "—"}
              </td>
              <td className="px-3 py-2 text-xs">
                {c.city ?? "—"}
                {c.district ? <p className="text-muted">{c.district}</p> : null}
              </td>
              <td className="px-3 py-2 text-xs">{c.accountName ?? "—"}</td>
              <td className="px-3 py-2">{c.hasCv ? <Badge tone="accent">יש</Badge> : <span className="text-muted">—</span>}</td>
              <td className="px-3 py-2 tabular-nums">{fmtInt(c.applications)}</td>
              <td className="whitespace-nowrap px-3 py-2 tabular-nums">{c.lastApplicationAt ? fmtDate(c.lastApplicationAt) : "—"}</td>
            </tr>
          ))}
        </Table>
        <Pager action={ACTION} values={values} page={page} pageSize={PAGE_SIZE} total={total} />
      </Card>
    </>
  );
}

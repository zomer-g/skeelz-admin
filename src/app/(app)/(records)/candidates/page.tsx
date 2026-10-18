import type { Metadata } from "next";
import Link from "next/link";
import { CopyContacts } from "@/components/entities/CopyContacts";
import { Pager, SearchForm } from "@/components/entities/Search";
import { Badge, Card, PageHeader, Table } from "@/components/ui";
import { pageAuth } from "@/lib/auth/guard";
import { viewPath } from "@/lib/dashboard/params";
import { emailPath } from "@/lib/entities/emails";
import { CANDIDATE_SORTS, candidateFilters, loadCandidateFilterOptions, searchCandidates } from "@/lib/entities/candidates";
import { choice, dayParam, PAGE_SIZE, pageParam, param, type SearchParams } from "@/lib/entities/search";
import { sortParam, tableSort } from "@/lib/entities/sort";
import { AREA_VALUES, areaOptions, NAPA_VALUES, napaOptions, placeText } from "@/lib/geo/filters";
import { SKILLS } from "@/lib/skills";
import { fmtDate, fmtInt } from "@/lib/format";

export const metadata: Metadata = { title: "מועמדים" };
export const dynamic = "force-dynamic";

const ACTION = "/candidates";
const KEYS = ["q", "district", "area", "napa", "skill", "city", "account", "cv", "fast", "applied", "from", "to", "sort", "dir", "page"];

export default async function CandidatesPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const search = await searchParams;
  const auth = await pageAuth("viewer", viewPath(ACTION, search, KEYS));
  if (!auth.ok) return auth.render;

  const filters = candidateFilters(search);
  const page = pageParam(search);
  const sort = sortParam(search, CANDIDATE_SORTS, "created");
  const [{ rows, total }, options] = await Promise.all([searchCandidates(filters, { page, sort }), loadCandidateFilterOptions()]);

  const values: Record<string, string> = {
    q: filters.q,
    district: filters.district,
    area: filters.area,
    napa: filters.napa,
    skill: filters.skill,
    city: filters.city,
    account: filters.account,
    cv: filters.cv,
    fast: filters.fast,
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
          { kind: "select", name: "area", label: "מחוז", options: areaOptions(["unknown"]) },
          { kind: "select", name: "napa", label: "נפה", options: napaOptions(filters.area) },
          { kind: "text", name: "city", label: "עיר" },
          { kind: "select", name: "skill", label: "כישור", options: SKILLS.map((s) => s.label) },
          { kind: "select", name: "account", label: "Account", options: options.accounts },
          { kind: "select", name: "cv", label: 'קו"ח', options: [{ value: "yes", label: 'יש קו"ח' }, { value: "no", label: 'אין קו"ח' }] },
          { kind: "select", name: "fast", label: "הגשה מהירה", options: [{ value: "yes", label: "הגשה מהירה" }, { value: "no", label: "לא הגשה מהירה" }] },
          { kind: "select", name: "applied", label: "הגשות", options: [{ value: "yes", label: "הגישו" }, { value: "no", label: "לא הגישו" }] },
          { kind: "date", name: "from", label: "נוספו מתאריך" },
          { kind: "date", name: "to", label: "עד תאריך" },
        ]}
      />
      <Card title={`מועמדים · ${fmtInt(total)}`}>
        <Table
          head={[
            { label: "מועמד", sort: "name" },
            "טלפון",
            { label: "עיר", sort: "city" },
            { label: "Account", sort: "account" },
            { label: 'קו"ח', sort: "cv" },
            { label: "הגשה מהירה", sort: "fast" },
            { label: "הגשות", sort: "applications" },
            { label: "נוצר", sort: "created" },
            { label: "הגשה אחרונה", sort: "last" },
          ]}
          sort={tableSort(CANDIDATE_SORTS, sort, ACTION, values)}
          empty={rows.length === 0 ? "לא נמצאו מועמדים" : undefined}
        >
          {rows.map((c) => (
            <tr key={c.id}>
              <td className="px-3 py-2">
                <Link href={`/candidates/${c.id}`} className="font-medium underline-offset-4 hover:underline" dir="auto">
                  {c.name ?? "(ללא שם)"}
                </Link>
                {c.email ? (
                  <p className="text-xs" dir="ltr">
                    <Link href={emailPath(c.email)} className="text-muted underline-offset-2 hover:underline">
                      {c.email}
                    </Link>
                  </p>
                ) : null}
              </td>
              <td className="whitespace-nowrap px-3 py-2 tabular-nums" dir="ltr">
                {c.phone ?? "—"}
              </td>
              <td className="px-3 py-2 text-xs">
                {c.city ?? c.place.locality ?? "—"}
                {placeText(c.place, true) ? <p className="text-muted">{placeText(c.place, true)}</p> : null}
              </td>
              <td className="px-3 py-2 text-xs">{c.accountName ?? "—"}</td>
              <td className="px-3 py-2">{c.hasCv ? <Badge tone="accent">יש</Badge> : <span className="text-muted">—</span>}</td>
              <td className="px-3 py-2">{c.fastApply ? <Badge tone="accent">כן</Badge> : <span className="text-muted">—</span>}</td>
              <td className="px-3 py-2 tabular-nums">{fmtInt(c.applications)}</td>
              <td className="whitespace-nowrap px-3 py-2 tabular-nums">{c.createdAt ? fmtDate(c.createdAt) : "—"}</td>
              <td className="whitespace-nowrap px-3 py-2 tabular-nums">{c.lastApplicationAt ? fmtDate(c.lastApplicationAt) : "—"}</td>
            </tr>
          ))}
        </Table>
        <Pager action={ACTION} values={{ ...values, sort: sort.key, dir: sort.dir }} page={page} pageSize={PAGE_SIZE} total={total} />
        {total ? <CopyContacts query={new URLSearchParams(Object.entries(values).filter(([, v]) => v)).toString()} total={total} /> : null}
      </Card>
    </>
  );
}

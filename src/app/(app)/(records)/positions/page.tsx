import type { Metadata } from "next";
import Link from "next/link";
import { MarkedBadge } from "@/components/entities/JobFields";
import { Pager, SearchForm } from "@/components/entities/Search";
import { Badge, buttonClass, Card, PageHeader, Table } from "@/components/ui";
import { pageAuth } from "@/lib/auth/guard";
import { topicLabel } from "@/lib/cv-topics";
import { viewPath } from "@/lib/dashboard/params";
import { JOB_STATUS_LABELS, jobStatusLabel } from "@/lib/entities/companies";
import { loadOutreachJobs } from "@/lib/entities/outreach";
import { POSITION_SORTS, positionFilters, positionFilterValues, searchPositions } from "@/lib/entities/positions";
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

/**
 * The jobs list, outreach included: each row shows the field read from the job and leads to the
 * candidates whose CVs fit it (/outreach/[id]). Without parameters: paid jobs live on the site.
 */
export default async function PositionsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const search = await searchParams;
  const auth = await pageAuth("viewer", viewPath(ACTION, search, KEYS));
  if (!auth.ok) return auth.render;

  const filters = positionFilters(search);
  const page = pageParam(search);
  const sort = sortParam(search, POSITION_SORTS, "created");
  const { rows, total } = await searchPositions(filters, { page, sort });
  const outreach = await loadOutreachJobs(rows.map((r) => r.id));
  const values = positionFilterValues(filters);

  return (
    <>
      <PageHeader
        title="משרות"
        subtitle="המשרות ב-Salesforce, עם המיקום, הכישורים והתחום שעולה מהן — ולכל משרה פעילות יזומה: קורות החיים שמתאימים לה, כדי לפנות למועמדים עוד לפני שהגישו. בלי סינון מוצגות משרות בתשלום שפעילות באתר"
      />
      <SearchForm
        action={ACTION}
        values={values}
        fields={[
          { kind: "text", name: "q", label: "חיפוש", placeholder: "שם משרה, חברה, מיקום או מספר Case", wide: true },
          {
            kind: "select",
            name: "status",
            label: "סטטוס באתר",
            any: "פעילה באתר",
            options: [
              ...Object.entries(JOB_STATUS_LABELS)
                .filter(([value]) => value !== "Active")
                .map(([value, label]) => ({ value, label })),
              { value: "none", label: "ללא סטטוס" },
              { value: "all", label: "כל הסטטוסים" },
            ],
          },
          {
            kind: "select",
            name: "paid",
            label: "תשלום",
            any: "בתשלום",
            options: [
              { value: "free", label: "לא בתשלום" },
              { value: "all", label: "בתשלום ולא בתשלום" },
            ],
          },
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
            "פעילות יזומה",
          ]}
          sort={tableSort(POSITION_SORTS, sort, ACTION, values)}
          download={{ name: "משרות", list: "positions", query: listQuery({ ...values, sort: sort.key, dir: sort.dir }) }}
          empty={rows.length === 0 ? "לא נמצאו משרות" : undefined}
        >
          {rows.map((j) => {
            const job = outreach.get(j.id);
            const fields = job?.suggested ?? [];
            return (
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
                <td className="px-3 py-2 text-xs">
                  {fields.length ? (
                    <span className="mb-1 flex flex-wrap gap-1">
                      {fields.map((id) => (
                        <Badge key={id} tone="accent">
                          {topicLabel(id)}
                        </Badge>
                      ))}
                    </span>
                  ) : (
                    <p className="mb-1 text-muted">
                      לא זוהה תחום{job?.keywords.length ? ` · יחפש: ${job.keywords.join(", ")}` : ""}
                    </p>
                  )}
                  <Link
                    href={`/outreach/${j.id}`}
                    className={`${buttonClass(fields.length || job?.keywords.length ? "primary" : "secondary", "sm")} whitespace-nowrap`}
                  >
                    מועמדים מתאימים<span className="sr-only"> ל{j.title ?? "משרה"}</span>
                  </Link>
                </td>
              </tr>
            );
          })}
        </Table>
        <Pager action={ACTION} values={{ ...values, sort: sort.key, dir: sort.dir }} page={page} pageSize={PAGE_SIZE} total={total} />
        <p className="mt-3 text-xs text-muted">
          פעילות יזומה: התחום מזוהה מכותרת המשרה, מהתיאור ומהכישורים שלה, באותם מונחים שבהם מסווגים קורות החיים (כמו בסינון &quot;תחום / מקצוע&quot; בקורות
          חיים); הכותרת קובעת יותר מהתיאור. משרה שלא זוהה לה תחום מחפשת את מילות הכותרת בתוך קורות החיים. האזור הוא היישוב של המשרה, בנפות ובמחוזות של הלמ״ס.
        </p>
      </Card>
    </>
  );
}

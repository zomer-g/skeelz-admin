import type { Metadata } from "next";
import Link from "next/link";
import { Pager, SearchForm } from "@/components/entities/Search";
import { Badge, buttonClass, Card, PageHeader, Table } from "@/components/ui";
import { pageAuth } from "@/lib/auth/guard";
import { topicLabel } from "@/lib/cv-topics";
import { viewPath } from "@/lib/dashboard/params";
import { JOB_STATUS_LABELS, jobStatusLabel } from "@/lib/entities/companies";
import { loadOutreachJobs } from "@/lib/entities/outreach";
import { JOB_STATUS_VALUES, POSITION_SORTS, searchPositions } from "@/lib/entities/positions";
import { choice, PAGE_SIZE, pageParam, param, type SearchParams } from "@/lib/entities/search";
import { sortParam, tableSort } from "@/lib/entities/sort";
import { fmtDate, fmtInt } from "@/lib/format";
import { AREA_VALUES, areaOptions, NAPA_VALUES, napaOptions, placeText } from "@/lib/geo/filters";

export const metadata: Metadata = { title: "פעילות יזומה" };
export const dynamic = "force-dynamic";

const ACTION = "/outreach";
const KEYS = ["q", "status", "paid", "area", "napa", "sort", "dir", "page"];
/** Without a status in the URL the list holds the jobs live on the site; "all" lifts that. */
const STATUS_VALUES = [...JOB_STATUS_VALUES, "all"] as const;

/**
 * Outreach: every job with the field and the place read from it, and a way into the candidates
 * whose CVs fit it (/outreach/[id], lib/entities/outreach.ts).
 */
export default async function OutreachPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const search = await searchParams;
  const auth = await pageAuth("viewer", viewPath(ACTION, search, KEYS));
  if (!auth.ok) return auth.render;

  const status = choice(search, "status", STATUS_VALUES);
  const filters = {
    q: param(search, "q"),
    status: status === "all" ? ("" as const) : status || ("Active" as const),
    paid: choice(search, "paid", ["paid", "free"] as const),
    area: choice(search, "area", AREA_VALUES),
    napa: choice(search, "napa", NAPA_VALUES),
    skill: "",
    fromDay: "",
    toDay: "",
  };
  const page = pageParam(search);
  const sort = sortParam(search, POSITION_SORTS, "created");
  const { rows, total } = await searchPositions(filters, { page, sort });
  const jobs = await loadOutreachJobs(rows.map((r) => r.id));
  const values: Record<string, string> = { q: filters.q, status, paid: filters.paid, area: filters.area, napa: filters.napa };

  return (
    <>
      <PageHeader
        title="פעילות יזומה"
        subtitle="לכל משרה: התחום והאזור שעולים ממנה, וחיפוש קורות החיים שמתאימים לה — כדי לפנות למועמדים עוד לפני שהגישו"
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
            any: "פעילות באתר",
            options: [
              ...Object.entries(JOB_STATUS_LABELS)
                .filter(([value]) => value !== "Active")
                .map(([value, label]) => ({ value, label })),
              { value: "none", label: "ללא סטטוס" },
              { value: "all", label: "כל המשרות" },
            ],
          },
          { kind: "select", name: "paid", label: "תשלום", options: [{ value: "paid", label: "בתשלום" }, { value: "free", label: "לא בתשלום" }] },
          { kind: "select", name: "area", label: "מחוז המשרה", options: areaOptions(["national", "remote", "unknown"]) },
          { kind: "select", name: "napa", label: "נפה", options: napaOptions(filters.area) },
        ]}
      />
      <Card title={`משרות · ${fmtInt(total)}`}>
        <Table
          head={[{ label: "משרה", sort: "title" }, "תחום שזוהה", { label: "מיקום", sort: "location" }, { label: "נפתחה", sort: "created" }, "מועמדים"]}
          sort={tableSort(POSITION_SORTS, sort, ACTION, values)}
          empty={rows.length === 0 ? "לא נמצאו משרות" : undefined}
        >
          {rows.map((r) => {
            const job = jobs.get(r.id);
            const fields = job?.suggested ?? [];
            return (
              <tr key={r.id}>
                <td className="px-3 py-2">
                  <Link href={`/positions/${r.id}`} className="font-medium underline-offset-4 hover:underline" dir="auto">
                    {r.title ?? "(ללא שם)"}
                  </Link>
                  <p className="mt-1 flex flex-wrap items-center gap-1 text-xs text-muted">
                    {r.company ? <span dir="auto">{r.company}</span> : null}
                    {r.paid ? <Badge tone="brand">בתשלום</Badge> : null}
                    {r.status !== "Active" ? <Badge>{jobStatusLabel(r.status)}</Badge> : null}
                  </p>
                </td>
                <td className="px-3 py-2 text-xs">
                  {fields.length ? (
                    <span className="flex flex-wrap gap-1">
                      {fields.map((id) => (
                        <Badge key={id} tone="accent">
                          {topicLabel(id)}
                        </Badge>
                      ))}
                    </span>
                  ) : (
                    <span className="text-muted">
                      לא זוהה{job?.keywords.length ? ` · יחפש: ${job.keywords.join(", ")}` : " — אפשר לבחור בחיפוש"}
                    </span>
                  )}
                </td>
                <td className="px-3 py-2 text-xs">
                  {r.location ?? r.place.locality ?? "—"}
                  {placeText(r.place, true) && placeText(r.place, true) !== r.location ? <p className="text-muted">{placeText(r.place, true)}</p> : null}
                </td>
                <td className="whitespace-nowrap px-3 py-2 tabular-nums">{r.createdAt ? fmtDate(r.createdAt) : "—"}</td>
                <td className="px-3 py-2">
                  <Link href={`/outreach/${r.id}`} className={buttonClass(fields.length || job?.keywords.length ? "primary" : "secondary", "sm")}>
                    חיפוש מועמדים<span className="sr-only"> ל{r.title ?? "משרה"}</span>
                  </Link>
                </td>
              </tr>
            );
          })}
        </Table>
        <Pager action={ACTION} values={{ ...values, sort: sort.key, dir: sort.dir }} page={page} pageSize={PAGE_SIZE} total={total} />
        <p className="mt-3 text-xs text-muted">
          התחום מזוהה מכותרת המשרה, מהתיאור ומהכישורים שלה, באותם מונחים שבהם מסווגים קורות החיים (כמו בסינון &quot;תחום / מקצוע&quot; בקורות חיים); הכותרת
          קובעת יותר מהתיאור. משרה שלא זוהה לה תחום מחפשת את מילות הכותרת בתוך קורות החיים. האזור הוא היישוב של המשרה, בנפות ובמחוזות של הלמ״ס.
        </p>
      </Card>
    </>
  );
}

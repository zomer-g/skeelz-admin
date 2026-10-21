import type { Metadata } from "next";
import Link from "next/link";
import { Pager, SearchForm } from "@/components/entities/Search";
import { Badge, Card, PageHeader, Table } from "@/components/ui";
import { pageAuth } from "@/lib/auth/guard";
import { viewPath } from "@/lib/dashboard/params";
import { fileSize } from "@/lib/entities/cv";
import { CV_SORTS, CV_SOURCE_LABELS, CV_SOURCES, searchCvs, type CvFilters } from "@/lib/entities/cvs";
import { emailPath } from "@/lib/entities/emails";
import { loadFileAccess } from "@/lib/entities/file-access";
import { choice, dayParam, PAGE_SIZE, pageParam, param, sfRecordUrl, type SearchParams } from "@/lib/entities/search";
import { sortParam, tableSort } from "@/lib/entities/sort";
import { fmtDate, fmtInt } from "@/lib/format";

export const metadata: Metadata = { title: "קורות חיים" };
export const dynamic = "force-dynamic";

const ACTION = "/cvs";
const KEYS = ["q", "text", "unhandled", "source", "kind", "from", "to", "sort", "dir", "page"];

/** Every CV in one list: on Contacts, on CV and application Cases, and on their emails (lib/entities/cvs.ts). */
export default async function CvsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const search = await searchParams;
  const auth = await pageAuth("viewer", viewPath(ACTION, search, KEYS));
  if (!auth.ok) return auth.render;

  const filters: CvFilters = {
    q: param(search, "q"),
    text: param(search, "text", 100),
    unhandled: choice(search, "unhandled", ["yes", "no"] as const),
    source: choice(search, "source", CV_SOURCES),
    kind: param(search, "kind") === "all" ? "all" : "",
    fromDay: dayParam(search, "from"),
    toDay: dayParam(search, "to"),
  };
  const page = pageParam(search);
  const sort = sortParam(search, CV_SORTS, "received");
  const { rows, total, unhandled, textSearch } = await searchCvs(filters, { page, sort });
  const access = await loadFileAccess(rows.map((r) => r.documentId));
  const values: Record<string, string> = {
    q: filters.q,
    text: filters.text,
    unhandled: filters.unhandled,
    source: filters.source,
    kind: filters.kind,
    from: filters.fromDay,
    to: filters.toDay,
  };
  const unhandledHref = `${ACTION}?${new URLSearchParams(Object.entries({ ...values, unhandled: "yes" }).filter(([, v]) => v)).toString()}`;

  return (
    <>
      <PageHeader title="קורות חיים" subtitle='כל הקבצים של מועמדים: באיש הקשר, ב-Case מסוג "קורות חיים" או הגשה, ובמיילים שלהם' />
      <SearchForm
        action={ACTION}
        values={values}
        fields={[
          { kind: "text", name: "q", label: "חיפוש", placeholder: "שם, מייל, שם הקובץ או מספר Case", wide: true },
          { kind: "text", name: "text", label: "חיפוש בתוך הקבצים", placeholder: 'למשל: אקסל, הנהלת חשבונות, "שירות לקוחות"', wide: true },
          {
            kind: "select",
            name: "unhandled",
            label: "טיפול",
            options: [
              { value: "yes", label: "לא טופלו (נסגרו בסגירה הגורפת)" },
              { value: "no", label: "כל השאר" },
            ],
          },
          { kind: "select", name: "source", label: "איפה הקובץ", options: CV_SOURCES.map((s) => ({ value: s, label: CV_SOURCE_LABELS[s] })) },
          { kind: "date", name: "from", label: "הגיעו מתאריך" },
          { kind: "date", name: "to", label: "עד תאריך" },
          { kind: "check", name: "kind", label: "גם קבצים שאינם מסמכים (תמונות וכו׳)" },
        ]}
      />
      {textSearch === "unavailable" ? (
        <p className="mb-4 rounded-card bg-hot/20 px-4 py-3 text-sm ring-1 ring-hot" role="status">
          החיפוש בתוך הקבצים לא זמין כרגע (Salesforce לא ענה). הרשימה מסוננת כאילו לא נמצא דבר.
        </p>
      ) : null}
      <Card title={`קורות חיים · ${fmtInt(total)}`}>
        <p className="mb-4 flex flex-wrap items-center gap-2 text-sm">
          <span className="inline-block h-3 w-5 rounded-e-[4px] bg-hot" aria-hidden />
          <span>
            {fmtInt(unhandled)} מהם הגיעו ב-Case שלא טופל: אף אחד לא שייך אותו לאיש קשר, שינה את סוגו או את הסטטוס שלו, והוא נסגר בסגירה הגורפת של 14.10.2026.
          </span>
          {filters.unhandled !== "yes" && unhandled ? (
            <Link href={unhandledHref} className="font-medium text-accent-dark underline underline-offset-4">
              להציג רק אותם
            </Link>
          ) : null}
        </p>
        <Table
          head={[
            { label: "הגיע", sort: "received" },
            { label: "מועמד", sort: "name" },
            { label: "קובץ", sort: "title" },
            "איפה",
            "Case",
            { label: "גודל", sort: "size" },
            "פתיחות",
          ]}
          sort={tableSort(CV_SORTS, sort, ACTION, values)}
          empty={rows.length === 0 ? (filters.text ? "לא נמצאו קבצים שמכילים את זה" : "לא נמצאו קבצים") : undefined}
        >
          {rows.map((r) => (
            <tr key={r.documentId} className={r.unhandled ? "bg-hot/25" : undefined}>
              <td className="whitespace-nowrap px-3 py-2 tabular-nums">
                {r.receivedAt ? fmtDate(r.receivedAt) : "—"}
                {r.unhandled ? (
                  <p className="mt-1">
                    <Badge tone="warning">לא טופל</Badge>
                  </p>
                ) : null}
              </td>
              <td className="px-3 py-2">
                {r.email ? (
                  <Link href={emailPath(r.email)} className="font-medium underline-offset-4 hover:underline" dir="auto">
                    {r.name ?? r.email}
                  </Link>
                ) : r.contactId ? (
                  <Link href={`/candidates/${r.contactId}`} className="font-medium underline-offset-4 hover:underline" dir="auto">
                    {r.name ?? "(ללא שם)"}
                  </Link>
                ) : (
                  <span dir="auto">{r.name ?? "—"}</span>
                )}
                {r.email && r.name ? (
                  <p className="text-xs text-muted" dir="ltr">
                    {r.email}
                  </p>
                ) : null}
              </td>
              <td className="px-3 py-2">
                {r.openPath ? (
                  <a href={r.openPath} target="_blank" rel="noreferrer" className="font-medium text-accent-dark underline underline-offset-4" dir="auto">
                    {r.title ?? "קובץ"}
                    {r.extension ? <span className="text-xs text-muted">.{r.extension}</span> : null}
                    <span className="sr-only"> (נפתח בלשונית חדשה)</span>
                  </a>
                ) : (
                  <span dir="auto">{r.title ?? "קובץ"}</span>
                )}
              </td>
              <td className="px-3 py-2">
                <span className="flex flex-wrap gap-1">
                  {r.sources.map((s) => (
                    <Badge key={s}>{CV_SOURCE_LABELS[s]}</Badge>
                  ))}
                </span>
              </td>
              <td className="px-3 py-2 text-xs">
                {r.caseId ? (
                  <>
                    <a href={sfRecordUrl(r.caseId) ?? "#"} target="_blank" rel="noreferrer" className="underline underline-offset-2">
                      {r.caseNumber ?? "Case"}
                      <span className="sr-only"> ב-Salesforce (נפתח בלשונית חדשה)</span>
                    </a>
                    <p className="text-muted">{[r.caseType, r.caseStatus].filter(Boolean).join(" · ")}</p>
                  </>
                ) : (
                  "—"
                )}
              </td>
              <td className="whitespace-nowrap px-3 py-2 tabular-nums text-xs">{fileSize(r.size)}</td>
              <td className="whitespace-nowrap px-3 py-2 text-xs">
                <Link href={`/cvs/${r.documentId}`} className="underline underline-offset-2">
                  {access.get(r.documentId) ? `${fmtInt(access.get(r.documentId)!.opens)} · ${fmtDate(access.get(r.documentId)!.lastAt)}` : "לא נפתח"}
                  <span className="sr-only"> · יומן הגישה ל{r.title ?? "קובץ"}</span>
                </Link>
                {access.get(r.documentId)?.lastBy ? <p className="text-muted" dir="ltr">{access.get(r.documentId)!.lastBy}</p> : null}
              </td>
            </tr>
          ))}
        </Table>
        <Pager action={ACTION} values={{ ...values, sort: sort.key, dir: sort.dir }} page={page} pageSize={PAGE_SIZE} total={total} />
        <p className="mt-3 text-xs text-muted">
          רשימת הקבצים מסונכרנת מ-Salesforce (רק הפרטים, לא הקבצים עצמם). כל פתיחה של קובץ נרשמת: &quot;פתיחות&quot; מראה כמה פעמים נפתח, מתי לאחרונה ועל ידי מי,
          ולחיצה עליה פותחת את יומן הגישה המלא של הקובץ. החיפוש בתוך הקבצים נעשה באינדקס של Salesforce.
        </p>
      </Card>
    </>
  );
}

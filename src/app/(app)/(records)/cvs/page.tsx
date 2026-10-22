import type { Metadata } from "next";
import Link from "next/link";
import { CopyContacts } from "@/components/entities/CopyContacts";
import { Pager, SearchForm } from "@/components/entities/Search";
import { Badge, Card, formatDateTime, PageHeader, Table } from "@/components/ui";
import { pageAuth } from "@/lib/auth/guard";
import { TOPIC_GROUPS, topicLabel, TOPICS } from "@/lib/cv-topics";
import { viewPath } from "@/lib/dashboard/params";
import { fileSize } from "@/lib/entities/cv";
import { CV_SORTS, CV_SOURCE_LABELS, CV_SOURCES, cvFilters, searchCvs, topicsRefreshedAt } from "@/lib/entities/cvs";
import { emailPath } from "@/lib/entities/emails";
import { loadFileAccess } from "@/lib/entities/file-access";
import { PAGE_SIZE, pageParam, sfRecordUrl, type SearchParams } from "@/lib/entities/search";
import { sortParam, tableSort } from "@/lib/entities/sort";
import { fmtDate, fmtInt } from "@/lib/format";
import { areaOptions, napaOptions, placeText } from "@/lib/geo/filters";

export const metadata: Metadata = { title: "קורות חיים" };
export const dynamic = "force-dynamic";

const ACTION = "/cvs";
const KEYS = ["q", "text", "topic", "source", "kind", "area", "napa", "from", "to", "sort", "dir", "page"];

/** Every CV in one list: on Contacts, on CV and application Cases, and on their emails (lib/entities/cvs.ts). */
export default async function CvsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const search = await searchParams;
  const auth = await pageAuth("viewer", viewPath(ACTION, search, KEYS));
  if (!auth.ok) return auth.render;

  const filters = cvFilters(search);
  const page = pageParam(search);
  const sort = sortParam(search, CV_SORTS, "received");
  const [{ rows, total, textSearch, topicCounts }, refreshedAt] = await Promise.all([
    searchCvs(filters, { page, sort, who: { actor: auth.user.email, via: "screen" }, topics: true }),
    topicsRefreshedAt(),
  ]);
  const access = await loadFileAccess(rows.map((r) => r.documentId));
  const values: Record<string, string> = {
    q: filters.q,
    text: filters.text,
    source: filters.source,
    kind: filters.kind,
    area: filters.area,
    napa: filters.napa,
    from: filters.fromDay,
    to: filters.toDay,
    topic: filters.topic,
  };
  const topicName = filters.topic ? topicLabel(filters.topic) : null;

  // Topics as a grouped select: each group (its whole field first, then its topics), with how many files
  // each holds under the other filters; the largest first, empty ones left out unless chosen.
  const n = (id: string) => topicCounts?.get(id) ?? 0;
  const counted = (id: string, label: string) => ({ value: id, label: `${label} (${fmtInt(n(id))})` });
  const topicGroups = TOPIC_GROUPS.filter((g) => n(g.id) || filters.topic.split(".")[0] === g.id)
    .sort((a, b) => n(b.id) - n(a.id))
    .map((g) => ({
      label: g.label,
      options: [
        counted(g.id, `${g.label} — הכל`),
        ...TOPICS.filter((t) => t.group === g.id && (n(t.id) || t.id === filters.topic))
          .sort((a, b) => n(b.id) - n(a.id))
          .map((t) => counted(t.id, t.label)),
      ],
    }));
  const chosen = TOPICS.find((t) => t.id === filters.topic);
  const chosenGroup = TOPIC_GROUPS.find((g) => g.id === filters.topic);
  const topicNote = chosen ? (
    <>
      <span className="font-medium text-ink">{chosen.label}:</span> מחפש בתוך הקבצים את {chosen.phrases.map((p) => `"${p}"`).join(", ")}, בכל צורות הכתיבה.
    </>
  ) : chosenGroup ? (
    <>
      <span className="font-medium text-ink">{chosenGroup.label}:</span> כל התחומים שבקבוצה —{" "}
      {TOPICS.filter((t) => t.group === chosenGroup.id)
        .map((t) => t.label)
        .join(", ")}
      .
    </>
  ) : (
    <>
      תחום = סט ביטויים שמחפשים בתוך הקבצים (למשל עבודה סוציאלית: &quot;עובדת סוציאלית&quot;, &quot;עו״ס&quot;, &quot;Social Worker&quot;). המספרים לפי שאר הסינון.
      {refreshedAt ? ` עודכן ב-${formatDateTime(refreshedAt)}.` : ""}
    </>
  );

  return (
    <>
      <PageHeader title="קורות חיים" subtitle='כל הקבצים של מועמדים: באיש הקשר, ב-Case מסוג "קורות חיים" או הגשה, ובמיילים שלהם' />
      <SearchForm
        action={ACTION}
        values={values}
        note={topicNote}
        fields={[
          { kind: "text", name: "q", label: "חיפוש", placeholder: "שם, מייל, שם הקובץ או מספר Case", wide: true },
          { kind: "text", name: "text", label: "חיפוש בתוך הקבצים", placeholder: "למשל: אקסל, הנהלת חשבונות", wide: true },
          { kind: "select", name: "topic", label: "תחום / מקצוע", options: [], groups: topicGroups, any: "כל התחומים" },
          { kind: "select", name: "area", label: "מחוז (לפי איש הקשר)", options: areaOptions(["unknown"]) },
          { kind: "select", name: "napa", label: "נפה", options: napaOptions(filters.area) },
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
      <Card title={`קורות חיים${topicName ? ` · ${topicName}` : ""} · ${fmtInt(total)}`}>
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
          empty={rows.length === 0 ? (filters.text || filters.topic ? "לא נמצאו קבצים שמכילים את זה" : "לא נמצאו קבצים") : undefined}
        >
          {rows.map((r) => (
            <tr key={r.documentId}>
              <td className="whitespace-nowrap px-3 py-2 tabular-nums">{r.receivedAt ? fmtDate(r.receivedAt) : "—"}</td>
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
                {placeText(r.place, true) ? <p className="text-xs text-muted">{placeText(r.place, true)}</p> : null}
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
                {r.topicPhrases.length ? <p className="text-xs text-muted">נמצא: {r.topicPhrases.join(" · ")}</p> : null}
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
        {total ? (
          <CopyContacts
            endpoint="/api/cvs/contacts"
            query={new URLSearchParams(Object.entries(values).filter(([, v]) => v)).toString()}
            total={total}
            subject={`האנשים מאחורי כל ${fmtInt(total)} הקבצים בחיפוש (כל אחד פעם אחת)`}
          />
        ) : null}
        <p className="mt-3 text-xs text-muted">
          רשימת הקבצים מסונכרנת מ-Salesforce (רק הפרטים, לא הקבצים עצמם). כל פתיחה של קובץ נרשמת: &quot;פתיחות&quot; מראה כמה פעמים נפתח, מתי לאחרונה ועל ידי מי,
          ולחיצה עליה פותחת את יומן הגישה המלא של הקובץ. החיפוש בתוך הקבצים נעשה באינדקס של Salesforce.
        </p>
      </Card>
    </>
  );
}

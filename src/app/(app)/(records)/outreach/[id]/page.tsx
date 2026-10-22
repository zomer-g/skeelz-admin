import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Pager } from "@/components/entities/Search";
import { EntityHeader } from "@/components/entities/EntityParts";
import { Badge, buttonClass, Card, smallFieldClass, Table } from "@/components/ui";
import { pageAuth } from "@/lib/auth/guard";
import { isTopicId, TOPIC_GROUPS, topicLabel, TOPICS } from "@/lib/cv-topics";
import { jobStatusLabel } from "@/lib/entities/companies";
import { emailPath } from "@/lib/entities/emails";
import { defaultReach, loadOutreachJob, parseWords, REACH_LABELS, REACHES, searchOutreach, type OutreachJob, type Reach } from "@/lib/entities/outreach";
import { choice, isSfId, PAGE_SIZE, pageParam, param, type SearchParams } from "@/lib/entities/search";
import { fmtDate, fmtDecimal, fmtInt } from "@/lib/format";
import { placeText } from "@/lib/geo/filters";

export const metadata: Metadata = { title: "פעילות יזומה" };
export const dynamic = "force-dynamic";

/** How many of the other fields the job's text pointed at are offered as choices. */
const MORE_TOPICS = 6;

/** The topics in the URL; before the form is first sent (`s` missing), the ones read from the job. */
function chosenTopics(search: SearchParams, job: OutreachJob): string[] {
  if (param(search, "s") !== "1") return job.suggested;
  const raw = search.topic;
  // Checkboxes send one `topic` each; the pager sends them joined by commas.
  const values = (Array.isArray(raw) ? raw : raw ? [raw] : [])
    .flatMap((v) => v.split(","))
    .map((v) => v.trim())
    .filter(isTopicId);
  return [...new Set(values)].slice(0, 10);
}

/** One job's outreach: the candidates whose CVs fit it best (lib/entities/outreach.ts). */
export default async function OutreachJobPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<SearchParams> }) {
  const [{ id }, search] = await Promise.all([params, searchParams]);
  if (!isSfId(id)) notFound();
  const action = `/outreach/${id}`;
  const auth = await pageAuth("viewer", action);
  if (!auth.ok) return auth.render;

  const job = await loadOutreachJob(id);
  if (!job) notFound();

  const topics = chosenTopics(search, job);
  // Before the form is sent, the title's words stand in for a job no topic fits.
  const words = param(search, "s") === "1" ? parseWords(param(search, "words")) : job.suggested.length ? [] : job.keywords;
  const reach: Reach = job.napa == null ? "all" : choice(search, "reach", REACHES) || defaultReach(job);
  const withApplied = param(search, "applied") === "1";
  const page = pageParam(search);
  const { rows, total, wordSearch } = await searchOutreach(job, { topics, words, reach, withApplied }, { page, who: { actor: auth.user.email, via: "screen" } });

  // The choices: what is chosen, then the other fields the job's text pointed at.
  const offered = [...new Set([...topics, ...job.topics.map((t) => t.id)])].slice(0, topics.length + MORE_TOPICS);
  const signs = new Map(job.topics.map((t) => [t.id, [...t.inTitle, ...t.inText, ...t.skills]]));
  const pagerValues: Record<string, string> = { s: "1", topic: topics.join(","), words: words.join(" "), reach: job.napa == null ? "" : reach, applied: withApplied ? "1" : "" };
  const jobPlace = placeText(job.place) ?? (job.place.locality ? job.place.locality : null);

  return (
    <>
      <EntityHeader
        back={{ href: "/outreach", label: "כל המשרות לפעילות יזומה" }}
        title={job.title ?? "(ללא שם)"}
        subtitle={job.company ?? undefined}
        badges={
          <>
            {job.paid ? <Badge tone="brand">משרה בתשלום</Badge> : <Badge>לא בתשלום</Badge>}
            {job.status ? <Badge tone={job.status === "Active" ? "success" : "neutral"}>באתר: {jobStatusLabel(job.status)}</Badge> : null}
            {job.caseNumber ? <span className="tabular-nums text-muted">Case {job.caseNumber}</span> : null}
          </>
        }
        links={[{ href: `/positions/${job.id}`, label: "כרטיס המשרה" }]}
      />

      <Card title="מה מחפשים">
        <form method="get" action={action} role="search">
          <input type="hidden" name="s" value="1" />
          <fieldset>
            <legend className="text-sm font-medium">תחום</legend>
            <p className="mt-1 text-xs text-muted">
              {job.suggested.length
                ? "סומנו התחומים שזוהו מהמשרה. אפשר להוריד, לסמן אחרים או להוסיף."
                : "לא זוהה תחום מהמשרה: מחפשים את מילות הכותרת בתוך קורות החיים. אפשר גם לבחור תחום."}
            </p>
            <div className="mt-2 flex flex-wrap gap-2">
              {offered.map((t) => (
                <label key={t} className="flex min-h-9 items-center gap-2 rounded-full border border-line bg-surface px-3 text-sm">
                  <input type="checkbox" name="topic" value={t} defaultChecked={topics.includes(t)} className="size-5 accent-[var(--color-accent)]" />
                  <span>
                    {topicLabel(t)}
                    {signs.get(t)?.length ? <span className="text-xs text-muted"> · {signs.get(t)!.slice(0, 3).join(", ")}</span> : null}
                  </span>
                </label>
              ))}
            </div>
          </fieldset>
          <div className="mt-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
            <div className="col-span-2 flex min-w-0 flex-col gap-1">
              <label htmlFor="f-words" className="text-xs font-medium text-muted">
                מילים לחיפוש בתוך קורות החיים (כל מילה שנמצאת מוסיפה לדירוג)
              </label>
              <input id="f-words" type="search" name="words" defaultValue={words.join(" ")} placeholder="למשל: גבייה, טכנאי" className={smallFieldClass} />
            </div>
            <div className="flex min-w-0 flex-col gap-1">
              <label htmlFor="f-topic-more" className="text-xs font-medium text-muted">
                הוספת תחום
              </label>
              <select id="f-topic-more" name="topic" defaultValue="" className={smallFieldClass}>
                <option value="">—</option>
                {TOPIC_GROUPS.map((g) => (
                  <optgroup key={g.id} label={g.label}>
                    <option value={g.id}>{g.label} — הכל</option>
                    {TOPICS.filter((t) => t.group === g.id).map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.label}
                      </option>
                    ))}
                  </optgroup>
                ))}
              </select>
            </div>
            <div className="flex min-w-0 flex-col gap-1">
              <label htmlFor="f-reach" className="text-xs font-medium text-muted">
                אזור המועמדים
              </label>
              {job.napa == null ? (
                <p id="f-reach" className="flex h-9 items-center text-sm">
                  בכל הארץ
                </p>
              ) : (
                <select id="f-reach" name="reach" defaultValue={reach} className={smallFieldClass}>
                  {REACHES.map((r) => (
                    <option key={r} value={r}>
                      {REACH_LABELS[r]}
                    </option>
                  ))}
                </select>
              )}
            </div>
            <label htmlFor="f-applied" className="col-span-2 flex min-h-9 items-center gap-2 self-end text-sm">
              <input id="f-applied" type="checkbox" name="applied" value="1" defaultChecked={withApplied} className="size-5 accent-[var(--color-accent)]" />
              גם מי שכבר הגיש/ה למשרה
            </label>
          </div>
          <p className="mt-3 text-xs text-muted">
            מיקום המשרה: {jobPlace ?? "לא ידוע"}
            {job.napa == null ? " — בלי יישוב ידוע מחפשים בכל הארץ, בלי עדיפות לאזור." : ". מועמדים מאותה נפה מדורגים ראשונים, אחריהם מאותו מחוז."}
          </p>
          <div className="mt-4">
            <button type="submit" className={buttonClass("primary", "sm")}>
              חיפוש מועמדים
            </button>
          </div>
        </form>
      </Card>

      <p className="mt-4" role="status">
        {wordSearch === "unavailable" ? (
          <span className="block rounded-card bg-hot/20 px-4 py-3 text-sm ring-1 ring-hot">
            החיפוש בתוך הקבצים לא זמין כרגע (Salesforce לא ענה): הדירוג לפי התחומים בלבד, בלי המילים.
          </span>
        ) : null}
      </p>
      <Card title={`מועמדים מתאימים · ${fmtInt(total)}`} className="mt-4">
        <Table
          head={["#", "מועמד", "התאמה", "קורות חיים", "הגיע"]}
          empty={
            rows.length
              ? undefined
              : topics.length || words.length
                ? "לא נמצאו קורות חיים מתאימים באזור שנבחר. אפשר להרחיב את האזור, להוסיף תחום או לשנות את המילים."
                : "בחרו תחום או כתבו מילים כדי לחפש."
          }
        >
          {rows.map((r) => (
            <tr key={r.documentId}>
              <td className="px-3 py-2 tabular-nums text-muted">{fmtInt(r.rank)}</td>
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
              <td className="px-3 py-2 text-xs">
                <span className="flex flex-wrap gap-1">
                  {r.topics
                    .filter((t) => topics.includes(t))
                    .map((t) => (
                      <Badge key={t} tone="accent">
                        {topicLabel(t)}
                      </Badge>
                    ))}
                  {r.near === "napa" ? <Badge tone="success">באותה נפה</Badge> : r.near === "district" ? <Badge tone="success">באותו מחוז</Badge> : null}
                  {r.applied ? <Badge tone="warning">כבר הגיש/ה</Badge> : null}
                </span>
                {r.phrases.length || r.words.length ? <p className="mt-1 text-muted">נמצא: {[...r.words, ...r.phrases].slice(0, 6).join(" · ")}</p> : null}
                <p className="mt-1 tabular-nums text-muted">ציון {fmtDecimal(r.score)}</p>
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
                {r.otherFiles ? <p className="text-xs text-muted">ועוד {fmtInt(r.otherFiles)} קבצים מתאימים</p> : null}
              </td>
              <td className="whitespace-nowrap px-3 py-2 tabular-nums">{r.receivedAt ? fmtDate(r.receivedAt) : "—"}</td>
            </tr>
          ))}
        </Table>
        <Pager action={action} values={pagerValues} page={page} pageSize={PAGE_SIZE} total={total} />
        <p className="mt-3 text-xs text-muted">
          כל אדם מופיע פעם אחת, עם קורות החיים שמתאימים לו ביותר. הדירוג: תחום שנבחר שנמצא בקובץ (3 נקודות, תחום כללי 2, ואותו תחום רחב 1), כל מילה שנמצאה בקובץ (2), מגורים באותה נפה
          (3) או באותו מחוז (1.5), וקובץ שהגיע ב-90 הימים האחרונים (1) או בשנה האחרונה (0.5). מי שכבר הגיש/ה למשרה לא מוצג/ת, אלא אם סומן. כל חיפוש כאן נרשם
          ביומן, כמו חיפוש בתוך קורות החיים, וכל פתיחה של קובץ נרשמת ונספרת במכסה היומית.
        </p>
      </Card>
    </>
  );
}

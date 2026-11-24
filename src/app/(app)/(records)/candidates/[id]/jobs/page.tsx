import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Pager } from "@/components/entities/Search";
import { EntityHeader } from "@/components/entities/EntityParts";
import { Badge, buttonClass, Card, smallFieldClass, Table } from "@/components/ui";
import { pageAuth } from "@/lib/auth/guard";
import { topicLabel } from "@/lib/cv-topics";
import { viewPath } from "@/lib/dashboard/params";
import { jobMatchFilters, loadCandidateTopics, loadMatchCandidate, matchJobs } from "@/lib/entities/job-match";
import { REACH_LABELS, REACHES } from "@/lib/entities/outreach";
import { isSfId, PAGE_SIZE, pageParam, type SearchParams } from "@/lib/entities/search";
import { fmtDate, fmtDecimal, fmtInt } from "@/lib/format";
import { placeText } from "@/lib/geo/filters";
import { districtName, districtOf, subdistrictName } from "@/lib/geo/map";

export const metadata: Metadata = { title: "משרות מתאימות" };
export const dynamic = "force-dynamic";

/** One candidate's best-fitting jobs among those live on the site now (lib/entities/job-match.ts). */
export default async function CandidateJobsPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<SearchParams> }) {
  const [{ id }, search] = await Promise.all([params, searchParams]);
  if (!isSfId(id)) notFound();
  const action = `/candidates/${id}/jobs`;
  const path = viewPath(action, search, ["s", "topic", "reach", "applied", "page"]);
  const auth = await pageAuth("viewer", path);
  if (!auth.ok) return auth.render;

  const candidate = await loadMatchCandidate(id);
  if (!candidate) notFound();
  const found = await loadCandidateTopics(candidate);
  const filters = jobMatchFilters(search, candidate, found.topics);
  const { topics, reach, withApplied } = filters;
  const { rows: all, activeJobs } = await matchJobs(candidate, filters, { actor: auth.user.email, via: "screen" });
  const page = pageParam(search);
  const rows = all.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  const offered = [...new Set([...found.topics.map((t) => t.id), ...topics])];
  const phrasesOf = new Map(found.topics.map((t) => [t.id, t.phrases]));
  const pagerValues: Record<string, string> = { s: "1", topic: topics.join(","), reach: candidate.napa == null ? "" : reach, applied: withApplied ? "1" : "" };
  const home = candidate.napa == null ? null : `נפת ${subdistrictName(candidate.napa)}, מחוז ${districtName(districtOf(candidate.napa))}`;

  return (
    <>
      <EntityHeader
        back={{ href: `/candidates/${id}`, label: "כרטיס המועמד" }}
        title={`משרות מתאימות · ${candidate.name ?? "מועמד"}`}
        subtitle={candidate.email ? <span dir="ltr">{candidate.email}</span> : undefined}
        badges={<Badge tone="accent">{fmtInt(found.files)} קבצי קו&quot;ח</Badge>}
        links={[]}
      />

      <Card title="לפי מה מחפשים">
        {found.topics.length ? (
          <form method="get" action={action} role="search">
            <input type="hidden" name="s" value="1" />
            <fieldset>
              <legend className="text-sm font-medium">תחומים שנמצאו בקורות החיים</legend>
              <p className="mt-1 text-xs text-muted">סומנו כל התחומים שזוהו בקבצים של המועמד. אפשר להוריד תחום כדי לחפש רק לפי האחרים.</p>
              <div className="mt-2 flex flex-wrap gap-2">
                {offered.map((t) => (
                  <label key={t} className="flex min-h-9 items-center gap-2 rounded-full border border-line bg-surface px-3 text-sm">
                    <input type="checkbox" name="topic" value={t} defaultChecked={topics.includes(t)} className="size-5 accent-[var(--color-accent)]" />
                    <span>
                      {topicLabel(t)}
                      {phrasesOf.get(t)?.length ? <span className="text-xs text-muted"> · {phrasesOf.get(t)!.slice(0, 3).join(", ")}</span> : null}
                    </span>
                  </label>
                ))}
              </div>
            </fieldset>
            <div className="mt-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
              <div className="flex min-w-0 flex-col gap-1">
                <label htmlFor="f-reach" className="text-xs font-medium text-muted">
                  אזור המשרות
                </label>
                {candidate.napa == null ? (
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
                גם משרות שהמועמד/ת כבר הגיש/ה אליהן
              </label>
            </div>
            <p className="mt-3 text-xs text-muted">
              מגורי המועמד/ת: {home ?? "לא ידוע"}
              {candidate.napa == null ? " — בלי יישוב ידוע מחפשים בכל הארץ, בלי עדיפות לאזור." : ". משרות באותה נפה מדורגות ראשונות, אחריהן באותו מחוז. משרות ארציות ומהבית מוצגות בכל אזור."}
            </p>
            <div className="mt-4">
              <button type="submit" className={buttonClass("primary", "sm")}>
                חיפוש משרות
              </button>
            </div>
          </form>
        ) : (
          <p className="text-muted">
            {found.files
              ? 'בקורות החיים של המועמד/ת לא זוהה אף תחום מרשימת התחומים, ולכן אין לפי מה להתאים משרות. קבצים חדשים מתויגים פעם בשעה.'
              : 'לא נמצאו קבצי קורות חיים של המועמד/ת (באיש הקשר, ב-Cases שלו או במיילים שלהם), ולכן אין לפי מה להתאים משרות.'}
          </p>
        )}
      </Card>

      <Card title={`משרות מתאימות · ${fmtInt(all.length)} מתוך ${fmtInt(activeJobs)} פעילות באתר`} className="mt-4">
        <Table
          head={["#", "משרה", "התאמה", "מיקום", "נפתחה"]}
          empty={rows.length ? undefined : topics.length ? "לא נמצאו משרות פעילות מתאימות באזור שנבחר. אפשר להרחיב את האזור או לסמן תחומים נוספים." : "סמנו תחום כדי לחפש."}
        >
          {rows.map((r) => (
            <tr key={r.job.id}>
              <td className="px-3 py-2 tabular-nums text-muted">{fmtInt(r.rank)}</td>
              <td className="px-3 py-2">
                <Link href={`/positions/${r.job.id}`} className="font-medium underline-offset-4 hover:underline" dir="auto">
                  {r.job.title ?? "(ללא שם)"}
                </Link>
                {r.job.company ? (
                  <p className="text-xs text-muted" dir="auto">
                    {r.job.company}
                  </p>
                ) : null}
                <p className="text-xs">
                  <Link href={`/outreach/${r.job.id}`} className="text-accent-dark underline underline-offset-2">
                    מועמדים מתאימים<span className="sr-only"> · {r.job.title ?? "משרה"}</span>
                  </Link>
                </p>
              </td>
              <td className="px-3 py-2 text-xs">
                <span className="flex flex-wrap gap-1">
                  {r.matched.map((t) => (
                    <Badge key={t} tone="accent">
                      {topicLabel(t)}
                    </Badge>
                  ))}
                  {r.near === "napa" ? <Badge tone="success">באותה נפה</Badge> : r.near === "district" ? <Badge tone="success">באותו מחוז</Badge> : null}
                  {r.job.paid ? <Badge tone="brand">בתשלום</Badge> : null}
                  {r.applied ? <Badge tone="warning">כבר הגיש/ה</Badge> : null}
                </span>
                <p className="mt-1 tabular-nums text-muted">ציון {fmtDecimal(r.score)}</p>
              </td>
              <td className="px-3 py-2 text-sm">{placeText(r.job.place, true) ?? "—"}</td>
              <td className="whitespace-nowrap px-3 py-2 tabular-nums">{r.job.createdAt ? fmtDate(r.job.createdAt) : "—"}</td>
            </tr>
          ))}
        </Table>
        <Pager action={action} values={pagerValues} page={page} pageSize={PAGE_SIZE} total={all.length} />
        <p className="mt-3 text-xs text-muted">
          רק משרות שפעילות עכשיו באתר. תחום המשרה מזוהה מהכותרת, מהתיאור ומהכישורים שלה, כמו בעמוד המשרות, ומושווה לתחומים שנמצאו בקורות החיים. הדירוג זהה לזה של
          &quot;מועמדים מתאימים&quot;: תחום של המשרה שנמצא בקורות החיים (3 נקודות, תחום כללי 2, ואותו תחום רחב 1), משרה באותה נפה (3) או באותו מחוז (1.5), ומשרה שנפתחה ב-30
          הימים האחרונים (1) או ב-90 (0.5). משרות שהמועמד/ת כבר הגיש/ה אליהן לא מוצגות, אלא אם סומן. כל חיפוש כאן נרשם ביומן, כמו חיפוש בתוך קורות החיים.
        </p>
      </Card>
    </>
  );
}

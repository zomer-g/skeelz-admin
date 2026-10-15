import type { Metadata } from "next";
import Link from "next/link";
import { SectionTitle } from "@/components/dashboard/ApplicationPipeline";
import { DashboardShell } from "@/components/dashboard/DashboardShell";
import { DashboardTabs } from "@/components/dashboard/DashboardTabs";
import { regionListHref } from "@/components/dashboard/PlaceMapCard";
import { LevelSwitch, RegionMap } from "@/components/dashboard/RegionMap";
import { Badge, Card, StatCard, Table } from "@/components/ui";
import { pageAuth } from "@/lib/auth/guard";
import { EXPLAIN } from "@/lib/dashboard/explain";
import { formatDay, parseDashboardParams, rangeQuery, viewPath } from "@/lib/dashboard/params";
import { fmtDecimal, fmtInt, fmtPercent, fmtRelative } from "@/lib/format";
import { PLACE_KIND_LABELS } from "@/lib/geo/localities";
import { syncFreshness } from "@/lib/metrics/candidates";
import { loadMatching, parseLevel, parseSupply, regionsOf, type Level, type Supply } from "@/lib/metrics/geo";

export const metadata: Metadata = { title: "התאמת משרות ומועמדים" };
export const dynamic = "force-dynamic";

type Search = Record<string, string | string[] | undefined>;
const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

/** A balance (log2 of candidates per job against the country's) in words. */
function balanceBadge(balance: number | null) {
  if (balance == null) return <span className="text-muted">—</span>;
  if (balance <= -1) return <Badge tone="brand">חסרים מועמדים</Badge>;
  if (balance < -0.3) return <Badge tone="warning">מעט מועמדים</Badge>;
  if (balance < 0.3) return <Badge>מאוזן</Badge>;
  return <Badge tone="accent">עודף מועמדים</Badge>;
}

/**
 * Demand against supply: the open jobs (live on the site, in the paid scope) and the candidates,
 * by CBS district or sub-district and by the skills the jobs ask for. Choosing a region on the
 * map narrows the skill comparison to it.
 */
export default async function MatchingPage({ searchParams }: { searchParams: Promise<Search> }) {
  const search = await searchParams;
  const auth = await pageAuth("viewer", viewPath("/matching", search, ["range", "scope", "from", "to", "level", "supply", "region"]));
  if (!auth.ok) return auth.render;

  const params = parseDashboardParams(search, new Date(), "90d");
  const query = rangeQuery(params);
  const level = parseLevel(search.level);
  const supply = parseSupply(search.supply);
  const regionParam = Number(first(search.region));
  const region = regionsOf(level).some((r) => r.code === regionParam) ? regionParam : null;

  const [m, freshness] = await Promise.all([loadMatching({ scope: params.scope, supply, level, region, from: params.from, to: params.to }), syncFreshness()]);

  const href = (over: { level?: Level; supply?: Supply; region?: number | null }, hash = "") => {
    const q = new URLSearchParams(query);
    const l = over.level ?? level;
    const s = over.supply ?? supply;
    const r = over.region === undefined ? region : over.region;
    if (l === "district") q.set("level", l);
    if (s === "recent") q.set("supply", s);
    if (r != null) q.set("region", String(r));
    return `/matching?${q.toString()}${hash}`;
  };
  const keep: Record<string, string> = {};
  if (level === "district") keep.level = level;
  if (supply === "recent") keep.supply = supply;
  if (region != null) keep.region = String(region);

  const regionName = region == null ? null : regionsOf(level).find((r) => r.code === region)?.name;
  const unit = level === "district" ? "מחוז" : "נפה";
  const overall = m.totals.placedJobs ? m.totals.placedCandidates / m.totals.placedJobs : null;
  const supplyLabel = supply === "recent" ? "מועמדים פעילים בטווח" : "מועמדים במאגר";
  const listExtra = (code: number, l: Level, skill?: string) => ({
    jobs: regionListHref("/positions", code, l, { status: "Active", ...(params.scope === "paid" ? { paid: "paid" } : {}), ...(skill ? { skill } : {}) }),
    candidates: regionListHref("/candidates", code, l, skill ? { skill } : {}),
  });
  const shortages = [...m.regions].filter((r) => r.balance != null).sort((a, b) => (a.balance ?? 0) - (b.balance ?? 0));
  const pill = (on: boolean) => `rounded-full px-3 py-1 ${on ? "bg-white font-bold text-accent-dark shadow-sm" : "text-ink hover:bg-white/70"}`;

  return (
    <>
      <DashboardTabs active="matching" query={query} />
      <DashboardShell preset={params.preset} scope={params.scope} fromDay={params.fromDay} toDay={params.toDay} showBasis={false} keep={keep}>
        <p className="mb-6 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted">
          <span>
            ביקוש: המשרות הפעילות באתר עכשיו{params.scope === "paid" ? " (בתשלום)" : ""} · היצע:{" "}
            {supply === "recent" ? `מועמדים שנוספו או הגישו בין ${formatDay(params.fromDay)} ל-${formatDay(params.toDay)}` : "כל מאגר המועמדים"}
          </span>
          {freshness.casesSyncedAt ? <span>נתונים מ-Salesforce עודכנו {fmtRelative(freshness.casesSyncedAt)}</span> : null}
        </p>
        <nav aria-label="איזה היצע" className="mb-6 flex w-fit gap-1 rounded-full bg-panel p-1 text-sm">
          <Link href={href({ supply: "pool" })} scroll={false} aria-current={supply === "pool" ? "true" : undefined} className={pill(supply === "pool")}>
            כל המאגר
          </Link>
          <Link href={href({ supply: "recent" })} scroll={false} aria-current={supply === "recent" ? "true" : undefined} className={pill(supply === "recent")}>
            פעילים בטווח
          </Link>
        </nav>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard label="משרות פעילות" value={fmtInt(m.totals.jobs)} hint={`${fmtInt(m.totals.placedJobs)} משויכות לאזור`} info={EXPLAIN.matchingJobs} />
          <StatCard label={supplyLabel} value={fmtInt(m.totals.candidates)} hint={`${fmtInt(m.totals.placedCandidates)} משויכים לאזור`} info={EXPLAIN.matchingCandidates} />
          <StatCard label="מועמדים למשרה" value={fmtDecimal(overall)} hint="בממוצע הארצי, רק משרות ומועמדים עם אזור" info={EXPLAIN.matchingPerJob} />
          <StatCard
            label="עם כישורים"
            value={fmtPercent(m.totals.jobsWithSkills, m.totals.jobs)}
            hint={`מהמשרות · ${fmtPercent(m.totals.candidatesWithSkills, m.totals.candidates)} מהמועמדים`}
            info={EXPLAIN.matchingSkills}
          />
        </div>

        <SectionTitle id="regions" hint={`לחיצה על ${unit} מצמצמת אליה את השוואת הכישורים`}>
          ביקוש והיצע לפי אזור
        </SectionTitle>
        <Card level={3} title={`מועמדים למשרה לפי ${unit}`}>
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-muted">
              כל {unit} נצבעת לפי מספר המועמדים למשרה בה, ביחס לממוצע הארצי ({fmtDecimal(overall)}).
            </p>
            <LevelSwitch level={level} hrefFor={(l) => href({ level: l, region: null }, "#regions")} />
          </div>
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
            <RegionMap
              id="matching-map"
              level={level}
              mode="balance"
              selected={region}
              caption={`מועמדים למשרה לפי ${unit}`}
              values={regionsOf(level).map((r) => {
                const row = m.regions.find((x) => x.code === r.code);
                return {
                  code: r.code,
                  name: r.name,
                  value: row?.balance ?? null,
                  title: row
                    ? `${unit} ${r.name}: ${fmtInt(row.jobs)} משרות, ${fmtInt(row.candidates)} מועמדים${row.perJob != null ? `, ${fmtDecimal(row.perJob)} למשרה` : ""}`
                    : `${unit} ${r.name}: אין משרות ואין מועמדים`,
                };
              })}
              href={(code) => href({ region: code === region ? null : code }, "#skills")}
              table={{
                head: [unit, "משרות פעילות", supplyLabel, "מועמדים למשרה", "מצב"],
                rows: m.regions.map((r) => ({
                  code: r.code,
                  cells: [r.name, fmtInt(r.jobs), fmtInt(r.candidates), r.perJob != null ? fmtDecimal(r.perJob) : "—", balanceBadge(r.balance)],
                })),
              }}
            />
            <div className="flex flex-col gap-4">
              <h4 className="text-sm font-bold">הכי חסרים מועמדים</h4>
              <Table head={[unit, "משרות", "מועמדים", "למשרה", "רשימות"]} empty={shortages.length ? undefined : "אין משרות פעילות עם אזור"}>
                {shortages.slice(0, 8).map((r) => {
                  const lists = listExtra(r.code, level);
                  return (
                    <tr key={r.code}>
                      <td className="px-3 py-2 font-medium">
                        <Link href={href({ region: r.code }, "#skills")} className="underline-offset-4 hover:underline">
                          {r.name}
                        </Link>
                      </td>
                      <td className="px-3 py-2 tabular-nums">{fmtInt(r.jobs)}</td>
                      <td className="px-3 py-2 tabular-nums">{fmtInt(r.candidates)}</td>
                      <td className="px-3 py-2 tabular-nums">{r.perJob != null ? fmtDecimal(r.perJob) : "—"}</td>
                      <td className="whitespace-nowrap px-3 py-2 text-xs">
                        <Link href={lists.jobs} className="underline underline-offset-2">
                          משרות<span className="sr-only"> ב{r.name}</span>
                        </Link>
                        {" · "}
                        <Link href={lists.candidates} className="underline underline-offset-2">
                          מועמדים<span className="sr-only"> ב{r.name}</span>
                        </Link>
                      </td>
                    </tr>
                  );
                })}
              </Table>
              <p className="text-xs text-muted">
                בלי אזור: {fmtInt(m.jobsUnplaced.national)} משרות ב{PLACE_KIND_LABELS.national}, {fmtInt(m.jobsUnplaced.remote)} ב{PLACE_KIND_LABELS.remote} ו-
                {fmtInt(m.jobsUnplaced.unknown)} שהמיקום שלהן לא ידוע; {fmtInt(m.candidatesUnplaced)} מועמדים בלי עיר מזוהה. הם לא נספרים במפה, ומשרות ארציות ומהבית
                נספרות בהשוואת הכישורים של כל אזור.
              </p>
            </div>
          </div>
        </Card>

        <SectionTitle id="skills" hint="כמה מהמשרות הפעילות דורשות כל כישור, מול כמה מהמועמדים מחזיקים בו">
          {regionName ? `כישורים: ביקוש מול היצע ב${unit === "נפה" ? "נפת" : "מחוז"} ${regionName}` : "כישורים: ביקוש מול היצע בכל הארץ"}
        </SectionTitle>
        {region != null ? (
          <p className="-mt-2 mb-4 text-sm">
            <Link href={href({ region: null }, "#skills")} className="font-medium text-accent-dark underline underline-offset-4">
              חזרה לכל הארץ
            </Link>
          </p>
        ) : null}
        <Card level={3} title="כישורים מבוקשים מול המועמדים">
          {m.skills.length ? (
            <>
              <div className="mb-4 flex flex-wrap gap-4 text-xs text-muted" aria-hidden>
                <span className="flex items-center gap-1.5">
                  <span className="inline-block h-3 w-5 rounded-e-[4px] bg-brand" /> מהמשרות דורשות
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="inline-block h-3 w-5 rounded-e-[4px] bg-accent" /> מהמועמדים מחזיקים
                </span>
              </div>
              <ul className="flex flex-col gap-4" aria-label="כישורים: שיעור המשרות שדורשות מול שיעור המועמדים שמחזיקים">
                {m.skills.map((g) => (
                  <li key={g.skill} className="flex flex-col gap-1">
                    <div className="flex flex-wrap items-baseline justify-between gap-2 text-sm">
                      <span className="font-medium">{g.skill}</span>
                      <span className="flex items-center gap-2 text-xs text-muted">
                        <span className="tabular-nums">
                          {fmtPercent(g.jobShare, 1)} מהמשרות · {fmtPercent(g.candidateShare, 1)} מהמועמדים
                        </span>
                        {balanceBadge(g.balance)}
                      </span>
                    </div>
                    <div className="h-2.5 w-full" title={`${g.skill}: ${fmtInt(g.jobs)} משרות`}>
                      <div className="h-full rounded-e-[4px] bg-brand" style={{ width: g.jobShare ? `max(${g.jobShare * 100}%, 3px)` : "0" }} />
                    </div>
                    <div className="h-2.5 w-full" title={`${g.skill}: ${fmtInt(g.candidates)} מועמדים`}>
                      <div className="h-full rounded-e-[4px] bg-accent" style={{ width: g.candidateShare ? `max(${g.candidateShare * 100}%, 3px)` : "0" }} />
                    </div>
                  </li>
                ))}
              </ul>
              <details className="mt-4 text-sm">
                <summary className="cursor-pointer text-accent-dark underline-offset-4 hover:underline">הצגה כטבלה</summary>
                <div className="relative mt-2 overflow-x-auto">
                  <table className="w-full text-start">
                    <caption className="sr-only">כישורים: ביקוש מול היצע</caption>
                    <thead>
                      <tr className="border-b border-line text-muted">
                        {["כישור", "משרות שדורשות", "שיעור מהמשרות", "מועמדים שמחזיקים", "שיעור מהמועמדים", "מועמדים למשרה", "מצב"].map((h) => (
                          <th key={h} scope="col" className="px-2 py-1 text-start font-medium">
                            {h}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {m.skills.map((g) => (
                        <tr key={g.skill} className="border-b border-line/60">
                          <th scope="row" className="px-2 py-1 text-start font-medium">
                            {g.skill}
                          </th>
                          <td className="px-2 py-1 tabular-nums">{fmtInt(g.jobs)}</td>
                          <td className="px-2 py-1 tabular-nums">{fmtPercent(g.jobShare, 1)}</td>
                          <td className="px-2 py-1 tabular-nums">{fmtInt(g.candidates)}</td>
                          <td className="px-2 py-1 tabular-nums">{fmtPercent(g.candidateShare, 1)}</td>
                          <td className="px-2 py-1 tabular-nums">{g.perJob != null ? fmtDecimal(g.perJob) : "—"}</td>
                          <td className="px-2 py-1">{balanceBadge(g.balance)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </details>
            </>
          ) : (
            <p className="py-4 text-center text-sm text-muted">אין כאן משרות פעילות או מועמדים עם כישורים</p>
          )}
          <p className="mt-4 text-xs text-muted">
            השיעורים מתוך המשרות והמועמדים שסימנו כישור אחד לפחות. מועמד מסמן בממוצע הרבה יותר כישורים ממה שמשרה דורשת, ולכן &quot;מצב&quot; משווה את
            חלקו של הכישור מכל הכישורים שהמשרות מבקשות לחלקו מכל הכישורים שהמועמדים מציעים: כישור &quot;חסר&quot; הוא כזה שהמשרות מבקשות יותר, יחסית
            לשאר, ממה שהמועמדים מציעים.
          </p>
        </Card>

        <SectionTitle id="hotspots" hint={`צירופי ${unit} וכישור עם הכי מעט מועמדים שסימנו את הכישור לכל משרה פעילה שדורשת אותו (שתי משרות לפחות)`}>
          מוקדי מחסור
        </SectionTitle>
        <Card level={3} title="איפה ובמה חסרים מועמדים">
          <Table head={[unit, "כישור", "משרות פעילות", "מועמדים", "מועמדים למשרה", "רשימות"]} empty={m.hotspots.length ? undefined : "אין מספיק משרות פעילות עם אזור וכישורים"}>
            {m.hotspots.map((h) => {
              const lists = listExtra(h.region, level, h.skill);
              return (
                <tr key={`${h.region}-${h.skill}`}>
                  <td className="px-3 py-2 font-medium">{h.regionName}</td>
                  <td className="px-3 py-2">{h.skill}</td>
                  <td className="px-3 py-2 tabular-nums">{fmtInt(h.jobs)}</td>
                  <td className="px-3 py-2 tabular-nums">{fmtInt(h.candidates)}</td>
                  <td className="px-3 py-2 tabular-nums">{fmtDecimal(h.perJob)}</td>
                  <td className="whitespace-nowrap px-3 py-2 text-xs">
                    <Link href={lists.jobs} className="underline underline-offset-2">
                      משרות<span className="sr-only">: {h.skill} ב{h.regionName}</span>
                    </Link>
                    {" · "}
                    <Link href={lists.candidates} className="underline underline-offset-2">
                      מועמדים<span className="sr-only">: {h.skill} ב{h.regionName}</span>
                    </Link>
                  </td>
                </tr>
              );
            })}
          </Table>
        </Card>

        <p className="mt-8 text-xs text-muted">
          אזורים לפי מחוזות ונפות של הלמ״ס (קובץ היישובים 2023, כולל הנפות החדשות רמת גן, חולון ונצרת). משרה משויכת לפי סמל היישוב שהאתר שומר בה, ואם אין — לפי שם
          המיקום; מועמד לפי סמל היישוב באיש הקשר, ואם אין — לפי העיר. הכישורים הם רשימת הכישורים של האתר: במשרה — הכישורים הנדרשים, ובמועמד — מה שסימן.
        </p>
      </DashboardShell>
    </>
  );
}

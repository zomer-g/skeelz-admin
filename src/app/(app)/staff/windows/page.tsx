import type { Metadata } from "next";
import Link from "next/link";
import { BarList, type BarItem } from "@/components/dashboard/BarList";
import { DashboardShell } from "@/components/dashboard/DashboardShell";
import { Badge, Card, PageHeader, StatCard, Table } from "@/components/ui";
import { pageAuthStaff } from "@/lib/auth/guard";
import { parseDashboardParams, viewPath } from "@/lib/dashboard/params";
import { casePath } from "@/lib/entities/emails";
import { loadWindowsDashboard, type EmployeeWindows } from "@/lib/staff/timesheet";
import {
  ATTRIBUTION_CAP_MIN,
  BREAK_CREDIT_MIN,
  CATEGORY_LABELS,
  DEMO_PAD_MIN,
  DEMO_SPLIT_GAP_MIN,
  FIT_JOIN_MIN,
  FIT_KEEP_MIN,
  ON_ACCOUNT,
  ON_NOTHING,
  type ActionCategory,
  type TargetTime,
  type WindowResult,
} from "@/lib/staff/windows";
import { dayLabel, fmtCount, fmtHours } from "../format";
import { StaffNav } from "../StaffNav";
import { ExpectedRates } from "./ExpectedRates";
import { DemoButtons, FitButton, RemoveSheetButton, SheetImport, SheetSources } from "./TimesheetTools";
import { serviceAccountEmail } from "@/lib/google/auth";
import { listSheetSources } from "@/lib/staff/gsheet";

export const metadata: Metadata = { title: "פעולות ביחידת זמן" };
export const dynamic = "force-dynamic";

type Search = Record<string, string | string[] | undefined>;

const one = new Intl.NumberFormat("he-IL", { maximumFractionDigits: 1 });
const fmtMin = (n: number | null) => (n == null ? "—" : `${one.format(n)} דק׳`);
const fmtRate = (n: number | null | undefined) => (n == null ? "—" : one.format(n));
const TIME = new Intl.DateTimeFormat("he-IL", { timeZone: "Asia/Jerusalem", hour: "2-digit", minute: "2-digit" });
const CATEGORIES = Object.keys(CATEGORY_LABELS) as ActionCategory[];

const RATE = "זמן ממוצע לפעולה = סך שעות העבודה בדוח השעות (בדקות) חלקי כל הפעולות של העובד בטווח, גם אלה שמחוץ לחלונות. פעולות לשעה = אותן פעולות חלקי אותן שעות, ולכן 60 חלקי פעולות לשעה = זמן ממוצע לפעולה. בסיכום הכללי נספרים רק עובדים שיש להם דוח שעות.";
const ATTRIBUTED = "לפי מודל השיוך (רק זמן משויך)";
const MODEL = `דוח השעות נותן חלונות עבודה (תאריך, משעה עד שעה; כמה חלונות ביום אפשר). פעולה (משימת Salesforce של העובד) נספרת בחלון כשזמן היצירה שלה בתוכו. בכל חלון הפעולות ממוינות לפי הזמן, וכל פעולה מקבלת את הדקות שעברו מהפעולה שלפניה (הראשונה: מתחילת החלון), אם עברו עד ${ATTRIBUTION_CAP_MIN} דקות. פער ארוך יותר הוא הפסקה: הפעולה מקבלת ${BREAK_CREDIT_MIN} דקות והשאר נשאר "לא משויך". פעולה מחוץ לכל חלון לא מקבלת זמן ונספרת בנפרד.`;
const PURPOSE = `לפי סוג המקרה והנושא. כל פעולה על מקרה "קורות חיים" היא בקשת קורות חיים. על הגשה (הגשות קמביום): נושא שמבקש קורות חיים ("קיבלנו את מועמדותך", "קיבלתי את בקשתך", "שלחי קורות חיים", "קורות חיים עדכניים") הוא בקשת קורות חיים; "SKEELZ | מועמד/ת למשרת", "הגשה למשרה", "הגשת מועמדות למשרה", "עדכון סטטוס: מועמדים" או "קורות חיים של…" הם מול המעסיק; נושא אחר שמופיע בו "קורות חיים" הוא בקשת קורות חיים; כל השאר (שיחות, עדכונים, תשובות) מול המועמד. פעולה על חשבון (מעסיק), על ליד מעסיק, על משרה או על מודעות דרושים, וכל חשבון שהעובד יצר, היא מול המעסיק. פעולות על מקרים מסוג אחר הן "אחרות". כך אצל כל העובדים. תיקון וראיון = מול המועמד + מול המעסיק.`;
const SUBMISSION = "כל הדקות ששויכו לפעולות על מקרי הגשה (הגשות קמביום), חלקי מספר ההגשות השונות שנגעו בהן בתוך חלונות העבודה.";
const BY_TYPE = `כל פעולה נספרת לפי סוג הרשומה (Record Type) של המקרה שהיא רשומה עליו, או "חשבון (מעסיק)" כשהיא על חשבון, או "בלי מקרה". זמן ממוצע למקרה = הדקות ששויכו לפעולות על מקרים מהסוג, חלקי מספר המקרים השונים מהסוג שנגעו בהם בתוך חלונות העבודה. מקרה שטופל בידי שני עובדים נספר אצל כל אחד מהם.`;
const SOURCE_LABEL: Record<string, string> = { sheet: "דוח שהוגש", api: "מערכת שעות", manual: "הזנה ידנית", demo: "דמו" };
const KIND_LABEL = { email: "מייל", call: "שיחה", task: "משימה" } as const;
const DAY_TIME = new Intl.DateTimeFormat("he-IL", { timeZone: "Asia/Jerusalem", weekday: "short", day: "numeric", month: "numeric" });
const DEMO_TEXT = `דוח שעות דמו, לא אמיתי: לכל יום שבו לעובדת יש משימות ב-Salesforce, חלון מ-${DEMO_PAD_MIN} דקות לפני המשימה הראשונה (מעוגל לרבע שעה למטה) עד ${DEMO_PAD_MIN} דקות אחרי האחרונה (מעוגל למעלה), ושני חלונות כשיש הפסקה של יותר מ-${DEMO_SPLIT_GAP_MIN / 60} שעות בין משימות.`;

/**
 * Salesforce actions per unit of work time (docs/staff.md, "פעולות ביחידת זמן"): staff managers only
 * (pageAuthStaff). The timesheet's windows (staff_time_entries) against the tasks each employee owns,
 * attributed by the model in src/lib/staff/windows.ts. The view is logged with its range only.
 */
export default async function StaffWindowsPage({ searchParams }: { searchParams: Promise<Search> }) {
  const search = await searchParams;
  const auth = await pageAuthStaff(viewPath("/staff/windows", search, ["range", "from", "to", "who"]));
  if (!auth.ok) return auth.render;

  const p = parseDashboardParams(search, new Date(), "30d");
  const openWho = typeof search.who === "string" ? search.who : null;
  const [data, sheets] = await Promise.all([loadWindowsDashboard(p.fromDay, p.toDay, p.from, p.to), listSheetSources()]);
  const saEmail = serviceAccountEmail();
  const withHours = data.employees.filter((e) => e.summary.hours > 0);
  const shown = data.employees.filter((e) => e.summary.hours > 0 || e.summary.outside.total > 0);
  const total = totals(shown);
  // The overall rate: hours and every action of the employees who have a timesheet only.
  const timed = withHours.reduce((t, e) => ({ hours: t.hours + e.summary.hours, actions: t.actions + e.summary.inWindow.total + e.summary.outside.total }), { hours: 0, actions: 0 });
  const who = (e: EmployeeWindows) => e.name;
  const bars = (list: EmployeeWindows[], value: (e: EmployeeWindows) => number, display?: (e: EmployeeWindows) => string): BarItem[] =>
    list.map((e) => ({ label: who(e), value: value(e), display: display?.(e) })).sort((a, b) => b.value - a.value);

  return (
    <>
      <PageHeader title="פעולות ביחידת זמן" subtitle="שעות העבודה מדוח השעות מול הפעולות שבוצעו ב-Salesforce באותן שעות. גלוי למנהלי עובדים בלבד" />
      <StaffNav active="windows" />
      <DashboardShell preset={p.preset} scope={p.scope} fromDay={p.fromDay} toDay={p.toDay} showBasis={false} showScope={false}>
        <div className="flex flex-col gap-8">
          {data.demo ? (
            <div className="rounded-card border-2 border-brand bg-brand/5 px-5 py-4" role="note">
              <p className="font-bold text-brand-hover">נתוני דמו</p>
              <p className="mt-1 text-sm text-ink">
                דוח השעות של {data.employees.filter((e) => e.demo).map(who).join(", ")} בטווח הזה הוא דוח דמו, שנבנה ממועדי המשימות שלה ב-Salesforce, ולא דוח שעות אמיתי. {DEMO_TEXT} כשייטען
                דוח אמיתי לאותם ימים, הוא יחליף את הדמו.
              </p>
            </div>
          ) : null}
          {data.reconstructed ? (
            <div className="rounded-card border-2 border-hot bg-hot/15 px-5 py-4" role="note">
              <p className="font-bold text-ink">דוח שעות משוחזר</p>
              <p className="mt-1 text-sm text-ink">
                דוח השעות של {data.employees.filter((e) => e.reconstructed).map(who).join(", ")} בטווח הזה נבנה בדיעבד מהפעילות שלהם ב-Salesforce, כי לא הוגש דוח. השעות
                היומיות הן הערכה שתואמת את הפעילות ואת סך השעות החודשי, ולא דיווח של העובדים.
              </p>
            </div>
          ) : null}

          {data.employees.some((e) => e.fit) ? (
            <Card title="פעולות מחוץ לשעות בדוח משוחזר">
              <p className="mb-4 text-sm text-muted">
                בדוח משוחזר כל פעולה אמורה להיות בתוך שעות העבודה, כי הדוח נבנה מהפעילות עצמה. ההתאמה מכניסה כל פעולה שנשארה בחוץ לחלון, ומשלמת על הזמן הזה מההפסקות הארוכות ביותר, כך שסך
                השעות של הטווח נשמר. כשההפסקה באמצע חלון, החלון מתפצל לשניים (למשל בוקר ואחר הצהריים). ההתאמה משנה רק דוח משוחזר, אף פעם דוח שהוגש. פירוט בסעיף 2 של המתודולוגיה.
              </p>
              <div className="flex flex-col gap-6">
                {data.employees
                  .filter((e) => e.fit)
                  .map((e) => {
                    const f = e.fit!;
                    const short = f.addedMinutes - f.freedMinutes;
                    return (
                      <div key={e.id} className="flex flex-col gap-2">
                        <h3 className="font-bold">{e.name}</h3>
                        <p className="text-sm">
                          {fmtCount(f.covered)} פעולות מחוץ לשעות. ההתאמה תוסיף {fmtCount(f.addedMinutes)} דקות כדי לכסות אותן ותחזיר {fmtCount(f.freedMinutes)} דקות מהפסקות, תפצל{" "}
                          {fmtCount(f.splits)} חלונות ({fmtCount(f.windowsBefore)} חלונות לפני, {fmtCount(f.windowsAfter)} אחרי).{" "}
                          {short > 0 ? `אין מספיק הפסקות, ולכן סך השעות יגדל ב-${fmtCount(short)} דקות.` : "סך השעות לא ישתנה."}
                        </p>
                        <FitButton userId={e.id} name={e.name} from={p.fromDay} to={p.toDay} />
                      </div>
                    );
                  })}
              </div>
            </Card>
          ) : null}

          <section aria-labelledby="totals" className="flex flex-col gap-4">
            <h2 id="totals" className="sr-only">
              סיכום הטווח
            </h2>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <StatCard label="שעות עבודה" value={fmtHours(total.hours)} hint={`${fmtCount(withHours.length)} עובדים עם דוח שעות`} info="סכום אורכי חלונות העבודה בדוח השעות, בימים שבטווח. חלונות חופפים של אותו עובד נספרים פעם אחת." />
              <StatCard label="פעולות בתוך שעות העבודה" value={fmtCount(total.inWindow)} hint={`ועוד ${fmtCount(total.outside)} מחוץ לשעות`} info={MODEL} />
              <StatCard
                label="זמן ממוצע לפעולה"
                value={fmtMin(timed.actions && timed.hours ? (timed.hours * 60) / timed.actions : null)}
                hint={timed.hours ? `${fmtRate(timed.actions / timed.hours)} פעולות לשעה` : undefined}
                info={RATE}
              />
              <StatCard label="זמן ממוצע להגשה" value={fmtMin(total.submissions ? total.submissionMinutes / total.submissions : null)} hint={`${fmtCount(total.submissions)} הגשות · ${ATTRIBUTED}`} info={`זמן ממוצע להגשה, ${ATTRIBUTED}: ${SUBMISSION}`} />
              <StatCard
                label="שעות שויכו לפעולות"
                value={fmtHours(total.attributedMinutes / 60)}
                hint={total.afterBreak ? `${fmtCount(total.afterBreak)} פעולות אחרי הפסקה קיבלו ${BREAK_CREDIT_MIN} דק׳` : undefined}
                info={MODEL}
              />
              <StatCard label="לא משויך" value={fmtHours(total.hours - total.attributedMinutes / 60)} info={MODEL} />
              <StatCard label="בקשת קורות חיים" value={fmtHours(total.categories.cv_request / 60)} info={`לאן הלך הזמן: ${PURPOSE}`} />
              <StatCard label="תיקון וראיון (מועמד ומעסיק)" value={fmtHours((total.categories.candidate + total.categories.employer) / 60)} info={`לאן הלך הזמן: ${PURPOSE}`} />
            </div>
          </section>

          <Methodology />

          <Card title="לפי עובד">
            {!shown.length ? (
              <p className="text-sm text-muted">אין בטווח הזה דוח שעות ואין פעולות של עובדים מקושרים.</p>
            ) : (
              <>
                <div className="grid gap-x-10 gap-y-8 lg:grid-cols-2">
                  <Bars title="שעות עבודה" items={bars(withHours, (e) => e.summary.hours, (e) => fmtHours(e.summary.hours))} />
                  <Bars title="פעולות בתוך שעות העבודה" items={bars(shown, (e) => e.summary.inWindow.total)} />
                  <Bars title="פעולות לשעה" items={bars(withHours, (e) => e.summary.perHour?.total ?? 0, (e) => fmtRate(e.summary.perHour?.total))} />
                  <Bars title="זמן ממוצע לפעולה (דקות)" items={bars(withHours, (e) => e.summary.minutesPerAction ?? 0, (e) => fmtMin(e.summary.minutesPerAction))} />
                </div>
                <div className="mt-8">
                  <Table
                    caption="שעות ופעולות לפי עובד"
                    head={["עובד", "שעות", "פעולות בשעות", "מיילים", "שיחות", "אחרות", "מחוץ לשעות", "לשעה", "דק׳ לפעולה", "דק׳ למייל*", "דק׳ לשיחה*", "הגשות", "דק׳ להגשה*"]}
                  >
                    {shown.map((e) => {
                      const s = e.summary;
                      return (
                        <tr key={e.id} className={e.active ? "" : "bg-panel"}>
                          <td className="px-3 py-2">
                            <Link href={`/staff/${e.id}`} className="font-medium text-accent-dark underline underline-offset-4">
                              {e.name}
                            </Link>
                            {e.demo ? (
                              <>
                                {" "}
                                <Badge tone="warning">דמו</Badge>
                              </>
                            ) : null}
                            {e.reconstructed ? (
                              <>
                                {" "}
                                <Badge tone="warning">שחזור</Badge>
                              </>
                            ) : null}
                          </td>
                          <td className="px-3 py-2 tabular-nums">{s.hours ? fmtHours(s.hours) : <span className="text-xs text-muted">אין דוח</span>}</td>
                          <td className="px-3 py-2 font-medium tabular-nums">{fmtCount(s.inWindow.total)}</td>
                          <td className="px-3 py-2 tabular-nums">{fmtCount(s.inWindow.email)}</td>
                          <td className="px-3 py-2 tabular-nums">{fmtCount(s.inWindow.call)}</td>
                          <td className="px-3 py-2 tabular-nums">{fmtCount(s.inWindow.task)}</td>
                          <td className="px-3 py-2 tabular-nums">{fmtCount(s.outside.total)}</td>
                          <td className="px-3 py-2 tabular-nums">{fmtRate(s.perHour?.total)}</td>
                          <td className="px-3 py-2 tabular-nums">{fmtMin(s.minutesPerAction)}</td>
                          <td className="px-3 py-2 tabular-nums">{fmtMin(s.avgMinutes.email)}</td>
                          <td className="px-3 py-2 tabular-nums">{fmtMin(s.avgMinutes.call)}</td>
                          <td className="px-3 py-2 tabular-nums">{fmtCount(s.submissions)}</td>
                          <td className="px-3 py-2 tabular-nums">{fmtMin(s.avgPerSubmission)}</td>
                        </tr>
                      );
                    })}
                  </Table>
                  <p className="mt-2 text-xs text-muted">
                    דק׳ לפעולה = שעות חלקי כל הפעולות (בשעות ומחוצה להן), ההופכי של &quot;לשעה&quot;. * {ATTRIBUTED}: הדקות ששויכו לפעולות מהסוג חלקי מספרן, ולכן אינן מתחברות לדק׳ לפעולה.
                  </p>
                </div>
              </>
            )}
          </Card>

          <Card title="צפי לפי הקצב בטווח">
            <p className="mb-4 text-sm text-muted">כמה פעולות צפויות בעוד מספר שעות עבודה, לפי הפעולות לשעה של כל עובד בטווח (כל הפעולות בטווח חלקי שעות העבודה).</p>
            <ExpectedRates rows={withHours.map((e) => ({ id: e.id, name: e.name, perHour: e.summary.perHour ?? { total: 0, email: 0, call: 0, task: 0 } }))} />
          </Card>

          <Card title={`לאן הלך הזמן, ${ATTRIBUTED}`}>
            <p className="mb-6 text-sm text-muted">לאן הלך הזמן, {PURPOSE}</p>
            {!withHours.length ? (
              <p className="text-sm text-muted">אין לאף עובד שעות בטווח.</p>
            ) : (
              <>
                <div className="grid gap-x-10 gap-y-8 lg:grid-cols-2">
                  {withHours.map((e) => (
                    <Bars
                      key={e.id}
                      title={`${e.name} (שעות)`}
                      items={[
                        ...CATEGORIES.map((c) => ({ label: CATEGORY_LABELS[c], value: e.summary.categories[c].minutes / 60, display: fmtHours(e.summary.categories[c].minutes / 60) })),
                        { label: "לא משויך", value: e.summary.unassignedHours, display: fmtHours(e.summary.unassignedHours), color: "var(--color-muted)" },
                      ]}
                    />
                  ))}
                </div>
                <div className="mt-8">
                  <Table caption="שעות ופעולות לפי מטרה" head={["עובד", ...CATEGORIES.map((c) => CATEGORY_LABELS[c]), "תיקון וראיון", "לא משויך"]}>
                    {withHours.map((e) => (
                      <tr key={e.id}>
                        <td className="px-3 py-2">{e.name}</td>
                        {CATEGORIES.map((c) => (
                          <td key={c} className="px-3 py-2 tabular-nums">
                            {fmtHours(e.summary.categories[c].minutes / 60)}
                            <p className="text-xs text-muted">{fmtCount(e.summary.categories[c].actions)} פעולות</p>
                          </td>
                        ))}
                        <td className="px-3 py-2 font-medium tabular-nums">{fmtHours((e.summary.categories.candidate.minutes + e.summary.categories.employer.minutes) / 60)}</td>
                        <td className="px-3 py-2 tabular-nums">{fmtHours(e.summary.unassignedHours)}</td>
                      </tr>
                    ))}
                  </Table>
                </div>
              </>
            )}
          </Card>

          <CaseTypes employees={withHours} recordTypes={data.recordTypes} />

          <Positions employees={withHours} positions={data.positions} />

          <DetailedTimesheets employees={shown} recordTypes={data.recordTypes} openWho={openWho} />

          <Card title="דוחות שעות" tone="accent-light">
            <div className="flex flex-col gap-8">
              <div>
                <h3 className="mb-2 font-bold">דמו</h3>
                <p className="mb-4 text-sm text-muted">{DEMO_TEXT} טעינה מחדש מחליפה את הדמו הקודם, והמחיקה מוחקת את כל שורות הדמו ולא נוגעת בדוחות אמיתיים.</p>
                <DemoButtons />
              </div>
              <div>
                <h3 className="mb-2 font-bold">משיכה אוטומטית מגוגל שיטס</h3>
                <p className="mb-4 text-sm text-muted">
                  גיליון עם לשונית לכל עובד (&quot;שרית נובמבר 26&quot;: המילה הראשונה היא שם העובד), ובה שורה לכל יום: תאריך (01.11.26), שעת כניסה ושעת יציאה, ואפשר זוג
                  שני. לשונית שמתחילה ב&quot;דוגמא&quot; מדולגת. המערכת קוראת את הגיליונות כל 10 דקות, ולכל עובד הימים שבלשונית מחליפים את מה שנקלט קודם מדוח לאותם ימים (יום
                  שרוקן נמחק). כדי שהמערכת תוכל לקרוא, משתפים את הגיליון לצפייה עם{" "}
                  {saEmail ? (
                    <span dir="ltr" className="font-medium text-ink">
                      {saEmail}
                    </span>
                  ) : (
                    "חשבון השירות של Google (לא מוגדר כרגע)"
                  )}
                  . לכל חודש גיליון חדש מוסיפים כאן.
                </p>
                {sheets.length ? (
                  <ul className="mb-4 flex flex-col gap-3">
                    {sheets.map((s) => (
                      <li key={s.spreadsheetId} className="rounded-card border border-line bg-white p-4 text-sm">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <a href={`https://docs.google.com/spreadsheets/d/${s.spreadsheetId}/edit`} target="_blank" rel="noreferrer" className="font-medium underline">
                            {s.title ?? s.spreadsheetId}
                            <span className="sr-only"> (נפתח בלשונית חדשה)</span>
                          </a>
                          <RemoveSheetButton id={s.spreadsheetId} title={s.title ?? s.spreadsheetId} />
                        </div>
                        <p className="mt-1 text-muted">
                          {s.lastSyncedAt ? `נמשך לאחרונה ${DAY_TIME.format(s.lastSyncedAt)} ${s.lastSyncedAt.toLocaleTimeString("he-IL", { timeZone: "Asia/Jerusalem", hour: "2-digit", minute: "2-digit" })}` : "עוד לא נמשך"}
                        </p>
                        {s.lastError ? <p className="mt-1 text-danger">{s.lastError}</p> : null}
                        {s.lastResult?.length ? (
                          <ul className="mt-2 flex flex-col gap-1">
                            {s.lastResult.map((t) => (
                              <li key={t.tab}>
                                <span className="font-medium">{t.tab}</span>
                                {t.employee ? ` · ${t.employee} · ${fmtCount(t.windows)} חלונות ב-${fmtCount(t.days)} ימים` : ""}
                                {t.error ? <span className="text-danger"> · {t.error}</span> : null}
                              </li>
                            ))}
                          </ul>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                ) : null}
                <SheetSources />
              </div>
              <div>
                <h3 className="mb-2 font-bold">קליטת דוח אמיתי</h3>
                <p className="mb-4 text-sm text-muted">
                  שורה לכל חלון עבודה, ארבע עמודות מופרדות בפסיק, טאב או נקודה-פסיק: מייל העובד במערכת (או מזהה המשתמש, או מזהה משתמש ה-Salesforce שלו), תאריך (2026-10-25 או 25.10.2026), משעה ועד שעה (09:00, שעון ישראל).
                  שורת כותרת מדולגת. לכל עובד, הימים שבקובץ מחליפים את מה שנקלט קודם מדוח לאותם ימים, ויום שיש לו דוח אמיתי מתעלם מהדמו של אותו יום.
                </p>
                <SheetImport />
              </div>
            </div>
          </Card>
        </div>
      </DashboardShell>
    </>
  );
}

function totals(list: EmployeeWindows[]) {
  const t = { hours: 0, inWindow: 0, outside: 0, afterBreak: 0, attributedMinutes: 0, submissions: 0, submissionMinutes: 0, categories: { cv_request: 0, employer: 0, candidate: 0, other: 0 } as Record<ActionCategory, number> };
  for (const e of list) {
    const s = e.summary;
    t.hours += s.hours;
    t.inWindow += s.inWindow.total;
    t.outside += s.outside.total;
    t.afterBreak += s.afterBreak;
    t.attributedMinutes += s.minutesByKind.total;
    t.submissions += s.submissions;
    t.submissionMinutes += s.submissionMinutes;
    for (const c of CATEGORIES) t.categories[c] += s.categories[c].minutes;
  }
  return t;
}

function Bars({ title, items }: { title: string; items: BarItem[] }) {
  return (
    <div>
      <h3 className="mb-3 font-medium">{title}</h3>
      {items.length ? <BarList items={items} caption={title} /> : <p className="text-sm text-muted">אין נתונים בטווח</p>}
    </div>
  );
}

type RecordTypeRow = { key: string; label: string; active: boolean };

/** The label of an action's record-type key: a Case RecordType, an Account, or nothing. */
function targetLabel(recordTypes: RecordTypeRow[]) {
  const labels = new Map(recordTypes.map((r) => [r.key, r.active ? r.label : `${r.label} (לא פעיל)`]));
  return (key: string) => (key === ON_ACCOUNT ? "חשבון (מעסיק)" : key === ON_NOTHING ? "בלי מקרה" : (labels.get(key) ?? key));
}

/** How every figure on the page is made. Always on screen: the numbers mean little without it. */
function Methodology() {
  return (
    <div id="methodology">
      <Card title="מתודולוגיה: איך מחושבים המספרים">
        <p className="mb-6 text-sm">
          המסך מעריך כמה זמן עבודה הלך לכל פעולה ב-Salesforce, משני מקורות: דוח השעות (מתי העובד עבד) והמשימות שהעובד תיעד ב-Salesforce (מה עשה ומתי). כל מספר במסך נגזר מהכללים
          הבאים, והפרמטרים שלהם מופיעים כאן במספרים.
        </p>
        <ol className="flex list-decimal flex-col gap-6 ps-6 text-sm leading-relaxed">
          <li>
            <h3 className="mb-1 text-base font-bold">שעות העבודה מגיעות מדוח השעות</h3>
            <p>
              דוח שעות הוא רשימה של חלונות עבודה: תאריך, משעה ועד שעה. עובד יכול לעבוד כמה חלונות באותו יום, למשל כמה שעות בבוקר, הפסקה וכמה שעות אחר הצהריים, וכל חלון נשמר בנפרד.
              שעות העבודה הן סכום אורכי החלונות; חלונות חופפים של אותו עובד נספרים פעם אחת.
            </p>
            <p className="mt-2">
              לכל חלון יש מקור: דוח שהוגש (קובץ או הדבקה), מערכת שעות, הזנה ידנית, דמו, או <strong>שחזור</strong>. שחזור נבנה בדיעבד כשלא הוגש דוח: מהשעות שבהן לעובד הייתה פעילות
              ב-Salesforce, מותאם לסך השעות החודשי שנמסר. הוא מסומן במסך ואינו דיווח של העובד.
            </p>
          </li>
          <li>
            <h3 className="mb-1 text-base font-bold">התאמת שחזור לפעולות, עם פיצול חלונות</h3>
            <p>
              שחזור נבנה מהפעילות, ולכן כל פעולה צריכה להיות בתוך חלון. פעולה שנשארה בחוץ מרחיבה את החלון הקרוב באותו יום (אם הוא במרחק של עד {FIT_JOIN_MIN} דקות) עד רבע השעה שמכילה
              אותה, עם {FIT_KEEP_MIN} דקות מרווח; רחוקה יותר, היא מקבלת חלון משלה. את הזמן שנוסף ההתאמה לוקחת מההפסקות הארוכות ביותר: קטע של יותר מ-{ATTRIBUTION_CAP_MIN} דקות בלי
              פעולה, בתוך חלון שיש בו פעולות, תוך שמירת {FIT_KEEP_MIN} דקות אחרי הפעולה שלפניו ולפני הפעולה שאחריו. הפסקה באמצע חלון מפצלת אותו לשני חלונות. חלון שאין בו משימות לא
              משתנה, כי הוא נשען על פעילות אחרת (כניסות, עריכות). יום שאין בו אף חלון, כלומר שאין לו דוח בכלל, לא מותאם ולא מקבל חלונות. סך השעות נשמר, ואם אין מספיק הפסקות הוא גדל, והמסך אומר בכמה. ההתאמה לא נוגעת בדוח שהוגש.
            </p>
          </li>
          <li>
            <h3 className="mb-1 text-base font-bold">מהי פעולה</h3>
            <p>
              פעולה היא משימת Salesforce (Task) שהעובד הוא הבעלים שלה, לפי זמן היצירה שלה. Salesforce רושם משימה על כל מייל שנשלח ממנו, ולכן מייל = משימה מסוג Email, שיחה = Call, וכל
              השאר משימות אחרות. גם יצירת חשבון (מעסיק) ב-Salesforce נספרת כפעולה אחת של מי שיצר אותו. פעולה בתוך שעות העבודה היא פעולה שזמן היצירה שלה נופל בתוך אחד החלונות; פעולה מחוץ לכל חלון נספרת בנפרד ולא מקבלת זמן.
            </p>
          </li>
          <li>
            <h3 className="mb-1 text-base font-bold">כמה זמן מקבלת כל פעולה</h3>
            <p>
              בתוך כל חלון הפעולות ממוינות לפי הזמן. כל פעולה מקבלת את הדקות שעברו מהפעולה שלפניה, והראשונה את הדקות מתחילת החלון, כל עוד עברו עד {ATTRIBUTION_CAP_MIN} דקות. פער ארוך
              יותר נחשב הפסקה, ולא עבודה על הפעולה הבאה: הפעולה מקבלת {BREAK_CREDIT_MIN} דקות, ושאר הפער נשאר &quot;לא משויך&quot;. כל מה שנשאר מהחלון אחרי השיוך הוא &quot;לא משויך&quot;.
            </p>
            <p className="mt-2 text-muted">
              דוגמה: חלון 10:15–13:30 ופעולות ב-10:37, 10:41 ו-12:10. הראשונה מקבלת 22 דקות, השנייה 4, והשלישית באה אחרי 89 דקות בלי פעולה ולכן מקבלת {BREAK_CREDIT_MIN}. שויכו{" "}
              {22 + 4 + BREAK_CREDIT_MIN} דקות, ו-{195 - 22 - 4 - BREAK_CREDIT_MIN} מתוך 195 לא משויכות.
            </p>
          </li>
          <li>
            <h3 className="mb-1 text-base font-bold">לאן הלך הזמן</h3>
            <p>{PURPOSE}</p>
          </li>
          <li>
            <h3 className="mb-1 text-base font-bold">המדדים</h3>
            <ul className="flex list-disc flex-col gap-1 ps-5">
              <li>זמן ממוצע לפעולה = סך שעות העבודה בדוח השעות (בדקות) חלקי כל הפעולות של העובד בטווח, גם אלה שמחוץ לחלונות. אין בו שיוך: מי שרואה את השעות ואת מספר הפעולות יכול לחשב אותו בעצמו.</li>
              <li>פעולות לשעה = אותן פעולות חלקי אותן שעות. שני המדדים הופכיים זה לזה: 60 חלקי פעולות לשעה = זמן ממוצע לפעולה. הצפי &quot;בעוד N שעות&quot; הוא אותו קצב כפול N. בסיכום הכללי נספרים רק השעות והפעולות של עובדים שיש להם דוח שעות.</li>
              <li>
                המדדים לפי סוג ({ATTRIBUTED}): דק׳ למייל, דק׳ לשיחה, דק׳ להגשה, זמן לפי סוג מקרה, לפי משרה ו&quot;לאן הלך הזמן&quot;. אין להם חלוקה פשוטה, ולכן הם נשענים על הדקות ששויכו לפעולות (סעיף 4). סכומם קטן מסך השעות, וההפרש הוא הזמן הלא משויך, לכן אין להשוות אותם ישירות לזמן ממוצע לפעולה.
              </li>
              <li>זמן ממוצע להגשה = {SUBMISSION}</li>
              <li>זמן לפי סוג מקרה: {BY_TYPE}</li>
              <li>זמן לפי משרה = הזמן של פעולות על הגשות, לפי המשרה שההגשה שייכת לה.</li>
            </ul>
          </li>
          <li>
            <h3 className="mb-1 text-base font-bold">מה המודל לא יודע</h3>
            <ul className="flex list-disc flex-col gap-1 ps-5">
              <li>הוא מניח שהזמן שלפני פעולה הוקדש לה. עבודה שלא נרשמה ב-Salesforce (קריאת קורות חיים, שיחה שלא תועדה) נכנסת ל&quot;לא משויך&quot; או לפעולה שאחריה.</li>
              <li>
                בשחזור, השעות עצמן נגזרו מהפעילות, ולכן &quot;פעולות לשעה&quot; משקף בעיקר את סך השעות שנמסר. השוואה בין עובדים אמינה יותר כשלשניהם דוח שהוגש.
              </li>
              <li>
                פעולות לא שוות זו לזו: מייל בתבנית לוקח דקות, שיחה עם מועמד יותר. עובדים עם תמהיל עבודה שונה משווים לפי מטרה (&quot;לאן הלך הזמן&quot;) ולא לפי מספר הפעולות לשעה.
              </li>
            </ul>
          </li>
        </ol>
      </Card>
    </div>
  );
}

/**
 * The detailed timesheet of each employee: every work window (with its source, actions and time), then every
 * action with the window it fell in and the minutes it was credited. Case numbers, never subjects (they name candidates).
 */
function DetailedTimesheets({ employees, recordTypes, openWho }: { employees: EmployeeWindows[]; recordTypes: RecordTypeRow[]; openWho: string | null }) {
  const label = targetLabel(recordTypes);
  const source = (e: EmployeeWindows, w: WindowResult) =>
    w.demo ? "דמו" : e.reconstructed && (w.sources ?? []).includes("manual") ? "שחזור" : (w.sources ?? []).map((x) => SOURCE_LABEL[x] ?? x).join(", ") || "—";
  return (
    <Card title="דוח שעות מפורט">
      <p className="mb-4 text-sm text-muted">
        לכל עובד, כל חלון עבודה בטווח: מתי, כמה זמן, מאיזה מקור, כמה פעולות היו בו וכמה מהזמן שויך להן. מתחת, כל פעולה: באיזה חלון נפלה, מה סוגה ומטרתה, וכמה דקות קיבלה לפי המודל (סעיף 4
        במתודולוגיה).
      </p>
      {!employees.length ? (
        <p className="text-sm text-muted">אין חלונות עבודה בטווח.</p>
      ) : (
        <div className="flex flex-col gap-4">
          {employees.map((e) => {
            const s = e.summary;
            const days = new Set(s.windows.map((w) => w.workDate)).size;
            const span = (i: number | null) => (i == null ? null : s.windows[i]);
            return (
              <details key={e.id} id={`emp-${e.id}`} className="text-sm" open={openWho === e.id || employees.length === 1}>
                <summary className="cursor-pointer font-medium text-accent-dark underline-offset-4 hover:underline">
                  {e.name} · {fmtCount(s.windows.length)} חלונות ב-{fmtCount(days)} ימים · {fmtHours(s.hours)}
                  {e.reconstructed ? " · שחזור" : ""}
                </summary>
                <div className="mt-3 flex flex-col gap-6">
                  <p>
                    {fmtCount(s.inWindow.total)} פעולות בתוך שעות העבודה ו-{fmtCount(s.outside.total)} מחוץ להן. שויכו {fmtHours(s.attributedHours)}, לא שויכו {fmtHours(s.unassignedHours)}.
                    {s.afterBreak ? ` ${fmtCount(s.afterBreak)} פעולות באו אחרי הפסקה וקיבלו ${BREAK_CREDIT_MIN} דקות.` : ""}
                  </p>
                  <Table caption={`חלונות העבודה של ${e.name}`} head={["תאריך", "חלון", "שעות", "פעולות", "מיילים", "שיחות", "שויך", "לא משויך", "מקור"]}>
                    {s.windows.map((w, i) => {
                      const mine = s.actions.filter((a) => a.window === i);
                      return (
                        <tr key={w.start.toISOString()}>
                          <td className="px-3 py-2 whitespace-nowrap">{DAY_TIME.format(w.start)}</td>
                          <td className="px-3 py-2 whitespace-nowrap tabular-nums" dir="ltr">
                            {TIME.format(w.start)}–{TIME.format(w.end)}
                          </td>
                          <td className="px-3 py-2 tabular-nums">{fmtHours(w.minutes / 60)}</td>
                          <td className="px-3 py-2 tabular-nums">{fmtCount(w.actions)}</td>
                          <td className="px-3 py-2 tabular-nums">{fmtCount(mine.filter((a) => a.kind === "email").length)}</td>
                          <td className="px-3 py-2 tabular-nums">{fmtCount(mine.filter((a) => a.kind === "call").length)}</td>
                          <td className="px-3 py-2 tabular-nums">{fmtMin(w.attributed)}</td>
                          <td className="px-3 py-2 tabular-nums">{fmtMin(w.unassigned)}</td>
                          <td className="px-3 py-2">{source(e, w) === "שחזור" || source(e, w) === "דמו" ? <Badge tone="warning">{source(e, w)}</Badge> : source(e, w)}</td>
                        </tr>
                      );
                    })}
                  </Table>
                  {s.actions.length ? (
                    <Table caption={`הפעולות של ${e.name}`} head={["מתי", "חלון", "סוג", "מטרה", "סוג מקרה", "מקרה", "דקות"]}>
                      {s.actions.map((a) => {
                        const w = span(a.window);
                        const target = a.caseId ? (a.caseType ?? ON_NOTHING) : a.accountId ? ON_ACCOUNT : ON_NOTHING;
                        const path = a.caseId ? casePath({ id: a.caseId, recordType: a.caseType }) : null;
                        return (
                          <tr key={a.id} className={w ? "" : "bg-panel"}>
                            <td className="px-3 py-2 whitespace-nowrap tabular-nums">
                              {DAY_TIME.format(a.at)} {TIME.format(a.at)}
                            </td>
                            <td className="px-3 py-2 whitespace-nowrap tabular-nums">
                              {w ? (
                                <span dir="ltr">
                                  {TIME.format(w.start)}–{TIME.format(w.end)}
                                </span>
                              ) : (
                                <Badge tone="warning">מחוץ לשעות</Badge>
                              )}
                            </td>
                            <td className="px-3 py-2">{a.created === "account" ? "יצירת חשבון" : KIND_LABEL[a.kind]}</td>
                            <td className="px-3 py-2">{CATEGORY_LABELS[a.category]}</td>
                            <td className="px-3 py-2">{label(target)}</td>
                            <td className="px-3 py-2">
                              {path ? (
                                <Link href={path} className="text-accent-dark underline underline-offset-4">
                                  {a.caseNumber ?? "מקרה"}
                                </Link>
                              ) : (
                                (a.caseNumber ?? "—")
                              )}
                            </td>
                            <td className="px-3 py-2 tabular-nums">
                              {w ? fmtMin(a.minutes) : "—"}
                              {a.afterBreak ? <span className="block text-xs text-muted">אחרי הפסקה</span> : null}
                            </td>
                          </tr>
                        );
                      })}
                    </Table>
                  ) : null}
                </div>
              </details>
            );
          })}
        </div>
      )}
    </Card>
  );
}

/** Time per record type of what the actions sit on: every Case RecordType in the mirror (even with no time), Accounts, nothing. */
function CaseTypes({ employees, recordTypes }: { employees: EmployeeWindows[]; recordTypes: RecordTypeRow[] }) {
  const label = targetLabel(recordTypes);
  const sum = new Map<string, Omit<TargetTime, "avgPerRecord">>();
  for (const e of employees) {
    for (const t of e.summary.targets) {
      const row = sum.get(t.key) ?? { key: t.key, minutes: 0, actions: 0, records: 0 };
      row.minutes += t.minutes;
      row.actions += t.actions;
      row.records += t.records;
      sum.set(t.key, row);
    }
  }
  const keys = [...new Set([...recordTypes.map((r) => r.key), ...sum.keys()])];
  const rows = keys
    .map((key) => sum.get(key) ?? { key, minutes: 0, actions: 0, records: 0 })
    .sort((a, b) => b.minutes - a.minutes || b.actions - a.actions || label(a.key).localeCompare(label(b.key), "he"));
  const used = rows.filter((r) => r.actions > 0);
  const perRecord = (r: { key: string; minutes: number; records: number }) => (r.key === ON_NOTHING || !r.records ? null : r.minutes / r.records);
  const head = ["סוג", "שעות", "פעולות", "מקרים", "דק׳ למקרה", "דק׳ לפעולה"];
  const line = (r: { key: string; minutes: number; actions: number; records: number }) => (
    <tr key={r.key} className={r.actions ? "" : "text-muted"}>
      <td className="px-3 py-2">{label(r.key)}</td>
      <td className="px-3 py-2 tabular-nums">{r.actions ? fmtHours(r.minutes / 60) : "—"}</td>
      <td className="px-3 py-2 tabular-nums">{fmtCount(r.actions)}</td>
      <td className="px-3 py-2 tabular-nums">{r.key === ON_NOTHING ? "—" : fmtCount(r.records)}</td>
      <td className="px-3 py-2 font-medium tabular-nums">{fmtMin(perRecord(r))}</td>
      <td className="px-3 py-2 tabular-nums">{fmtMin(r.actions ? r.minutes / r.actions : null)}</td>
    </tr>
  );
  return (
    <Card title={`זמן לפי סוג מקרה, ${ATTRIBUTED}`}>
      <p className="mb-6 text-sm text-muted">זמן לפי סוג מקרה: {BY_TYPE} סוג בלי פעולות בטווח מוצג באפור.</p>
      {!used.length ? (
        <p className="text-sm text-muted">אין פעולות בתוך שעות העבודה בטווח.</p>
      ) : (
        <BarList
          caption="שעות לפי סוג מקרה"
          items={used.map((r) => ({ label: label(r.key), value: r.minutes / 60, display: fmtHours(r.minutes / 60), note: r.key === ON_NOTHING ? undefined : `${fmtMin(perRecord(r))} למקרה` }))}
        />
      )}
      <div className="mt-8">
        <Table caption="זמן ממוצע למקרה לפי סוג, כל העובדים" head={head}>
          {rows.map(line)}
        </Table>
      </div>
      {employees.length > 1 ? (
        <div className="mt-8 flex flex-col gap-4">
          {employees.map((e) => (
            <details key={e.id} className="text-sm">
              <summary className="cursor-pointer font-medium text-accent-dark underline-offset-4 hover:underline">{e.name} · לפי סוג מקרה</summary>
              <div className="mt-3">
                <Table caption={`זמן לפי סוג מקרה של ${e.name}`} head={head} empty={e.summary.targets.length ? undefined : "אין פעולות בתוך שעות העבודה"}>
                  {e.summary.targets.map(line)}
                </Table>
              </div>
            </details>
          ))}
        </div>
      ) : null}
    </Card>
  );
}

/** Submission time by job, every employee together: the jobs that took the most hours. */
function Positions({ employees, positions }: { employees: EmployeeWindows[]; positions: Map<string, { title: string | null; caseNumber: string | null }> }) {
  const byJob = new Map<string, { id: string | null; minutes: number; actions: number; submissions: number; people: Set<string> }>();
  for (const e of employees) {
    for (const p of e.summary.positions) {
      const key = p.positionId ?? "";
      const row = byJob.get(key) ?? { id: p.positionId, minutes: 0, actions: 0, submissions: 0, people: new Set<string>() };
      row.minutes += p.minutes;
      row.actions += p.actions;
      row.submissions += p.submissions;
      row.people.add(e.name);
      byJob.set(key, row);
    }
  }
  const top = [...byJob.values()].sort((a, b) => b.minutes - a.minutes).slice(0, 15);
  const title = (id: string | null) => (id ? (positions.get(id)?.title ?? positions.get(id)?.caseNumber ?? "משרה") : "בלי משרה");
  return (
    <Card title={`זמן לפי משרה, ${ATTRIBUTED}`}>
      <p className="mb-6 text-sm text-muted">
        הזמן ששויך לפעולות על הגשות (הגשות קמביום), לפי המשרה שההגשה שייכת לה (ParentId), כל העובדים יחד. 15 המשרות שלקחו הכי הרבה זמן. הגשה שטופלה בידי שני עובדים נספרת אצל כל אחד מהם.
      </p>
      {!top.length ? (
        <p className="text-sm text-muted">אין פעולות על הגשות בתוך שעות העבודה בטווח.</p>
      ) : (
        <>
          <BarList
            caption="שעות לפי משרה"
            items={top.map((j) => ({ label: title(j.id), value: j.minutes / 60, display: fmtHours(j.minutes / 60), note: `${fmtCount(j.submissions)} הגשות` }))}
          />
          <div className="mt-8">
            <Table caption="זמן לפי משרה" head={["משרה", "שעות", "הגשות", "פעולות", "דק׳ להגשה", "עובדים"]}>
              {top.map((j) => (
                <tr key={j.id ?? "none"}>
                  <td className="px-3 py-2">
                    {j.id ? (
                      <Link href={`/positions/${j.id}`} className="text-accent-dark underline underline-offset-4">
                        {title(j.id)}
                      </Link>
                    ) : (
                      title(j.id)
                    )}
                  </td>
                  <td className="px-3 py-2 tabular-nums">{fmtHours(j.minutes / 60)}</td>
                  <td className="px-3 py-2 tabular-nums">{fmtCount(j.submissions)}</td>
                  <td className="px-3 py-2 tabular-nums">{fmtCount(j.actions)}</td>
                  <td className="px-3 py-2 tabular-nums">{fmtMin(j.submissions ? j.minutes / j.submissions : null)}</td>
                  <td className="px-3 py-2">{[...j.people].join(", ")}</td>
                </tr>
              ))}
            </Table>
          </div>
        </>
      )}
    </Card>
  );
}

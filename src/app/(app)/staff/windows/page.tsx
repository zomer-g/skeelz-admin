import type { Metadata } from "next";
import Link from "next/link";
import { Explained } from "@/components/Explained";
import { BarList, type BarItem } from "@/components/dashboard/BarList";
import { DashboardShell } from "@/components/dashboard/DashboardShell";
import { Badge, Card, PageHeader, StatCard, Table } from "@/components/ui";
import { pageAuthStaff } from "@/lib/auth/guard";
import { parseDashboardParams, viewPath } from "@/lib/dashboard/params";
import { loadWindowsDashboard, type EmployeeWindows } from "@/lib/staff/timesheet";
import { ATTRIBUTION_CAP_MIN, CATEGORY_LABELS, DEMO_PAD_MIN, DEMO_SPLIT_GAP_MIN, type ActionCategory } from "@/lib/staff/windows";
import { dayLabel, fmtCount, fmtHours } from "../format";
import { StaffNav } from "../StaffNav";
import { ExpectedRates } from "./ExpectedRates";
import { DemoButtons, SheetImport } from "./TimesheetTools";

export const metadata: Metadata = { title: "פעולות ביחידת זמן" };
export const dynamic = "force-dynamic";

type Search = Record<string, string | string[] | undefined>;

const one = new Intl.NumberFormat("he-IL", { maximumFractionDigits: 1 });
const fmtMin = (n: number | null) => (n == null ? "—" : `${one.format(n)} דק׳`);
const fmtRate = (n: number | null | undefined) => (n == null ? "—" : one.format(n));
const TIME = new Intl.DateTimeFormat("he-IL", { timeZone: "Asia/Jerusalem", hour: "2-digit", minute: "2-digit" });
const CATEGORIES = Object.keys(CATEGORY_LABELS) as ActionCategory[];

const MODEL = `מודל השיוך: דוח השעות נותן חלונות עבודה (מתאריך-שעה עד שעה). פעולה (משימת Salesforce שהעובד יצר) נספרת בחלון כשזמן היצירה שלה בתוכו. בתוך כל חלון הפעולות ממוינות לפי הזמן, וכל פעולה מקבלת את הדקות שעברו מהפעולה שלפניה (הראשונה: מתחילת החלון), עד ${ATTRIBUTION_CAP_MIN} דקות לכל היותר. מה שנשאר מהחלון הוא "לא משויך". פעולה מחוץ לכל חלון לא מקבלת זמן ונספרת בנפרד.`;
const PURPOSE = `לאן הלך הזמן: פעולה על מקרה "קורות חיים" (cv_message), או על הגשה (הגשות קמביום, RecordType2) שהנושא שלה הוא תבנית "קיבלנו את מועמדותך" או שמופיע בו "קורות חיים", היא בקשת קורות חיים. על הגשה, נושא "SKEELZ | מועמד/ת למשרת", "הגשה למשרה" או "עדכון סטטוס: מועמדים" הוא מול המעסיק, וכל השאר (שיחות, עדכונים, תשובות) מול המועמד. פעולות על מקרים אחרים הן "אחרות". תיקון וראיון = מול המועמד + מול המעסיק.`;
const SUBMISSION = "זמן ממוצע להגשה: כל הדקות ששויכו לפעולות על מקרי הגשה (הגשות קמביום), חלקי מספר ההגשות השונות שנגעו בהן בתוך חלונות העבודה.";
const DEMO_TEXT = `דוח שעות דמו, לא אמיתי: לכל יום שבו לעובדת יש משימות ב-Salesforce, חלון מ-${DEMO_PAD_MIN} דקות לפני המשימה הראשונה (מעוגל לרבע שעה למטה) עד ${DEMO_PAD_MIN} דקות אחרי האחרונה (מעוגל למעלה), ושני חלונות כשיש הפסקה של יותר מ-${DEMO_SPLIT_GAP_MIN / 60} שעות בין משימות.`;

/**
 * Salesforce actions per unit of work time (docs/staff.md, "פעולות ביחידת זמן"): staff managers only
 * (pageAuthStaff). The timesheet's windows (staff_time_entries) against the tasks each employee owns,
 * attributed by the model in src/lib/staff/windows.ts. The view is logged with its range only.
 */
export default async function StaffWindowsPage({ searchParams }: { searchParams: Promise<Search> }) {
  const search = await searchParams;
  const auth = await pageAuthStaff(viewPath("/staff/windows", search, ["range", "from", "to"]));
  if (!auth.ok) return auth.render;

  const p = parseDashboardParams(search, new Date(), "30d");
  const data = await loadWindowsDashboard(p.fromDay, p.toDay, p.from, p.to);
  const withHours = data.employees.filter((e) => e.summary.hours > 0);
  const shown = data.employees.filter((e) => e.summary.hours > 0 || e.summary.outside.total > 0);
  const total = totals(shown);
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

          <section aria-labelledby="totals" className="flex flex-col gap-4">
            <h2 id="totals" className="sr-only">
              סיכום הטווח
            </h2>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <StatCard label="שעות עבודה" value={fmtHours(total.hours)} hint={`${fmtCount(withHours.length)} עובדים עם דוח שעות`} info="סכום אורכי חלונות העבודה בדוח השעות, בימים שבטווח. חלונות חופפים של אותו עובד נספרים פעם אחת." />
              <StatCard label="פעולות בתוך שעות העבודה" value={fmtCount(total.inWindow)} hint={`ועוד ${fmtCount(total.outside)} מחוץ לשעות`} info={MODEL} />
              <StatCard label="זמן ממוצע לפעולה" value={fmtMin(total.inWindow ? total.attributedMinutes / total.inWindow : null)} info={MODEL} />
              <StatCard label="זמן ממוצע להגשה" value={fmtMin(total.submissions ? total.submissionMinutes / total.submissions : null)} hint={`${fmtCount(total.submissions)} הגשות`} info={SUBMISSION} />
              <StatCard label="שעות שויכו לפעולות" value={fmtHours(total.attributedMinutes / 60)} info={MODEL} />
              <StatCard label="לא משויך" value={fmtHours(total.hours - total.attributedMinutes / 60)} info={MODEL} />
              <StatCard label="בקשת קורות חיים" value={fmtHours(total.categories.cv_request / 60)} info={PURPOSE} />
              <StatCard label="תיקון וראיון (מועמד ומעסיק)" value={fmtHours((total.categories.candidate + total.categories.employer) / 60)} info={PURPOSE} />
            </div>
          </section>

          <Explained label="מודל השיוך" text={`${MODEL} ${PURPOSE}`}>
            <Card title="איך נמדד הזמן">
              <ul className="flex list-disc flex-col gap-2 ps-5 pe-8 text-sm">
                <li>{MODEL}</li>
                <li>{PURPOSE}</li>
                <li>{SUBMISSION}</li>
                <li>מיילים = משימות מסוג Email (Salesforce רושם משימה על כל מייל שנשלח ממנו), שיחות = Call, וכל השאר משימות אחרות, כמו במסך החודשי.</li>
              </ul>
            </Card>
          </Explained>

          <Card title="לפי עובד">
            {!shown.length ? (
              <p className="text-sm text-muted">אין בטווח הזה דוח שעות ואין פעולות של עובדים מקושרים.</p>
            ) : (
              <>
                <div className="grid gap-x-10 gap-y-8 lg:grid-cols-2">
                  <Bars title="שעות עבודה" items={bars(withHours, (e) => e.summary.hours, (e) => fmtHours(e.summary.hours))} />
                  <Bars title="פעולות בתוך שעות העבודה" items={bars(shown, (e) => e.summary.inWindow.total)} />
                  <Bars title="פעולות לשעה" items={bars(withHours, (e) => e.summary.perHour?.total ?? 0, (e) => fmtRate(e.summary.perHour?.total))} />
                  <Bars title="זמן ממוצע לפעולה (דקות)" items={bars(withHours, (e) => e.summary.avgMinutes.total ?? 0, (e) => fmtMin(e.summary.avgMinutes.total))} />
                </div>
                <div className="mt-8">
                  <Table
                    caption="שעות ופעולות לפי עובד"
                    head={["עובד", "שעות", "פעולות בשעות", "מיילים", "שיחות", "אחרות", "מחוץ לשעות", "לשעה", "דק׳ לפעולה", "דק׳ למייל", "דק׳ לשיחה", "הגשות", "דק׳ להגשה"]}
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
                          </td>
                          <td className="px-3 py-2 tabular-nums">{s.hours ? fmtHours(s.hours) : <span className="text-xs text-muted">אין דוח</span>}</td>
                          <td className="px-3 py-2 font-medium tabular-nums">{fmtCount(s.inWindow.total)}</td>
                          <td className="px-3 py-2 tabular-nums">{fmtCount(s.inWindow.email)}</td>
                          <td className="px-3 py-2 tabular-nums">{fmtCount(s.inWindow.call)}</td>
                          <td className="px-3 py-2 tabular-nums">{fmtCount(s.inWindow.task)}</td>
                          <td className="px-3 py-2 tabular-nums">{fmtCount(s.outside.total)}</td>
                          <td className="px-3 py-2 tabular-nums">{fmtRate(s.perHour?.total)}</td>
                          <td className="px-3 py-2 tabular-nums">{fmtMin(s.avgMinutes.total)}</td>
                          <td className="px-3 py-2 tabular-nums">{fmtMin(s.avgMinutes.email)}</td>
                          <td className="px-3 py-2 tabular-nums">{fmtMin(s.avgMinutes.call)}</td>
                          <td className="px-3 py-2 tabular-nums">{fmtCount(s.submissions)}</td>
                          <td className="px-3 py-2 tabular-nums">{fmtMin(s.avgPerSubmission)}</td>
                        </tr>
                      );
                    })}
                  </Table>
                </div>
              </>
            )}
          </Card>

          <Card title="צפי לפי הקצב בטווח">
            <p className="mb-4 text-sm text-muted">כמה פעולות צפויות בעוד מספר שעות עבודה, לפי הפעולות לשעה של כל עובד בטווח (פעולות בתוך חלונות העבודה חלקי שעות העבודה).</p>
            <ExpectedRates rows={withHours.map((e) => ({ id: e.id, name: e.name, perHour: e.summary.perHour ?? { total: 0, email: 0, call: 0, task: 0 } }))} />
          </Card>

          <Card title="לאן הלך הזמן">
            <p className="mb-6 text-sm text-muted">{PURPOSE}</p>
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

          <Positions employees={withHours} positions={data.positions} />

          <Card title="ציר זמן יומי">
            {!withHours.length ? (
              <p className="text-sm text-muted">אין חלונות עבודה בטווח.</p>
            ) : (
              <div className="flex flex-col gap-4">
                {withHours.map((e) => (
                  <details key={e.id} className="text-sm" open={withHours.length === 1}>
                    <summary className="cursor-pointer font-medium text-accent-dark underline-offset-4 hover:underline">
                      {e.name} · {fmtCount(e.summary.windows.length)} חלונות
                    </summary>
                    <div className="mt-3">
                      <Table caption={`חלונות העבודה של ${e.name}`} head={["תאריך", "חלון", "שעות", "פעולות", "שויך", "לא משויך"]}>
                        {[...e.summary.windows].reverse().map((w) => (
                          <tr key={w.start.toISOString()}>
                            <td className="px-3 py-2 whitespace-nowrap">
                              {dayLabel(w.workDate)}
                              {w.demo ? (
                                <>
                                  {" "}
                                  <Badge tone="warning">דמו</Badge>
                                </>
                              ) : null}
                            </td>
                            <td className="px-3 py-2 whitespace-nowrap tabular-nums" dir="ltr">
                              {TIME.format(w.start)}–{TIME.format(w.end)}
                            </td>
                            <td className="px-3 py-2 tabular-nums">{fmtHours(w.minutes / 60)}</td>
                            <td className="px-3 py-2 tabular-nums">{fmtCount(w.actions)}</td>
                            <td className="px-3 py-2 tabular-nums">{fmtMin(w.attributed)}</td>
                            <td className="px-3 py-2 tabular-nums">{fmtMin(w.unassigned)}</td>
                          </tr>
                        ))}
                      </Table>
                    </div>
                  </details>
                ))}
              </div>
            )}
          </Card>

          <Card title="דוחות שעות" tone="accent-light">
            <div className="flex flex-col gap-8">
              <div>
                <h3 className="mb-2 font-bold">דמו</h3>
                <p className="mb-4 text-sm text-muted">{DEMO_TEXT} טעינה מחדש מחליפה את הדמו הקודם, והמחיקה מוחקת את כל שורות הדמו ולא נוגעת בדוחות אמיתיים.</p>
                <DemoButtons />
              </div>
              <div>
                <h3 className="mb-2 font-bold">קליטת דוח אמיתי</h3>
                <p className="mb-4 text-sm text-muted">
                  שורה לכל חלון עבודה, ארבע עמודות מופרדות בפסיק, טאב או נקודה-פסיק: מייל העובד במערכת (או מזהה המשתמש), תאריך (2026-10-25 או 25.10.2026), משעה ועד שעה (09:00, שעון ישראל).
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
  const t = { hours: 0, inWindow: 0, outside: 0, attributedMinutes: 0, submissions: 0, submissionMinutes: 0, categories: { cv_request: 0, employer: 0, candidate: 0, other: 0 } as Record<ActionCategory, number> };
  for (const e of list) {
    const s = e.summary;
    t.hours += s.hours;
    t.inWindow += s.inWindow.total;
    t.outside += s.outside.total;
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
    <Card title="זמן לפי משרה">
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

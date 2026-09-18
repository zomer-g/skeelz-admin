import type { Metadata } from "next";
import type { ReactNode } from "react";
import { ContactLink } from "@/components/PublicDoc";
import { Badge, Card, PageHeader, Table } from "@/components/ui";
import { webhookConfigured } from "@/lib/api/outbound";
import { API_LIMITS, MIN_TOKEN_LENGTH, WEBHOOK_EVENTS, WEBHOOK_LIMITS } from "@/lib/api/spec";
import { inboundTokens } from "@/lib/api/tokens";
import { pageAuth } from "@/lib/auth/guard";

export const metadata: Metadata = { title: "תיעוד API" };
export const dynamic = "force-dynamic";

function Code({ children }: { children: string }) {
  return (
    <pre dir="ltr" tabIndex={0} className="overflow-x-auto rounded-card bg-ink p-4 text-start font-mono text-xs leading-relaxed text-white">
      {children}
    </pre>
  );
}

function C({ children }: { children: ReactNode }) {
  return (
    <code dir="ltr" className="rounded bg-white px-1.5 py-0.5 font-mono text-[0.85em] ring-1 ring-line">
      {children}
    </code>
  );
}

function H3({ children }: { children: ReactNode }) {
  return <h3 className="mt-2 text-lg font-bold">{children}</h3>;
}

const td = "px-3 py-2 align-top";

const JOBS_EXAMPLE = [
  'curl -H "Authorization: Bearer $API_TOKEN" \\',
  '  "https://<כתובת המערכת>/api/v1/jobs?status=active&scope=paid&limit=2"',
  "",
  "{",
  '  "data": [',
  "    {",
  '      "id": "500000000000001AAA",',
  '      "case_number": "00012345",',
  '      "title": "שם המשרה",',
  '      "company": "שם החברה",',
  '      "site_job_key": "0123456789abcdef01234567",',
  '      "url": "https://jobs.skeelz.co.il/job/0123456789abcdef01234567",',
  '      "paid": true,',
  '      "active": true,',
  '      "manage_status": null,',
  '      "created_at": "2026-09-01T08:12:00.000Z",',
  '      "updated_at": "2026-09-13T10:40:00.000Z"',
  "    }",
  "  ],",
  '  "page": 1, "limit": 2, "total": 85, "has_more": true',
  "}",
].join("\n");

const JOB_EXAMPLE = [
  "GET /api/v1/jobs/0123456789abcdef01234567",
  "",
  "{",
  '  "data": {',
  '    "id": "500000000000001AAA", "title": "…", "paid": true, "active": true, …',
  '    "applications": { "total": 14, "paid": 14, "by_status": { "New": 3, "נשלחו קו\\"ח": 6, … } },',
  '    "site_last_30_days": { "from": "2026-08-16", "to": "2026-09-14", "job_opens": 412,',
  '                           "apply_clicks": 51, "apply_confirmations": 17, "page_views": 38 }',
  "  }",
  "}",
].join("\n");

const METRICS_EXAMPLE = [
  "GET /api/v1/metrics?from=2026-08-01&to=2026-08-31&scope=paid&basis=application",
  "",
  "{",
  '  "range": { "from": "2026-08-01", "to": "2026-08-31", "scope": "paid", "basis": "application" },',
  '  "jobs": { "new": 12, "active": 85 },',
  '  "applications": { "received": 320, "status_new": 41, "requested_cv": 150, "cv_received": 97,',
  '                    "in_handling": 22, "sent_to_employer": 88, "employer_responded": 40,',
  '                    "interviews": 25, "accepted": 6, "rejected_by_us": 70 },',
  '  "timing": { "first_touch_hours_median": 5.5, "days_to_transfer_median": 2 },',
  '  "reject_reasons": [ { "reason": "…", "count": 30 } ],',
  '  "site": { "sessions": 15300, "job_opens": 8200, "apply_clicks": 950, "apply_confirmations": 410 },',
  '  "data_freshness": { "salesforce_synced_at": "2026-09-14T15:40:00.000Z" }',
  "}",
].join("\n");

const WEBHOOK_EXAMPLE = [
  "POST <WEBHOOK_URL>",
  "Content-Type: application/json; charset=utf-8",
  "X-Skeelz-Event: application.status_changed",
  "X-Skeelz-Delivery: 5b0f1c3e-8d2a-4b7e-9c61-2f4a7d9e0b13",
  "X-Skeelz-Signature: t=1757862000,v1=9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08",
  "",
  "{",
  '  "id": "5b0f1c3e-8d2a-4b7e-9c61-2f4a7d9e0b13",',
  '  "type": "application.status_changed",',
  '  "created_at": "2026-09-14T15:41:02.000Z",',
  '  "data": {',
  '    "application": {',
  '      "id": "500000000000003AAA", "kind": "application", "status": "זומן לראיון",',
  '      "paid": true, "created_at": "2026-09-10T09:00:00.000Z", "candidate_id": "003000000000001AAA",',
  '      "job": { "id": "500000000000001AAA", "title": "…", "site_job_key": "0123…", "paid": true, … }',
  "    },",
  '    "previous_status": "נשלחו קו\\"ח",',
  '    "status": "זומן לראיון"',
  "  }",
  "}",
].join("\n");

const VERIFY_EXAMPLE = [
  'import { createHmac, timingSafeEqual } from "node:crypto";',
  "",
  "// rawBody: the request body exactly as received, before JSON.parse.",
  "export function verifySkeelzWebhook(rawBody, signatureHeader, secret) {",
  '  const parts = Object.fromEntries(signatureHeader.split(",").map((p) => p.split("=")));',
  "  const t = Number(parts.t);",
  `  if (!t || Math.abs(Date.now() / 1000 - t) > ${WEBHOOK_LIMITS.signatureToleranceSec}) return false; // stale: possible replay`,
  '  const expected = createHmac("sha256", secret).update(t + "." + rawBody).digest();',
  '  const given = Buffer.from(parts.v1 ?? "", "hex");',
  "  return given.length === expected.length && timingSafeEqual(given, expected);",
  "}",
].join("\n");

export default async function ApiDocsPage() {
  const auth = await pageAuth("viewer", "/api-docs");
  if (!auth.ok) return auth.render;

  const inboundOn = inboundTokens().length > 0;
  const outboundOn = webhookConfigured();
  const retries = WEBHOOK_LIMITS.retryDelaysMin.map((m) => (m < 60 ? `${m} דק׳` : `${m / 60} שע׳`)).join(", ");

  return (
    <>
      <PageHeader title="תיעוד API" subtitle="API נכנס לקריאת משרות ומדדים, ו-webhooks יוצאים על אירועים. בשני הכיוונים האימות בטוקן משותף." />

      <div className="flex flex-col gap-6">
        <Card title="מצב והגדרה">
          <div className="flex flex-col gap-4">
            <ul className="flex flex-wrap gap-x-8 gap-y-2">
              <li className="flex items-center gap-2">
                API נכנס: {inboundOn ? <Badge tone="success">פעיל</Badge> : <Badge>כבוי</Badge>}
              </li>
              <li className="flex items-center gap-2">
                Webhooks יוצאים: {outboundOn ? <Badge tone="success">פעיל</Badge> : <Badge>כבוי</Badge>}
              </li>
            </ul>
            <p>
              אדמין מפעיל כל כיוון בהגדרת משתני סביבה סודיים ב-xhostd (<C>set_env(secret=true)</C>). כל טוקן חייב להיות באורך {MIN_TOKEN_LENGTH} תווים
              לפחות, ואפשר ליצור אחד עם <C>openssl rand -hex 32</C>. טוקן קצר יותר, או שדה ריק, משאיר את הכיוון כבוי.
            </p>
            <Table head={["משתנה", "תפקיד"]}>
              <tr>
                <td className={td}><C>API_TOKEN</C></td>
                <td className={td}>הטוקן המשותף של ה-API הנכנס.</td>
              </tr>
              <tr>
                <td className={td}><C>API_TOKEN_PREVIOUS</C></td>
                <td className={td}>לא חובה. בזמן החלפת טוקן גם הישן ממשיך לעבוד, עד שמוחקים את המשתנה.</td>
              </tr>
              <tr>
                <td className={td}><C>WEBHOOK_URL</C></td>
                <td className={td}>הכתובת שאליה נשלחים האירועים. חייבת להיות https ולכתובת ציבורית, בלי שם משתמש וסיסמה בתוכה.</td>
              </tr>
              <tr>
                <td className={td}><C>WEBHOOK_TOKEN</C></td>
                <td className={td}>הטוקן המשותף שחותם על כל אירוע. הוא אף פעם לא נשלח בעצמו.</td>
              </tr>
            </Table>
            <p className="text-sm text-muted">
              ה-webhooks נשלחים מתהליך הסנכרון (<C>SYNC_WORKER=true</C>). שאלות על ה-API: <ContactLink />.
            </p>
          </div>
        </Card>

        <Card title="API נכנס: קריאת משרות ומדדים">
          <div className="flex flex-col gap-4">
            <p>
              כל הבקשות הן <C>GET</C> לכתובת <C>https://&lt;כתובת המערכת&gt;/api/v1</C>, והטוקן נשלח בכותרת <C>Authorization: Bearer &lt;API_TOKEN&gt;</C>.
              טוקן בכתובת (למשל <C>?token=</C>) נדחה, כי כתובות נשמרות בלוגים. התשובות ב-JSON. ה-API מחזיר משרות ונתונים מצטברים בלבד: שמות מועמדים,
              פרטי קשר וקבצים לא יוצאים דרכו.
            </p>

            <H3>GET /api/v1/jobs</H3>
            <p>רשימת משרות, מהחדשה לישנה.</p>
            <Table head={["פרמטר", "ערכים", "ברירת מחדל"]}>
              <tr>
                <td className={td}><C>status</C></td>
                <td className={td}><C>active</C> (באוויר באתר) או <C>all</C></td>
                <td className={td}><C>active</C></td>
              </tr>
              <tr>
                <td className={td}><C>scope</C></td>
                <td className={td}><C>paid</C> (משרות בתשלום) או <C>all</C></td>
                <td className={td}><C>paid</C></td>
              </tr>
              <tr>
                <td className={td}><C>updated_since</C></td>
                <td className={td}>תאריך ושעה ב-ISO 8601: רק משרות שהשתנו מאז</td>
                <td className={td}>—</td>
              </tr>
              <tr>
                <td className={td}><C>limit</C></td>
                <td className={td}>1–{API_LIMITS.maxPageSize}</td>
                <td className={td}>{API_LIMITS.defaultPageSize}</td>
              </tr>
              <tr>
                <td className={td}><C>page</C></td>
                <td className={td}>1–{API_LIMITS.maxPage}</td>
                <td className={td}>1</td>
              </tr>
            </Table>
            <Code>{JOBS_EXAMPLE}</Code>

            <H3>GET /api/v1/jobs/&#123;id&#125;</H3>
            <p>
              משרה אחת לפי מזהה Salesforce או לפי המזהה בכתובת המשרה באתר (24 תווים). מוחזרים גם ספירת ההגשות לפי סטטוס, והחשיפה באתר ב-30 הימים
              האחרונים.
            </p>
            <Code>{JOB_EXAMPLE}</Code>

            <H3>GET /api/v1/site/jobs</H3>
            <p>
              הפיד של האתר החדש (skeelz-site): כל המשרות הפעילות באתר, עם מה שדף משרה ציבורי מציג (כותרת, חברה, תיאור, עיר, היקף, כישורים, &quot;משרה
              חמה&quot; ובתשלום). בלי פרטי קשר של מעסיקים ובלי הגשות. נפתח רק בטוקן נפרד, <C>SITE_FEED_TOKEN</C>, ולא ב-<C>API_TOKEN</C>, עם מכסה
              שעתית משלו. התשובה נשמרת במטמון לשתי דקות.
            </p>

            <H3>GET /api/v1/metrics</H3>
            <p>המדדים של לשונית המועמדים בדשבורד, וסיכום התנועה באתר, לטווח ימים (שעון ישראל).</p>
            <Table head={["פרמטר", "ערכים", "ברירת מחדל"]}>
              <tr>
                <td className={td}><C>from</C>, <C>to</C></td>
                <td className={td}>
                  <C>YYYY-MM-DD</C>, כולל שני הקצוות, עד {API_LIMITS.maxRangeDays} ימים
                </td>
                <td className={td}>30 הימים האחרונים</td>
              </tr>
              <tr>
                <td className={td}><C>scope</C></td>
                <td className={td}><C>paid</C> או <C>all</C></td>
                <td className={td}><C>paid</C></td>
              </tr>
              <tr>
                <td className={td}><C>basis</C></td>
                <td className={td}>
                  <C>application</C> (ההגשות שנוצרו בטווח ומה קרה איתן) או <C>event</C> (כל מה שקרה בטווח)
                </td>
                <td className={td}><C>application</C></td>
              </tr>
            </Table>
            <Code>{METRICS_EXAMPLE}</Code>
          </div>
        </Card>

        <Card title="API יוצא: webhooks">
          <div className="flex flex-col gap-4">
            <p>
              המערכת שולחת <C>POST</C> עם JSON לכתובת <C>WEBHOOK_URL</C> על כל אחד מהאירועים הבאים. שינויים ב-Salesforce מזוהים אחרי כל סנכרון (בערך
              כל 10 דקות), ונשלחים תוך דקה. אירוע אינו כולל שם מועמד או פרטי קשר, רק מזהים (<C>candidate_id</C> הוא מזהה איש הקשר ב-Salesforce),
              סטטוסים ופרטי משרה.
            </p>
            <Table head={["אירוע", "מתי"]}>
              {WEBHOOK_EVENTS.map((e) => (
                <tr key={e.type}>
                  <td className={td}><C>{e.type}</C></td>
                  <td className={td}>{e.label}</td>
                </tr>
              ))}
            </Table>
            <Code>{WEBHOOK_EXAMPLE}</Code>

            <H3>אימות החתימה</H3>
            <p>
              כותרת <C>X-Skeelz-Signature</C> מכילה <C>t</C> (שניות מאז 1970) ו-<C>v1</C>: HMAC-SHA256 בהקסדצימלי, עם <C>WEBHOOK_TOKEN</C> כמפתח, על
              המחרוזת <C>t.גוף הבקשה</C>. הצד המקבל צריך לחשב את החתימה על הגוף הגולמי ולהשוות בזמן קבוע, לדחות חתימה ישנה מ-
              {WEBHOOK_LIMITS.signatureToleranceSec / 60} דקות, ולהתעלם מאירוע שכבר עובד (לפי <C>X-Skeelz-Delivery</C>, שהוא גם <C>id</C>).
            </p>
            <Code>{VERIFY_EXAMPLE}</Code>

            <H3>משלוח וניסיונות חוזרים</H3>
            <ul className="list-disc space-y-1 ps-6">
              <li>תשובה 2xx תוך {WEBHOOK_LIMITS.timeoutSec} שניות נחשבת הצלחה. כל תשובה אחרת, כולל הפניה (3xx), נחשבת כישלון.</li>
              <li>אחרי כישלון יש ניסיונות חוזרים בהפרשים של {retries}. אחרי הניסיון האחרון האירוע מסומן כנכשל ונרשם ביומן הפעילות.</li>
              <li>הסדר בין אירועים אינו מובטח, ואותו אירוע עשוי להגיע יותר מפעם אחת.</li>
              <li>
                בהפעלה הראשונה המערכת רק רושמת את המצב הקיים, בלי לשלוח אירועים. גם שינוי של יותר מ-{WEBHOOK_LIMITS.floodThreshold} רשומות בבת אחת
                (למשל בנייה מחדש של המראה) נרשם בלי משלוח.
              </li>
              <li>
                תקלת סנכרון נשלחת פעם אחת לכל מקור, ושוב רק אחרי {WEBHOOK_LIMITS.failureRepeatHours} שעות. הסיכום היומי נשלח אחרי השעה{" "}
                {WEBHOOK_LIMITS.summaryHourIsrael}:00.
              </li>
            </ul>
          </div>
        </Card>

        <Card title="מגבלות ואבטחה">
          <ul className="list-disc space-y-1 ps-6">
            <li>התקשורת ב-HTTPS בלבד, והטוקנים נשמרים רק כמשתני סביבה סודיים בשרת. ההשוואה שלהם נעשית בזמן קבוע.</li>
            <li>
              עד {API_LIMITS.perIpPerMinute} בקשות בדקה מכל כתובת IP, ועד {fmt(API_LIMITS.perTokenPerHour)} בקשות בשעה לטוקן. ל-<C>/metrics</C>, שהוא
              חישוב כבד, יש תקרה משותפת של {API_LIMITS.metricsPerMinute} בקשות בדקה.
            </li>
            <li>
              אחרי {API_LIMITS.authFailures} ניסיונות עם טוקן שגוי תוך {API_LIMITS.authFailureWindowMin} דקות, הכתובת נחסמת ל-
              {API_LIMITS.lockoutMin} דקות.
            </li>
            <li>
              כל תשובה כוללת <C>X-RateLimit-Limit</C>, <C>X-RateLimit-Remaining</C> ו-<C>X-RateLimit-Reset</C>. בחריגה חוזרת תשובה 429 עם{" "}
              <C>Retry-After</C>.
            </li>
            <li>ה-API לקריאה בלבד: אין בו שום פעולה שמשנה נתונים, והוא לא נגיש מדפדפן באתר אחר (אין CORS).</li>
            <li>ניסיונות כושלים, חסימות, שימוש ב-API ו-webhooks שנכשלו נרשמים ביומן הפעילות.</li>
            <li>ה-webhook נשלח רק לכתובת https ציבורית: כתובת פרטית או פנימית נדחית, והפניות לא נעקבות.</li>
            <li>המגבלות נספרות בזיכרון השרת, ולכן מתאפסות בכל פריסה או הפעלה מחדש.</li>
          </ul>
        </Card>

        <Card title="קודי שגיאה">
          <p className="mb-4">
            שגיאה חוזרת כ-<C>{'{ "error": { "code": "…", "message": "…" } }'}</C>.
          </p>
          <Table head={["סטטוס", "קוד", "משמעות"]}>
            {[
              ["400", "invalid_parameter · invalid_id · range_too_long · token_in_url", "פרמטר לא תקין, או טוקן שנשלח בכתובת"],
              ["401", "unauthorized", "חסר טוקן, או שהטוקן שגוי"],
              ["404", "not_found", "המשרה לא נמצאה"],
              ["405", "—", "שיטה שאינה GET"],
              ["429", "rate_limited · locked_out", "חריגה מהמגבלות, או חסימה אחרי ניסיונות כושלים"],
              ["500", "internal_error", "תקלה בשרת"],
              ["503", "api_disabled", "ה-API כבוי: API_TOKEN לא הוגדר"],
            ].map(([status, code, meaning]) => (
              <tr key={status}>
                <td className={`${td} tabular-nums`}>{status}</td>
                <td className={td}>
                  <C>{code}</C>
                </td>
                <td className={td}>{meaning}</td>
              </tr>
            ))}
          </Table>
        </Card>
      </div>
    </>
  );
}

function fmt(n: number): string {
  return new Intl.NumberFormat("he-IL").format(n);
}

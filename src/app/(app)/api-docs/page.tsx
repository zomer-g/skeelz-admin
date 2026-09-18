import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import { ContactLink } from "@/components/PublicDoc";
import { Badge, Card, PageHeader, Table } from "@/components/ui";
import { webhookConfigured } from "@/lib/api/outbound";
import { legacyKeys } from "@/lib/api/keys";
import {
  API_ERRORS,
  API_LIMITS,
  API_SCOPES,
  APP,
  ENDPOINTS,
  KEY_PREFIX,
  LEGACY_KEYS,
  MIN_TOKEN_LENGTH,
  WEBHOOK_EVENTS,
  WEBHOOK_LIMITS,
  type EndpointAuth,
} from "@/lib/api/spec";
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

const curl = (path: string) => [`curl -H "Authorization: Bearer <KEY>" \\`, `  "https://<כתובת המערכת>${path}"`];

const PING_EXAMPLE = [
  ...curl("/api/v1/ping"),
  "",
  "{",
  `  "app": "${APP}",`,
  '  "version": "110313e",',
  '  "time": "2026-09-18T09:30:00.000Z",',
  '  "key": { "name": "site → admin", "scopes": ["site-feed:read"] }',
  "}",
].join("\n");

const SITE_FEED_EXAMPLE = [
  ...curl("/api/v1/site/jobs"),
  "",
  "{",
  '  "data": [',
  '    { "id": "0123456789abcdef01234567", "case_id": "500000000000001AAA", "title": "…", "company": "…",',
  '      "city": "תל אביב", "job_scope": ["משרה מלאה"], "skill_ids": ["12"], "hot": false, "sponsored": true, … }',
  "  ],",
  '  "total": 85, "generated_at": "2026-09-18T09:30:00.000Z"',
  "}",
].join("\n");

const JOBS_EXAMPLE = [
  ...curl("/api/v1/jobs?status=active&scope=paid&limit=2"),
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
  ...curl("/api/v1/jobs/0123456789abcdef01234567"),
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
  ...curl("/api/v1/metrics?from=2026-08-01&to=2026-08-31&scope=paid&basis=application"),
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

const OPENAPI_EXAMPLE = [
  'curl "https://<כתובת המערכת>/api/v1/openapi.json"',
  "",
  `{ "openapi": "3.1.0", "info": { "title": "SKEELZ Connect — ${APP}", … }, "paths": { … } }`,
].join("\n");

const EXAMPLES: Record<string, string> = {
  "/api/v1/ping": PING_EXAMPLE,
  "/api/v1/openapi.json": OPENAPI_EXAMPLE,
  "/api/v1/jobs": JOBS_EXAMPLE,
  "/api/v1/jobs/{id}": JOB_EXAMPLE,
  "/api/v1/site/jobs": SITE_FEED_EXAMPLE,
  "/api/v1/metrics": METRICS_EXAMPLE,
};

function AuthLabel({ auth }: { auth: EndpointAuth }) {
  if (auth === "public") return <>בלי מפתח</>;
  if (auth === "any") return <>כל מפתח תקף</>;
  return <C>{auth}</C>;
}

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

  const legacyOn = legacyKeys().length;
  const outboundOn = webhookConfigured();
  const retries = WEBHOOK_LIMITS.retryDelaysMin.map((m) => (m < 60 ? `${m} דק׳` : `${m / 60} שע׳`)).join(", ");

  return (
    <>
      <PageHeader title="תיעוד API" subtitle="SKEELZ Connect: API נכנס לקריאת משרות ומדדים במפתחות עם הרשאות, ו-webhooks יוצאים על אירועים." />

      <div className="flex flex-col gap-6">
        <Card title="מפתחות והרשאות">
          <div className="flex flex-col gap-4">
            <ul className="flex flex-wrap gap-x-8 gap-y-2">
              <li className="flex items-center gap-2">
                טוקנים ותיקים מ-env: <span className="font-medium tabular-nums">{legacyOn}</span>
              </li>
              <li className="flex items-center gap-2">
                Webhooks יוצאים: {outboundOn ? <Badge tone="success">פעיל</Badge> : <Badge>כבוי</Badge>}
              </li>
            </ul>
            <p>
              כל קריאה ל-API הנכנס צריכה מפתח. אדמין מנפיק מפתחות ב
              <Link href="/admin/api" className="font-medium text-accent-dark underline underline-offset-4">
                ניהול · API ומפתחות
              </Link>
              . מפתח נראה כך: <C>{`${KEY_PREFIX}<43 תווים>`}</C>. הוא מוצג פעם אחת ביצירה, ונשמר אצלנו רק כ-hash. לכל מפתח יש הרשאות (scopes), וכל נתיב
              דורש הרשאה אחת. מפתח שבוטל או שפג תוקפו נדחה מיד.
            </p>
            <Table head={["הרשאה", "מה היא פותחת", "נתיבים"]} caption="הרשאות">
              {API_SCOPES.map((sc) => (
                <tr key={sc.scope}>
                  <td className={td}>
                    <C>{sc.scope}</C>
                  </td>
                  <td className={td}>{sc.label}</td>
                  <td className={td}>
                    <ul className="flex flex-col gap-1">
                      {ENDPOINTS.filter((e) => e.auth === sc.scope).map((e) => (
                        <li key={e.path}>
                          <C>{`${e.method} ${e.path}`}</C>
                        </li>
                      ))}
                    </ul>
                  </td>
                </tr>
              ))}
            </Table>
            <p>
              טוקנים משותפים שהוגדרו לפני המפתחות כמשתני סביבה סודיים ב-xhostd (<C>set_env(secret=true)</C>, לפחות {MIN_TOKEN_LENGTH} תווים) ממשיכים
              לעבוד כמפתחות עם הרשאות קבועות. אותו מסך מציג אותם, אבל מבטלים אותם רק במחיקת המשתנה.
            </p>
            <Table head={["משתנה", "הרשאות", "תפקיד"]} caption="משתני סביבה">
              {LEGACY_KEYS.map((k) => (
                <tr key={k.env}>
                  <td className={td}>
                    <C>{k.env}</C>
                  </td>
                  <td className={td}>
                    <C>{k.scopes.join(" ")}</C>
                  </td>
                  <td className={td}>{k.note}</td>
                </tr>
              ))}
              <tr>
                <td className={td}>
                  <C>WEBHOOK_URL</C>
                </td>
                <td className={td}>—</td>
                <td className={td}>הכתובת שאליה נשלחים האירועים. חייבת להיות https ולכתובת ציבורית, בלי שם משתמש וסיסמה בתוכה.</td>
              </tr>
              <tr>
                <td className={td}>
                  <C>WEBHOOK_TOKEN</C>
                </td>
                <td className={td}>—</td>
                <td className={td}>הטוקן המשותף שחותם על כל אירוע. הוא אף פעם לא נשלח בעצמו.</td>
              </tr>
            </Table>
            <p className="text-sm text-muted">
              ה-webhooks נשלחים מתהליך הסנכרון (<C>SYNC_WORKER=true</C>). הפניות מהמערכת הזו אל ה-CRM ואל האתר מוגדרות ב
              <Link href="/admin/connections" className="font-medium text-accent-dark underline underline-offset-4">
                ניהול · חיבורים
              </Link>
              . שאלות על ה-API: <ContactLink />.
            </p>
          </div>
        </Card>

        <Card title="API נכנס">
          <div className="flex flex-col gap-4">
            <p>
              כל הבקשות הן <C>GET</C> לכתובת <C>https://&lt;כתובת המערכת&gt;/api/v1</C>, והמפתח נשלח בכותרת <C>Authorization: Bearer &lt;KEY&gt;</C>.
              מפתח בכתובת (למשל <C>?token=</C>) נדחה, כי כתובות נשמרות בלוגים. התשובות ב-JSON. ה-API מחזיר משרות, סטטוסים, מזהים ונתונים מצטברים
              בלבד: שמות מועמדים, פרטי קשר וקבצים לא יוצאים דרכו. תיאור מכונה של כל הנתיבים ב-<C>/api/v1/openapi.json</C> (OpenAPI 3.1, בלי מפתח).
            </p>
            <Table head={["נתיב", "הרשאה", "מה"]} caption="נתיבים">
              {ENDPOINTS.map((e) => (
                <tr key={e.path}>
                  <td className={td}>
                    <C>{`${e.method} ${e.path}`}</C>
                  </td>
                  <td className={td}>
                    <AuthLabel auth={e.auth} />
                  </td>
                  <td className={td}>{e.summary}</td>
                </tr>
              ))}
            </Table>

            {ENDPOINTS.map((e) => (
              <section key={e.path} className="flex flex-col gap-3">
                <H3>
                  <span dir="ltr">{`${e.method} ${e.path}`}</span>
                </H3>
                <p>
                  {e.description} הרשאה: <AuthLabel auth={e.auth} />.
                </p>
                {e.params.length ? (
                  <Table head={["פרמטר", "ערכים", "ברירת מחדל"]} caption={`פרמטרים של ${e.path}`}>
                    {e.params.map((prm) => (
                      <tr key={prm.name}>
                        <td className={td}>
                          <C>{prm.name}</C>
                        </td>
                        <td className={td}>{prm.description}</td>
                        <td className={td}>{prm.defaultLabel ? <C>{prm.defaultLabel}</C> : "—"}</td>
                      </tr>
                    ))}
                  </Table>
                ) : null}
                {EXAMPLES[e.path] ? <Code>{EXAMPLES[e.path]!}</Code> : null}
              </section>
            ))}
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
            <li>התקשורת ב-HTTPS בלבד. מפתחות נשמרים רק כ-hash (SHA-256), וטוקנים ותיקים רק כמשתני סביבה סודיים בשרת. ההשוואה נעשית בזמן קבוע.</li>
            <li>
              עד {API_LIMITS.perIpPerMinute} בקשות בדקה מכל כתובת IP, ועד {fmt(API_LIMITS.perTokenPerHour)} בקשות בשעה לכל מפתח. ל-<C>/metrics</C>, שהוא
              חישוב כבד, יש תקרה משותפת של {API_LIMITS.metricsPerMinute} בקשות בדקה.
            </li>
            <li>
              אחרי {API_LIMITS.authFailures} ניסיונות עם מפתח שגוי תוך {API_LIMITS.authFailureWindowMin} דקות, הכתובת נחסמת ל-
              {API_LIMITS.lockoutMin} דקות. חסימה כזו לא חלה על בקשה עם מפתח תקף.
            </li>
            <li>
              כל תשובה כוללת <C>X-RateLimit-Limit</C>, <C>X-RateLimit-Remaining</C> ו-<C>X-RateLimit-Reset</C>. בחריגה חוזרת תשובה 429 עם{" "}
              <C>Retry-After</C>.
            </li>
            <li>ה-API לקריאה בלבד: אין בו שום פעולה שמשנה נתונים, והוא לא נגיש מדפדפן באתר אחר (אין CORS).</li>
            <li>יצירה וביטול של מפתחות, ניסיונות כושלים, חסימות, השימוש הראשון בכל שעה של כל מפתח ו-webhooks שנכשלו נרשמים ביומן הפעילות.</li>
            <li>ה-webhook נשלח רק לכתובת https ציבורית: כתובת פרטית או פנימית נדחית, והפניות לא נעקבות.</li>
            <li>המגבלות נספרות בזיכרון השרת, ולכן מתאפסות בכל פריסה או הפעלה מחדש.</li>
          </ul>
        </Card>

        <Card title="קודי שגיאה">
          <p className="mb-4">
            שגיאה חוזרת כ-<C>{'{ "error": { "code": "…", "message": "…" } }'}</C>.
          </p>
          <Table head={["סטטוס", "קוד", "משמעות"]} caption="קודי שגיאה">
            {API_ERRORS.map((e) => (
              <tr key={e.status}>
                <td className={`${td} tabular-nums`}>{e.status}</td>
                <td className={td}>
                  <C>{e.codes.join(" · ")}</C>
                </td>
                <td className={td}>{e.meaning}</td>
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

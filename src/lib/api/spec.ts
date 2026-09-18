/**
 * The external API's contract in one place: the limits the code enforces and the
 * docs page (/api-docs) shows, and the webhook event types. Change a number here
 * and both follow.
 */

/** A shared token shorter than this is ignored, and that side of the API stays off. */
export const MIN_TOKEN_LENGTH = 32;

export const API_LIMITS = {
  perIpPerMinute: 60,
  perTokenPerHour: 1000,
  /** /metrics recomputes the whole funnel, so it gets a tighter shared budget. */
  metricsPerMinute: 10,
  authFailures: 10,
  authFailureWindowMin: 10,
  lockoutMin: 15,
  defaultPageSize: 50,
  maxPageSize: 100,
  maxPage: 1000,
  maxRangeDays: 366,
} as const;

export const WEBHOOK_LIMITS = {
  timeoutSec: 10,
  /** Waits before each retry, in minutes; after the last one the event is marked failed. */
  retryDelaysMin: [1, 5, 30, 120, 360, 720] as number[],
  /** Receivers should refuse a signature older than this. */
  signatureToleranceSec: 300,
  retentionDays: 30,
  summaryHourIsrael: 7,
  /** The same source's failure is reported again only after this many hours. */
  failureRepeatHours: 6,
  /** More changes than this in one sync pass (a mirror rebuild) are recorded silently, not sent. */
  floodThreshold: 1000,
  /** Deliveries attempted per worker minute. */
  batchPerMinute: 20,
} as const;

export const WEBHOOK_EVENTS = [
  { type: "application.created", label: "הגשה חדשה או השמה חדשה" },
  { type: "application.status_changed", label: "סטטוס של הגשה השתנה" },
  { type: "job.created", label: "משרה חדשה" },
  { type: "job.status_changed", label: "משרה עלתה לאתר או ירדה ממנו (PStatus__c)" },
  { type: "sync.failed", label: "סנכרון מ-Salesforce, Google או SMOOV נכשל" },
  { type: "summary.daily", label: "סיכום של אתמול, כל בוקר" },
] as const;

export type WebhookEventType = (typeof WEBHOOK_EVENTS)[number]["type"];

/* ------------------------------------------------------------ SKEELZ Connect */

/*
 * The common contract of the three SKEELZ apps (docs/connect-api.md). This file is
 * the one source for this app's part of it: the scopes, the keys that live outside
 * the database, the endpoints, the docs page (/api-docs) and /api/v1/openapi.json.
 */

/** This app's name in the contract: in key prefixes (`sk_admin_…`) and in the ping. */
export const APP = "admin" as const;
export const PEERS = ["crm", "site"] as const;
export type Peer = (typeof PEERS)[number];

export const PEER_LABELS: Record<Peer, string> = { crm: "CRM (skeelz-crm)", site: "האתר (skeelz-site)" };

export const API_SCOPES = [
  { scope: "jobs:read", label: "משרות: רשימה ומשרה אחת, עם ספירת הגשות וחשיפה באתר" },
  { scope: "metrics:read", label: "מדדים מצטברים: המשפך של לשונית המועמדים ותנועה באתר" },
  { scope: "site-feed:read", label: "הפיד של האתר החדש: המשרות הפעילות עם תוכן דף המשרה" },
] as const;

export type ApiScope = (typeof API_SCOPES)[number]["scope"];

export const isApiScope = (v: unknown): v is ApiScope => API_SCOPES.some((s) => s.scope === v);

/**
 * Shared tokens set in the server's env before keys were issued in the UI. They keep
 * working as keys with these scopes; the UI lists them but cannot revoke them.
 * API_TOKEN deliberately does not open the site feed.
 */
export const LEGACY_KEYS: { env: string; scopes: ApiScope[]; note: string }[] = [
  { env: "API_TOKEN", scopes: ["jobs:read", "metrics:read"], note: "הטוקן המשותף הוותיק של ה-API הנכנס." },
  { env: "API_TOKEN_PREVIOUS", scopes: ["jobs:read", "metrics:read"], note: "בזמן החלפה של API_TOKEN: הטוקן הקודם ממשיך לעבוד עד שמוחקים את המשתנה." },
  { env: "SITE_FEED_TOKEN", scopes: ["site-feed:read"], note: "הטוקן של האתר החדש לפיד המשרות." },
];

/** `sk_admin_` + 43 characters: base64url of 32 random bytes. */
export const KEY_PREFIX = `sk_${APP}_`;
export const KEY_RANDOM_BYTES = 32;
/** Characters after KEY_PREFIX kept and shown in lists, so a key can be recognised without being usable. */
export const KEY_SHOWN_CHARS = 8;
export const KEY_EXPIRY_DAYS = [30, 90, 365] as const;

export const CONNECT_LIMITS = {
  /** Outbound calls to a peer app give up after this. */
  peerTimeoutMs: 5000,
  /** last_used_at is written at most this often per key. */
  lastUsedEveryMin: 1,
  /** The unauthenticated openapi.json, per address. */
  openapiPerIpPerMinute: 30,
} as const;

/** Who may call an endpoint: anyone, any valid key, or a key holding that scope. */
export type EndpointAuth = "public" | "any" | ApiScope;

type Schema = Record<string, unknown>;

export interface ParamSpec {
  name: string;
  in: "query" | "path";
  schema: Schema;
  /** Hebrew, for the docs page and the OpenAPI description. */
  description: string;
  defaultLabel?: string;
}

export interface EndpointSpec {
  method: "GET";
  /** OpenAPI style: `{id}` for a path parameter. */
  path: string;
  auth: EndpointAuth;
  summary: string;
  description: string;
  params: ParamSpec[];
  /** Counted against the tighter shared budget (API_LIMITS.metricsPerMinute). */
  heavy?: boolean;
  response: Schema;
}

const str = { type: "string" };
const strOrNull = { type: ["string", "null"] };
const int = { type: "integer" };
const bool = { type: "boolean" };
const obj = (properties: Record<string, Schema>, extra: Schema = {}): Schema => ({ type: "object", properties, ...extra });
const ref = (name: string): Schema => ({ $ref: `#/components/schemas/${name}` });

const SCHEMAS: Record<string, Schema> = {
  Error: obj(
    { error: obj({ code: { type: "string", description: "snake_case" }, message: str }, { required: ["code", "message"] }) },
    { required: ["error"] },
  ),
  Job: obj({
    id: { type: "string", description: "Salesforce Case id" },
    case_number: strOrNull,
    title: strOrNull,
    company: strOrNull,
    site_job_key: { type: ["string", "null"], description: "The 24-hex id in the public job URL" },
    url: strOrNull,
    paid: bool,
    active: bool,
    manage_status: strOrNull,
    created_at: { type: ["string", "null"], format: "date-time" },
    updated_at: { type: ["string", "null"], format: "date-time" },
  }),
  SiteFeedJob: obj({
    id: { type: "string", description: "The site job key" },
    case_id: str,
    case_number: strOrNull,
    title: strOrNull,
    company: strOrNull,
    description_html: strOrNull,
    city: strOrNull,
    city_symbol: { type: ["integer", "null"] },
    job_scope: { type: "array", items: str },
    skill_ids: { type: "array", items: str },
    hot: bool,
    sponsored: bool,
    self_apply: bool,
    published_at: strOrNull,
    updated_at: strOrNull,
  }),
};

const scopeParam: ParamSpec = {
  name: "scope",
  in: "query",
  schema: { type: "string", enum: ["paid", "all"], default: "paid" },
  description: "paid (בתשלום בלבד) או all",
  defaultLabel: "paid",
};

export const ENDPOINTS: EndpointSpec[] = [
  {
    method: "GET",
    path: "/api/v1/ping",
    auth: "any",
    summary: "בדיקת חיבור",
    description: "כל מפתח תקף. מחזיר את שם המערכת, הגרסה, השעה, ושם המפתח וההרשאות שלו. כך מערכת אחרת בודקת שהמפתח שקיבלה עובד.",
    params: [],
    response: obj(
      {
        app: { type: "string", enum: ["admin", "crm", "site"] },
        version: str,
        time: { type: "string", format: "date-time" },
        key: obj({ name: str, scopes: { type: "array", items: str } }),
      },
      { required: ["app", "version", "time", "key"] },
    ),
  },
  {
    method: "GET",
    path: "/api/v1/openapi.json",
    auth: "public",
    summary: "מסמך OpenAPI 3.1",
    description: "תיאור מכונה של ה-API הזה, בלי אימות (אין בו נתונים). נוצר מאותו מקור כמו דף התיעוד.",
    params: [],
    response: { type: "object" },
  },
  {
    method: "GET",
    path: "/api/v1/jobs",
    auth: "jobs:read",
    summary: "רשימת משרות",
    description: "משרות, מהחדשה לישנה.",
    params: [
      {
        name: "status",
        in: "query",
        schema: { type: "string", enum: ["active", "all"], default: "active" },
        description: "active (באוויר באתר) או all",
        defaultLabel: "active",
      },
      scopeParam,
      { name: "updated_since", in: "query", schema: { type: "string", format: "date-time" }, description: "תאריך ושעה ב-ISO 8601: רק משרות שהשתנו מאז" },
      {
        name: "limit",
        in: "query",
        schema: { type: "integer", minimum: 1, maximum: API_LIMITS.maxPageSize, default: API_LIMITS.defaultPageSize },
        description: `1–${API_LIMITS.maxPageSize}`,
        defaultLabel: String(API_LIMITS.defaultPageSize),
      },
      {
        name: "page",
        in: "query",
        schema: { type: "integer", minimum: 1, maximum: API_LIMITS.maxPage, default: 1 },
        description: `1–${API_LIMITS.maxPage}`,
        defaultLabel: "1",
      },
    ],
    response: obj({ data: { type: "array", items: ref("Job") }, page: int, limit: int, total: int, has_more: bool }),
  },
  {
    method: "GET",
    path: "/api/v1/jobs/{id}",
    auth: "jobs:read",
    summary: "משרה אחת",
    description:
      "משרה אחת לפי מזהה Salesforce או לפי המזהה בכתובת המשרה באתר (24 תווים), עם ספירת ההגשות לפי סטטוס והחשיפה באתר ב-30 הימים האחרונים.",
    params: [{ name: "id", in: "path", schema: str, description: "מזהה Salesforce או מזהה המשרה באתר (24 תווים הקסדצימליים)" }],
    response: obj({
      data: {
        allOf: [
          ref("Job"),
          obj({
            applications: obj({ total: int, paid: int, by_status: { type: "object", additionalProperties: int } }),
            site_last_30_days: obj({ from: str, to: str, job_opens: int, apply_clicks: int, apply_confirmations: int, page_views: int }),
          }),
        ],
      },
    }),
  },
  {
    method: "GET",
    path: "/api/v1/site/jobs",
    auth: "site-feed:read",
    summary: "הפיד של האתר החדש",
    description:
      "כל המשרות הפעילות באתר, עם מה שדף משרה ציבורי מציג (כותרת, חברה, תיאור, עיר, היקף, כישורים, משרה חמה ובתשלום). בלי פרטי קשר של מעסיקים ובלי הגשות. התשובה נשמרת במטמון לשתי דקות.",
    params: [],
    response: obj({ data: { type: "array", items: ref("SiteFeedJob") }, total: int, generated_at: { type: "string", format: "date-time" } }),
  },
  {
    method: "GET",
    path: "/api/v1/metrics",
    auth: "metrics:read",
    heavy: true,
    summary: "מדדים מצטברים",
    description: "המדדים של לשונית המועמדים בדשבורד, וסיכום התנועה באתר, לטווח ימים (שעון ישראל).",
    params: [
      {
        name: "from",
        in: "query",
        schema: { type: "string", format: "date" },
        description: `YYYY-MM-DD, כולל. הטווח עד ${API_LIMITS.maxRangeDays} ימים`,
        defaultLabel: "29 ימים לפני to",
      },
      { name: "to", in: "query", schema: { type: "string", format: "date" }, description: "YYYY-MM-DD, כולל", defaultLabel: "היום" },
      scopeParam,
      {
        name: "basis",
        in: "query",
        schema: { type: "string", enum: ["application", "event"], default: "application" },
        description: "application (ההגשות שנוצרו בטווח ומה קרה איתן) או event (כל מה שקרה בטווח)",
        defaultLabel: "application",
      },
    ],
    response: obj({
      range: { type: "object" },
      jobs: obj({ new: int, active: int }),
      applications: { type: "object", additionalProperties: int },
      timing: { type: "object" },
      reject_reasons: { type: "array", items: obj({ reason: str, count: int }) },
      site: { type: "object" },
      data_freshness: obj({ salesforce_synced_at: { type: ["string", "null"], format: "date-time" } }),
    }),
  },
];

export const endpointFor = (path: string): EndpointSpec => {
  const e = ENDPOINTS.find((x) => x.path === path);
  if (!e) throw new Error(`No endpoint ${path} in spec.ts`);
  return e;
};

/** Every error the API returns, as `{ "error": { "code", "message" } }`. */
export const API_ERRORS: { status: number; codes: string[]; meaning: string }[] = [
  { status: 400, codes: ["token_in_url", "invalid_parameter", "invalid_id", "range_too_long"], meaning: "מפתח שנשלח בכתובת, או פרמטר לא תקין" },
  { status: 401, codes: ["unauthorized"], meaning: "חסר מפתח, או שהוא שגוי, בוטל או פג תוקפו" },
  { status: 403, codes: ["insufficient_scope"], meaning: "המפתח תקף, אבל אין לו את ההרשאה שהנתיב דורש" },
  { status: 404, codes: ["not_found"], meaning: "הרשומה לא נמצאה" },
  { status: 405, codes: ["—"], meaning: "שיטה שאינה GET" },
  { status: 429, codes: ["rate_limited", "locked_out"], meaning: "חריגה מהמגבלות, או חסימה אחרי ניסיונות כושלים. עם Retry-After" },
  { status: 500, codes: ["internal_error"], meaning: "תקלה בשרת" },
];

const ERROR_STATUS_TEXT: Record<number, string> = {
  400: "Invalid parameter, or a key in the URL (token_in_url)",
  401: "Missing, wrong, revoked or expired key (unauthorized)",
  403: "The key lacks the required scope (insufficient_scope)",
  404: "Not found (not_found)",
  429: "Rate limited or locked out; see Retry-After",
  500: "Server error (internal_error)",
};

/** The OpenAPI 3.1 document served at /api/v1/openapi.json. */
export function openApiDocument(version: string): Record<string, unknown> {
  const paths: Record<string, Record<string, unknown>> = {};
  for (const e of ENDPOINTS) {
    const keyed = e.auth !== "public";
    const errors = [
      ...(keyed || e.params.length ? [400] : []),
      ...(keyed ? [401] : []),
      ...(keyed && e.auth !== "any" ? [403] : []),
      ...(e.path.includes("{") ? [404] : []),
      429,
      500,
    ];
    const responses: Record<string, unknown> = { 200: { description: "OK", content: { "application/json": { schema: e.response } } } };
    for (const status of errors) responses[status] = { description: ERROR_STATUS_TEXT[status], content: { "application/json": { schema: ref("Error") } } };
    paths[e.path] = {
      ...paths[e.path],
      [e.method.toLowerCase()]: {
        summary: e.summary,
        description: e.description,
        // Scopes of an http bearer scheme aren't standard OpenAPI; the required one is named here.
        ...(keyed ? { security: [{ bearer: [] }], "x-required-scope": e.auth === "any" ? null : e.auth } : { security: [] }),
        parameters: e.params.map((p) => ({ name: p.name, in: p.in, required: p.in === "path", description: p.description, schema: p.schema })),
        responses,
      },
    };
  }
  return {
    openapi: "3.1.0",
    info: {
      title: `SKEELZ Connect — ${APP}`,
      version,
      description:
        "The admin app's part of SKEELZ Connect. Keys are issued at /admin/api and sent only as `Authorization: Bearer <key>`. " +
        "Jobs, statuses, ids and aggregates only: never candidate names, contact details or files.",
    },
    servers: [{ url: "/" }],
    "x-scopes": Object.fromEntries(API_SCOPES.map((s) => [s.scope, s.label])),
    components: {
      securitySchemes: { bearer: { type: "http", scheme: "bearer", description: `A key ${KEY_PREFIX}… issued at /admin/api` } },
      schemas: SCHEMAS,
    },
    paths,
  };
}

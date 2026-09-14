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

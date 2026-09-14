import { randomUUID } from "node:crypto";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { and, asc, eq, gte, isNotNull, isNull, lt, lte, or, sql } from "drizzle-orm";
import { writeAudit } from "@/lib/audit";
import { addDays, israelDay } from "@/lib/dashboard/params";
import { getDb, type Db } from "@/lib/db/client";
import { webhookCaseState, webhookDeliveries } from "@/lib/db/schema";
import { asDate } from "@/lib/entities/search";
import { normStatus, RECORD_TYPES } from "@/lib/metrics/candidates";
import { loadPositionsByIds } from "@/lib/metrics/jobs";
import { applicationPaidSql } from "@/lib/metrics/paid";
import { dailySummary, jobJson } from "./data";
import { WEBHOOK_LIMITS, type WebhookEventType } from "./spec";
import { sharedToken, signPayload } from "./tokens";

/**
 * Outgoing webhooks. After each Salesforce pass the sync worker compares the mirror
 * with the last state it reported, queues one event per change in `webhook_deliveries`,
 * and posts the queue to WEBHOOK_URL signed with WEBHOOK_TOKEN, retrying with backoff.
 * While the webhook is not configured nothing is tracked or queued.
 *
 * Events carry Salesforce ids, statuses and job fields — never a candidate's name or contact details.
 */

const MIN = 60_000;
const HOUR = 60 * MIN;
const ACTOR = "webhook";

type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
type Event = { type: WebhookEventType; data: Record<string, unknown> };

export type WebhookPayload = {
  id: string;
  type: WebhookEventType;
  created_at: string;
  data: Record<string, unknown>;
};

/** The target and signing token, or null when either is missing or unsafe (not https, credentials in the URL). */
export function webhookConfig(): { url: URL; token: string } | null {
  const raw = process.env.WEBHOOK_URL?.trim();
  const token = sharedToken("WEBHOOK_TOKEN");
  if (!raw || !token) return null;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  const localDev = process.env.NODE_ENV === "development" && url.protocol === "http:" && ["localhost", "127.0.0.1"].includes(url.hostname);
  if ((url.protocol !== "https:" && !localDev) || url.username || url.password) return null;
  return { url, token };
}

export const webhookConfigured = () => webhookConfig() !== null;

async function enqueue(tx: Tx, events: Event[]): Promise<void> {
  const now = new Date();
  const rows = events.map(({ type, data }) => {
    const id = randomUUID();
    const payload: WebhookPayload = { id, type, created_at: now.toISOString(), data };
    return { id, type, payload, createdAt: now, nextAttemptAt: now };
  });
  for (let i = 0; i < rows.length; i += 500) await tx.insert(webhookDeliveries).values(rows.slice(i, i + 500));
}

const text = (v: unknown) => (typeof v === "string" ? v : null);
const present = (v: unknown) => (typeof v === "string" && v !== "" ? v : null);

/**
 * Queues job and application events for what changed since the last pass. The first
 * pass only records where everything stands, and a pass that changes more than the
 * flood threshold (a mirror rebuild) is recorded without sending — neither is news.
 */
export async function detectCaseChanges(): Promise<{ events: number; baseline: boolean; suppressed: boolean }> {
  if (!webhookConfigured()) return { events: 0, baseline: false, suppressed: false };
  const db = getDb();
  const rows = (
    await db.execute<Record<string, unknown>>(sql`
      SELECT c.id, rt.developer_name AS record_type, c.status, c.data->>'PStatus__c' AS site_status,
             c.parent_id, c.contact_id, c.created_date, ${applicationPaidSql("c", "j")} AS paid,
             s.case_id IS NULL AS is_new, s.status AS prev_status, s.site_status AS prev_site_status
        FROM sf_case c
        JOIN sf_record_type rt ON rt.id = c.record_type_id
        LEFT JOIN sf_case j ON j.id = c.parent_id
        LEFT JOIN webhook_case_state s ON s.case_id = c.id
       WHERE rt.developer_name IN (${RECORD_TYPES.position}, ${RECORD_TYPES.application}, ${RECORD_TYPES.accepted})
         AND NOT c.is_deleted
         AND (s.case_id IS NULL OR s.status IS DISTINCT FROM c.status OR s.site_status IS DISTINCT FROM (c.data->>'PStatus__c'))`)
  ).rows;
  if (!rows.length) return { events: 0, baseline: false, suppressed: false };

  const seeded = (await db.select({ id: webhookCaseState.caseId }).from(webhookCaseState).limit(1)).length > 0;
  const baseline = !seeded;
  const suppressed = seeded && rows.length > WEBHOOK_LIMITS.floodThreshold;
  const events: Event[] = [];

  if (!baseline && !suppressed) {
    const jobIds = [...new Set(rows.flatMap((r) => (r.record_type === RECORD_TYPES.position ? [String(r.id)] : r.parent_id ? [String(r.parent_id)] : [])))];
    const jobs = new Map((await loadPositionsByIds(jobIds)).map((p) => [p.id, jobJson(p)]));

    for (const r of rows) {
      const id = String(r.id);
      const isNew = r.is_new === true;
      if (r.record_type === RECORD_TYPES.position) {
        const job = jobs.get(id);
        if (!job) continue;
        const siteStatus = present(r.site_status);
        const previousSiteStatus = present(r.prev_site_status);
        if (isNew) events.push({ type: "job.created", data: { job: { ...job, site_status: siteStatus } } });
        else if (previousSiteStatus !== siteStatus) {
          events.push({ type: "job.status_changed", data: { job: { ...job, site_status: siteStatus }, previous_site_status: previousSiteStatus, site_status: siteStatus } });
        }
        continue;
      }
      const status = normStatus(present(r.status));
      const previous = normStatus(present(r.prev_status));
      const application = {
        id,
        kind: r.record_type === RECORD_TYPES.accepted ? "placement" : "application",
        status,
        paid: r.paid === true,
        created_at: asDate(r.created_date)?.toISOString() ?? null,
        candidate_id: present(r.contact_id),
        job: r.parent_id ? (jobs.get(String(r.parent_id)) ?? null) : null,
      };
      if (isNew) events.push({ type: "application.created", data: { application } });
      else if (previous !== status) events.push({ type: "application.status_changed", data: { application, previous_status: previous, status } });
    }
  }

  // The state and its events commit together: a crash between them can neither lose an event nor repeat one.
  await db.transaction(async (tx) => {
    const seenAt = new Date();
    for (let i = 0; i < rows.length; i += 500) {
      await tx
        .insert(webhookCaseState)
        .values(rows.slice(i, i + 500).map((r) => ({ caseId: String(r.id), status: text(r.status), siteStatus: text(r.site_status), seenAt })))
        .onConflictDoUpdate({ target: webhookCaseState.caseId, set: { status: sql`excluded.status`, siteStatus: sql`excluded.site_status`, seenAt } });
    }
    if (events.length) await enqueue(tx, events);
  });
  if (suppressed) await writeAudit(ACTOR, "webhook.flood_suppressed", null, { changes: rows.length });
  return { events: events.length, baseline, suppressed };
}

/** One `sync.failed` per failing source, repeated only after a quiet period. */
export async function enqueueSyncFailures(results: { source: string; error?: string }[]): Promise<void> {
  if (!webhookConfigured()) return;
  const db = getDb();
  for (const r of results) {
    if (!r.error) continue;
    const [recent] = await db
      .select({ id: webhookDeliveries.id })
      .from(webhookDeliveries)
      .where(
        and(
          eq(webhookDeliveries.type, "sync.failed"),
          sql`${webhookDeliveries.payload}->'data'->>'source' = ${r.source}`,
          gte(webhookDeliveries.createdAt, new Date(Date.now() - WEBHOOK_LIMITS.failureRepeatHours * HOUR)),
        ),
      )
      .limit(1);
    if (recent) continue;
    const data = { source: r.source, error: r.error.slice(0, 300), failed_at: new Date().toISOString() };
    await db.transaction((tx) => enqueue(tx, [{ type: "sync.failed", data }]));
  }
}

/** Yesterday's summary, once, from the configured hour of the Israel morning. */
export async function maybeDailySummary(now = new Date()): Promise<void> {
  if (!webhookConfigured()) return;
  const hour = Number(new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Jerusalem", hour: "numeric", hourCycle: "h23" }).format(now));
  if (hour < WEBHOOK_LIMITS.summaryHourIsrael) return;
  const day = addDays(israelDay(now), -1);
  const db = getDb();
  const [sent] = await db
    .select({ id: webhookDeliveries.id })
    .from(webhookDeliveries)
    .where(and(eq(webhookDeliveries.type, "summary.daily"), sql`${webhookDeliveries.payload}->'data'->>'day' = ${day}`))
    .limit(1);
  if (sent) return;
  const data = await dailySummary(day);
  await db.transaction((tx) => enqueue(tx, [{ type: "summary.daily", data }]));
}

/** Posts due events, oldest first, and clears settled ones past the retention period. */
export async function deliverPending(limit: number = WEBHOOK_LIMITS.batchPerMinute): Promise<void> {
  const config = webhookConfig();
  if (!config) return;
  const db = getDb();
  const due = await db
    .select()
    .from(webhookDeliveries)
    .where(and(isNull(webhookDeliveries.deliveredAt), isNull(webhookDeliveries.failedAt), lte(webhookDeliveries.nextAttemptAt, new Date())))
    .orderBy(asc(webhookDeliveries.createdAt))
    .limit(limit);
  for (const delivery of due) await deliverOne(config, delivery);

  await db
    .delete(webhookDeliveries)
    .where(
      and(
        lt(webhookDeliveries.createdAt, new Date(Date.now() - WEBHOOK_LIMITS.retentionDays * 24 * HOUR)),
        or(isNotNull(webhookDeliveries.deliveredAt), isNotNull(webhookDeliveries.failedAt)),
      ),
    );
}

async function deliverOne(config: { url: URL; token: string }, delivery: typeof webhookDeliveries.$inferSelect): Promise<void> {
  const body = JSON.stringify(delivery.payload);
  const timestamp = Math.floor(Date.now() / 1000);
  let status: number | null = null;
  let error: string | null = null;
  try {
    await assertPublicHost(config.url);
    const res = await fetch(config.url, {
      method: "POST",
      // A redirect could lead the signed event somewhere else; treat it as a failure.
      redirect: "manual",
      signal: AbortSignal.timeout(WEBHOOK_LIMITS.timeoutSec * 1000),
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "User-Agent": "SKEELZ-Admin-Webhook/1",
        "X-Skeelz-Event": delivery.type,
        "X-Skeelz-Delivery": delivery.id,
        "X-Skeelz-Signature": `t=${timestamp},v1=${signPayload(config.token, timestamp, body)}`,
      },
      body,
    });
    status = res.status;
    await res.body?.cancel();
    if (res.status < 200 || res.status >= 300) error = `HTTP ${res.status}`;
  } catch (err) {
    error = ((err as Error).message || "request failed").slice(0, 300);
  }

  const attempts = delivery.attempts + 1;
  const db = getDb();
  if (!error) {
    await db.update(webhookDeliveries).set({ attempts, deliveredAt: new Date(), lastStatus: status, lastError: null }).where(eq(webhookDeliveries.id, delivery.id));
    return;
  }
  const delayMin = WEBHOOK_LIMITS.retryDelaysMin[attempts - 1];
  if (delayMin === undefined) {
    await db.update(webhookDeliveries).set({ attempts, failedAt: new Date(), lastStatus: status, lastError: error }).where(eq(webhookDeliveries.id, delivery.id));
    await writeAudit(ACTOR, "webhook.failed", delivery.type, { id: delivery.id, attempts, error });
    return;
  }
  await db
    .update(webhookDeliveries)
    .set({ attempts, nextAttemptAt: new Date(Date.now() + delayMin * MIN), lastStatus: status, lastError: error })
    .where(eq(webhookDeliveries.id, delivery.id));
}

/** Refuses a target that resolves to a private, loopback or link-local address. */
async function assertPublicHost(url: URL): Promise<void> {
  if (process.env.NODE_ENV === "development") return;
  const host = url.hostname.replace(/^\[|\]$/g, "");
  const addresses = isIP(host) ? [host] : (await lookup(host, { all: true })).map((a) => a.address);
  if (!addresses.length || addresses.some(isPrivateAddress)) throw new Error("webhook host is not a public address");
}

function isPrivateAddress(ip: string): boolean {
  if (isIP(ip) === 4) {
    const [a = 0, b = 0] = ip.split(".").map(Number);
    return a === 0 || a === 10 || a === 127 || a >= 224 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
  }
  const v = ip.toLowerCase();
  if (v.startsWith("::ffff:")) return isPrivateAddress(v.slice(7));
  return v === "::" || v === "::1" || v.startsWith("fc") || v.startsWith("fd") || v.startsWith("fe80");
}

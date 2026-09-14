/**
 * Fixed-window counters in memory. The app runs as a single web process, so this
 * is the whole picture. They live on globalThis because Next may bundle each route
 * handler separately, and every route must count against the same limits.
 */

interface Bucket {
  count: number;
  resetAt: number;
}

const g = globalThis as typeof globalThis & { __skeelzRateBuckets?: Map<string, Bucket> };
const buckets = (g.__skeelzRateBuckets ??= new Map<string, Bucket>());
const MAX_KEYS = 50_000;

export interface Hit {
  ok: boolean;
  limit: number;
  remaining: number;
  resetAt: number;
}

/** Counts one request against `key` and says whether it is still within `limit` for the window. */
export function hit(key: string, limit: number, windowMs: number, now = Date.now()): Hit {
  let bucket = buckets.get(key);
  if (!bucket || bucket.resetAt <= now) {
    if (buckets.size >= MAX_KEYS) sweep(now);
    bucket = { count: 0, resetAt: now + windowMs };
    buckets.set(key, bucket);
  }
  bucket.count += 1;
  return { ok: bucket.count <= limit, limit, remaining: Math.max(0, limit - bucket.count), resetAt: bucket.resetAt };
}

/** Seconds until `key`'s window ends; 0 when it has none. */
export function secondsLeft(key: string, now = Date.now()): number {
  const bucket = buckets.get(key);
  return bucket && bucket.resetAt > now ? Math.ceil((bucket.resetAt - now) / 1000) : 0;
}

/** True only the first time per window — for log and audit writes that must not flood. */
export const firstInWindow = (key: string, windowMs: number): boolean => hit(`first:${key}`, 1, windowMs).ok;

function sweep(now: number) {
  for (const [key, bucket] of buckets) if (bucket.resetAt <= now) buckets.delete(key);
  if (buckets.size < MAX_KEYS) return;
  // Still full of live windows (someone cycling addresses): drop the oldest per-address counters,
  // never the shared token budget or a lockout.
  let drop = Math.ceil(MAX_KEYS / 10);
  for (const key of buckets.keys()) {
    if (drop <= 0) break;
    if (key.startsWith("ip:") || key.startsWith("first:")) {
      buckets.delete(key);
      drop -= 1;
    }
  }
}

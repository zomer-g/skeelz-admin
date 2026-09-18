import { writeAudit } from "@/lib/audit";
import { firstInWindow, hit, secondsLeft } from "./rate-limit";
import { API_LIMITS } from "./spec";
import { inboundTokens, matchesToken } from "./tokens";

/**
 * The gate every /api/v1 route goes through. These routes are for other systems,
 * not people: the shared API_TOKEN stands in for the xhostd sign-in, and
 * `withApiToken` stands in for `requireUser`.
 */

const ACTOR = "api:inbound";
const MIN = 60_000;

export function apiJson(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      ...headers,
    },
  });
}

export const apiError = (status: number, code: string, message: string, headers: Record<string, string> = {}) =>
  apiJson({ error: { code, message } }, status, headers);

/**
 * The address the proxy saw. xhostd's edge appends the real client to X-Forwarded-For,
 * so the last entry is the one a caller cannot forge; anything earlier is theirs to write.
 */
function clientIp(req: Request): string {
  const forwarded = req.headers.get("x-forwarded-for")?.split(",").map((s) => s.trim()).filter(Boolean);
  return forwarded?.at(-1) || req.headers.get("x-real-ip") || "unknown";
}

type Handler<C> = (req: Request, ctx: C) => Promise<Response>;

/**
 * In order: the API is switched on, the address is not locked out, the token arrives in
 * the Authorization header (never the URL) and matches, and the rate limits allow it.
 */
export function withApiToken<C>(
  route: string,
  handler: Handler<C>,
  {
    heavy = false,
    tokens: tokenSource = inboundTokens,
    bucket = "token",
  }: {
    heavy?: boolean;
    /** Which shared tokens open this route; a consumer with its own token gets its own. */
    tokens?: () => string[];
    /** The per-token hourly budget, kept apart per consumer. */
    bucket?: string;
  } = {},
): Handler<C> {
  return async (req, ctx) => {
    const tokens = tokenSource();
    if (!tokens.length) return apiError(503, "api_disabled", "The API is not enabled on this server.");

    const ip = clientIp(req);
    const lockKey = `lock:${ip}`;
    const locked = secondsLeft(lockKey);
    if (locked) return apiError(429, "locked_out", "Too many failed authentication attempts.", { "Retry-After": String(locked) });

    const params = new URL(req.url).searchParams;
    if (["token", "api_key", "access_token", "key"].some((k) => params.has(k))) {
      return apiError(400, "token_in_url", "Send the token in the Authorization header, never in the URL.");
    }

    const bearer = /^Bearer\s+(\S+)\s*$/i.exec(req.headers.get("authorization") ?? "");
    if (!bearer || !matchesToken(bearer[1]!, tokens)) {
      const failures = hit(`fail:${ip}`, API_LIMITS.authFailures, API_LIMITS.authFailureWindowMin * MIN);
      if (!failures.ok) hit(lockKey, 1, API_LIMITS.lockoutMin * MIN);
      if (firstInWindow(`denied:${ip}`, 10 * MIN)) {
        await writeAudit(ACTOR, "api.denied", route, { ip, reason: bearer ? "wrong_token" : "missing_token", lockedOut: !failures.ok });
      }
      return apiError(401, "unauthorized", "A valid token is required: Authorization: Bearer <token>.", { "WWW-Authenticate": 'Bearer realm="skeelz"' });
    }

    const limits = [
      hit(`ip:${ip}`, API_LIMITS.perIpPerMinute, MIN),
      hit(bucket, API_LIMITS.perTokenPerHour, 60 * MIN),
      ...(heavy ? [hit("heavy", API_LIMITS.metricsPerMinute, MIN)] : []),
    ];
    const tightest = limits.reduce((a, b) => (b.remaining < a.remaining ? b : a));
    const rateHeaders = {
      "X-RateLimit-Limit": String(tightest.limit),
      "X-RateLimit-Remaining": String(tightest.remaining),
      "X-RateLimit-Reset": String(Math.ceil(tightest.resetAt / 1000)),
    };
    const blocked = limits.find((l) => !l.ok);
    if (blocked) {
      if (firstInWindow(`limited:${ip}`, 10 * MIN)) await writeAudit(ACTOR, "api.rate_limited", route, { ip });
      const retry = Math.max(1, Math.ceil((blocked.resetAt - Date.now()) / 1000));
      return apiError(429, "rate_limited", "Rate limit exceeded.", { ...rateHeaders, "Retry-After": String(retry) });
    }

    // The log shows that the API is in use and from where, without a row per request.
    if (firstInWindow(`used:${route}:${ip}`, 60 * MIN)) void writeAudit(ACTOR, "api.used", route, { ip });

    try {
      const res = await handler(req, ctx);
      for (const [name, value] of Object.entries(rateHeaders)) res.headers.set(name, value);
      return res;
    } catch (err) {
      // Drizzle's message is the SQL; the database's own error is the cause.
      const cause = (err as Error).cause;
      console.error(`[api] ${route} failed:`, cause instanceof Error ? cause.message : (err as Error).message);
      return apiError(500, "internal_error", "Something went wrong.", rateHeaders);
    }
  };
}

/** A whole number within [min, max], the fallback when absent, or null when invalid. */
export function intParam(params: URLSearchParams, name: string, fallback: number, min: number, max: number): number | null {
  const raw = params.get(name);
  if (raw === null || raw === "") return fallback;
  if (!/^\d+$/.test(raw)) return null;
  const n = Number(raw);
  return n >= min && n <= max ? n : null;
}

/** One of `allowed`, the first allowed value when absent, or null when invalid. */
export function choiceParam<T extends string>(params: URLSearchParams, name: string, allowed: readonly T[]): T | null {
  const raw = params.get(name);
  if (raw === null || raw === "") return allowed[0]!;
  return (allowed as readonly string[]).includes(raw) ? (raw as T) : null;
}

/** A real calendar day, YYYY-MM-DD. */
export const isDay = (v: string) => /^\d{4}-\d{2}-\d{2}$/.test(v) && new Date(`${v}T00:00:00Z`).toISOString().startsWith(v);

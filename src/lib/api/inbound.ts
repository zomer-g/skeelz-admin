import { writeAudit } from "@/lib/audit";
import { touchKey, verifyKey, type ApiKeyIdentity } from "./keys";
import { firstInWindow, hit, secondsLeft } from "./rate-limit";
import { API_LIMITS, endpointFor, type EndpointAuth } from "./spec";

/**
 * The gate every keyed /api/v1 route goes through. These routes are for other systems,
 * not people: an API key (lib/api/keys.ts) stands in for the xhostd sign-in, and
 * `withApiKey` stands in for `requireUser`.
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
export function clientIp(req: Request): string {
  const forwarded = req.headers.get("x-forwarded-for")?.split(",").map((s) => s.trim()).filter(Boolean);
  return forwarded?.at(-1) || req.headers.get("x-real-ip") || "unknown";
}

type Handler<C> = (req: Request, ctx: C, key: ApiKeyIdentity) => Promise<Response>;

/**
 * In order: the address is not locked out, the key arrives in the Authorization header
 * (never the URL), it is a live key, it holds the route's scope, and the rate limits
 * (per address and per key) allow it.
 *
 * `path` is the endpoint as written in spec.ts, and `auth` must match what spec.ts says,
 * so the docs, openapi.json and the code cannot drift apart.
 */
export function withApiKey<C>(path: string, auth: Exclude<EndpointAuth, "public">, handler: Handler<C>): (req: Request, ctx: C) => Promise<Response> {
  const endpoint = endpointFor(path);
  if (endpoint.auth !== auth) throw new Error(`${path}: spec.ts says ${endpoint.auth}, the route says ${auth}`);
  const route = `${endpoint.method} ${path}`;

  return async (req, ctx) => {
    const ip = clientIp(req);
    const lockKey = `lock:${ip}`;
    const locked = secondsLeft(lockKey);
    if (locked) return apiError(429, "locked_out", "Too many failed authentication attempts.", { "Retry-After": String(locked) });

    const params = new URL(req.url).searchParams;
    if (["token", "api_key", "access_token", "key"].some((k) => params.has(k))) {
      return apiError(400, "token_in_url", "Send the key in the Authorization header, never in the URL.");
    }

    const bearer = /^Bearer\s+(\S+)\s*$/i.exec(req.headers.get("authorization") ?? "");
    const key = bearer ? await verifyKey(bearer[1]!) : null;
    if (!key) {
      const failures = hit(`fail:${ip}`, API_LIMITS.authFailures, API_LIMITS.authFailureWindowMin * MIN);
      if (!failures.ok) hit(lockKey, 1, API_LIMITS.lockoutMin * MIN);
      if (firstInWindow(`denied:${ip}`, 10 * MIN)) {
        await writeAudit(ACTOR, "api.denied", route, { ip, reason: bearer ? "wrong_key" : "missing_key", lockedOut: !failures.ok });
      }
      return apiError(401, "unauthorized", "A valid key is required: Authorization: Bearer <key>.", { "WWW-Authenticate": 'Bearer realm="skeelz"' });
    }

    if (auth !== "any" && !key.scopes.includes(auth)) {
      if (firstInWindow(`scope:${key.id}:${route}`, 10 * MIN)) {
        await writeAudit(ACTOR, "api.denied", route, { ip, reason: "insufficient_scope", key: key.name, keyId: key.id, required: auth });
      }
      return apiError(403, "insufficient_scope", `This key lacks the ${auth} scope.`, {
        "WWW-Authenticate": `Bearer realm="skeelz", error="insufficient_scope", scope="${auth}"`,
      });
    }
    touchKey(key, ip);

    const limits = [
      hit(`ip:${ip}`, API_LIMITS.perIpPerMinute, MIN),
      hit(`key:${key.id}`, API_LIMITS.perTokenPerHour, 60 * MIN),
      ...(endpoint.heavy ? [hit("heavy", API_LIMITS.metricsPerMinute, MIN)] : []),
    ];
    const tightest = limits.reduce((a, b) => (b.remaining < a.remaining ? b : a));
    const rateHeaders = {
      "X-RateLimit-Limit": String(tightest.limit),
      "X-RateLimit-Remaining": String(tightest.remaining),
      "X-RateLimit-Reset": String(Math.ceil(tightest.resetAt / 1000)),
    };
    const blocked = limits.find((l) => !l.ok);
    if (blocked) {
      if (firstInWindow(`limited:${key.id}`, 10 * MIN)) await writeAudit(ACTOR, "api.rate_limited", route, { ip, key: key.name, keyId: key.id });
      const retry = Math.max(1, Math.ceil((blocked.resetAt - Date.now()) / 1000));
      return apiError(429, "rate_limited", "Rate limit exceeded.", { ...rateHeaders, "Retry-After": String(retry) });
    }

    // The log shows which key uses the API and from where, without a row per request.
    if (firstInWindow(`used:${key.id}`, 60 * MIN)) void writeAudit(ACTOR, "api.used", route, { ip, key: key.name, keyId: key.id });

    try {
      const res = await handler(req, ctx, key);
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

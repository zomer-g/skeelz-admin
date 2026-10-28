import { writeAudit } from "@/lib/audit";
import { getDb } from "@/lib/db/client";
import { apiCalls } from "@/lib/db/schema";
import { touchKey, verifyKey, type ApiKeyIdentity } from "./keys";
import { firstInWindow, hit, secondsLeft } from "./rate-limit";
import { API_LIMITS, endpointFor, type EndpointAuth } from "./spec";
import { staffKeyAllowed } from "./staff";
import { logError } from "@/lib/log";

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

/** One row in api_calls for a call made with a key, whatever its answer. Never blocks or fails the call. */
function recordCall(key: ApiKeyIdentity, req: Request, status: number, started: number, ip: string): void {
  const url = new URL(req.url);
  void getDb()
    .insert(apiCalls)
    .values({
      keyId: key.id,
      keyName: key.name,
      method: req.method,
      path: `${url.pathname}${url.search}`.slice(0, 500),
      status,
      ip: ip === "unknown" ? null : ip,
      ms: Date.now() - started,
    })
    .catch((err: unknown) => logError("api call log", err));
}

/**
 * In order: no key in the URL, then the Authorization header's key. A missing or invalid
 * key counts toward the address's lockout (and is refused outright while it is locked out);
 * a valid key is never refused for its address's lockout. Then the key must hold the
 * route's scope, and the rate limits (per address and per key) must allow it. An address
 * the proxy didn't report ("unknown") is never locked out or limited per address: all
 * such callers would share one bucket, so only the per-key limits apply to them.
 *
 * `path` is the endpoint as written in spec.ts, and `auth` must match what spec.ts says,
 * so the docs, openapi.json and the code cannot drift apart.
 */
export function withApiKey<C>(path: string, auth: Exclude<EndpointAuth, "public">, handler: Handler<C>): (req: Request, ctx: C) => Promise<Response> {
  const endpoint = endpointFor(path);
  if (endpoint.auth !== auth) throw new Error(`${path}: spec.ts says ${endpoint.auth}, the route says ${auth}`);
  const route = `${endpoint.method} ${path}`;

  const gate = async (req: Request, ctx: C): Promise<Response> => {
    const started = Date.now();
    const ip = clientIp(req);
    const knownIp = ip !== "unknown";

    const params = new URL(req.url).searchParams;
    if (["token", "api_key", "access_token", "key"].some((k) => params.has(k)) || [...params.values()].some((v) => v.startsWith("sk_"))) {
      return apiError(400, "token_in_url", "Send the key in the Authorization header, never in the URL.");
    }

    const bearer = /^Bearer\s+(\S+)\s*$/i.exec(req.headers.get("authorization") ?? "");
    const key = bearer ? await verifyKey(bearer[1]!) : null;
    if (!key) {
      const lockKey = `lock:${ip}`;
      const locked = knownIp ? secondsLeft(lockKey) : 0;
      if (locked) return apiError(429, "locked_out", "Too many failed authentication attempts.", { "Retry-After": String(locked) });
      let lockedOut = false;
      if (knownIp) {
        const failures = hit(`fail:${ip}`, API_LIMITS.authFailures, API_LIMITS.authFailureWindowMin * MIN);
        if (!failures.ok) hit(lockKey, 1, API_LIMITS.lockoutMin * MIN);
        lockedOut = !failures.ok;
      }
      if (firstInWindow(`denied:${ip}`, 10 * MIN)) {
        await writeAudit(ACTOR, "api.denied", route, { ip, reason: bearer ? "wrong_key" : "missing_key", lockedOut });
      }
      return apiError(401, "unauthorized", "A valid key is required: Authorization: Bearer <key>.", { "WWW-Authenticate": 'Bearer realm="skeelz"' });
    }

    // From here on the key is known: every answer is in its call log.
    const answer = (res: Response) => {
      recordCall(key, req, res.status, started, ip);
      return res;
    };

    if (auth !== "any" && !key.scopes.includes(auth)) {
      if (firstInWindow(`scope:${key.id}:${route}`, 10 * MIN)) {
        await writeAudit(ACTOR, "api.denied", route, { ip, reason: "insufficient_scope", key: key.name, keyId: key.id, required: auth });
      }
      return answer(
        apiError(403, "insufficient_scope", `This key lacks the ${auth} scope.`, {
          "WWW-Authenticate": `Bearer realm="skeelz", error="insufficient_scope", scope="${auth}"`,
        }),
      );
    }
    // staff:read (docs/staff.md) also needs the key's issuer to be a staff manager right now; an env key never is.
    if (auth === "staff:read" && !(await staffKeyAllowed(key))) {
      if (firstInWindow(`staff:${key.id}`, 10 * MIN)) {
        await writeAudit(ACTOR, "api.denied", route, { ip, reason: "issuer_lost_staff_access", key: key.name, keyId: key.id });
      }
      return answer(apiError(403, "insufficient_scope", "The person who issued this key is no longer allowed staff data."));
    }
    touchKey(key, ip);

    const limits = [
      ...(knownIp ? [hit(`ip:${ip}`, API_LIMITS.perIpPerMinute, MIN)] : []),
      hit(`key:${key.id}`, API_LIMITS.perTokenPerHour, 60 * MIN),
      // The heavy endpoints: a shared budget for the database's sake, and one per key so no key starves the others.
      ...(endpoint.heavy ? [hit("heavy", API_LIMITS.metricsPerMinute, MIN), hit(`heavy:${key.id}`, API_LIMITS.metricsPerMinute, MIN)] : []),
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
      return answer(apiError(429, "rate_limited", "Rate limit exceeded.", { ...rateHeaders, "Retry-After": String(retry) }));
    }

    // The log shows which key uses the API and from where, without a row per request.
    if (firstInWindow(`used:${key.id}`, 60 * MIN)) void writeAudit(ACTOR, "api.used", route, { ip, key: key.name, keyId: key.id });

    try {
      const res = await handler(req, ctx, key);
      for (const [name, value] of Object.entries(rateHeaders)) res.headers.set(name, value);
      return answer(res);
    } catch (err) {
      // Never the message: a database error's message holds the SQL and its values.
      logError(`api ${route}`, err);
      return answer(apiError(500, "internal_error", "Something went wrong.", rateHeaders));
    }
  };

  // The gate itself reads the database (the key, the audit log); a failure there is the same
  // documented error, never Next's default page.
  return async (req, ctx) => {
    try {
      return await gate(req, ctx);
    } catch (err) {
      logError(`api ${route} gate`, err);
      return apiError(500, "internal_error", "Something went wrong.");
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

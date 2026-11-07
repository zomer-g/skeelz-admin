import { eq } from "drizzle-orm";
import { recordIds } from "@/lib/audit-ids";
import { AuditWriteError, writeAudit, writeAuditStrict } from "@/lib/audit";
import { LockTimeoutError, withUserLock } from "@/lib/security/lock";
import { envAdmins } from "@/lib/auth/session";
import { getDb } from "@/lib/db/client";
import { users } from "@/lib/db/schema";
import { afterExport, API_PEOPLE_LISTED, atExportLimit, dailyExportUsage, EXPORT_LIMITS, exportAllowance, type ExportUsage } from "@/lib/security/exports";
import { apiError } from "./inbound";
import type { ApiKeyIdentity } from "./keys";
import { firstInWindow } from "./rate-limit";
import { PEOPLE_SCOPES } from "./spec";

/**
 * Candidates' names, emails and phones over the API (people:read, docs/connect-api.md). The one
 * place the API hands out people's details, and only when a call asks for them (`?include=people`):
 * the key holds people:read, it is not an env key, its issuer is still an active admin, and the
 * people go against the issuer's daily export budget (lib/security/exports.ts) like the copy
 * buttons and the MCP tools. Every answer that carries people is an `api.people_listed` log entry
 * with the count, under the issuer.
 */

export type PeopleAccess =
  | { people: false }
  | { people: true; actor: string; usage: ExportUsage; take: number };

/** The issuer of a key that may carry people: an active admin now (or one of ADMIN_EMAILS); null otherwise. */
export async function peopleKeyIssuer(key: ApiKeyIdentity): Promise<string | null> {
  if (key.legacy || !key.createdBy || !key.scopes.some((s) => (PEOPLE_SCOPES as readonly string[]).includes(s))) return null;
  const email = key.createdBy.toLowerCase();
  if (envAdmins().includes(email)) return email;
  const [row] = await getDb().select({ active: users.active, role: users.role }).from(users).where(eq(users.email, email)).limit(1);
  return row?.active && row.role === "admin" ? email : null;
}

/**
 * Runs an answer that may carry people. Without `include=people` it is the plain answer. With it:
 * the scope and the issuer are checked, then the budget check, the answer and its counted entry run
 * under the issuer's export lock (lib/security/lock.ts), so parallel calls cannot spend the same
 * allowance twice; a page is cut to what is left of the issuer's day. Refused with a Response when
 * the scope is missing, the issuer is no longer allowed, the budget is spent, or the entry could
 * not be written (nothing is sent unlogged).
 */
export async function withPeople(
  key: ApiKeyIdentity,
  params: URLSearchParams,
  route: string,
  wanted: number,
  answer: (access: PeopleAccess) => Promise<Response>,
): Promise<Response> {
  const include = params.get("include");
  if (include === null || include === "") return answer({ people: false });
  if (include !== "people") return apiError(400, "invalid_parameter", "include must be people.");
  if (!key.scopes.some((s) => (PEOPLE_SCOPES as readonly string[]).includes(s))) {
    return apiError(403, "insufficient_scope", "include=people needs a key with the people:read scope.", {
      "WWW-Authenticate": 'Bearer realm="skeelz", error="insufficient_scope", scope="people:read"',
    });
  }
  const actor = await peopleKeyIssuer(key);
  if (!actor) {
    if (firstInWindow(`people:${key.id}`, 10 * 60_000)) {
      await writeAudit("api:inbound", "api.denied", route, { reason: "issuer_lost_people_access", key: key.name, keyId: key.id });
    }
    return apiError(403, "insufficient_scope", "The person who issued this key is no longer an active admin, so it carries no personal details.");
  }
  try {
    return await withUserLock("exports", actor, async () => {
      const usage = await dailyExportUsage(actor);
      const { take } = exportAllowance(usage, wanted);
      if (take === 0) {
        await atExportLimit(actor, usage, `api:${route}`);
        return apiError(
          429,
          "export_limit",
          `The daily limit of ${usage.allowed} people's details for this key's issuer is spent. An admin can allow another ${EXPORT_LIMITS.grant} today at /admin/security.`,
          { "Retry-After": String(secondsToIsraelMidnight()) },
        );
      }
      return answer({ people: true, actor, usage, take });
    });
  } catch (err) {
    if (err instanceof AuditWriteError) return apiError(503, "audit_unavailable", "The activity log is unavailable, so no personal details were sent. Try again shortly.", { "Retry-After": "30" });
    if (err instanceof LockTimeoutError) return apiError(429, "busy", "Another call carrying people for this key's issuer is still running. Try again shortly.", { "Retry-After": "10" });
    throw err;
  }
}

/**
 * After an answer that carried `n` people: the log entry they are counted from (written strictly,
 * so it throws and nothing is sent when it fails), with the records the answer named
 * (lib/audit-ids.ts) — the query alone cannot be replayed later — and the admins' alert.
 */
export async function countPeople(access: PeopleAccess, key: ApiKeyIdentity, route: string, n: number, query: string, sent?: unknown): Promise<void> {
  if (!access.people || n === 0) return;
  const { ids, more } = recordIds(sent ?? []);
  await writeAuditStrict(access.actor, API_PEOPLE_LISTED, route, {
    count: n,
    key: key.name,
    keyId: key.id,
    query: query.slice(0, 300),
    ids,
    ...(more ? { more_ids: true } : {}),
  });
  await afterExport(access.actor, access.usage, n);
}

/** Seconds until the next Israel midnight, when the budget starts again. */
function secondsToIsraelMidnight(now = new Date()): number {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Jerusalem", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" })
    .formatToParts(now)
    .reduce<Record<string, number>>((acc, p) => (p.type === "literal" ? acc : { ...acc, [p.type]: Number(p.value) }), {});
  return Math.max(60, 86_400 - ((parts.hour ?? 0) * 3600 + (parts.minute ?? 0) * 60 + (parts.second ?? 0)));
}

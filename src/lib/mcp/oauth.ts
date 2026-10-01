import { createHash, randomBytes } from "node:crypto";
import { and, eq, gt, isNull, lt, sql } from "drizzle-orm";
import { hasRole, isRole, type Role } from "@/lib/auth/roles";
import { envAdmins } from "@/lib/auth/session";
import { getDb } from "@/lib/db/client";
import { mcpClients, mcpCodes, mcpGrants, users } from "@/lib/db/schema";
import { MCP_LIMITS, resourceUrl } from "./config";

/**
 * The OAuth 2.1 side of the MCP server (docs/mcp.md §2). Identity is the site's own
 * sign-in; this file only turns an approved sign-in into a code, the code into tokens,
 * and a token back into a person — with their role as the site has it right now.
 */

const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");
const token = (prefix: string) => prefix + randomBytes(32).toString("base64url");

/** The lower of two roles. */
export const lowerRole = (a: Role, b: Role): Role => (hasRole(a, b) ? b : a);

/* ---------------------------------------------------------------- clients */

/** https anywhere, or http on the loopback (desktop clients such as Claude Code). No fragments. */
export function isAllowedRedirect(value: string): boolean {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  if (url.hash || url.username || url.password) return false;
  if (url.protocol === "https:") return true;
  return url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
}

export async function registerClient(name: string, redirectUris: string[], ip: string) {
  const id = "mcpc_" + randomBytes(16).toString("base64url");
  const [row] = await getDb().insert(mcpClients).values({ id, name, redirectUris, createdIp: ip }).returning();
  return row!;
}

export async function registrationsToday(): Promise<number> {
  const [row] = await getDb()
    .select({ n: sql<number>`count(*)::int` })
    .from(mcpClients)
    .where(gt(mcpClients.createdAt, new Date(Date.now() - 86_400_000)));
  return row?.n ?? 0;
}

/* -------------------------------------------------------------- authorize */

export interface AuthorizeRequest {
  clientId: string;
  clientName: string;
  redirectUri: string;
  codeChallenge: string;
  state: string | null;
}

/** Why an authorization request was refused, in Hebrew for the person in the browser. */
export type AuthorizeCheck = { ok: true; request: AuthorizeRequest } | { ok: false; message: string };

const PKCE_CHALLENGE = /^[A-Za-z0-9_-]{43}$/;

/**
 * Validates /mcp/oauth/authorize's parameters. The redirect_uri must be one the client
 * registered, exactly; until it is, nothing redirects anywhere — errors are shown here.
 */
export async function checkAuthorizeRequest(params: Record<string, string | undefined>, origin: string): Promise<AuthorizeCheck> {
  const clientId = params.client_id ?? "";
  if (!clientId || clientId.length > 100) return { ok: false, message: "בקשת החיבור חסרה מזהה לקוח (client_id)." };
  const [client] = await getDb().select().from(mcpClients).where(eq(mcpClients.id, clientId)).limit(1);
  if (!client) return { ok: false, message: "הלקוח שביקש את החיבור אינו רשום. יש להתחיל את החיבור מחדש מהאפליקציה." };
  const redirectUri = params.redirect_uri ?? "";
  if (!client.redirectUris.includes(redirectUri)) return { ok: false, message: "כתובת החזרה (redirect_uri) אינה תואמת את מה שהלקוח רשם." };
  if (params.response_type !== "code") return { ok: false, message: "סוג הבקשה אינו נתמך (response_type חייב להיות code)." };
  if (params.code_challenge_method !== "S256" || !PKCE_CHALLENGE.test(params.code_challenge ?? "")) {
    return { ok: false, message: "בקשת החיבור חייבת להשתמש ב-PKCE ‏(S256)." };
  }
  // RFC 8707: a client that names the resource must name this one.
  if (params.resource && params.resource.replace(/\/$/, "") !== resourceUrl(origin)) {
    return { ok: false, message: "הבקשה מיועדת לשרת אחר." };
  }
  const state = params.state ?? null;
  if (state && state.length > 1000) return { ok: false, message: "פרמטר state ארוך מדי." };
  return { ok: true, request: { clientId, clientName: client.name, redirectUri, codeChallenge: params.code_challenge!, state } };
}

/** The address to send the browser back to, with the code or the error, the state and our issuer (RFC 9207). */
export function redirectBack(req: AuthorizeRequest, origin: string, result: { code: string } | { error: string }): string {
  const url = new URL(req.redirectUri);
  if ("code" in result) url.searchParams.set("code", result.code);
  else url.searchParams.set("error", result.error);
  if (req.state) url.searchParams.set("state", req.state);
  url.searchParams.set("iss", origin);
  return url.toString();
}

export async function issueCode(req: AuthorizeRequest, userId: string, maxRole: Role): Promise<string> {
  const code = token("skm_code_");
  const db = getDb();
  // Expired codes are cleared on the way; there are never many.
  await db.delete(mcpCodes).where(lt(mcpCodes.expiresAt, new Date()));
  await db.insert(mcpCodes).values({
    hash: sha256(code),
    clientId: req.clientId,
    userId,
    redirectUri: req.redirectUri,
    codeChallenge: req.codeChallenge,
    maxRole,
    expiresAt: new Date(Date.now() + MCP_LIMITS.codeTtlMin * 60_000),
  });
  return code;
}

/* ------------------------------------------------------------------ people */

export interface McpPerson {
  id: string;
  email: string;
  name: string | null;
  /** The role the site gives them right now (ADMIN_EMAILS wins, as in session.ts). */
  siteRole: Role;
}

/** The person behind a grant as the site sees them now, or null when they may no longer enter. */
export async function currentPerson(userId: string): Promise<McpPerson | null> {
  const [row] = await getDb().select().from(users).where(eq(users.id, userId)).limit(1);
  if (!row) return null;
  const envAdmin = envAdmins().includes(row.email);
  if (!row.active && !envAdmin) return null;
  return { id: row.id, email: row.email, name: row.name, siteRole: envAdmin ? "admin" : row.role };
}

/* ------------------------------------------------------------------ tokens */

export interface TokenResponse {
  access_token: string;
  token_type: "Bearer";
  expires_in: number;
  refresh_token: string;
  scope: string;
}

function newPair() {
  const access = token("skm_at_");
  const refresh = token("skm_rt_");
  const now = Date.now();
  return {
    access,
    refresh,
    columns: {
      accessHash: sha256(access),
      accessExpiresAt: new Date(now + MCP_LIMITS.accessTtlMin * 60_000),
      refreshHash: sha256(refresh),
      refreshExpiresAt: new Date(now + MCP_LIMITS.refreshTtlDays * 86_400_000),
    },
  };
}

const response = (access: string, refresh: string, role: Role): TokenResponse => ({
  access_token: access,
  token_type: "Bearer",
  expires_in: MCP_LIMITS.accessTtlMin * 60,
  refresh_token: refresh,
  scope: `mcp role:${role}`,
});

export type TokenResult = { ok: true; body: TokenResponse; grantId: string; person: McpPerson; created: boolean } | { ok: false; error: string; description: string };

const PKCE_VERIFIER = /^[A-Za-z0-9._~-]{43,128}$/;

/** authorization_code: single use (deleted whatever happens next), PKCE, same client and redirect. */
export async function redeemCode(p: { code: string; clientId: string; redirectUri: string; verifier: string }): Promise<TokenResult> {
  const db = getDb();
  const [row] = await db.delete(mcpCodes).where(eq(mcpCodes.hash, sha256(p.code))).returning();
  const bad = (description: string): TokenResult => ({ ok: false, error: "invalid_grant", description });
  if (!row || row.expiresAt.getTime() <= Date.now()) return bad("authorization code not found or expired");
  if (row.clientId !== p.clientId) return bad("code was issued to another client");
  if (row.redirectUri !== p.redirectUri) return bad("redirect_uri does not match");
  if (!PKCE_VERIFIER.test(p.verifier) || createHash("sha256").update(p.verifier).digest("base64url") !== row.codeChallenge) {
    return bad("PKCE verification failed");
  }
  const person = await currentPerson(row.userId);
  if (!person) return bad("this account no longer has access");

  const pair = newPair();
  const [grant] = await db
    .insert(mcpGrants)
    .values({ userId: row.userId, clientId: row.clientId, maxRole: row.maxRole, ...pair.columns })
    .returning({ id: mcpGrants.id });
  return { ok: true, body: response(pair.access, pair.refresh, lowerRole(person.siteRole, row.maxRole)), grantId: grant!.id, person, created: true };
}

/** refresh_token: rotates both tokens; the old refresh token stops working at once. */
export async function refreshGrant(p: { refreshToken: string; clientId: string }): Promise<TokenResult> {
  const db = getDb();
  const bad = (description: string): TokenResult => ({ ok: false, error: "invalid_grant", description });
  const [grant] = await db
    .select()
    .from(mcpGrants)
    .where(and(eq(mcpGrants.refreshHash, sha256(p.refreshToken)), isNull(mcpGrants.revokedAt)))
    .limit(1);
  if (!grant || grant.refreshExpiresAt.getTime() <= Date.now()) return bad("refresh token not found, revoked or expired");
  if (grant.clientId !== p.clientId) return bad("refresh token was issued to another client");
  const person = await currentPerson(grant.userId);
  if (!person) return bad("this account no longer has access");

  const pair = newPair();
  // Conditional on the hash just read, so two racing refreshes cannot both win.
  const [updated] = await db
    .update(mcpGrants)
    .set(pair.columns)
    .where(and(eq(mcpGrants.id, grant.id), eq(mcpGrants.refreshHash, grant.refreshHash), isNull(mcpGrants.revokedAt)))
    .returning({ id: mcpGrants.id });
  if (!updated) return bad("refresh token was already used");
  return { ok: true, body: response(pair.access, pair.refresh, lowerRole(person.siteRole, grant.maxRole)), grantId: grant.id, person, created: false };
}

/* -------------------------------------------------------------- principal */

/** Who is calling /mcp, and with which role. */
export interface McpPrincipal {
  grantId: string;
  clientName: string;
  person: McpPerson;
  /** The ceiling chosen when the connection was approved. */
  maxRole: Role;
  /** What every tool check uses: the site role, capped by the ceiling. */
  role: Role;
}

/** The principal for a bearer access token, or null. The role is read from the users table on every call. */
export async function verifyAccessToken(presented: string): Promise<McpPrincipal | null> {
  if (!presented.startsWith("skm_at_") || presented.length > 200) return null;
  const [row] = await getDb()
    .select({ grant: mcpGrants, clientName: mcpClients.name })
    .from(mcpGrants)
    .innerJoin(mcpClients, eq(mcpClients.id, mcpGrants.clientId))
    .where(and(eq(mcpGrants.accessHash, sha256(presented)), isNull(mcpGrants.revokedAt)))
    .limit(1);
  if (!row || row.grant.accessExpiresAt.getTime() <= Date.now()) return null;
  const person = await currentPerson(row.grant.userId);
  if (!person) return null;
  const maxRole = isRole(row.grant.maxRole) ? row.grant.maxRole : "viewer";
  return { grantId: row.grant.id, clientName: row.clientName, person, maxRole, role: lowerRole(person.siteRole, maxRole) };
}

/** Counts a call and records when and from where, at most one write per call. */
export async function touchGrant(grantId: string, ip: string): Promise<void> {
  await getDb()
    .update(mcpGrants)
    .set({ lastUsedAt: new Date(), lastUsedIp: ip, calls: sql`${mcpGrants.calls} + 1` })
    .where(eq(mcpGrants.id, grantId));
}

export async function revokeGrant(grantId: string, by: string) {
  const [row] = await getDb()
    .update(mcpGrants)
    .set({ revokedAt: new Date(), revokedBy: by })
    .where(and(eq(mcpGrants.id, grantId), isNull(mcpGrants.revokedAt)))
    .returning({ id: mcpGrants.id, userId: mcpGrants.userId, clientId: mcpGrants.clientId });
  return row ?? null;
}

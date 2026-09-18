import { eq } from "drizzle-orm";
import { CONNECT_LIMITS, type Peer } from "@/lib/api/spec";
import { getDb } from "@/lib/db/client";
import { connections } from "@/lib/db/schema";
import { decryptSecret } from "./crypto";

/**
 * Calls to the other SKEELZ apps (docs/connect-api.md §2). Every cross-app call goes
 * through `peerFetch`: it finds the connection (the `connections` row first, then the
 * env), sends the key as a Bearer header, gives up after 5 seconds, and returns parsed
 * JSON or throws a PeerError. The key is never logged or put in an error message.
 */

export type PeerErrorCode = "not_configured" | "disabled" | "invalid_path" | "timeout" | "network" | "http" | "invalid_response";

export class PeerError extends Error {
  constructor(
    readonly peer: Peer,
    readonly code: PeerErrorCode,
    message: string,
    /** The peer's HTTP status and its `error.code`, for code "http". */
    readonly status?: number,
    readonly peerCode?: string,
  ) {
    super(message);
    this.name = "PeerError";
  }
}

/**
 * Where the connection comes from when no row exists for a peer. The admin app had no
 * calls to crm or site before SKEELZ Connect, so it has no env wiring to fall back to;
 * the site app's fallbacks (ADMIN_API_URL + SITE_FEED_TOKEN, CRM_URL + CRM_INTAKE_TOKEN) live there.
 */
const ENV_FALLBACK: Partial<Record<Peer, { url: string; key: string }>> = {};

/**
 * A peer's base URL must be an origin and nothing more: https (or http://localhost in
 * dev), no credentials, path, query or fragment. Returns the normalised origin, or null.
 */
export function normalizeBaseUrl(raw: string): string | null {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return null;
  }
  const localDev = process.env.NODE_ENV === "development" && url.protocol === "http:" && ["localhost", "127.0.0.1"].includes(url.hostname);
  if (url.protocol !== "https:" && !localDev) return null;
  if (url.username || url.password || url.search || url.hash || (url.pathname !== "/" && url.pathname !== "")) return null;
  if (raw.trim().includes("?") || raw.trim().includes("#")) return null;
  return url.origin;
}

export interface ResolvedConnection {
  source: "db" | "env";
  baseUrl: string;
  key: string;
}

export async function resolveConnection(peer: Peer): Promise<ResolvedConnection> {
  const [row] = await getDb().select().from(connections).where(eq(connections.peer, peer)).limit(1);
  if (row) {
    if (!row.enabled) throw new PeerError(peer, "disabled", `The connection to ${peer} is switched off.`);
    const baseUrl = normalizeBaseUrl(row.baseUrl);
    if (!baseUrl) throw new PeerError(peer, "not_configured", `The base URL stored for ${peer} is not allowed.`);
    let key: string;
    try {
      key = decryptSecret(row.keyCiphertext);
    } catch {
      throw new PeerError(peer, "not_configured", `The key stored for ${peer} cannot be decrypted (CONNECT_SECRET_KEY).`);
    }
    return { source: "db", baseUrl, key };
  }
  const fallback = ENV_FALLBACK[peer];
  const url = fallback ? process.env[fallback.url]?.trim() : undefined;
  const key = fallback ? process.env[fallback.key]?.trim() : undefined;
  const baseUrl = url ? normalizeBaseUrl(url) : null;
  if (baseUrl && key) return { source: "env", baseUrl, key };
  throw new PeerError(peer, "not_configured", `No connection to ${peer} is set up.`);
}

export async function peerFetch<T = unknown>(peer: Peer, path: string, init: RequestInit & { timeoutMs?: number } = {}): Promise<T> {
  if (!path.startsWith("/api/v1/") || path.includes("..") || /^\/\//.test(path)) {
    throw new PeerError(peer, "invalid_path", "Peer paths start with /api/v1/.");
  }
  const { baseUrl, key } = await resolveConnection(peer);
  const { timeoutMs = CONNECT_LIMITS.peerTimeoutMs, headers, ...rest } = init;
  const target = new URL(path, baseUrl);
  if (target.origin !== baseUrl) throw new PeerError(peer, "invalid_path", "The path left the peer's origin.");

  const merged = new Headers(headers);
  merged.set("Authorization", `Bearer ${key}`);
  merged.set("Accept", "application/json");

  let res: Response;
  try {
    // No redirects: a redirect could carry the key's header to another origin.
    res = await fetch(target, { ...rest, headers: merged, redirect: "error", cache: "no-store", signal: AbortSignal.timeout(timeoutMs) });
  } catch (err) {
    const name = (err as Error).name;
    if (name === "TimeoutError" || name === "AbortError") throw new PeerError(peer, "timeout", `${peer} did not answer within ${timeoutMs / 1000}s.`);
    throw new PeerError(peer, "network", `${peer} could not be reached.`);
  }

  let body: unknown = null;
  const text = await res.text();
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      throw new PeerError(peer, res.ok ? "invalid_response" : "http", `${peer} answered ${res.status} without JSON.`, res.status);
    }
  }
  if (!res.ok) {
    const error = (body as { error?: { code?: unknown; message?: unknown } } | null)?.error;
    const code = typeof error?.code === "string" ? error.code : undefined;
    const message = typeof error?.message === "string" ? error.message.slice(0, 200) : "";
    throw new PeerError(peer, "http", `${peer} answered ${res.status}${code ? ` ${code}` : ""}${message ? `: ${message}` : ""}`, res.status, code);
  }
  return body as T;
}

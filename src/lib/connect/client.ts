import { eq } from "drizzle-orm";
import { CONNECT_LIMITS, type Peer } from "@/lib/api/spec";
import { getDb } from "@/lib/db/client";
import { connections } from "@/lib/db/schema";
import { assertPublicHost, isInternalHostname } from "@/lib/net/public-address";
import { decryptSecret } from "./crypto";

/**
 * Calls to the other SKEELZ apps (docs/connect-api.md §2). Every cross-app call goes
 * through `peerFetch`: it finds the connection (the `connections` row first, then the
 * env), checks the address is public, sends the key as a Bearer header, gives up after
 * 5 seconds or past a size cap, and returns parsed JSON or throws a PeerError. The key
 * is never logged or put in an error message.
 */

export type PeerErrorCode =
  | "not_configured"
  | "disabled"
  | "invalid_path"
  | "invalid_base_url"
  | "blocked_address"
  | "timeout"
  | "network"
  | "too_large"
  | "http"
  | "invalid_response";

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

const isDev = () => process.env.NODE_ENV === "development";

/** http://localhost:<port> or http://127.0.0.1:<port>, allowed only under `next dev`. */
const isLocalDevUrl = (url: URL) => isDev() && url.protocol === "http:" && ["localhost", "127.0.0.1"].includes(url.hostname);

/**
 * A peer's base URL must be a public https origin and nothing more: no IP literal,
 * localhost or internal-looking name, no credentials, path, query or fragment (SSRF).
 * In development http://localhost:<port> and http://127.0.0.1:<port> are also allowed.
 * Returns the normalised origin, or null.
 */
export function normalizeBaseUrl(raw: string): string | null {
  const trimmed = raw.trim();
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return null;
  }
  if (url.username || url.password || url.search || url.hash || trimmed.includes("?") || trimmed.includes("#")) return null;
  if (url.pathname !== "/" && url.pathname !== "") return null;
  if (isLocalDevUrl(url)) return url.origin;
  if (url.protocol !== "https:" || isInternalHostname(url.hostname)) return null;
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
    if (!baseUrl) throw new PeerError(peer, "invalid_base_url", `The base URL stored for ${peer} is not allowed.`);
    let key: string;
    try {
      key = decryptSecret(row.keyCiphertext, peer);
    } catch {
      throw new PeerError(peer, "not_configured", `The key stored for ${peer} cannot be decrypted: enter it again.`);
    }
    return { source: "db", baseUrl, key };
  }
  const fallback = ENV_FALLBACK[peer];
  const url = fallback ? process.env[fallback.url]?.trim() : undefined;
  const key = fallback ? process.env[fallback.key]?.trim() : undefined;
  const baseUrl = url ? normalizeBaseUrl(url) : null;
  if (url && !baseUrl) throw new PeerError(peer, "invalid_base_url", `The base URL in the env for ${peer} is not allowed.`);
  if (baseUrl && key) return { source: "env", baseUrl, key };
  throw new PeerError(peer, "not_configured", `No connection to ${peer} is set up.`);
}

/** Reads at most `maxBytes` of the body, aborting the stream past the cap. */
async function readCapped(peer: Peer, res: Response, maxBytes: number): Promise<string> {
  const declared = Number(res.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maxBytes) {
    await res.body?.cancel();
    throw new PeerError(peer, "too_large", `${peer} sent more than ${maxBytes} bytes.`);
  }
  if (!res.body) return "";
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      throw new PeerError(peer, "too_large", `${peer} sent more than ${maxBytes} bytes.`);
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString("utf8");
}

export async function peerFetch<T = unknown>(
  peer: Peer,
  path: string,
  init: RequestInit & { timeoutMs?: number; maxBytes?: number } = {},
): Promise<T> {
  if (!path.startsWith("/api/v1/") || path.includes("..") || /^\/\//.test(path)) {
    throw new PeerError(peer, "invalid_path", "Peer paths start with /api/v1/.");
  }
  const { baseUrl, key } = await resolveConnection(peer);
  const { timeoutMs = CONNECT_LIMITS.peerTimeoutMs, maxBytes = CONNECT_LIMITS.peerMaxBytes, headers, ...rest } = init;
  const target = new URL(path, baseUrl);
  if (target.origin !== baseUrl) throw new PeerError(peer, "invalid_path", "The path left the peer's origin.");

  // Checked again at every call, so rows saved before a rule changed are covered too.
  if (!isLocalDevUrl(target)) {
    try {
      await assertPublicHost(target.hostname);
    } catch (err) {
      if ((err as Error).message === "blocked_address") throw new PeerError(peer, "blocked_address", `${peer}'s address resolves to a non-public address.`);
      throw new PeerError(peer, "network", `${peer}'s address could not be resolved.`);
    }
  }

  const merged = new Headers(headers);
  merged.set("Authorization", `Bearer ${key}`);
  merged.set("Accept", "application/json");

  const signal = AbortSignal.timeout(timeoutMs);
  let res: Response;
  let text: string;
  try {
    // No redirects: a redirect could carry the key's header to another origin.
    res = await fetch(target, { ...rest, headers: merged, redirect: "error", cache: "no-store", signal });
    text = await readCapped(peer, res, maxBytes);
  } catch (err) {
    if (err instanceof PeerError) throw err;
    const name = (err as Error).name;
    if (name === "TimeoutError" || name === "AbortError") throw new PeerError(peer, "timeout", `${peer} did not answer within ${timeoutMs / 1000}s.`);
    throw new PeerError(peer, "network", `${peer} could not be reached.`);
  }

  let body: unknown = null;
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      throw new PeerError(peer, res.ok ? "invalid_response" : "http", `${peer} answered ${res.status} without JSON.`, res.status);
    }
  }
  if (!res.ok) {
    const error = (body as { error?: { code?: unknown; message?: unknown } } | null)?.error;
    const code = typeof error?.code === "string" ? error.code.slice(0, 60) : undefined;
    const message = typeof error?.message === "string" ? error.message.slice(0, 200) : "";
    throw new PeerError(peer, "http", `${peer} answered ${res.status}${code ? ` ${code}` : ""}${message ? `: ${message}` : ""}`, res.status, code);
  }
  return body as T;
}

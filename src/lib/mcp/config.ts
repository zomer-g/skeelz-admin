import { audiences } from "@/lib/auth/xhost";

/**
 * The MCP server's fixed numbers and its public address (docs/mcp.md).
 *
 * The issuer is the site's origin, so the authorization-server metadata sits at the root
 * (/.well-known/oauth-authorization-server); the protected resource is <origin>/mcp.
 */

export const MCP_PATH = "/mcp";
export const SERVER_NAME = "skeelz-admin";
export const SERVER_TITLE = "SKEELZ Admin";

/** Newest first; a client asking for another version gets the newest. */
export const PROTOCOL_VERSIONS = ["2025-11-25", "2025-06-18", "2025-03-26", "2024-11-05"] as const;

export const MCP_LIMITS = {
  codeTtlMin: 10,
  accessTtlMin: 60,
  /** Sliding: every refresh starts a new 30 days. */
  refreshTtlDays: 30,
  /** Tool calls per connection per minute. */
  callsPerMinute: 60,
  /** The heavy dashboard tools, per person per minute. */
  heavyPerMinute: 10,
  /** Client registrations per address per hour, and in total per day. */
  registerPerIpPerHour: 10,
  registerPerDay: 200,
  /** Failed bearer tokens per address per ten minutes before 429. */
  authFailures: 30,
  maxRedirectUris: 5,
  maxClientName: 100,
  maxBodyBytes: 256 * 1024,
} as const;

/**
 * The site's public origin. Behind xhostd the request's Host is the proxy's business, so a
 * hostname is used only when it is one of XHOST_AUTH_AUDIENCES (the hostnames the sign-in
 * is minted for); otherwise the first of them. `next dev` may also run on localhost.
 */
export function publicOrigin(headers: Headers): string {
  const raw = (headers.get("x-forwarded-host") ?? headers.get("host") ?? "").split(",")[0]!.trim().toLowerCase();
  const hostname = raw.replace(/:\d+$/, "");
  const allowed = audiences();
  if (allowed.includes(hostname)) return `https://${hostname}`;
  if (process.env.NODE_ENV === "development" && (hostname === "localhost" || hostname === "127.0.0.1")) return `http://${raw}`;
  return allowed[0] ? `https://${allowed[0]}` : "http://localhost:3000";
}

export const resourceUrl = (origin: string) => `${origin}${MCP_PATH}`;
export const resourceMetadataUrl = (origin: string) => `${origin}/.well-known/oauth-protected-resource${MCP_PATH}`;

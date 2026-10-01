import { clientIp } from "@/lib/api/inbound";
import { hit, secondsLeft } from "@/lib/api/rate-limit";
import { MCP_LIMITS, publicOrigin } from "@/lib/mcp/config";
import { CORS_HEADERS, mcpJson, preflight, unauthorized } from "@/lib/mcp/http";
import { verifyAccessToken } from "@/lib/mcp/oauth";
import { handleRpc } from "@/lib/mcp/server";

export const dynamic = "force-dynamic";

const TEN_MIN = 10 * 60_000;

/**
 * The MCP endpoint (docs/mcp.md). It stands outside the site's cookie sign-in: the caller is an
 * AI client holding an OAuth access token issued at /mcp/oauth/token, and verifyAccessToken
 * stands in for requireUser — it reads the person's role from the users table on every call.
 */
export async function POST(req: Request): Promise<Response> {
  const origin = publicOrigin(req.headers);
  const ip = clientIp(req);
  const knownIp = ip !== "unknown";

  const lockKey = `mcp-lock:${ip}`;
  const locked = knownIp ? secondsLeft(lockKey) : 0;
  if (locked) return mcpJson({ error: "too_many_requests" }, 429, { "Retry-After": String(locked) });

  const bearer = /^Bearer\s+(\S+)\s*$/i.exec(req.headers.get("authorization") ?? "");
  const principal = bearer ? await verifyAccessToken(bearer[1]!) : null;
  if (!principal) {
    // Wrong tokens count toward a lockout; a missing one is just the start of the OAuth flow.
    if (bearer && knownIp && !hit(`mcp-fail:${ip}`, MCP_LIMITS.authFailures, TEN_MIN).ok) hit(lockKey, 1, TEN_MIN);
    return unauthorized(origin, bearer ? "Token invalid, expired or revoked" : "Missing Bearer token");
  }

  const text = await req.text();
  if (text.length > MCP_LIMITS.maxBodyBytes) {
    return mcpJson({ jsonrpc: "2.0", id: null, error: { code: -32600, message: "Request too large" } }, 413);
  }
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return mcpJson({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } }, 400);
  }

  const res = await handleRpc(body, { principal, origin }, ip);
  for (const [k, v] of Object.entries(CORS_HEADERS)) res.headers.set(k, v);
  return res;
}

/** No server-to-client stream: this server is stateless and never pushes. */
export function GET(): Response {
  return new Response(null, { status: 405, headers: { Allow: "POST, OPTIONS", ...CORS_HEADERS } });
}

/** There are no sessions to end. */
export function DELETE(): Response {
  return new Response(null, { status: 405, headers: { Allow: "POST, OPTIONS", ...CORS_HEADERS } });
}

export const OPTIONS = preflight;

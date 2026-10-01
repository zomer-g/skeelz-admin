import { clientIp } from "@/lib/api/inbound";
import { hit } from "@/lib/api/rate-limit";
import { writeAudit } from "@/lib/audit";
import { mcpJson, oauthError, preflight, readParams } from "@/lib/mcp/http";
import { redeemCode, refreshGrant, type TokenResult } from "@/lib/mcp/oauth";

export const dynamic = "force-dynamic";

const str = (v: unknown) => (typeof v === "string" ? v : "");

/** The OAuth token endpoint (RFC 6749 §3.2): authorization_code with PKCE, and refresh_token with rotation. */
export async function POST(req: Request): Promise<Response> {
  const ip = clientIp(req);
  if (ip !== "unknown" && !hit(`mcp-token:${ip}`, 60, 60_000).ok) return oauthError(429, "slow_down", "Too many token requests.");

  // OAuth sends a form; some clients send JSON. Both are read.
  const p = await readParams(req, 16 * 1024);
  if (!p) return oauthError(400, "invalid_request", "The body must be application/x-www-form-urlencoded or JSON.");
  const clientId = str(p.client_id);
  if (!clientId) return oauthError(401, "invalid_client", "client_id is required.");

  let result: TokenResult;
  switch (str(p.grant_type)) {
    case "authorization_code":
      if (!p.code || !p.redirect_uri || !p.code_verifier) return oauthError(400, "invalid_request", "code, redirect_uri and code_verifier are required.");
      result = await redeemCode({ code: str(p.code), clientId, redirectUri: str(p.redirect_uri), verifier: str(p.code_verifier) });
      break;
    case "refresh_token":
      if (!p.refresh_token) return oauthError(400, "invalid_request", "refresh_token is required.");
      result = await refreshGrant({ refreshToken: str(p.refresh_token), clientId });
      break;
    default:
      return oauthError(400, "unsupported_grant_type", "Supported: authorization_code, refresh_token.");
  }

  if (!result.ok) return oauthError(400, result.error, result.description);
  if (result.created) await writeAudit(result.person.email, "mcp.connected", result.grantId, { ip });
  return mcpJson(result.body, 200, { Pragma: "no-cache" });
}

export const OPTIONS = preflight;

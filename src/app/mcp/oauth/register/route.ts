import { clientIp } from "@/lib/api/inbound";
import { hit } from "@/lib/api/rate-limit";
import { MCP_LIMITS } from "@/lib/mcp/config";
import { mcpJson, oauthError, preflight, readParams } from "@/lib/mcp/http";
import { isAllowedRedirect, registerClient, registrationsToday } from "@/lib/mcp/oauth";

export const dynamic = "force-dynamic";

const CONTROL_CHARS = /[\u0000-\u001f\u007f]/g;

/**
 * Dynamic Client Registration (RFC 7591), open as MCP clients expect. Registering grants
 * nothing: every connection still needs a signed-in person to approve it on the consent
 * screen. Clients are public (PKCE, no secret), whatever auth method they ask for.
 */
export async function POST(req: Request): Promise<Response> {
  const ip = clientIp(req);
  if (ip !== "unknown" && !hit(`mcp-register:${ip}`, MCP_LIMITS.registerPerIpPerHour, 3_600_000).ok) {
    return oauthError(429, "slow_down", "Too many registrations from this address.");
  }
  if ((await registrationsToday()) >= MCP_LIMITS.registerPerDay) return oauthError(429, "slow_down", "Registration is paused; try again tomorrow.");

  const p = await readParams(req, 16 * 1024);
  if (!p) return oauthError(400, "invalid_client_metadata", "The body must be a JSON object.");
  const uris = p.redirect_uris;
  if (!Array.isArray(uris) || !uris.length || uris.length > MCP_LIMITS.maxRedirectUris) {
    return oauthError(400, "invalid_redirect_uri", `redirect_uris must list 1 to ${MCP_LIMITS.maxRedirectUris} addresses.`);
  }
  if (!uris.every((u) => typeof u === "string" && u.length <= 500 && isAllowedRedirect(u))) {
    return oauthError(400, "invalid_redirect_uri", "Each redirect URI must be https, or http on localhost, without a fragment.");
  }
  const grantTypes = Array.isArray(p.grant_types) ? p.grant_types : ["authorization_code"];
  if (!grantTypes.includes("authorization_code")) return oauthError(400, "invalid_client_metadata", "authorization_code is required.");
  const rawName = typeof p.client_name === "string" ? p.client_name : "";
  const name = rawName.replace(CONTROL_CHARS, "").trim().slice(0, MCP_LIMITS.maxClientName) || "MCP client";

  const client = await registerClient(name, uris as string[], ip);
  return mcpJson(
    {
      client_id: client.id,
      client_id_issued_at: Math.floor(client.createdAt.getTime() / 1000),
      client_name: client.name,
      redirect_uris: client.redirectUris,
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
    },
    201,
  );
}

export const OPTIONS = preflight;

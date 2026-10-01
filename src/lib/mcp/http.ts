import { resourceMetadataUrl } from "./config";

/**
 * MCP clients call from other origins (claude.ai, the MCP Inspector in a browser), with a
 * Bearer token and never cookies, so these routes allow any origin without credentials.
 */
export const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Authorization, Content-Type, Accept, Mcp-Session-Id, Mcp-Protocol-Version, Last-Event-Id",
  "Access-Control-Expose-Headers": "Mcp-Session-Id, WWW-Authenticate",
  "Access-Control-Max-Age": "86400",
};

export function mcpJson(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...CORS_HEADERS, ...headers },
  });
}

export const preflight = () => new Response(null, { status: 204, headers: CORS_HEADERS });

/** An OAuth error response (RFC 6749 §5.2). */
export const oauthError = (status: number, error: string, description: string, headers: Record<string, string> = {}) =>
  mcpJson({ error, error_description: description }, status, headers);

/** 401 with the header that tells an MCP client where to start the OAuth flow (RFC 9728 §5.1). */
export function unauthorized(origin: string, description: string): Response {
  const challenge = `Bearer realm="skeelz", error="invalid_token", error_description="${description}", resource_metadata="${resourceMetadataUrl(origin)}"`;
  return oauthError(401, "invalid_token", description, { "WWW-Authenticate": challenge });
}

/** The body of a token or registration request: form-encoded (as OAuth requires) or JSON. */
export async function readParams(req: Request, maxBytes: number): Promise<Record<string, unknown> | null> {
  const text = await req.text();
  if (text.length > maxBytes) return null;
  const type = req.headers.get("content-type") ?? "";
  if (type.includes("application/x-www-form-urlencoded")) return Object.fromEntries(new URLSearchParams(text));
  try {
    const parsed: unknown = JSON.parse(text);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

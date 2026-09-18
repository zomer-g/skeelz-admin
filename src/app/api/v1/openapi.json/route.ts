import { apiError, apiJson, clientIp } from "@/lib/api/inbound";
import { hit } from "@/lib/api/rate-limit";
import { CONNECT_LIMITS, openApiDocument } from "@/lib/api/spec";
import { appVersion } from "@/lib/connect/version";

export const dynamic = "force-dynamic";

/** The OpenAPI 3.1 description of this app's API. No key: it holds no data, only the contract in spec.ts. */
export async function GET(req: Request): Promise<Response> {
  const limit = hit(`openapi:${clientIp(req)}`, CONNECT_LIMITS.openapiPerIpPerMinute, 60_000);
  if (!limit.ok) {
    return apiError(429, "rate_limited", "Rate limit exceeded.", { "Retry-After": String(Math.max(1, Math.ceil((limit.resetAt - Date.now()) / 1000))) });
  }
  return apiJson(openApiDocument(appVersion()));
}

import { apiError, apiJson, withApiKey } from "@/lib/api/inbound";
import { staffMonthlyJson } from "@/lib/api/staff";

export const dynamic = "force-dynamic";

/** Staff hours and tasks for a month (docs/staff.md): staff:read, and an issuer who is still a staff manager. */
export const GET = withApiKey("/api/v1/staff/monthly", "staff:read", async (req: Request) => {
  const body = await staffMonthlyJson(new URL(req.url).searchParams.get("month"));
  if (!body) return apiError(400, "invalid_parameter", "month must be YYYY-MM.");
  return apiJson(body);
});

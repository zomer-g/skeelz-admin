import { jobJson } from "@/lib/api/data";
import { apiError, apiJson, choiceParam, intParam, withApiToken } from "@/lib/api/inbound";
import { API_LIMITS } from "@/lib/api/spec";
import { listPositions } from "@/lib/metrics/jobs";

export const dynamic = "force-dynamic";

/** Jobs, newest first. No people: see /api-docs. */
export const GET = withApiToken("GET /api/v1/jobs", async (req: Request) => {
  const params = new URL(req.url).searchParams;
  const status = choiceParam(params, "status", ["active", "all"] as const);
  const scope = choiceParam(params, "scope", ["paid", "all"] as const);
  const limit = intParam(params, "limit", API_LIMITS.defaultPageSize, 1, API_LIMITS.maxPageSize);
  const page = intParam(params, "page", 1, 1, API_LIMITS.maxPage);
  if (!status) return apiError(400, "invalid_parameter", "status must be active or all.");
  if (!scope) return apiError(400, "invalid_parameter", "scope must be paid or all.");
  if (limit === null) return apiError(400, "invalid_parameter", `limit must be a whole number from 1 to ${API_LIMITS.maxPageSize}.`);
  if (page === null) return apiError(400, "invalid_parameter", `page must be a whole number from 1 to ${API_LIMITS.maxPage}.`);

  const since = params.get("updated_since");
  const updatedSince = since ? new Date(since) : null;
  if (updatedSince && Number.isNaN(updatedSince.getTime())) return apiError(400, "invalid_parameter", "updated_since must be an ISO 8601 date-time.");

  const { rows, total } = await listPositions({
    activeOnly: status === "active",
    paidOnly: scope === "paid",
    updatedSince,
    limit,
    offset: (page - 1) * limit,
  });
  return apiJson({ data: rows.map(jobJson), page, limit, total, has_more: page * limit < total });
});

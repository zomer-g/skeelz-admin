import { metricsSummary } from "@/lib/api/data";
import { apiError, apiJson, choiceParam, isDay, withApiKey } from "@/lib/api/inbound";
import { API_LIMITS } from "@/lib/api/spec";
import { addDays, israelDay } from "@/lib/dashboard/params";

export const dynamic = "force-dynamic";

/** The candidates-tab funnel and site totals for a range of Israel days. Aggregates only. */
export const GET = withApiKey(
  "/api/v1/metrics",
  "metrics:read",
  async (req: Request) => {
    const params = new URL(req.url).searchParams;
    const toDay = params.get("to") || israelDay();
    const fromDay = params.get("from") || addDays(toDay, -29);
    if (!isDay(fromDay) || !isDay(toDay)) return apiError(400, "invalid_parameter", "from and to must be dates: YYYY-MM-DD.");
    if (fromDay > toDay) return apiError(400, "invalid_parameter", "from must not be after to.");
    const days = (Date.parse(toDay) - Date.parse(fromDay)) / 86_400_000 + 1;
    if (days > API_LIMITS.maxRangeDays) return apiError(400, "range_too_long", `The range may span at most ${API_LIMITS.maxRangeDays} days.`);
    const scope = choiceParam(params, "scope", ["paid", "all"] as const);
    const basis = choiceParam(params, "basis", ["application", "event"] as const);
    if (!scope) return apiError(400, "invalid_parameter", "scope must be paid or all.");
    if (!basis) return apiError(400, "invalid_parameter", "basis must be application or event.");

    return apiJson(await metricsSummary(fromDay, toDay, scope, basis));
  },
);

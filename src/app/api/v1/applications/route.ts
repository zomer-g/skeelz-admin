import { apiError, apiJson, choiceParam, intParam, isDay, withApiKey } from "@/lib/api/inbound";
import { countPeople, peopleAccess } from "@/lib/api/people";
import { applicationJson } from "@/lib/api/records";
import { API_LIMITS } from "@/lib/api/spec";
import { searchApplications } from "@/lib/entities/applications";
import { isSfId } from "@/lib/entities/search";

export const dynamic = "force-dynamic";

const PATH = "/api/v1/applications";

/** Applications, newest first, one per row: ids, job, status and dates; people only with include=people (lib/api/people.ts). */
export const GET = withApiKey(PATH, "records:read", async (req: Request, _ctx: unknown, key) => {
  const url = new URL(req.url);
  const params = url.searchParams;
  const scope = choiceParam(params, "scope", ["paid", "all"] as const);
  const fast = choiceParam(params, "fast", ["", "fast", "regular"] as const);
  let limit = intParam(params, "limit", API_LIMITS.defaultPageSize, 1, API_LIMITS.maxPageSize);
  const page = intParam(params, "page", 1, 1, API_LIMITS.maxPage);
  const fromDay = params.get("from") ?? "";
  const toDay = params.get("to") ?? "";
  const jobId = params.get("job_id") ?? "";
  const candidateId = params.get("candidate_id") ?? "";
  const status = (params.get("status") ?? "").slice(0, 100);
  if (!scope) return apiError(400, "invalid_parameter", "scope must be paid or all.");
  if (fast === null) return apiError(400, "invalid_parameter", "fast must be fast or regular.");
  if (limit === null) return apiError(400, "invalid_parameter", `limit must be a whole number from 1 to ${API_LIMITS.maxPageSize}.`);
  if (page === null) return apiError(400, "invalid_parameter", `page must be a whole number from 1 to ${API_LIMITS.maxPage}.`);
  if ((fromDay && !isDay(fromDay)) || (toDay && !isDay(toDay))) return apiError(400, "invalid_parameter", "from and to must be dates: YYYY-MM-DD.");
  if (fromDay && toDay && fromDay > toDay) return apiError(400, "invalid_parameter", "from must not be after to.");
  if ((jobId && !isSfId(jobId)) || (candidateId && !isSfId(candidateId))) return apiError(400, "invalid_id", "job_id and candidate_id must be Salesforce ids.");

  const access = await peopleAccess(key, params, PATH, limit);
  if (access instanceof Response) return access;
  if (access.people) limit = access.take;

  const { rows, total } = await searchApplications(
    {
      q: "",
      status,
      paid: scope === "paid" ? "paid" : "",
      fast,
      owner: "",
      fromDay,
      toDay,
      ...(jobId ? { jobId } : {}),
      ...(candidateId ? { contactId: candidateId } : {}),
    },
    { page, pageSize: limit },
  );
  await countPeople(access, key, PATH, rows.length, url.search);
  return apiJson({ data: rows.map((r) => applicationJson(r, access.people)), page, limit, total, has_more: page * limit < total });
});

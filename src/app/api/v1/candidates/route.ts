import { apiError, apiJson, choiceParam, intParam, isDay, withApiKey } from "@/lib/api/inbound";
import { countPeople, peopleAccess } from "@/lib/api/people";
import { candidateJson } from "@/lib/api/records";
import { API_LIMITS } from "@/lib/api/spec";
import { searchCandidates } from "@/lib/entities/candidates";
import { AREA_VALUES, NAPA_VALUES } from "@/lib/geo/filters";
import { SKILLS } from "@/lib/skills";

export const dynamic = "force-dynamic";

const PATH = "/api/v1/candidates";

/** Candidates, newest first, one per row: place, skills, CV flag and applications; people only with include=people. Never files. */
export const GET = withApiKey(PATH, "records:read", async (req: Request, _ctx: unknown, key) => {
  const url = new URL(req.url);
  const params = url.searchParams;
  let limit = intParam(params, "limit", API_LIMITS.defaultPageSize, 1, API_LIMITS.maxPageSize);
  const page = intParam(params, "page", 1, 1, API_LIMITS.maxPage);
  const area = choiceParam(params, "area", ["", ...AREA_VALUES] as const);
  const napa = choiceParam(params, "napa", ["", ...NAPA_VALUES] as const);
  const skill = choiceParam(params, "skill", ["", ...SKILLS.map((s) => s.label)] as const);
  const cv = choiceParam(params, "cv", ["", "yes", "no"] as const);
  const fast = choiceParam(params, "fast", ["", "yes", "no"] as const);
  const applied = choiceParam(params, "applied", ["", "yes", "no"] as const);
  const fromDay = params.get("from") ?? "";
  const toDay = params.get("to") ?? "";
  if (limit === null) return apiError(400, "invalid_parameter", `limit must be a whole number from 1 to ${API_LIMITS.maxPageSize}.`);
  if (page === null) return apiError(400, "invalid_parameter", `page must be a whole number from 1 to ${API_LIMITS.maxPage}.`);
  if (area === null || napa === null) return apiError(400, "invalid_parameter", "area must be 1–7 or unknown; napa a CBS sub-district code.");
  if (skill === null) return apiError(400, "invalid_parameter", "skill must be a skill name.");
  if (cv === null || fast === null || applied === null) return apiError(400, "invalid_parameter", "cv, fast and applied must be yes or no.");
  if ((fromDay && !isDay(fromDay)) || (toDay && !isDay(toDay))) return apiError(400, "invalid_parameter", "from and to must be dates: YYYY-MM-DD.");
  if (fromDay && toDay && fromDay > toDay) return apiError(400, "invalid_parameter", "from must not be after to.");

  const access = await peopleAccess(key, params, PATH, limit);
  if (access instanceof Response) return access;
  if (access.people) limit = access.take;

  const { rows, total } = await searchCandidates(
    { q: "", district: "", area, napa, skill, city: "", account: "", cv, fast, applied, fromDay, toDay },
    { page, pageSize: limit },
  );
  await countPeople(access, key, PATH, rows.length, url.search);
  return apiJson({ data: rows.map((r) => candidateJson(r, access.people)), page, limit, total, has_more: page * limit < total });
});

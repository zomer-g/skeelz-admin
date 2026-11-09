import { apiError, apiJson, withApiKey } from "@/lib/api/inbound";
import { countPeople, withPeople } from "@/lib/api/people";
import { applicationJson, statusHistory } from "@/lib/api/records";
import { searchApplications } from "@/lib/entities/applications";
import { isSfId } from "@/lib/entities/search";
import { loadSourcesFor, siteSourceJson } from "@/lib/metrics/attribution";

export const dynamic = "force-dynamic";

const PATH = "/api/v1/applications/{id}";

/** One application with its status history; the candidate's details only with include=people. */
export const GET = withApiKey(PATH, "records:read", async (req: Request, { params }: { params: Promise<{ id: string }> }, key) => {
  const { id } = await params;
  if (!isSfId(id)) return apiError(400, "invalid_id", "id must be a Salesforce id.");
  const url = new URL(req.url);
  return withPeople(key, url.searchParams, PATH, 1, async (access) => {
    const { rows } = await searchApplications({ q: "", status: "", paid: "", owner: "", fromDay: "", toDay: "", id }, { pageSize: 1 });
    const row = rows[0];
    if (!row) return apiError(404, "not_found", "No such application.");
    const sources = await loadSourcesFor([row.id]);
    const data = { ...applicationJson(row, access.people), site_source: siteSourceJson(sources.get(row.id)), status_history: await statusHistory(row.id) };
    await countPeople(access, key, PATH, 1, url.pathname, data);
    return apiJson({ data });
  });
});

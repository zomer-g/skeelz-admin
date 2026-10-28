import { apiError, apiJson, withApiKey } from "@/lib/api/inbound";
import { countPeople, peopleAccess } from "@/lib/api/people";
import { applicationJson, statusHistory } from "@/lib/api/records";
import { searchApplications } from "@/lib/entities/applications";
import { isSfId } from "@/lib/entities/search";

export const dynamic = "force-dynamic";

const PATH = "/api/v1/applications/{id}";

/** One application with its status history; the candidate's details only with include=people. */
export const GET = withApiKey(PATH, "records:read", async (req: Request, { params }: { params: Promise<{ id: string }> }, key) => {
  const { id } = await params;
  if (!isSfId(id)) return apiError(400, "invalid_id", "id must be a Salesforce id.");
  const url = new URL(req.url);
  const access = await peopleAccess(key, url.searchParams, PATH, 1);
  if (access instanceof Response) return access;

  const { rows } = await searchApplications({ q: "", status: "", paid: "", owner: "", fromDay: "", toDay: "", id }, { pageSize: 1 });
  const row = rows[0];
  if (!row) return apiError(404, "not_found", "No such application.");
  await countPeople(access, key, PATH, 1, url.pathname);
  return apiJson({ data: { ...applicationJson(row, access.people), status_history: await statusHistory(row.id) } });
});

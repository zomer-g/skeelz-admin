import { apiError, apiJson, withApiKey } from "@/lib/api/inbound";
import { staffEmployeeJson } from "@/lib/api/staff";

export const dynamic = "force-dynamic";

/** One employee's months and tasks (docs/staff.md): staff:read, and an issuer who is still a staff manager. */
export const GET = withApiKey("/api/v1/staff/employee", "staff:read", async (req: Request) => {
  const params = new URL(req.url).searchParams;
  const email = params.get("email") ?? "";
  if (!/^[^\s@]+@[^\s@]+$/.test(email.trim())) return apiError(400, "invalid_parameter", "email is required: the employee's email on the site.");
  const body = await staffEmployeeJson(email, params.get("month"));
  if (body === "bad_month") return apiError(400, "invalid_parameter", "month must be YYYY-MM.");
  if (body === "not_found") return apiError(404, "not_found", "No site user with that email.");
  return apiJson(body);
});

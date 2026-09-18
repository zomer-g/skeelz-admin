import { applicationCounts, jobJson } from "@/lib/api/data";
import { apiError, apiJson, withApiKey } from "@/lib/api/inbound";
import { addDays, israelDay } from "@/lib/dashboard/params";
import { isSfId } from "@/lib/entities/search";
import { loadJobGa, loadPosition, loadPositionsByJobKeys } from "@/lib/metrics/jobs";

export const dynamic = "force-dynamic";

const SITE_KEY = /^[0-9a-f]{24}$/i;

/** One job by Salesforce id or public site key, with its application counts and 30 days of site exposure. */
export const GET = withApiKey("/api/v1/jobs/{id}", "jobs:read", async (_req: Request, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params;
  let job;
  if (SITE_KEY.test(id)) job = (await loadPositionsByJobKeys([id.toLowerCase()]))[0] ?? null;
  else if (isSfId(id)) job = await loadPosition(id);
  else return apiError(400, "invalid_id", "id must be a Salesforce id or a 24-character site job key.");
  if (!job) return apiError(404, "not_found", "No such job.");

  const toDay = israelDay();
  const fromDay = addDays(toDay, -29);
  const [applications, ga] = await Promise.all([
    applicationCounts(job.id),
    job.siteJobKey ? loadJobGa(fromDay, toDay, job.siteJobKey) : Promise.resolve(null),
  ]);
  const exposure = job.siteJobKey ? ga?.get(job.siteJobKey) : undefined;

  return apiJson({
    data: {
      ...jobJson(job),
      applications,
      site_last_30_days: {
        from: fromDay,
        to: toDay,
        job_opens: exposure?.opens ?? 0,
        apply_clicks: exposure?.applyClicks ?? 0,
        apply_confirmations: exposure?.applyYes ?? 0,
        page_views: exposure?.pageViews ?? 0,
      },
    },
  });
});

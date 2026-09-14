import { googleConfigured, googleFetch } from "./auth";

/** Tag Manager API v2, read-only: the published (live) container version. */

export function gtmConfigured(): boolean {
  return Boolean(process.env.GTM_ACCOUNT_ID && process.env.GTM_CONTAINER_ID) && googleConfigured();
}

export interface GtmLiveVersion {
  containerVersionId?: string;
  name?: string;
  fingerprint?: string;
  tag?: { tagId: string; name: string; type: string; firingTriggerId?: string[]; parameter?: unknown[] }[];
  trigger?: { triggerId: string; name: string; type: string; filter?: unknown[]; customEventFilter?: unknown[] }[];
  variable?: { variableId: string; name: string; type: string }[];
}

export async function getLiveVersion(): Promise<GtmLiveVersion> {
  const account = process.env.GTM_ACCOUNT_ID;
  const container = process.env.GTM_CONTAINER_ID;
  if (!account || !container) throw new Error("GTM_ACCOUNT_ID / GTM_CONTAINER_ID are not set");
  // The API allows 0.25 requests per second per project; this is called at most a few times a day.
  return googleFetch<GtmLiveVersion>(
    `https://tagmanager.googleapis.com/tagmanager/v2/accounts/${encodeURIComponent(account)}/containers/${encodeURIComponent(container)}/versions:live`,
  );
}

/** Whether any published tag already sends a job_id parameter (docs/gtm-job-id.md). */
export function sendsJobId(version: GtmLiveVersion): boolean {
  return JSON.stringify(version.tag ?? []).includes("job_id") || JSON.stringify(version.variable ?? []).includes("job_id");
}

import { and, eq } from "drizzle-orm";
import { writeAudit } from "@/lib/audit";
import { getDb } from "@/lib/db/client";
import { campaignJobs, campaignSettings, smoovCampaigns } from "@/lib/db/schema";
import { isSfId } from "@/lib/entities/search";
import { loadPosition } from "@/lib/metrics/jobs";

/**
 * Editing a campaign's details and linked jobs: dashboard configuration, editors and admins
 * only. The callers check the role — the campaign page's server actions and the MCP tools —
 * and these functions validate, write and audit.
 */

export type EditResult = { ok: boolean; message: string };

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
// GA's campaign names are far shorter; the cap only keeps junk out of the tables.
const MAX_KEY = 500;
export const MAX_LABEL = 200;
// smoov_campaigns.id and campaign_settings.smoov_campaign_id are Postgres integers.
const MAX_SMOOV_ID = 2_147_483_647;
export const validCampaignKey = (key: string) => key.length > 0 && key.length <= MAX_KEY;

export async function saveCampaignSettings(
  actor: string,
  input: { key: string; label: string | null; smoov: string; sendDay: string },
): Promise<EditResult> {
  const { key, label } = input;
  const smoovRaw = input.smoov.trim();
  const sendDayRaw = input.sendDay.trim();
  if (!key) return { ok: false, message: "חסר מזהה קמפיין" };
  if (!validCampaignKey(key)) return { ok: false, message: "מזהה הקמפיין ארוך מדי" };
  if (label && label.length > MAX_LABEL) return { ok: false, message: `השם ארוך מדי (עד ${MAX_LABEL} תווים)` };

  const smoovCampaignId = smoovRaw ? Number(smoovRaw) : null;
  if (smoovRaw && (!Number.isInteger(smoovCampaignId) || smoovCampaignId! <= 0)) return { ok: false, message: "מזהה SMOOV חייב להיות מספר" };
  if (smoovCampaignId && smoovCampaignId > MAX_SMOOV_ID) return { ok: false, message: "מזהה SMOOV גדול מדי" };
  if (sendDayRaw && !DAY_RE.test(sendDayRaw)) return { ok: false, message: "תאריך שליחה לא תקין" };

  const values = { label, smoovCampaignId, sendDay: sendDayRaw || null, updatedBy: actor, updatedAt: new Date() };
  const db = getDb();
  await db.insert(campaignSettings).values({ campaignKey: key, ...values }).onConflictDoUpdate({ target: campaignSettings.campaignKey, set: values });
  if (smoovCampaignId) {
    // Track a new id so the SMOOV sync fetches its statistics. A known id is left alone:
    // whether a campaign an admin stopped tracking comes back is the admin's call.
    const [added] = await db
      .insert(smoovCampaigns)
      .values({ id: smoovCampaignId, label: label ?? key, addedBy: actor })
      .onConflictDoNothing()
      .returning({ id: smoovCampaigns.id });
    if (added) await writeAudit(actor, "smoov.campaign_added", String(smoovCampaignId), { label: label ?? key, campaignKey: key });
  }
  await writeAudit(actor, "campaign.updated", key, { label, smoovCampaignId, sendDay: sendDayRaw || null });
  return { ok: true, message: "נשמר" };
}

export async function linkCampaignJob(actor: string, key: string, jobId: string): Promise<EditResult> {
  if (!validCampaignKey(key)) return { ok: false, message: "מזהה קמפיין לא תקין" };
  if (!isSfId(jobId) || !(await loadPosition(jobId))) return { ok: false, message: "המשרה לא נמצאה" };
  await getDb().insert(campaignJobs).values({ campaignKey: key, jobCaseId: jobId, linkedBy: actor }).onConflictDoNothing();
  await writeAudit(actor, "campaign.job_linked", key, { jobId });
  return { ok: true, message: "המשרה קושרה" };
}

export async function unlinkCampaignJob(actor: string, key: string, jobId: string): Promise<EditResult> {
  if (!validCampaignKey(key) || !isSfId(jobId)) return { ok: false, message: "מזהה לא תקין" };
  await getDb().delete(campaignJobs).where(and(eq(campaignJobs.campaignKey, key), eq(campaignJobs.jobCaseId, jobId)));
  await writeAudit(actor, "campaign.job_unlinked", key, { jobId });
  return { ok: true, message: "הקישור הוסר" };
}

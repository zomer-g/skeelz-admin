"use server";

import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { writeAudit } from "@/lib/audit";
import { requireUser } from "@/lib/auth/session";
import { getDb } from "@/lib/db/client";
import { campaignJobs, campaignSettings, smoovCampaigns } from "@/lib/db/schema";
import { loadPosition, searchPositions } from "@/lib/metrics/jobs";

// Linking campaigns is dashboard configuration: editors and admins only.

export type FormState = { ok: boolean; message: string } | null;

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const pathFor = (key: string) => `/campaigns/${encodeURIComponent(key)}`;

export async function saveCampaign(_prev: FormState, form: FormData): Promise<FormState> {
  const editor = await requireUser("editor");
  const key = String(form.get("key") ?? "");
  const label = String(form.get("label") ?? "").trim() || null;
  const smoovRaw = String(form.get("smoovCampaignId") ?? "").trim();
  const sendDayRaw = String(form.get("sendDay") ?? "").trim();
  if (!key) return { ok: false, message: "חסר מזהה קמפיין" };

  const smoovCampaignId = smoovRaw ? Number(smoovRaw) : null;
  if (smoovRaw && (!Number.isInteger(smoovCampaignId) || smoovCampaignId! <= 0)) return { ok: false, message: "מזהה SMOOV חייב להיות מספר" };
  if (sendDayRaw && !DAY_RE.test(sendDayRaw)) return { ok: false, message: "תאריך שליחה לא תקין" };

  const values = { label, smoovCampaignId, sendDay: sendDayRaw || null, updatedBy: editor.email, updatedAt: new Date() };
  const db = getDb();
  await db.insert(campaignSettings).values({ campaignKey: key, ...values }).onConflictDoUpdate({ target: campaignSettings.campaignKey, set: values });
  if (smoovCampaignId) {
    // Track it so the SMOOV sync fetches its statistics.
    await db
      .insert(smoovCampaigns)
      .values({ id: smoovCampaignId, label: label ?? key, addedBy: editor.email })
      .onConflictDoUpdate({ target: smoovCampaigns.id, set: { active: true } });
  }
  await writeAudit(editor.email, "campaign.updated", key, { label, smoovCampaignId, sendDay: sendDayRaw || null });
  revalidatePath(pathFor(key));
  return { ok: true, message: "נשמר" };
}

export async function linkJob(form: FormData): Promise<void> {
  const editor = await requireUser("editor");
  const key = String(form.get("key") ?? "");
  const jobId = String(form.get("jobId") ?? "");
  if (!key || !(await loadPosition(jobId))) return;
  await getDb().insert(campaignJobs).values({ campaignKey: key, jobCaseId: jobId, linkedBy: editor.email }).onConflictDoNothing();
  await writeAudit(editor.email, "campaign.job_linked", key, { jobId });
  revalidatePath(pathFor(key));
}

export async function unlinkJob(form: FormData): Promise<void> {
  const editor = await requireUser("editor");
  const key = String(form.get("key") ?? "");
  const jobId = String(form.get("jobId") ?? "");
  await getDb().delete(campaignJobs).where(and(eq(campaignJobs.campaignKey, key), eq(campaignJobs.jobCaseId, jobId)));
  await writeAudit(editor.email, "campaign.job_unlinked", key, { jobId });
  revalidatePath(pathFor(key));
}

export async function findJobs(q: string): Promise<{ id: string; title: string | null; company: string | null; caseNumber: string | null; created: string | null }[]> {
  await requireUser("editor");
  if (q.trim().length < 2) return [];
  const positions = await searchPositions(q, 8);
  return positions.map((p) => ({
    id: p.id,
    title: p.title,
    company: p.company,
    caseNumber: p.caseNumber,
    created: p.createdAt ? p.createdAt.toISOString().slice(0, 10) : null,
  }));
}

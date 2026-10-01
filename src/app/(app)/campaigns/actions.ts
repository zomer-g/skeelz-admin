"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth/session";
import { linkCampaignJob, saveCampaignSettings, unlinkCampaignJob } from "@/lib/campaigns/edit";
import { searchPositions } from "@/lib/metrics/jobs";

// Linking campaigns is dashboard configuration: editors and admins only.

export type FormState = { ok: boolean; message: string } | null;

const pathFor = (key: string) => `/campaigns/${encodeURIComponent(key)}`;

export async function saveCampaign(_prev: FormState, form: FormData): Promise<FormState> {
  const editor = await requireUser("editor");
  const key = String(form.get("key") ?? "");
  const result = await saveCampaignSettings(editor.email, {
    key,
    label: String(form.get("label") ?? "").trim() || null,
    smoov: String(form.get("smoovCampaignId") ?? ""),
    sendDay: String(form.get("sendDay") ?? ""),
  });
  if (result.ok) revalidatePath(pathFor(key));
  return result;
}

export async function linkJob(form: FormData): Promise<void> {
  const editor = await requireUser("editor");
  const key = String(form.get("key") ?? "");
  const { ok } = await linkCampaignJob(editor.email, key, String(form.get("jobId") ?? ""));
  if (ok) revalidatePath(pathFor(key));
}

export async function unlinkJob(form: FormData): Promise<void> {
  const editor = await requireUser("editor");
  const key = String(form.get("key") ?? "");
  const { ok } = await unlinkCampaignJob(editor.email, key, String(form.get("jobId") ?? ""));
  if (ok) revalidatePath(pathFor(key));
}

export async function findJobs(
  q: string,
): Promise<{ id: string; title: string | null; company: string | null; caseNumber: string | null; created: string | null; paid: boolean }[]> {
  await requireUser("editor");
  if (q.trim().length < 2) return [];
  const positions = await searchPositions(q, 8);
  return positions.map((p) => ({
    id: p.id,
    title: p.title,
    company: p.company,
    caseNumber: p.caseNumber,
    created: p.createdAt ? p.createdAt.toISOString().slice(0, 10) : null,
    paid: p.paid,
  }));
}

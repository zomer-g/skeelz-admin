"use server";

import { writeAudit } from "@/lib/audit";
import { requireUser } from "@/lib/auth/session";
import { REPORT_EXPORTED } from "@/lib/export/audit";

/**
 * Logs a download made in the browser from a table or a chart on screen (whole filtered lists are
 * logged by their own route, /api/lists/[list]/export). Only tables and charts that carry no personal
 * data offer a download at all; this records who took what, as every other way data leaves the site.
 */
export async function logExport(entry: { screen: string; name: string; format: string; rows: number }): Promise<void> {
  const user = await requireUser("viewer");
  const clip = (v: unknown, n: number) => String(v ?? "").slice(0, n);
  await writeAudit(user.email, REPORT_EXPORTED, clip(entry.name, 200), {
    screen: clip(entry.screen, 300),
    format: clip(entry.format, 8),
    rows: Math.max(0, Math.min(1_000_000, Math.floor(Number(entry.rows) || 0))),
  });
}

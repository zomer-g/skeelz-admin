import { inArray } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { smoovCampaignStats } from "@/lib/db/schema";
import { isMailing, loadCampaignSummaries, type CampaignSummary } from "./campaigns";

/**
 * Campaigns as a funnel, for the applications tab: from how many people a message reached
 * (SMOOV) to what they did on the site (GA4, by the session's UTM campaign).
 *
 * The two sources count differently. SMOOV's figures are per send, whenever the opens and
 * clicks came; GA's are the sessions and events in the selected range only. A mailing sent
 * before the range shows its full send figures next to just the site visits inside the range.
 */

export interface CampaignFunnelRow extends CampaignSummary {
  mailing: boolean;
  /** SMOOV, per send. Null when no SMOOV campaign is linked or it has no statistics yet. */
  sent: number | null;
  mailOpens: number | null;
  mailClicks: number | null;
  sentAt: Date | null;
}

export const CAMPAIGN_STAGES = [
  { key: "sent", label: "נשלחו", source: "smoov" },
  { key: "mailOpens", label: "פתחו את ההודעה", source: "smoov" },
  { key: "mailClicks", label: "הקליקו על קישור", source: "smoov" },
  { key: "sessions", label: "כניסות לאתר", source: "ga" },
  { key: "opens", label: "פתיחות של דפי משרות", source: "ga" },
  { key: "applyClicks", label: 'לחיצות "הגש מועמדות"', source: "ga" },
  { key: "applyYes", label: "אישורי הגשה", source: "ga" },
] as const;

export type CampaignStage = (typeof CAMPAIGN_STAGES)[number]["key"];

export async function loadCampaignFunnel(fromDay: string, toDay: string): Promise<CampaignFunnelRow[]> {
  const summaries = await loadCampaignSummaries(fromDay, toDay);
  const ids = summaries.flatMap((c) => (c.smoovCampaignId ? [c.smoovCampaignId] : []));
  const stats = ids.length ? await getDb().select().from(smoovCampaignStats).where(inArray(smoovCampaignStats.campaignId, ids)) : [];
  const byId = new Map(stats.map((s) => [s.campaignId, s]));
  return summaries.map((c) => {
    const s = c.smoovCampaignId ? byId.get(c.smoovCampaignId) : undefined;
    return {
      ...c,
      mailing: isMailing(c),
      sent: s?.sent ?? null,
      mailOpens: s?.opens ?? null,
      mailClicks: s?.clicks ?? null,
      sentAt: s?.sentAt ?? null,
    };
  });
}

/** The stages of one row, or of the sum of several (SMOOV stages count only the rows that have them). */
export function campaignStageValues(rows: CampaignFunnelRow[]): Record<CampaignStage, number | null> {
  const sum = (pick: (r: CampaignFunnelRow) => number | null) => {
    const vals = rows.map(pick).filter((v): v is number => v != null);
    return vals.length ? vals.reduce((a, b) => a + b, 0) : null;
  };
  return {
    sent: sum((r) => r.sent),
    mailOpens: sum((r) => r.mailOpens),
    mailClicks: sum((r) => r.mailClicks),
    sessions: sum((r) => r.sessions),
    opens: sum((r) => r.opens),
    applyClicks: sum((r) => r.applyClicks),
    applyYes: sum((r) => r.applyYes),
  };
}

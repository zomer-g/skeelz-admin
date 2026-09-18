import { getDb } from "@/lib/db/client";
import { auditLog } from "@/lib/db/schema";
import { errorCode } from "@/lib/log";

/** A signed-in user opened a screen. Fire-and-forget: logging never slows a render. */
export function logPageView(actor: string, path: string): void {
  void writeAudit(actor, "page.view", path);
}

export async function writeAudit(
  actor: string,
  action: string,
  target?: string | null,
  details?: Record<string, unknown>,
): Promise<void> {
  try {
    await getDb().insert(auditLog).values({ actor, action, target: target ?? null, details: details ?? null });
  } catch (err) {
    // An audit write must never take down the operation it describes.
    console.error(`[audit] write failed: ${errorCode(err)}`, { action });
  }
}

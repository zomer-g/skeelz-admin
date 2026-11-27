import { and, eq } from "drizzle-orm";
import { cached } from "@/lib/cache";
import { getDb } from "@/lib/db/client";
import { sfPicklistValue } from "@/lib/db/schema";
import { logError } from "@/lib/log";
import { REJECT_REASON_FIELD, setRejectReasonDescribe } from "./reject-reasons";

const TTL_MS = 10 * 60_000;

/**
 * Loads `Field21__c`'s labels from the Case describe the sync keeps (`sf_picklist_value`) into
 * ./reject-reasons.ts. Every loader that shows reasons awaits it first. Cached; on a failure (or before the
 * first sync) the built-in labels stay in use.
 */
export async function ensureRejectReasonLabels(): Promise<void> {
  try {
    const labels = await cached(
      "reject-reason-labels",
      async () => {
        const rows = await getDb()
          .select({ value: sfPicklistValue.value, label: sfPicklistValue.label })
          .from(sfPicklistValue)
          .where(and(eq(sfPicklistValue.object, "Case"), eq(sfPicklistValue.field, REJECT_REASON_FIELD)));
        return Object.fromEntries(rows.map((r) => [r.value, r.label]));
      },
      TTL_MS,
    );
    setRejectReasonDescribe(labels);
  } catch (err) {
    logError("reject reason labels", err);
  }
}

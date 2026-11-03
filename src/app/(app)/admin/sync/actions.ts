"use server";

import { and, eq, isNull } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { writeAudit } from "@/lib/audit";
import { requireUser } from "@/lib/auth/session";
import { getDb } from "@/lib/db/client";
import { syncRequests } from "@/lib/db/schema";

/** What the source buttons queue: Salesforce updates or a full load, or one marketing source. */
const MODES = new Set(["incremental", "full", "marketing", "marketing:GA4", "marketing:GTM", "marketing:SMOOV"]);

/** Queues a run for the sync worker, which checks once a minute. */
export async function requestSync(form: FormData): Promise<void> {
  const admin = await requireUser("admin");
  const requested = String(form.get("mode") ?? "");
  const mode = MODES.has(requested) ? requested : "incremental";

  const db = getDb();
  const [pending] = await db
    .select({ id: syncRequests.id })
    .from(syncRequests)
    .where(and(isNull(syncRequests.pickedAt), eq(syncRequests.mode, mode)))
    .limit(1);
  if (!pending) {
    await db.insert(syncRequests).values({ mode, requestedBy: admin.email });
    await writeAudit(admin.email, "sync.requested", mode);
  }
  revalidatePath("/admin/sync");
}

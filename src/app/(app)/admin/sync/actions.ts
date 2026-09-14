"use server";

import { and, eq, isNull } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { writeAudit } from "@/lib/audit";
import { requireUser } from "@/lib/auth/session";
import { getDb } from "@/lib/db/client";
import { syncRequests } from "@/lib/db/schema";

/** Queues a run for the sync worker, which checks once a minute. */
export async function requestSync(form: FormData): Promise<void> {
  const admin = await requireUser("admin");
  const mode = form.get("mode") === "full" ? "full" : "incremental";

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

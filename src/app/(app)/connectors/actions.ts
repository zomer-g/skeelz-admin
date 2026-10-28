"use server";

import { and, eq, isNull } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { writeAudit } from "@/lib/audit";
import { hasRole } from "@/lib/auth/roles";
import { requireStaffManager, requireUser } from "@/lib/auth/session";
import { getDb } from "@/lib/db/client";
import { mcpGrants } from "@/lib/db/schema";
import { revokeGrant } from "@/lib/mcp/oauth";

const UUID_RE = /^[0-9a-f-]{36}$/i;

/** Disconnect an MCP connection: anyone their own, an admin anyone's. Takes effect on the next call. */
export async function disconnectGrant(form: FormData): Promise<void> {
  const user = await requireUser("viewer");
  const id = String(form.get("id") ?? "");
  if (!UUID_RE.test(id)) return;
  const [grant] = await getDb().select({ userId: mcpGrants.userId }).from(mcpGrants).where(eq(mcpGrants.id, id)).limit(1);
  if (!grant) return;
  if (grant.userId !== user.id && !hasRole(user.role, "admin")) return;
  const revoked = await revokeGrant(id, user.email);
  if (revoked) await writeAudit(user.email, "mcp.revoked", id, { own: grant.userId === user.id });
  revalidatePath("/connectors");
  revalidatePath("/admin/mcp");
}

/**
 * Turns the staff tools (hours and activity per employee, docs/staff.md) on or off for one of your own
 * connections. Only a staff manager, only their own connection; off again also when they stop being one,
 * since every MCP call checks the flag anew.
 */
export async function setGrantStaffData(form: FormData): Promise<void> {
  const user = await requireStaffManager();
  const id = String(form.get("id") ?? "");
  const on = form.get("on") === "true";
  if (!UUID_RE.test(id)) return;
  const [row] = await getDb()
    .update(mcpGrants)
    .set({ staffData: on })
    .where(and(eq(mcpGrants.id, id), eq(mcpGrants.userId, user.id), isNull(mcpGrants.revokedAt)))
    .returning({ id: mcpGrants.id });
  if (row) await writeAudit(user.email, on ? "mcp.staff_data_on" : "mcp.staff_data_off", id);
  revalidatePath("/connectors");
  revalidatePath("/admin/mcp");
}

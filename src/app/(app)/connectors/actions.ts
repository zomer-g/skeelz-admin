"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { writeAudit } from "@/lib/audit";
import { hasRole } from "@/lib/auth/roles";
import { requireUser } from "@/lib/auth/session";
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

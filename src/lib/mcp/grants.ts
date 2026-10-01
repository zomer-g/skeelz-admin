import { desc, eq } from "drizzle-orm";
import { isRole, type Role } from "@/lib/auth/roles";
import { envAdmins } from "@/lib/auth/session";
import { getDb } from "@/lib/db/client";
import { mcpClients, mcpGrants, users } from "@/lib/db/schema";
import { lowerRole } from "./oauth";

export interface GrantRow {
  id: string;
  userEmail: string;
  userName: string | null;
  clientName: string;
  maxRole: Role;
  /** What the connection can do right now; null when the person no longer has access. */
  effectiveRole: Role | null;
  createdAt: Date;
  lastUsedAt: Date | null;
  lastUsedIp: string | null;
  calls: number;
  /** The refresh token's end: after it the connection must be approved again. */
  expiresAt: Date;
  revokedAt: Date | null;
  revokedBy: string | null;
}

/** Connections, newest first: one person's, or everyone's for the admin screen. */
export async function listGrants(userId?: string): Promise<GrantRow[]> {
  const admins = envAdmins();
  const rows = await getDb()
    .select({ grant: mcpGrants, clientName: mcpClients.name, user: users })
    .from(mcpGrants)
    .innerJoin(mcpClients, eq(mcpClients.id, mcpGrants.clientId))
    .innerJoin(users, eq(users.id, mcpGrants.userId))
    .where(userId ? eq(mcpGrants.userId, userId) : undefined)
    .orderBy(desc(mcpGrants.createdAt))
    .limit(500);
  return rows.map(({ grant: g, clientName, user: u }) => {
    const envAdmin = admins.includes(u.email);
    const siteRole: Role | null = envAdmin ? "admin" : u.active ? u.role : null;
    const maxRole = isRole(g.maxRole) ? g.maxRole : "viewer";
    return {
      id: g.id,
      userEmail: u.email,
      userName: u.name,
      clientName,
      maxRole,
      effectiveRole: siteRole ? lowerRole(siteRole, maxRole) : null,
      createdAt: g.createdAt,
      lastUsedAt: g.lastUsedAt,
      lastUsedIp: g.lastUsedIp,
      calls: g.calls,
      expiresAt: g.refreshExpiresAt,
      revokedAt: g.revokedAt,
      revokedBy: g.revokedBy,
    };
  });
}

import { cache } from "react";
import { and, eq, gt, isNull, sql } from "drizzle-orm";
import { writeAudit } from "@/lib/audit";
import { getDb } from "@/lib/db/client";
import { accessRequests, invites, users } from "@/lib/db/schema";
import { readPreviewRole } from "./preview";
import { hasRole, type Role } from "./roles";
import { verifiedIdentity, type Identity } from "./xhost";

/**
 * Authentication is not authorisation: anyone can hold a Google account, so a
 * verified identity still needs one of three ways in — ADMIN_EMAILS, an active
 * user row, or an open invitation redeemed on first sign-in. Everything else is
 * refused and remembered as an access request.
 */

export interface SessionUser {
  id: string;
  email: string;
  name: string | null;
  picture: string | null;
  /** The effective role: what every page, action and API check uses. */
  role: Role;
  /** The role the user really holds; differs from `role` while an admin previews a lower one. */
  realRole: Role;
  previewing: boolean;
  /** Admin by ADMIN_EMAILS; the UI can't demote or deactivate these. */
  envAdmin: boolean;
}

export type Session =
  | { status: "anonymous" }
  | { status: "refused"; identity: Identity }
  | { status: "ok"; identity: Identity; user: SessionUser };

export function envAdmins(): string[] {
  return (process.env.ADMIN_EMAILS ?? "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
}

// cache() dedupes the verification and user lookup across one server render.
export const getSession = cache(async (): Promise<Session> => {
  const identity = await verifiedIdentity();
  if (!identity) return { status: "anonymous" };
  const user = await resolveUser(identity);
  if (!user) return { status: "refused", identity };
  // An admin previewing a lower role gets exactly that role everywhere.
  const preview = user.realRole === "admin" ? await readPreviewRole() : null;
  return { status: "ok", identity, user: preview ? { ...user, role: preview, previewing: true } : user };
});

async function resolveUser(identity: Identity): Promise<SessionUser | null> {
  const db = getDb();
  const email = identity.email;
  const isEnvAdmin = envAdmins().includes(email);

  let [row] = await db.select().from(users).where(eq(users.email, email)).limit(1);

  if (isEnvAdmin) {
    if (!row) {
      [row] = await db
        .insert(users)
        .values({ email, sub: identity.sub, name: identity.name, picture: identity.picture, role: "admin" })
        .onConflictDoNothing()
        .returning();
      if (row) await writeAudit(email, "user.bootstrap_admin", email);
      // Parallel first requests (a page and its prefetch) race here; the loser reads the winner's row.
      row ??= (await db.select().from(users).where(eq(users.email, email)).limit(1))[0];
    }
    if (row && (row.role !== "admin" || !row.active)) {
      // The configuration is the stronger statement; a row that disagrees is stale.
      [row] = await db.update(users).set({ role: "admin", active: true }).where(eq(users.id, row.id)).returning();
    }
  }

  if (!row) {
    const [invite] = await db
      .select()
      .from(invites)
      .where(
        and(eq(invites.email, email), isNull(invites.acceptedAt), isNull(invites.revokedAt), gt(invites.expiresAt, new Date())),
      )
      .limit(1);

    if (!invite) {
      await recordAccessRequest(identity);
      return null;
    }

    [row] = await db
      .insert(users)
      .values({ email, sub: identity.sub, name: identity.name, picture: identity.picture, role: invite.role })
      .onConflictDoNothing()
      .returning();
    // Two first requests racing: the loser reads the row the winner created.
    row ??= (await db.select().from(users).where(eq(users.email, email)).limit(1))[0];
    await db.update(invites).set({ acceptedAt: new Date() }).where(eq(invites.id, invite.id));
    await db.delete(accessRequests).where(eq(accessRequests.email, email));
    await writeAudit(email, "invite.accepted", email, { role: invite.role });
  }

  if (!row || !row.active) return null;

  // An email is bound to the Google account that first used it.
  if (row.sub && row.sub !== identity.sub && identity.sub !== "dev-local") {
    console.warn(`[auth] ${email} presented a different Google subject; refusing`);
    return null;
  }

  // Throttled: a write per request would be wasteful, a login per session is enough.
  const lastLogin = row.lastLoginAt?.getTime() ?? 0;
  if (!row.sub || Date.now() - lastLogin > 5 * 60_000) {
    await db
      .update(users)
      .set({
        lastLoginAt: new Date(),
        sub: row.sub ?? identity.sub,
        name: identity.name ?? row.name,
        picture: identity.picture ?? row.picture,
      })
      .where(eq(users.id, row.id));
    if (Date.now() - lastLogin > 6 * 3600_000) await writeAudit(email, "login", email);
  }

  return {
    id: row.id,
    email: row.email,
    name: identity.name ?? row.name,
    picture: identity.picture ?? row.picture,
    role: row.role,
    realRole: row.role,
    previewing: false,
    envAdmin: isEnvAdmin,
  };
}

// Anyone with a Google account can sign in and be refused; cap how many distinct
// refused emails are kept so that cannot grow the table without bound.
const MAX_ACCESS_REQUESTS = 1000;

async function recordAccessRequest(identity: Identity): Promise<void> {
  const db = getDb();
  const [existing] = await db
    .select({ email: accessRequests.email })
    .from(accessRequests)
    .where(eq(accessRequests.email, identity.email))
    .limit(1);
  if (!existing) {
    const [{ n }] = (await db.select({ n: sql<number>`count(*)::int` }).from(accessRequests)) as [{ n: number }];
    if (n >= MAX_ACCESS_REQUESTS) return;
  }
  await db
    .insert(accessRequests)
    .values({ email: identity.email, name: identity.name })
    .onConflictDoUpdate({
      target: accessRequests.email,
      set: {
        name: sql`coalesce(excluded.name, ${accessRequests.name})`,
        // Count distinct attempts, not every page load of one attempt.
        attempts: sql`${accessRequests.attempts} + case when ${accessRequests.lastAt} < now() - interval '10 minutes' then 1 else 0 end`,
        lastAt: sql`now()`,
      },
    });
}

export class AuthError extends Error {
  constructor(
    public readonly status: 401 | 403,
    message: string,
  ) {
    super(message);
  }
}

/** For server actions and route handlers: returns the user or throws AuthError. */
export async function requireUser(minimum: Role): Promise<SessionUser> {
  const session = await getSession();
  if (session.status === "anonymous") throw new AuthError(401, "יש להתחבר למערכת");
  if (session.status === "refused") throw new AuthError(403, `החשבון ${session.identity.email} אינו מורשה`);
  if (!hasRole(session.user.role, minimum)) throw new AuthError(403, "אין לך הרשאה לפעולה הזו");
  return session.user;
}

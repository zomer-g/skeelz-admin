"use server";

import { and, eq, isNull } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { writeAudit } from "@/lib/audit";
import { isRole } from "@/lib/auth/roles";
import { envAdmins, requireUser } from "@/lib/auth/session";
import { getDb } from "@/lib/db/client";
import { accessRequests, invites, users } from "@/lib/db/schema";

// Every action re-checks the caller: a server action is a public endpoint,
// whatever the page that renders its form happens to show.

export type ActionState = { ok: boolean; message: string } | null;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const INVITE_DAYS = 14;
const PATH = "/admin/users";

export async function inviteUser(_prev: ActionState, form: FormData): Promise<ActionState> {
  const admin = await requireUser("admin");
  const email = String(form.get("email") ?? "").trim().toLowerCase();
  const role = form.get("role");

  if (!EMAIL_RE.test(email)) return { ok: false, message: "כתובת האימייל אינה תקינה" };
  if (!isRole(role)) return { ok: false, message: "יש לבחור תפקיד" };

  const db = getDb();
  const [existing] = await db.select({ id: users.id }).from(users).where(eq(users.email, email)).limit(1);
  if (existing) return { ok: false, message: "המשתמש כבר קיים. אפשר לשנות את התפקיד שלו בטבלת המשתמשים" };

  // One open invitation per email: a new one replaces the old.
  await db
    .update(invites)
    .set({ revokedAt: new Date() })
    .where(and(eq(invites.email, email), isNull(invites.acceptedAt), isNull(invites.revokedAt)));
  await db.insert(invites).values({
    email,
    role,
    invitedBy: admin.email,
    expiresAt: new Date(Date.now() + INVITE_DAYS * 86_400_000),
  });
  await writeAudit(admin.email, "invite.created", email, { role });

  revalidatePath(PATH);
  return {
    ok: true,
    message: `ההזמנה ל-${email} נוצרה (בתוקף ${INVITE_DAYS} יום). היא תמומש כשהכתובת תתחבר לראשונה עם Google. לא נשלח מייל, צריך להעביר את כתובת המערכת.`,
  };
}

export async function changeRole(form: FormData): Promise<void> {
  const admin = await requireUser("admin");
  const id = String(form.get("id") ?? "");
  const role = form.get("role");
  if (!isRole(role)) throw new Error("invalid role");

  const target = await loadChangeableUser(id, admin.id);
  await getDb().update(users).set({ role }).where(eq(users.id, target.id));
  await writeAudit(admin.email, "user.role_changed", target.email, { from: target.role, to: role });
  revalidatePath(PATH);
}

export async function setActive(form: FormData): Promise<void> {
  const admin = await requireUser("admin");
  const id = String(form.get("id") ?? "");
  const active = form.get("active") === "true";

  const target = await loadChangeableUser(id, admin.id);
  await getDb().update(users).set({ active }).where(eq(users.id, target.id));
  await writeAudit(admin.email, active ? "user.reactivated" : "user.deactivated", target.email);
  revalidatePath(PATH);
}

export async function revokeInvite(form: FormData): Promise<void> {
  const admin = await requireUser("admin");
  const id = String(form.get("id") ?? "");
  const [invite] = await getDb()
    .update(invites)
    .set({ revokedAt: new Date() })
    .where(and(eq(invites.id, id), isNull(invites.acceptedAt), isNull(invites.revokedAt)))
    .returning();
  if (invite) await writeAudit(admin.email, "invite.revoked", invite.email);
  revalidatePath(PATH);
}

/** Approving a refused sign-in creates the user directly; their Google subject binds on next sign-in. */
export async function approveRequest(form: FormData): Promise<void> {
  const admin = await requireUser("admin");
  const email = String(form.get("email") ?? "").trim().toLowerCase();
  const role = form.get("role");
  if (!EMAIL_RE.test(email) || !isRole(role)) throw new Error("invalid request");

  const db = getDb();
  await db.insert(users).values({ email, role }).onConflictDoNothing();
  await db.delete(accessRequests).where(eq(accessRequests.email, email));
  await writeAudit(admin.email, "access_request.approved", email, { role });
  revalidatePath(PATH);
}

export async function dismissRequest(form: FormData): Promise<void> {
  const admin = await requireUser("admin");
  const email = String(form.get("email") ?? "").trim().toLowerCase();
  const [removed] = await getDb().delete(accessRequests).where(eq(accessRequests.email, email)).returning();
  if (removed) await writeAudit(admin.email, "access_request.dismissed", email);
  revalidatePath(PATH);
}

async function loadChangeableUser(id: string, selfId: string) {
  const [target] = await getDb().select().from(users).where(eq(users.id, id)).limit(1);
  if (!target) throw new Error("user not found");
  // Guard rails the UI also enforces: nobody locks themselves out, and
  // ADMIN_EMAILS stays authoritative (it would re-promote on next sign-in anyway).
  if (target.id === selfId) throw new Error("cannot change your own access");
  if (envAdmins().includes(target.email)) throw new Error("user is an admin by configuration");
  return target;
}

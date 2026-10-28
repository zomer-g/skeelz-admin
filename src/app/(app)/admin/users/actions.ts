"use server";

import { and, eq, isNull } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { writeAudit } from "@/lib/audit";
import { CATEGORY_LABELS, isCategory, roleAfter, roleFor } from "@/lib/auth/permissions";
import { AuthError, envAdmins, requireUser } from "@/lib/auth/session";
import { getDb, type Db } from "@/lib/db/client";
import { accessRequests, invites, sfUser, users } from "@/lib/db/schema";
import { isSfId } from "@/lib/entities/search";
import { confirmAccess } from "@/lib/security/reviews";

// Every action re-checks the caller: a server action is a public endpoint,
// whatever the page that renders its form happens to show.

export type ActionState = { ok: boolean; message: string } | null;

type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const UUID_RE = /^[0-9a-f-]{36}$/i;
const INVITE_DAYS = 14;
const PATH = "/admin/users";

/** The role from the edit/admin boxes of an invite or approval form. Staff manager is never granted this way. */
const roleFromForm = (form: FormData) => roleFor({ edit: form.get("edit") === "on", admin: form.get("admin") === "on" });

export async function inviteUser(_prev: ActionState, form: FormData): Promise<ActionState> {
  const admin = await requireUser("admin");
  const email = String(form.get("email") ?? "").trim().toLowerCase();
  const role = roleFromForm(form);

  if (!EMAIL_RE.test(email)) return { ok: false, message: "כתובת האימייל אינה תקינה" };

  const db = getDb();
  const [existing] = await db.select({ id: users.id }).from(users).where(eq(users.email, email)).limit(1);
  if (existing) return { ok: false, message: "המשתמש כבר קיים. אפשר לשנות את ההרשאות שלו בטבלת המשתמשים" };

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

/** The monthly review: an admin confirms one user's access and role (lib/security/reviews.ts). */
export async function confirmUserAccess(form: FormData): Promise<void> {
  const admin = await requireUser("admin");
  const id = String(form.get("id") ?? "");
  if (!UUID_RE.test(id)) throw new Error("invalid id");
  await confirmAccess(admin.email, id);
  revalidatePath(PATH);
}

/**
 * One permission box on or off. Edit and admin change the stored role and need an admin; staff
 * manager is a separate flag that only a current staff manager may grant or remove (docs/staff.md).
 */
export async function setCategory(form: FormData): Promise<void> {
  const admin = await requireUser("admin");
  const id = String(form.get("id") ?? "");
  const category = form.get("category");
  const on = form.get("on") === "true";
  if (!isCategory(category)) throw new Error("invalid category");

  const target = await loadChangeableUser(id, admin.id);

  if (category === "staff") {
    if (!admin.staffManager) throw new AuthError(403, "רק מנהל עובדים יכול להעניק או להסיר הרשאת מנהל עובדים");
    if (target.staffManager === on) return;
    await getDb().update(users).set({ staffManager: on }).where(eq(users.id, target.id));
    await writeAudit(admin.email, on ? "user.staff_granted" : "user.staff_revoked", target.email);
    revalidatePath(PATH);
    return;
  }

  const role = roleAfter(target.role, category, on);
  if (role === target.role) return;
  await getDb().transaction(async (tx) => {
    if (role !== "admin") await keepLastAdmin(tx, target.id);
    await tx.update(users).set({ role }).where(eq(users.id, target.id));
  });
  await writeAudit(admin.email, "user.role_changed", target.email, { from: target.role, to: role, box: CATEGORY_LABELS[category], on });
  revalidatePath(PATH);
}

/** Links a site user to their Salesforce User (or clears it), so their logged activity can be told apart. */
export async function linkSfUser(form: FormData): Promise<void> {
  const admin = await requireUser("admin");
  const id = String(form.get("id") ?? "");
  const sfUserId = String(form.get("sfUserId") ?? "").trim();
  if (!UUID_RE.test(id)) throw new Error("invalid id");
  if (sfUserId && !isSfId(sfUserId)) throw new Error("invalid Salesforce user");

  const db = getDb();
  const [target] = await db.select().from(users).where(eq(users.id, id)).limit(1);
  if (!target) throw new Error("user not found");
  if ((target.sfUserId ?? "") === sfUserId) return;
  if (sfUserId) {
    const [known] = await db.select({ id: sfUser.id }).from(sfUser).where(eq(sfUser.id, sfUserId)).limit(1);
    if (!known) throw new Error("unknown Salesforce user");
    // One site user per Salesforce user: someone else's activity must never become this person's.
    const [taken] = await db.select({ email: users.email }).from(users).where(eq(users.sfUserId, sfUserId)).limit(1);
    if (taken) throw new Error("Salesforce user already linked");
  }
  await db.update(users).set({ sfUserId: sfUserId || null }).where(eq(users.id, target.id));
  await writeAudit(admin.email, sfUserId ? "user.sf_linked" : "user.sf_unlinked", target.email, { from: target.sfUserId, to: sfUserId || null });
  revalidatePath(PATH);
}

export async function setActive(form: FormData): Promise<void> {
  const admin = await requireUser("admin");
  const id = String(form.get("id") ?? "");
  const active = form.get("active") === "true";

  const target = await loadChangeableUser(id, admin.id);
  await getDb().transaction(async (tx) => {
    if (!active) await keepLastAdmin(tx, target.id);
    await tx.update(users).set({ active }).where(eq(users.id, target.id));
  });
  await writeAudit(admin.email, active ? "user.reactivated" : "user.deactivated", target.email);
  revalidatePath(PATH);
}

export async function revokeInvite(form: FormData): Promise<void> {
  const admin = await requireUser("admin");
  const id = String(form.get("id") ?? "");
  if (!UUID_RE.test(id)) throw new Error("invalid id");
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
  const role = roleFromForm(form);
  if (!EMAIL_RE.test(email)) throw new Error("invalid request");

  const db = getDb();
  const [created] = await db.insert(users).values({ email, role }).onConflictDoNothing().returning({ id: users.id });
  await db.delete(accessRequests).where(eq(accessRequests.email, email));
  // An existing user keeps their role, so there is no approval to record.
  if (created) await writeAudit(admin.email, "access_request.approved", email, { role });
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
  if (!UUID_RE.test(id)) throw new Error("invalid id");
  const [target] = await getDb().select().from(users).where(eq(users.id, id)).limit(1);
  if (!target) throw new Error("user not found");
  // Guard rails the UI also enforces: nobody locks themselves out, and
  // ADMIN_EMAILS stays authoritative (it would re-promote on next sign-in anyway).
  if (target.id === selfId) throw new Error("cannot change your own access");
  if (envAdmins().includes(target.email)) throw new Error("user is an admin by configuration");
  return target;
}

/**
 * Refuses to demote or deactivate the last active admin. The admin rows are locked for the
 * transaction, so two admins removing each other at the same moment cannot both succeed.
 */
async function keepLastAdmin(tx: Tx, targetId: string): Promise<void> {
  const admins = await tx
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.role, "admin"), eq(users.active, true)))
    .for("update");
  if (admins.length <= 1 && admins.some((a) => a.id === targetId)) throw new Error("cannot remove the last active admin");
}

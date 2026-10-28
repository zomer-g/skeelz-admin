import type { Role } from "./roles";

/**
 * Permission categories as the users screen shows them: boxes an admin ticks for each person.
 *   view   צופה — everyone has it; not a box.
 *   edit   עורך — dashboard configuration (role "editor").
 *   admin  אדמין — users, integrations, sync (role "admin"; includes edit).
 *   staff  מנהל עובדים — the staff data (hours, activity per employee). Deliberately NOT part of
 *          the role ladder: admin does not include it, MCP and the API never carry it, a "view as"
 *          preview drops it, invitations cannot grant it, and only a staff manager can grant it.
 * Edit and admin still map onto the stored role (viewer < editor < admin), so every existing
 * `pageAuth(minRole)` / `requireUser(minRole)` check keeps its meaning. Rules: docs/staff.md.
 */

export const CATEGORIES = ["edit", "staff", "admin"] as const;
export type Category = (typeof CATEGORIES)[number];

export const CATEGORY_LABELS: Record<Category | "view", string> = {
  view: "צופה",
  edit: "עורך",
  staff: "מנהל עובדים",
  admin: "אדמין",
};

export const CATEGORY_HINTS: Record<Category | "view", string> = {
  view: "צפייה בדשבורדים וברשומות. לכל משתמש",
  edit: "גם עריכת הגדרות הדשבורד והקמפיינים",
  staff: "צפייה בנתוני העובדים: שעות עבודה ופעילות. נפרד מאדמין, ורק מנהל עובדים יכול להעניק אותו",
  admin: "גם ניהול משתמשים, חיבורים, מפתחות API וסנכרון. כולל עריכה",
};

export function isCategory(value: unknown): value is Category {
  return typeof value === "string" && (CATEGORIES as readonly string[]).includes(value);
}

/** The stored role for ticked edit/admin boxes. Admin includes editing. */
export function roleFor({ edit, admin }: { edit: boolean; admin: boolean }): Role {
  return admin ? "admin" : edit ? "editor" : "viewer";
}

/** Which boxes are on for a stored role and staff flag. */
export function categoriesOf(role: Role, staffManager: boolean): Record<Category, boolean> {
  return { edit: role !== "viewer", admin: role === "admin", staff: staffManager };
}

/**
 * The role after one box changes. Unticking admin goes all the way down to viewer: whoever
 * should still edit gets the edit box ticked again, on purpose, rather than keeping it silently.
 */
export function roleAfter(role: Role, category: "edit" | "admin", on: boolean): Role {
  if (category === "admin") return on ? "admin" : "viewer";
  // Edit cannot be removed while admin is on: admin includes it.
  if (role === "admin") return "admin";
  return on ? "editor" : "viewer";
}

/**
 * Whether a session may see staff data. Only a real, current staff manager: never while an admin
 * previews another role, whatever the stored flag says.
 */
export function effectiveStaffManager({ stored, envAdmin, previewing }: { stored: boolean; envAdmin: boolean; previewing: boolean }): boolean {
  if (previewing) return false;
  return stored || envAdmin;
}

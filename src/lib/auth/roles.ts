/**
 * Roles are ranked: each one can do everything the roles below it can.
 *   viewer — reads dashboards and records
 *   editor — also edits dashboard configuration (widgets, saved views, KPIs)
 *   admin  — also manages users, integrations and manual syncs
 */
export const ROLES = ["viewer", "editor", "admin"] as const;
export type Role = (typeof ROLES)[number];

const RANK: Record<Role, number> = { viewer: 0, editor: 1, admin: 2 };

export const ROLE_LABELS: Record<Role, string> = {
  viewer: "צופה",
  editor: "עורך דשבורד",
  admin: "אדמין",
};

export function isRole(value: unknown): value is Role {
  return typeof value === "string" && (ROLES as readonly string[]).includes(value);
}

export function hasRole(actual: Role, minimum: Role): boolean {
  return RANK[actual] >= RANK[minimum];
}

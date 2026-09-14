import { cookies } from "next/headers";
import type { Role } from "./roles";

/**
 * "View as": an admin can see the platform with a lower role to check what
 * editors and viewers get. The choice lives in a cookie, and it is honoured
 * only for users whose stored role is admin — for anyone else it is ignored, so
 * a forged cookie can at most lower a role, never raise one.
 */

export const PREVIEW_COOKIE = "skeelz_view_as";

export const PREVIEW_ROLES = ["editor", "viewer"] as const satisfies readonly Role[];
export type PreviewRole = (typeof PREVIEW_ROLES)[number];

export function isPreviewRole(value: unknown): value is PreviewRole {
  return typeof value === "string" && (PREVIEW_ROLES as readonly string[]).includes(value);
}

export async function readPreviewRole(): Promise<PreviewRole | null> {
  const value = (await cookies()).get(PREVIEW_COOKIE)?.value;
  return isPreviewRole(value) ? value : null;
}

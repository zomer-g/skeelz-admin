"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { writeAudit } from "@/lib/audit";
import { isPreviewRole, PREVIEW_COOKIE } from "@/lib/auth/preview";
import { AuthError, getSession } from "@/lib/auth/session";

/**
 * Starts, changes or ends "view as". Checked against the real role, not the
 * effective one — otherwise an admin previewing "viewer" could never get back.
 * Any value that is not a lower role ends the preview.
 */
export async function setPreviewRole(form: FormData): Promise<void> {
  const session = await getSession();
  if (session.status !== "ok" || session.user.realRole !== "admin") {
    throw new AuthError(403, "רק אדמין יכול לצפות במערכת בהרשאה אחרת");
  }

  const role = form.get("role");
  const jar = await cookies();
  if (isPreviewRole(role)) {
    jar.set(PREVIEW_COOKIE, role, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: 8 * 3600,
    });
    await writeAudit(session.user.email, "preview.started", role);
  } else {
    jar.delete(PREVIEW_COOKIE);
    if (session.user.previewing) await writeAudit(session.user.email, "preview.ended", session.user.role);
  }
  revalidatePath("/", "layout");
}

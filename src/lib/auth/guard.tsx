import type { ReactNode } from "react";
import { Forbidden } from "@/components/Forbidden";
import { firstInWindow } from "@/lib/api/rate-limit";
import { logPageView, writeAudit } from "@/lib/audit";
import { SignInScreen } from "@/components/SignInScreen";
import { hasRole, type Role } from "./roles";
import { getSession, type SessionUser } from "./session";

export type PageAuth = { ok: true; user: SessionUser } | { ok: false; render: ReactNode };

/**
 * Every page checks for itself rather than trusting the layout: layouts are not
 * re-rendered on client navigation, so a check that lives only there can be
 * skipped. Anonymous visitors get the sign-in screen with a 200, which also
 * keeps xhostd's readiness probe on GET / green.
 *
 * Every permitted view is written to the activity log; `returnTo` is the path
 * that gets logged, so pages include the query string that shapes what they show.
 */
export async function pageAuth(minimum: Role, returnTo: string): Promise<PageAuth> {
  const auth = await checkPage(minimum, returnTo);
  if (auth.ok) logPageView(auth.user.email, returnTo);
  return auth;
}

/**
 * For pages that show staff data: only a current staff manager (never during a "view as"
 * preview), whatever the role. Others get the same refusal as a missing role, which names no data.
 * The view is logged only once every check passed; a refusal is a page.denied entry.
 */
export async function pageAuthStaff(returnTo: string): Promise<PageAuth> {
  const auth = await checkPage("viewer", returnTo);
  if (!auth.ok) return auth;
  if (!auth.user.staffManager) {
    logPageDenied(auth.user.email, returnTo, "staff");
    return { ok: false, render: <Forbidden email={auth.user.email} reason="staff" /> };
  }
  logPageView(auth.user.email, returnTo);
  return auth;
}

/** The checks, without the view entry. A signed-in person refused for their role is logged as page.denied. */
async function checkPage(minimum: Role, returnTo: string): Promise<PageAuth> {
  const session = await getSession();
  if (session.status === "anonymous") {
    return { ok: false, render: <SignInScreen returnTo={returnTo} /> };
  }
  if (session.status === "refused") {
    return { ok: false, render: <Forbidden email={session.identity.email} reason="not_invited" /> };
  }
  if (!hasRole(session.user.role, minimum)) {
    logPageDenied(session.user.email, returnTo, "role");
    return { ok: false, render: <Forbidden email={session.user.email} reason="role" required={minimum} /> };
  }
  return { ok: true, user: session.user };
}

/** A refused screen, once per person, path and ten minutes (a reload loop must not flood the log). */
function logPageDenied(actor: string, path: string, reason: "role" | "staff"): void {
  if (firstInWindow(`page-denied:${actor}:${path}`, 10 * 60_000)) void writeAudit(actor, "page.denied", path, { reason });
}

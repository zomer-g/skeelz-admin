import type { ReactNode } from "react";
import { Forbidden } from "@/components/Forbidden";
import { logPageView } from "@/lib/audit";
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
  const session = await getSession();
  if (session.status === "anonymous") {
    return { ok: false, render: <SignInScreen returnTo={returnTo} /> };
  }
  if (session.status === "refused") {
    return { ok: false, render: <Forbidden email={session.identity.email} reason="not_invited" /> };
  }
  if (!hasRole(session.user.role, minimum)) {
    return { ok: false, render: <Forbidden email={session.user.email} reason="role" required={minimum} /> };
  }
  logPageView(session.user.email, returnTo);
  return { ok: true, user: session.user };
}

import { NextResponse, type NextRequest } from "next/server";
import { loginUrl, XHOST_COOKIE } from "@/lib/auth/urls";

/**
 * A cheap first gate for the API only: no identity cookie at all means 401
 * without running a handler. It does not verify the token — handlers do that
 * via requireUser() / getSession().
 *
 * Pages are not redirected here. A proxy redirect needs an absolute URL, and
 * behind xhostd's proxy the server does not reliably know its public host (a
 * relative Location throws "Invalid URL"). Pages render the sign-in screen
 * themselves instead — see lib/auth/guard.tsx.
 */
export function proxy(req: NextRequest) {
  if (process.env.NODE_ENV === "development" && process.env.DEV_AUTH_EMAIL) return NextResponse.next();
  if (req.cookies.has(XHOST_COOKIE)) return NextResponse.next();
  return NextResponse.json({ error: "unauthorized", login_url: loginUrl("/") }, { status: 401 });
}

export const config = {
  // Every API route except the unauthenticated health check.
  matcher: ["/api/((?!health$).*)"],
};

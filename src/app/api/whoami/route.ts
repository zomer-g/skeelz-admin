import { getSession } from "@/lib/auth/session";
import { loginUrl, logoutUrl } from "@/lib/auth/urls";

export const dynamic = "force-dynamic";

export async function GET() {
  const session = await getSession();

  if (session.status === "anonymous") {
    return Response.json({ error: "unauthorized", login_url: loginUrl("/") }, { status: 401 });
  }
  if (session.status === "refused") {
    return Response.json(
      { error: "not_invited", email: session.identity.email, logout_url: logoutUrl("/") },
      { status: 403 },
    );
  }

  const { email, name, role } = session.user;
  return Response.json({ email, name, role, logout_url: logoutUrl("/") });
}

import { AuthError, requireUser } from "@/lib/auth/session";
import { parseSubscription, saveSubscription } from "@/lib/push/subscriptions";
import { pushConfigured } from "@/lib/push/webpush";

export const dynamic = "force-dynamic";

/**
 * Turns push notices on for this browser (docs/pwa.md). Any signed-in user may subscribe; what is
 * sent to them is decided by their role when each notice goes out (lib/push/send.ts). Only
 * endpoints on the known push services are accepted, so the server never posts to an arbitrary URL.
 */
export async function POST(request: Request) {
  let user;
  try {
    user = await requireUser("viewer");
  } catch (err) {
    if (err instanceof AuthError) return new Response(err.message, { status: err.status });
    throw err;
  }
  if (!pushConfigured()) return Response.json({ error: "push_off" }, { status: 404 });
  const sub = parseSubscription(await request.json().catch(() => null));
  if (!sub) return Response.json({ error: "bad_subscription" }, { status: 400 });
  await saveSubscription(user, sub, request.headers.get("user-agent"));
  return Response.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
}

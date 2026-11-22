import { AuthError, requireUser } from "@/lib/auth/session";
import { deleteSubscription } from "@/lib/push/subscriptions";

export const dynamic = "force-dynamic";

/** Turns push notices off for this browser: the subscription row is deleted (docs/pwa.md). */
export async function POST(request: Request) {
  let user;
  try {
    user = await requireUser("viewer");
  } catch (err) {
    if (err instanceof AuthError) return new Response(err.message, { status: err.status });
    throw err;
  }
  const body = (await request.json().catch(() => null)) as { endpoint?: unknown } | null;
  if (typeof body?.endpoint !== "string" || body.endpoint.length > 1024) return Response.json({ error: "bad_request" }, { status: 400 });
  const removed = await deleteSubscription(user, body.endpoint);
  return Response.json({ ok: true, removed }, { headers: { "Cache-Control": "no-store" } });
}

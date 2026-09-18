import { apiJson, withApiKey } from "@/lib/api/inbound";
import { APP } from "@/lib/api/spec";
import { appVersion } from "@/lib/connect/version";

export const dynamic = "force-dynamic";

/** Any valid key: who we are, and what the caller's key may do here. The "בדיקת חיבור" of the other apps calls this. */
export const GET = withApiKey("/api/v1/ping", "any", async (_req: Request, _ctx: unknown, key) =>
  apiJson({ app: APP, version: appVersion(), time: new Date().toISOString(), key: { name: key.name, scopes: key.scopes } }),
);

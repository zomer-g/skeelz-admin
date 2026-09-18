import { sql } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { logError } from "@/lib/log";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await getDb().execute(sql`select 1`);
    return Response.json({ ok: true, db: true });
  } catch (err) {
    logError("health", err);
    return Response.json({ ok: false, db: false }, { status: 503 });
  }
}

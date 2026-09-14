import { sql } from "drizzle-orm";
import { getDb } from "@/lib/db/client";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await getDb().execute(sql`select 1`);
    return Response.json({ ok: true, db: true });
  } catch (err) {
    console.error("[health] database check failed:", (err as Error).message);
    return Response.json({ ok: false, db: false }, { status: 503 });
  }
}

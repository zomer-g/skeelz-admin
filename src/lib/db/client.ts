import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema";

export type Db = NodePgDatabase<typeof schema>;

// One pool per process; kept on globalThis so `next dev` reloads don't leak pools.
const g = globalThis as unknown as { __skeelzDb?: Db; __skeelzPool?: Pool };

/** Created lazily: the build imports this module but must never connect. */
export function getPool(): Pool {
  if (!g.__skeelzPool) {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error("DATABASE_URL is not set");
    g.__skeelzPool = new Pool({ connectionString: url, max: 5, idleTimeoutMillis: 30_000 });
    g.__skeelzPool.on("error", (err) => console.error("[db] idle client error:", err.message));
  }
  return g.__skeelzPool;
}

export function getDb(): Db {
  g.__skeelzDb ??= drizzle(getPool(), { schema });
  return g.__skeelzDb;
}

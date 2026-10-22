/**
 * Applies the SQL migrations in ./drizzle. Run at boot by launch.sh and locally
 * with `npm run db:migrate`. Migrations are generated from src/lib/db/schema.ts
 * with `npm run db:generate` and committed.
 */
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";
import { errorCode } from "../src/lib/log";

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");

  const pool = new Pool({ connectionString: url, max: 1 });
  try {
    const started = Date.now();
    await migrate(drizzle(pool), { migrationsFolder: "drizzle" });
    console.log(`[migrate] up to date in ${Date.now() - started}ms`);
  } finally {
    await pool.end();
  }
}

main().catch((err: unknown) => {
  // Only a code: a database error's message carries the SQL and its values.
  console.error(`[migrate] FAILED: ${errorCode(err)}`);
  process.exit(1);
});

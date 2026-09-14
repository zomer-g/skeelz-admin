import { defineConfig } from "drizzle-kit";

// `generate` needs no database; the URL only matters for `drizzle-kit studio`/`push`.
export default defineConfig({
  dialect: "postgresql",
  schema: "./src/lib/db/schema.ts",
  out: "./drizzle",
  dbCredentials: { url: process.env.DATABASE_URL ?? "postgresql://localhost:5432/skeelz" },
});

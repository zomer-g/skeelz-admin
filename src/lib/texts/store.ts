import { desc, eq } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { siteTexts, siteTextVersions } from "@/lib/db/schema";
import { findText } from "./registry";

export interface StoredText {
  body: string;
  updatedAt: Date | null;
  updatedBy: string | null;
}

/**
 * The current text for a page: the latest saved version, or the built-in text
 * until someone edits it. Public pages must render even if the database is
 * unreachable, so a failed read falls back to the built-in text.
 */
export async function loadText(key: string): Promise<StoredText> {
  const def = findText(key);
  if (!def) throw new Error(`unknown text: ${key}`);
  try {
    const [row] = await getDb().select().from(siteTexts).where(eq(siteTexts.key, key)).limit(1);
    if (row) return { body: row.body, updatedAt: row.updatedAt, updatedBy: row.updatedBy };
  } catch (err) {
    console.error(`[texts] showing the built-in "${key}" text:`, (err as Error).message);
  }
  return { body: def.defaultBody, updatedAt: null, updatedBy: null };
}

export async function loadSavedTexts() {
  return getDb().select({ key: siteTexts.key, updatedAt: siteTexts.updatedAt, updatedBy: siteTexts.updatedBy }).from(siteTexts);
}

export async function loadVersions(key: string, limit = 20) {
  return getDb()
    .select({ id: siteTextVersions.id, savedBy: siteTextVersions.savedBy, savedAt: siteTextVersions.savedAt, length: siteTextVersions.body })
    .from(siteTextVersions)
    .where(eq(siteTextVersions.key, key))
    .orderBy(desc(siteTextVersions.id))
    .limit(limit)
    .then((rows) => rows.map((r) => ({ ...r, length: r.length.length })));
}

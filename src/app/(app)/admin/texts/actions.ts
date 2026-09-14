"use server";

import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { writeAudit } from "@/lib/audit";
import { requireUser } from "@/lib/auth/session";
import { getDb } from "@/lib/db/client";
import { siteTexts, siteTextVersions } from "@/lib/db/schema";
import { findText, MAX_TEXT_LENGTH, ORIGINAL_AUTHOR, type EditableText } from "@/lib/texts/registry";

// Every action re-checks the caller: a server action is a public endpoint.

export type TextActionState = { ok: boolean; message: string } | null;

/**
 * Stores `body` as the text's newest version and makes it current. The first
 * edit also preserves the built-in text as a version, so it can be restored.
 * Returns false when nothing changed.
 */
async function store(text: EditableText, body: string, actor: string): Promise<boolean> {
  return getDb().transaction(async (tx) => {
    const [current] = await tx.select().from(siteTexts).where(eq(siteTexts.key, text.key)).limit(1);
    if ((current?.body ?? text.defaultBody) === body) return false;
    if (!current) await tx.insert(siteTextVersions).values({ key: text.key, body: text.defaultBody, savedBy: ORIGINAL_AUTHOR });
    await tx.insert(siteTextVersions).values({ key: text.key, body, savedBy: actor });
    const now = new Date();
    await tx
      .insert(siteTexts)
      .values({ key: text.key, body, updatedBy: actor, updatedAt: now })
      .onConflictDoUpdate({ target: siteTexts.key, set: { body, updatedBy: actor, updatedAt: now } });
    return true;
  });
}

function refresh(text: EditableText) {
  revalidatePath(text.path);
  revalidatePath("/admin/texts");
  revalidatePath(`/admin/texts/${text.key}`);
}

export async function saveText(_prev: TextActionState, form: FormData): Promise<TextActionState> {
  const admin = await requireUser("admin");
  const text = findText(String(form.get("key") ?? ""));
  if (!text) return { ok: false, message: "הטקסט לא מוכר" };

  const body = String(form.get("body") ?? "")
    .replace(/\r\n?/g, "\n")
    .trim();
  if (!body) return { ok: false, message: "הטקסט ריק. כדי לחזור לנוסח קודם, אפשר לשחזר גרסה מהרשימה." };
  if (body.length > MAX_TEXT_LENGTH) return { ok: false, message: `הטקסט ארוך מדי (עד ${MAX_TEXT_LENGTH.toLocaleString("he-IL")} תווים)` };

  const changed = await store(text, body, admin.email);
  if (!changed) return { ok: true, message: "אין שינויים לשמירה" };
  await writeAudit(admin.email, "text.updated", text.key, { length: body.length });
  refresh(text);
  return { ok: true, message: `נשמר. ${text.title} מציגה עכשיו את הנוסח החדש.` };
}

export async function restoreVersion(form: FormData): Promise<void> {
  const admin = await requireUser("admin");
  const text = findText(String(form.get("key") ?? ""));
  const id = Number(form.get("versionId"));
  if (!text || !Number.isSafeInteger(id) || id <= 0) throw new Error("invalid version");

  const [version] = await getDb()
    .select()
    .from(siteTextVersions)
    .where(and(eq(siteTextVersions.id, id), eq(siteTextVersions.key, text.key)))
    .limit(1);
  if (!version) throw new Error("version not found");

  if (await store(text, version.body, admin.email)) {
    await writeAudit(admin.email, "text.restored", text.key, { versionId: id });
    refresh(text);
  }
}

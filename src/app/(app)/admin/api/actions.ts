"use server";

import { and, eq, isNull } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { generateKey } from "@/lib/api/keys";
import { isApiScope, KEY_EXPIRY_DAYS } from "@/lib/api/spec";
import { writeAudit } from "@/lib/audit";
import { requireUser } from "@/lib/auth/session";
import { getDb } from "@/lib/db/client";
import { apiKeys } from "@/lib/db/schema";

// Every action re-checks the caller: a server action is a public endpoint.

/** `key` is the new key in full, returned this once and never again. */
export type CreateKeyState = { ok: boolean; message: string; key?: string } | null;

const PATH = "/admin/api";
const UUID_RE = /^[0-9a-f-]{36}$/i;

export async function createApiKey(_prev: CreateKeyState, form: FormData): Promise<CreateKeyState> {
  const admin = await requireUser("admin");
  const name = String(form.get("name") ?? "").trim();
  const scopes = [...new Set(form.getAll("scopes"))];
  const expiry = String(form.get("expires") ?? "");

  if (!name || name.length > 100) return { ok: false, message: "יש לתת למפתח שם (עד 100 תווים): למי הוא מיועד" };
  if (!scopes.length || !scopes.every(isApiScope)) return { ok: false, message: "יש לבחור לפחות הרשאה אחת" };
  const days = expiry === "" ? null : Number(expiry);
  if (days !== null && !(KEY_EXPIRY_DAYS as readonly number[]).includes(days)) return { ok: false, message: "תוקף לא תקין" };

  const { key, prefix, hash } = generateKey();
  const expiresAt = days ? new Date(Date.now() + days * 86_400_000) : null;
  const [row] = await getDb()
    .insert(apiKeys)
    .values({ name, prefix, hash, scopes: scopes as string[], createdBy: admin.email, expiresAt })
    .returning({ id: apiKeys.id });
  await writeAudit(admin.email, "api_key.created", row!.id, { name, prefix, scopes, expiresAt: expiresAt?.toISOString() ?? null });

  revalidatePath(PATH);
  return { ok: true, message: `המפתח "${name}" נוצר. זו הפעם היחידה שהוא מוצג: יש להעתיק אותו עכשיו.`, key };
}

export async function revokeApiKey(form: FormData): Promise<void> {
  const admin = await requireUser("admin");
  const id = String(form.get("id") ?? "");
  if (!UUID_RE.test(id)) return;
  const [row] = await getDb()
    .update(apiKeys)
    .set({ revokedAt: new Date() })
    .where(and(eq(apiKeys.id, id), isNull(apiKeys.revokedAt)))
    .returning({ name: apiKeys.name, prefix: apiKeys.prefix });
  if (row) await writeAudit(admin.email, "api_key.revoked", id, { name: row.name, prefix: row.prefix });
  revalidatePath(PATH);
}

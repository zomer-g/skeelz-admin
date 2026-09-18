import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { eq } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { apiKeys } from "@/lib/db/schema";
import { firstInWindow } from "./rate-limit";
import { CONNECT_LIMITS, KEY_PREFIX, KEY_RANDOM_BYTES, KEY_SHOWN_CHARS, LEGACY_KEYS, type ApiScope } from "./spec";
import { matchesToken, sharedToken } from "./tokens";

/**
 * API keys (docs/connect-api.md §1). A key is `sk_admin_` + 43 base64url characters,
 * shown once when it is issued; the database keeps only its sha256. The shared env
 * tokens from before keep working as legacy keys with fixed scopes.
 */

export interface ApiKeyIdentity {
  /** The row id, or `env:<NAME>` for a legacy key. Rate limits count per id. */
  id: string;
  name: string;
  scopes: string[];
  legacy: boolean;
}

export const hashKey = (key: string) => createHash("sha256").update(key).digest("hex");

/** A new key and what gets stored about it. The key itself is returned to be shown once, never stored. */
export function generateKey(): { key: string; prefix: string; hash: string } {
  const key = KEY_PREFIX + randomBytes(KEY_RANDOM_BYTES).toString("base64url");
  return { key, prefix: key.slice(KEY_PREFIX.length, KEY_PREFIX.length + KEY_SHOWN_CHARS), hash: hashKey(key) };
}

/** The env tokens that are set (and long enough), each as a legacy key. */
export function legacyKeys(): { env: string; token: string; scopes: ApiScope[] }[] {
  return LEGACY_KEYS.flatMap((k) => {
    const token = sharedToken(k.env);
    return token ? [{ env: k.env, token, scopes: k.scopes }] : [];
  });
}

export const legacyKeyName = (env: string) => `${env} (env)`;

/** The key a presented bearer value belongs to, or null when it is unknown, revoked or expired. */
export async function verifyKey(presented: string): Promise<ApiKeyIdentity | null> {
  // Every legacy token is compared, in constant time, whichever the value looks like.
  let legacy: ApiKeyIdentity | null = null;
  for (const k of legacyKeys()) {
    if (matchesToken(presented, [k.token]) && !legacy) legacy = { id: `env:${k.env}`, name: legacyKeyName(k.env), scopes: k.scopes, legacy: true };
  }
  if (legacy) return legacy;
  if (!presented.startsWith(KEY_PREFIX)) return null;

  const hash = hashKey(presented);
  const [row] = await getDb().select().from(apiKeys).where(eq(apiKeys.hash, hash)).limit(1);
  if (!row || !timingSafeEqual(Buffer.from(row.hash, "hex"), Buffer.from(hash, "hex"))) return null;
  if (row.revokedAt) return null;
  if (row.expiresAt && row.expiresAt.getTime() <= Date.now()) return null;
  return { id: row.id, name: row.name, scopes: row.scopes, legacy: false };
}

/** Records when and from where a key was last used, at most once a minute per key. */
export function touchKey(key: ApiKeyIdentity, ip: string): void {
  if (key.legacy || !firstInWindow(`touch:${key.id}`, CONNECT_LIMITS.lastUsedEveryMin * 60_000)) return;
  void getDb()
    .update(apiKeys)
    .set({ lastUsedAt: new Date(), lastUsedIp: ip })
    .where(eq(apiKeys.id, key.id))
    .catch((err: Error) => console.error("[api] last_used update failed:", err.message));
}

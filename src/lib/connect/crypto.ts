import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

/**
 * The keys other apps issued to us are stored encrypted (docs/connect-api.md §2):
 * AES-256-GCM under CONNECT_SECRET_KEY (64 hex = 32 bytes, an xhostd secret),
 * as `v1:<iv b64url>:<tag b64url>:<ciphertext b64url>`.
 */

const VERSION = "v1";

function secretKey(): Buffer | null {
  const hex = process.env.CONNECT_SECRET_KEY?.trim();
  return hex && /^[0-9a-f]{64}$/i.test(hex) ? Buffer.from(hex, "hex") : null;
}

export const connectSecretConfigured = () => secretKey() !== null;

export function encryptSecret(plain: string): string {
  const key = secretKey();
  if (!key) throw new Error("CONNECT_SECRET_KEY is not set (64 hex characters)");
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ct = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return [VERSION, iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), ct.toString("base64url")].join(":");
}

export function decryptSecret(stored: string): string {
  const key = secretKey();
  if (!key) throw new Error("CONNECT_SECRET_KEY is not set (64 hex characters)");
  const [version, iv, tag, ct] = stored.split(":");
  if (version !== VERSION || !iv || !tag || !ct) throw new Error("Unknown ciphertext format");
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(iv, "base64url"));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(ct, "base64url")), decipher.final()]).toString("utf8");
}

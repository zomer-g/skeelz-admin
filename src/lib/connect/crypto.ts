import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

/**
 * The keys other apps issued to us are stored encrypted (docs/connect-api.md §2):
 * AES-256-GCM under CONNECT_SECRET_KEY (64 hex = 32 bytes, an xhostd secret),
 * as `v2:<iv b64url>:<tag b64url>:<ciphertext b64url>`. The peer's name is the
 * additional authenticated data, so a ciphertext copied to another peer's row fails.
 * `v1` (no AAD) is refused: that key has to be entered again.
 */

const VERSION = "v2";
const IV_BYTES = 12;
const TAG_BYTES = 16;

function secretKey(): Buffer | null {
  const hex = process.env.CONNECT_SECRET_KEY?.trim();
  return hex && /^[0-9a-f]{64}$/i.test(hex) ? Buffer.from(hex, "hex") : null;
}

export const connectSecretConfigured = () => secretKey() !== null;

function requireKey(): Buffer {
  const key = secretKey();
  if (!key) throw new Error("CONNECT_SECRET_KEY is not set (64 hex characters)");
  return key;
}

export function encryptSecret(plain: string, peer: string): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", requireKey(), iv, { authTagLength: TAG_BYTES });
  cipher.setAAD(Buffer.from(peer, "utf8"));
  const ct = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return [VERSION, iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), ct.toString("base64url")].join(":");
}

export function decryptSecret(stored: string, peer: string): string {
  const key = requireKey();
  const parts = stored.split(":");
  if (parts.length !== 4 || parts[0] !== VERSION) throw new Error("Unknown ciphertext format");
  const iv = Buffer.from(parts[1]!, "base64url");
  const tag = Buffer.from(parts[2]!, "base64url");
  const ct = Buffer.from(parts[3]!, "base64url");
  if (iv.length !== IV_BYTES || tag.length !== TAG_BYTES) throw new Error("Malformed ciphertext");
  const decipher = createDecipheriv("aes-256-gcm", key, iv, { authTagLength: TAG_BYTES });
  decipher.setAAD(Buffer.from(peer, "utf8"));
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ct), decipher.final()]).toString("utf8");
}

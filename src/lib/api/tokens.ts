import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { MIN_TOKEN_LENGTH } from "./spec";

/**
 * Shared tokens come only from the environment (xhostd `set_env(secret=true)`),
 * are never logged, and are compared in constant time. The inbound API's env tokens
 * are legacy keys now (lib/api/keys.ts, LEGACY_KEYS in spec.ts).
 */

/** A configured shared token, or null when it is unset or too short to be safe. */
export function sharedToken(name: string): string | null {
  const value = process.env[name]?.trim();
  return value && value.length >= MIN_TOKEN_LENGTH ? value : null;
}

const digest = (value: string) => createHash("sha256").update(value).digest();

/** Compares fixed-length digests and checks every token, so timing reveals neither length nor which one matched. */
export function matchesToken(presented: string, tokens: string[]): boolean {
  const given = digest(presented);
  let ok = false;
  for (const token of tokens) ok = timingSafeEqual(given, digest(token)) || ok;
  return ok;
}

/** The webhook signature: HMAC-SHA256 of "<unix seconds>.<raw body>", hex. */
export function signPayload(secret: string, timestamp: number, body: string): string {
  return createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex");
}

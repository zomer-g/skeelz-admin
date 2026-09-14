import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { MIN_TOKEN_LENGTH } from "./spec";

/**
 * Shared tokens come only from the environment (xhostd `set_env(secret=true)`),
 * are never logged, and are compared in constant time.
 */

/** A configured shared token, or null when it is unset or too short to be safe. */
export function sharedToken(name: string): string | null {
  const value = process.env[name]?.trim();
  return value && value.length >= MIN_TOKEN_LENGTH ? value : null;
}

/** Tokens the inbound API accepts: the current one and, during a rotation, the previous one. */
export function inboundTokens(): string[] {
  const current = sharedToken("API_TOKEN");
  if (!current) return [];
  const previous = sharedToken("API_TOKEN_PREVIOUS");
  return previous ? [current, previous] : [current];
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

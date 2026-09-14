import { cookies } from "next/headers";
import { createRemoteJWKSet, jwtVerify } from "jose";
import { XHOST_COOKIE } from "./urls";

/**
 * Identity comes from xhostd's built-in Google sign-in, mounted at /xhost-auth/
 * on every hostname. The platform sets an RS256 JWT cookie and enforces nothing:
 * every request reaches the app, so verifying the cookie and deciding who may
 * enter is entirely ours (see session.ts).
 */

const ISSUER = "https://auth.xhostd.com";

// jose caches the key set and re-fetches on an unknown kid, which covers rotation.
const JWKS = createRemoteJWKSet(new URL(`${ISSUER}/xhost-auth/jwks`));

export interface Identity {
  sub: string;
  email: string; // lowercased
  name: string | null;
  picture: string | null;
}

/**
 * The token's aud is the exact hostname it was minted for, and the accepted
 * hostnames must be configured. There is deliberately no fallback to the
 * request's Host / X-Forwarded-Host: those headers are client-controlled, so a
 * token xhostd minted for someone else's app could be replayed here with a
 * forged header naming that app.
 */
let warnedNoAudiences = false;

function audiences(): string[] {
  const configured = (process.env.XHOST_AUTH_AUDIENCES ?? "")
    .split(",")
    .map((h) => h.trim().toLowerCase())
    .filter(Boolean);
  if (!configured.length && !warnedNoAudiences) {
    console.error("[auth] XHOST_AUTH_AUDIENCES is not set; every sign-in is refused");
    warnedNoAudiences = true;
  }
  return configured;
}

export async function verifiedIdentity(): Promise<Identity | null> {
  // There is no xhostd edge on localhost — let `next dev` impersonate a user.
  if (process.env.NODE_ENV === "development" && process.env.DEV_AUTH_EMAIL) {
    return { sub: "dev-local", email: process.env.DEV_AUTH_EMAIL.toLowerCase(), name: "Dev User", picture: null };
  }

  const token = (await cookies()).get(XHOST_COOKIE)?.value;
  if (!token) return null;

  const audience = audiences();
  if (!audience.length) return null;

  try {
    const { payload } = await jwtVerify(token, JWKS, {
      issuer: ISSUER,
      audience,
      // Pinned: never trust the algorithm named in the token's own header.
      algorithms: ["RS256"],
      requiredClaims: ["exp", "iss", "aud", "sub", "email"],
      clockTolerance: 60,
    });
    const email = typeof payload.email === "string" ? payload.email.trim().toLowerCase() : "";
    if (!email || !payload.sub) return null;
    return {
      sub: payload.sub,
      email,
      name: typeof payload.name === "string" && payload.name ? payload.name : null,
      picture: typeof payload.picture === "string" && payload.picture ? payload.picture : null,
    };
  } catch {
    // Expired, forged, or minted for another host: all simply mean "not signed in".
    return null;
  }
}

import { createCipheriv, createECDH, hkdfSync, randomBytes } from "node:crypto";
import { importJWK, SignJWT } from "jose";

/**
 * Web Push by hand (no library, like the CSV/XLSX writers): the message is encrypted to the
 * browser's key (RFC 8291, aes128gcm) and the request is signed with our VAPID key (RFC 8292).
 * Only node:crypto and jose, which the app already uses. The push service (Google, Mozilla, Apple,
 * Microsoft) sees the endpoint and an encrypted blob; what we put inside is content-free anyway
 * (lib/push/events.ts).
 */

export interface VapidKeys {
  /** 65-byte uncompressed P-256 point, base64url — the applicationServerKey the browser subscribes with. */
  publicKey: string;
  /** 32-byte private scalar, base64url. A secret. */
  privateKey: string;
  /** mailto: or https: contact the push services may use. */
  subject: string;
}

export interface PushTarget {
  endpoint: string;
  p256dh: string;
  auth: string;
}

const b64u = (buf: Uint8Array): string => Buffer.from(buf).toString("base64url");
const unb64u = (s: string): Buffer => Buffer.from(s, "base64url");

/** The keys from the environment, or null: then push is off everywhere, quietly. */
export function vapidKeys(): VapidKeys | null {
  const publicKey = process.env.VAPID_PUBLIC_KEY?.trim();
  const privateKey = process.env.VAPID_PRIVATE_KEY?.trim();
  const subject = process.env.VAPID_SUBJECT?.trim();
  if (!publicKey || !privateKey || !subject) return null;
  if (unb64u(publicKey).length !== 65 || unb64u(privateKey).length !== 32) return null;
  if (!/^(mailto:|https:\/\/)/.test(subject)) return null;
  return { publicKey, privateKey, subject };
}

export const pushConfigured = (): boolean => vapidKeys() !== null;

/** A fresh VAPID key pair, for scripts/vapid-keys.ts. */
export function generateVapidKeys(): { publicKey: string; privateKey: string } {
  const ecdh = createECDH("prime256v1");
  ecdh.generateKeys();
  return { publicKey: b64u(ecdh.getPublicKey()), privateKey: b64u(ecdh.getPrivateKey()) };
}

/**
 * The push services browsers actually use. A subscription is only an endpoint URL the browser
 * hands us, so without this list a signed-in user could make the server POST to any address.
 */
const PUSH_HOSTS = [/^fcm\.googleapis\.com$/, /^updates\.push\.services\.mozilla\.com$/, /^[a-z0-9-]+\.notify\.windows\.com$/, /^web\.push\.apple\.com$/];

export function allowedEndpoint(endpoint: string): URL | null {
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" || url.username || url.password || (url.port && url.port !== "443")) return null;
  if (!PUSH_HOSTS.some((re) => re.test(url.hostname))) return null;
  if (endpoint.length > 1024) return null;
  return url;
}

/** A browser's keys: p256dh a 65-byte uncompressed point, auth 16 bytes. */
export function validKeys(p256dh: unknown, auth: unknown): p256dh is string {
  if (typeof p256dh !== "string" || typeof auth !== "string") return false;
  if (!/^[A-Za-z0-9_-]+={0,2}$/.test(p256dh) || !/^[A-Za-z0-9_-]+={0,2}$/.test(auth)) return false;
  const key = unb64u(p256dh);
  return key.length === 65 && key[0] === 4 && unb64u(auth).length === 16;
}

const RECORD_SIZE = 4096;

/** RFC 8291 §3–4 with RFC 8188's aes128gcm: one record, the header carrying our ephemeral public key. */
export function encryptPayload(plaintext: Uint8Array, target: Pick<PushTarget, "p256dh" | "auth">, salt: Buffer = randomBytes(16)): Buffer {
  const ephemeral = createECDH("prime256v1");
  ephemeral.generateKeys();
  const uaPublic = unb64u(target.p256dh);
  const authSecret = unb64u(target.auth);
  const asPublic = ephemeral.getPublicKey();
  const ecdhSecret = ephemeral.computeSecret(uaPublic);

  const keyInfo = Buffer.concat([Buffer.from("WebPush: info\0"), uaPublic, asPublic]);
  const ikm = Buffer.from(hkdfSync("sha256", ecdhSecret, authSecret, keyInfo, 32));
  const cek = Buffer.from(hkdfSync("sha256", ikm, salt, Buffer.from("Content-Encoding: aes128gcm\0"), 16));
  const nonce = Buffer.from(hkdfSync("sha256", ikm, salt, Buffer.from("Content-Encoding: nonce\0"), 12));

  // The last (only) record ends with the 0x02 delimiter.
  const padded = Buffer.concat([Buffer.from(plaintext), Buffer.from([2])]);
  if (padded.length + 16 > RECORD_SIZE) throw new Error("payload_too_large");
  const cipher = createCipheriv("aes-128-gcm", cek, nonce);
  const body = Buffer.concat([cipher.update(padded), cipher.final(), cipher.getAuthTag()]);

  const header = Buffer.alloc(16 + 4 + 1);
  salt.copy(header, 0);
  header.writeUInt32BE(RECORD_SIZE, 16);
  header.writeUInt8(asPublic.length, 20);
  return Buffer.concat([header, asPublic, body]);
}

/** The VAPID Authorization header for one push service origin (RFC 8292), valid 12 hours. */
export async function vapidAuthorization(endpoint: URL, keys: VapidKeys, now = Date.now()): Promise<string> {
  const pub = unb64u(keys.publicKey);
  const jwk = { kty: "EC", crv: "P-256", x: b64u(pub.subarray(1, 33)), y: b64u(pub.subarray(33, 65)), d: keys.privateKey };
  const key = await importJWK(jwk, "ES256");
  const jwt = await new SignJWT({ sub: keys.subject })
    .setProtectedHeader({ typ: "JWT", alg: "ES256" })
    .setAudience(endpoint.origin)
    .setExpirationTime(Math.floor(now / 1000) + 12 * 3600)
    .sign(key);
  return `vapid t=${jwt}, k=${keys.publicKey}`;
}

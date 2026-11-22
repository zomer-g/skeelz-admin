import assert from "node:assert/strict";
import { createDecipheriv, createECDH, hkdfSync, randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import { importJWK, jwtVerify } from "jose";
import { alertKey, buildPayload, isSafePath, pendingNotices, PUSH_EVENTS, reviewKey, type PushKind } from "./events";
import { parseSubscription } from "./subscriptions";
import { allowedEndpoint, encryptPayload, generateVapidKeys, vapidAuthorization, validKeys } from "./webpush";

const root = join(__dirname, "..", "..");
const read = (...p: string[]) => readFileSync(join(root, ...p), "utf8");

/** A browser's side of a subscription, to decrypt what we send (RFC 8291 in reverse). */
function browser() {
  const ecdh = createECDH("prime256v1");
  ecdh.generateKeys();
  const auth = randomBytes(16);
  return {
    target: { p256dh: ecdh.getPublicKey().toString("base64url"), auth: auth.toString("base64url") },
    decrypt(message: Buffer): string {
      const salt = message.subarray(0, 16);
      const idlen = message.readUInt8(20);
      const asPublic = message.subarray(21, 21 + idlen);
      const body = message.subarray(21 + idlen);
      const secret = ecdh.computeSecret(asPublic);
      const info = Buffer.concat([Buffer.from("WebPush: info\0"), ecdh.getPublicKey(), asPublic]);
      const ikm = Buffer.from(hkdfSync("sha256", secret, auth, info, 32));
      const cek = Buffer.from(hkdfSync("sha256", ikm, salt, Buffer.from("Content-Encoding: aes128gcm\0"), 16));
      const nonce = Buffer.from(hkdfSync("sha256", ikm, salt, Buffer.from("Content-Encoding: nonce\0"), 12));
      const d = createDecipheriv("aes-128-gcm", cek, nonce);
      d.setAuthTag(body.subarray(body.length - 16));
      const plain = Buffer.concat([d.update(body.subarray(0, body.length - 16)), d.final()]);
      assert.equal(plain[plain.length - 1], 2, "last-record delimiter");
      return plain.subarray(0, plain.length - 1).toString("utf8");
    },
  };
}

describe("web push encryption and VAPID", () => {
  it("encrypts so only the subscribed browser can read it (aes128gcm)", () => {
    const b = browser();
    const text = JSON.stringify(buildPayload("security_alert"));
    const msg = encryptPayload(Buffer.from(text), b.target);
    assert.equal(msg.readUInt32BE(16), 4096);
    assert.equal(b.decrypt(msg), text);
    assert.ok(!msg.includes(Buffer.from("התראת")), "the title is not in clear");
  });

  it("signs a VAPID token for the push service's origin", async () => {
    const keys = { ...generateVapidKeys(), subject: "mailto:ops@example.com" };
    const header = await vapidAuthorization(new URL("https://fcm.googleapis.com/fcm/send/abc"), keys);
    const m = /^vapid t=([^,]+), k=(.+)$/.exec(header);
    assert.ok(m);
    assert.equal(m[2], keys.publicKey);
    const pub = Buffer.from(keys.publicKey, "base64url");
    const key = await importJWK({ kty: "EC", crv: "P-256", x: pub.subarray(1, 33).toString("base64url"), y: pub.subarray(33).toString("base64url") }, "ES256");
    const { payload } = await jwtVerify(m[1]!, key, { audience: "https://fcm.googleapis.com" });
    assert.equal(payload.sub, "mailto:ops@example.com");
  });
});

describe("subscriptions point only at the known push services", () => {
  const good = [
    "https://fcm.googleapis.com/fcm/send/abc:def",
    "https://updates.push.services.mozilla.com/wpush/v2/gAAAA",
    "https://wns2-db5p.notify.windows.com/w/?token=x",
    "https://web.push.apple.com/QH1234",
  ];
  const bad = [
    "http://fcm.googleapis.com/fcm/send/abc",
    "https://fcm.googleapis.com.evil.example/x",
    "https://evil.example/?fcm.googleapis.com",
    "https://localhost/push",
    "https://169.254.169.254/latest",
    "https://user:pw@fcm.googleapis.com/x",
    "https://fcm.googleapis.com:8443/x",
    "https://notify.windows.com.evil.example/x",
    "javascript:alert(1)",
  ];
  for (const e of good) it(`accepts ${new URL(e).hostname}`, () => assert.ok(allowedEndpoint(e)));
  for (const e of bad) it(`refuses ${e}`, () => assert.equal(allowedEndpoint(e), null));

  it("checks the browser's keys", () => {
    const b = browser();
    assert.ok(validKeys(b.target.p256dh, b.target.auth));
    assert.ok(!validKeys(b.target.p256dh, "short"));
    assert.ok(!validKeys("x".repeat(87), b.target.auth));
    assert.ok(parseSubscription({ endpoint: "https://fcm.googleapis.com/fcm/send/a", keys: b.target }));
    assert.equal(parseSubscription({ endpoint: "https://evil.example/a", keys: b.target }), null);
    assert.equal(parseSubscription({ endpoint: "https://fcm.googleapis.com/fcm/send/a" }), null);
  });
});

describe("a push payload carries no personal data", () => {
  // Rows as the worker loads them, with the personal columns a careless change might pass on.
  const alerts = [
    { id: 7, handledAt: null, kind: "files_alert", userEmail: "dana.cohen@example.com", day: "2026-11-22", threshold: 20 },
    { id: 8, handledAt: null, kind: "export_limit", userEmail: "moshe@example.org", day: "2026-11-22", threshold: 5000 },
    { id: 9, handledAt: new Date(), userEmail: "handled@example.com" },
  ];
  const reviews = [
    { userId: "0b9f1c1e-1111-4222-8333-444455556666", state: "due" as const, validUntil: null, email: "rina@example.com", name: "רינה לוי" },
    { userId: "0b9f1c1e-aaaa-4222-8333-444455556666", state: "soon" as const, validUntil: new Date("2026-11-30T00:00:00Z"), name: "יוסי" },
    { userId: "0b9f1c1e-bbbb-4222-8333-444455556666", state: "valid" as const, validUntil: new Date("2027-01-30T00:00:00Z") },
  ];
  const personal = ["dana.cohen", "example.com", "example.org", "moshe", "rina", "רינה", "לוי", "יוסי", "0b9f1c1e", "2026-11", "5000", "@"];

  it("holds exactly a fixed title, body, a path and a tag", () => {
    for (const kind of Object.keys(PUSH_EVENTS) as PushKind[]) {
      const p = buildPayload(kind);
      assert.deepEqual(Object.keys(p).sort(), ["body", "tag", "title", "url"]);
      assert.equal(p.title, PUSH_EVENTS[kind].title);
      assert.equal(p.body, PUSH_EVENTS[kind].body);
      assert.ok(isSafePath(p.url));
      assert.doesNotMatch(JSON.stringify(p), /\d|@/, "no counts, ids or addresses");
    }
  });

  it("built from alert and review rows, contains nothing from them", () => {
    const pending = pendingNotices(alerts, reviews, new Set());
    assert.deepEqual(
      pending.map((p) => p.kind),
      ["security_alert", "access_review"],
    );
    for (const p of pending) {
      const json = JSON.stringify(buildPayload(p.kind));
      for (const word of personal) assert.ok(!json.includes(word), `${p.kind} payload must not contain "${word}"`);
    }
  });

  it("each event is sent once: keys already sent are skipped, handled alerts and valid reviews never count", () => {
    const all = pendingNotices(alerts, reviews, new Set());
    assert.deepEqual(all[0]!.keys, ["alert:7", "alert:8"]);
    assert.equal(all[1]!.keys.length, 2);
    const sent = new Set([...all[0]!.keys, ...all[1]!.keys]);
    assert.deepEqual(pendingNotices(alerts, reviews, sent), []);
    assert.equal(alertKey(alerts[0]!), "alert:7");
    // A renewal (new valid_until) or a state change is a new event.
    assert.notEqual(reviewKey({ ...reviews[1]!, state: "due" }), reviewKey(reviews[1]!));
  });

  it("the sender serialises only buildPayload's output", () => {
    const code = read("lib", "push", "send.ts");
    const stringified = [...code.matchAll(/JSON\.stringify\(([^)]*\))?/g)].map((m) => m[1]);
    assert.deepEqual(stringified, ["buildPayload(kind)"]);
  });
});

describe("who receives a notice is decided when it is sent", () => {
  it("the role comes from the users table at send time (no session, so no view-as), active users only", () => {
    const code = read("lib", "push", "send.ts");
    assert.match(code, /innerJoin\(users, eq\(users\.id, pushSubscriptions\.userId\)\)/);
    assert.match(code, /where\(eq\(users\.active, true\)\)/);
    assert.match(code, /hasRole\(row\.role, event\.minRole\)/);
    assert.doesNotMatch(code, /getSession|requireUser|skeelz_view_as/);
  });
  it("every notice links to a screen of the role it is sent to", () => {
    const pages: Record<string, string> = { "/admin/security": "admin", "/admin/users": "admin", "/admin/audit": "admin" };
    for (const e of Object.values(PUSH_EVENTS)) assert.equal(pages[e.path], e.minRole, e.kind);
  });
});

describe("the service worker caches nothing and opens only our own paths", () => {
  const sw = read("..", "public", "sw.js");
  it("has no fetch handler and no Cache Storage", () => {
    assert.doesNotMatch(sw, /addEventListener\(\s*["']fetch["']/);
    assert.doesNotMatch(sw, /\bcaches\b|importScripts/);
  });
  it("shows notices right-to-left in Hebrew", () => {
    assert.match(sw, /dir: "rtl"/);
    assert.match(sw, /lang: "he"/);
  });
  it("same-origin paths only", () => {
    assert.ok(isSafePath("/admin/security"));
    for (const p of ["//evil.example/x", "https://evil.example", "/\\evil.example", "admin", "", null]) assert.ok(!isSafePath(p), String(p));
  });
});

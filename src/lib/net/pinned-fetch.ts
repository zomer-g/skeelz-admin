import { lookup as dnsLookup, type LookupAddress } from "node:dns";
import { request } from "node:https";
import type { LookupFunction } from "node:net";
import { Readable } from "node:stream";
import { isBlockedAddress } from "./public-address";

/**
 * An https request to an address an admin typed in (a peer app, the webhook), connected only to
 * a public address. The check runs inside the connection's own DNS lookup, so the address that
 * was checked is the address that is used: a name that answers "public" to a check and "internal"
 * a moment later (DNS rebinding) cannot reach the inside. Redirects are never followed. Returns a
 * standard Response; a blocked address fails with the message "blocked_address".
 */
export interface PinnedInit {
  method?: string;
  headers?: Headers | Record<string, string>;
  body?: string;
  signal?: AbortSignal;
}

/** Node's lookup hook: resolve, then refuse unless every address is public. */
export const publicOnlyLookup: LookupFunction = (hostname, options, callback) => {
  dnsLookup(hostname, { ...options, all: true }, (err, addresses: LookupAddress[]) => {
    if (err) return callback(err, "", 4);
    if (!addresses.length || addresses.some((a) => isBlockedAddress(a.address))) {
      return callback(Object.assign(new Error("blocked_address"), { code: "EBLOCKED" }), "", 4);
    }
    if ((options as { all?: boolean }).all) return (callback as unknown as (e: null, a: LookupAddress[]) => void)(null, addresses);
    callback(null, addresses[0]!.address, addresses[0]!.family);
  });
};

export function pinnedFetch(url: URL, init: PinnedInit = {}): Promise<Response> {
  if (url.protocol !== "https:") return Promise.reject(new Error("https_only"));
  const headers: Record<string, string> = {};
  new Headers(init.headers).forEach((v, k) => (headers[k] = v));
  if (init.body !== undefined) headers["content-length"] = String(Buffer.byteLength(init.body));
  return new Promise((resolve, reject) => {
    const req = request(url, { method: init.method ?? "GET", headers, lookup: publicOnlyLookup, signal: init.signal }, (res) => {
      const out = new Headers();
      for (const [k, v] of Object.entries(res.headers)) {
        if (v !== undefined) out.set(k, Array.isArray(v) ? v.join(", ") : v);
      }
      const status = res.statusCode ?? 502;
      const noBody = status === 204 || status === 304 || (status >= 100 && status < 200);
      if (noBody) res.resume();
      resolve(new Response(noBody ? null : (Readable.toWeb(res) as ReadableStream<Uint8Array>), { status, headers: out }));
    });
    req.on("error", (err: Error & { code?: string }) => reject(err.code === "EBLOCKED" ? new Error("blocked_address") : err));
    if (init.body !== undefined) req.write(init.body);
    req.end();
  });
}

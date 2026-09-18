import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

/**
 * SSRF guards for server-side requests to addresses an admin typed in (peer apps,
 * webhooks): the target must be a public host, both by name and by what it resolves to.
 */

const INTERNAL_SUFFIXES = [".localhost", ".local", ".internal", ".lan"];

/** A hostname that is an IP literal, localhost, an internal-looking name or a single label. */
export function isInternalHostname(hostname: string): boolean {
  const host = hostname.replace(/^\[|\]$/g, "").toLowerCase().replace(/\.$/, "");
  if (isIP(host)) return true;
  if (host === "localhost" || INTERNAL_SUFFIXES.some((s) => host.endsWith(s))) return true;
  return !host.includes(".");
}

function ipv4Blocked(ip: string): boolean {
  const [a = 0, b = 0] = ip.split(".").map(Number);
  return (
    a === 0 || // unspecified, "this network"
    a === 10 ||
    a === 127 ||
    a >= 224 || // multicast and reserved
    (a === 100 && b >= 64 && b <= 127) || // CGNAT
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168)
  );
}

/** Expands an IPv6 address to its eight 16-bit groups. */
function ipv6Groups(ip: string): number[] | null {
  let v = ip.toLowerCase();
  const dotted = /(\d+\.\d+\.\d+\.\d+)$/.exec(v);
  if (dotted) {
    const [a, b, c, d] = dotted[1]!.split(".").map(Number) as [number, number, number, number];
    v = v.slice(0, -dotted[1]!.length) + `${((a << 8) | b).toString(16)}:${((c << 8) | d).toString(16)}`;
  }
  const [head, tail] = v.split("::") as [string, string | undefined];
  const h = head ? head.split(":") : [];
  const t = tail === undefined ? [] : tail ? tail.split(":") : [];
  const fill = tail === undefined ? 0 : 8 - h.length - t.length;
  const groups = [...h, ...Array(Math.max(0, fill)).fill("0"), ...t].map((g) => parseInt(g, 16));
  return groups.length === 8 && groups.every((g) => Number.isInteger(g) && g >= 0 && g <= 0xffff) ? groups : null;
}

/** Loopback, private, link-local, CGNAT, unspecified, ULA, multicast, or IPv4-mapped IPv6 of any of those. */
export function isBlockedAddress(ip: string): boolean {
  const kind = isIP(ip);
  if (kind === 4) return ipv4Blocked(ip);
  if (kind !== 6) return true;
  const g = ipv6Groups(ip);
  if (!g) return true;
  const [g0, , , , , g5, g6, g7] = g as [number, number, number, number, number, number, number, number];
  if (g.slice(0, 5).every((x) => x === 0) && g5 === 0xffff) return ipv4Blocked(`${g6 >> 8}.${g6 & 255}.${g7 >> 8}.${g7 & 255}`); // ::ffff:a.b.c.d
  if (g.slice(0, 7).every((x) => x === 0)) return true; // :: and ::1
  if ((g0 & 0xfe00) === 0xfc00) return true; // fc00::/7 ULA
  if ((g0 & 0xffc0) === 0xfe80) return true; // fe80::/10 link-local
  if ((g0 & 0xff00) === 0xff00) return true; // ff00::/8 multicast
  return false;
}

/** Resolves the host and throws unless every address it has is public. */
export async function assertPublicHost(hostname: string): Promise<void> {
  const host = hostname.replace(/^\[|\]$/g, "");
  const addresses = isIP(host) ? [host] : (await lookup(host, { all: true })).map((a) => a.address);
  if (!addresses.length || addresses.some(isBlockedAddress)) throw new Error("blocked_address");
}

"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { PEERS, type Peer } from "@/lib/api/spec";
import { writeAudit } from "@/lib/audit";
import { requireUser } from "@/lib/auth/session";
import { normalizeBaseUrl, peerFetch, PeerError } from "@/lib/connect/client";
import { connectSecretConfigured, encryptSecret } from "@/lib/connect/crypto";
import { getDb } from "@/lib/db/client";
import { connections } from "@/lib/db/schema";

// Every action re-checks the caller: a server action is a public endpoint.
// The peer's key goes one way only: from the form into the encrypted column.

export type ConnectionState = { ok: boolean; lines: string[] } | null;

const PATH = "/admin/connections";
const isPeer = (v: unknown): v is Peer => (PEERS as readonly unknown[]).includes(v);

export async function saveConnection(_prev: ConnectionState, form: FormData): Promise<ConnectionState> {
  const admin = await requireUser("admin");
  const peer = form.get("peer");
  if (!isPeer(peer)) return { ok: false, lines: ["מערכת לא מוכרת"] };
  const baseUrl = normalizeBaseUrl(String(form.get("base_url") ?? ""));
  if (!baseUrl) {
    return {
      ok: false,
      lines: [
        "כתובת לא מורשית (invalid_base_url): צריך כתובת https ציבורית עם שם דומיין מלא, בלי כתובת IP, localhost או שם פנימי, ובלי נתיב, פרמטרים, שם משתמש או סיסמה. למשל https://skeelz-crm-zomerg.xhostd.app",
      ],
    };
  }
  const key = String(form.get("key") ?? "").trim();
  const enabled = form.get("enabled") === "on";
  if (key && (key.length < 20 || key.length > 200 || /\s/.test(key))) return { ok: false, lines: ["המפתח לא נראה תקין"] };
  if (key && !connectSecretConfigured()) return { ok: false, lines: ["CONNECT_SECRET_KEY לא מוגדר בשרת, ולכן אי אפשר לשמור מפתח"] };

  const db = getDb();
  const [existing] = await db
    .select({ peer: connections.peer, baseUrl: connections.baseUrl })
    .from(connections)
    .where(eq(connections.peer, peer))
    .limit(1);
  if (!existing && !key) return { ok: false, lines: ["בחיבור חדש צריך להדביק את המפתח שהמערכת השנייה הנפיקה לנו"] };
  // A key is never carried over to a new origin: that would hand it to whoever runs the new address.
  if (existing && !key && normalizeBaseUrl(existing.baseUrl) !== baseUrl) {
    return { ok: false, lines: ["כתובת השתנתה — יש להזין את המפתח מחדש"] };
  }

  const keyFields = key ? { keyCiphertext: encryptSecret(key, peer), keyLast4: key.slice(-4) } : {};
  const common = { baseUrl, enabled, updatedBy: admin.email, updatedAt: new Date() };
  if (existing) await db.update(connections).set({ ...common, ...keyFields }).where(eq(connections.peer, peer));
  else await db.insert(connections).values({ peer, ...common, keyCiphertext: keyFields.keyCiphertext!, keyLast4: keyFields.keyLast4! });

  await writeAudit(admin.email, "connection.updated", peer, { baseUrl, enabled, keyChanged: Boolean(key) });
  revalidatePath(PATH);
  return { ok: true, lines: [key ? "החיבור נשמר עם המפתח החדש" : "החיבור נשמר (המפתח לא השתנה)"] };
}

interface Ping {
  app?: unknown;
  version?: unknown;
  key?: { name?: unknown; scopes?: unknown };
}

export async function checkConnection(_prev: ConnectionState, form: FormData): Promise<ConnectionState> {
  const admin = await requireUser("admin");
  const peer = form.get("peer");
  if (!isPeer(peer)) return { ok: false, lines: ["מערכת לא מוכרת"] };

  let result: { ok: boolean; lines: string[]; detail: string };
  try {
    const ping = await peerFetch<Ping>(peer, "/api/v1/ping");
    const scopes = Array.isArray(ping?.key?.scopes) ? ping.key.scopes.map(String) : [];
    const app = typeof ping?.app === "string" ? ping.app : "?";
    const version = typeof ping?.version === "string" ? ping.version : "?";
    const keyName = typeof ping?.key?.name === "string" ? ping.key.name : "—";
    const sameApp = app === peer;
    result = {
      ok: sameApp,
      lines: [
        sameApp ? `מחובר: ${app}, גרסה ${version}` : `הכתובת ענתה כמערכת "${app}" ולא "${peer}": כנראה הכתובת שגויה`,
        `המפתח שלנו שם: ${keyName}`,
        `הרשאות: ${scopes.length ? scopes.join(", ") : "אין"}`,
      ],
      detail: `${app} ${version} · ${scopes.join(" ") || "no scopes"}`,
    };
  } catch (err) {
    const message = err instanceof PeerError ? err.message : "Unexpected error";
    result = { ok: false, lines: [message], detail: message };
  }

  // Only a stored connection has somewhere to keep the result.
  await getDb()
    .update(connections)
    .set({ lastCheckAt: new Date(), lastCheckOk: result.ok, lastCheckDetail: result.detail.slice(0, 300) })
    .where(eq(connections.peer, peer));
  await writeAudit(admin.email, "connection.checked", peer, { ok: result.ok });
  revalidatePath(PATH);
  return { ok: result.ok, lines: result.lines };
}

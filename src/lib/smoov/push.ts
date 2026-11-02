import { eq, inArray, sql } from "drizzle-orm";
import { writeAudit } from "@/lib/audit";
import { getDb } from "@/lib/db/client";
import { smoovPushed, syncState } from "@/lib/db/schema";
import { CANDIDATES } from "@/lib/entities/candidates";
import { asDate, isTrue, run, str } from "@/lib/entities/search";
import { placeLabel } from "@/lib/geo/filters";
import { BULK_IMPORT_MAX, smoov, smoovConfigured, SmoovError, type SmoovBulkContact } from "./client";
import { contactHash, isPlausibleEmail, resolveFieldKeys, toBulkContact } from "./push-payload";

/**
 * Fills the SMOOV list "מחפשי עבודה 2026" with every candidate who has an email
 * (the same candidates as /candidates), with city, sub-district, district, CV and
 * creation date in the list's custom fields. Runs with the marketing sync, at most
 * twice a day, and sends only addresses that are new or changed since the last run.
 *
 * Consent: signing up on jobs.skeelz.co.il includes consent to job mailings. SMOOV
 * keeps unsubscribed and blacklisted addresses out; this never re-subscribes them.
 * Nothing is ever removed from the list from here.
 */

export const PUSH_OBJECT = "SMOOV_PUSH";
/** Twice a day: the marketing sync runs every six hours, and a push is due after eleven. */
const PUSH_EVERY_MS = 11 * 3600_000;

function listId(): number | null {
  const id = Number(process.env.SMOOV_PUSH_LIST_ID);
  return Number.isInteger(id) && id > 0 ? id : null;
}

/** Writing to SMOOV is opt-in: it needs the key and the target list's id. */
export function smoovPushConfigured(): boolean {
  return smoovConfigured() && listId() !== null;
}

export async function smoovPushDue(): Promise<boolean> {
  const [state] = await getDb().select().from(syncState).where(eq(syncState.object, PUSH_OBJECT));
  if (!state?.lastSuccessAt || state.lastError) return true;
  return Date.now() - state.lastSuccessAt.getTime() >= PUSH_EVERY_MS;
}

/** One row per address: a person with two Contacts is one subscriber, described by the newest. */
async function loadCandidates() {
  const rows = await run(sql`${CANDIDATES}
    SELECT DISTINCT ON (lower(btrim(c.email))) lower(btrim(c.email)) AS email, c.name, c.phone, c.city, c.has_cv, c.created_date,
           c.place_kind, c.napa, c.locality, c.data->>'FirstName' AS first_name, c.data->>'LastName' AS last_name
      FROM cand c
     WHERE c.email IS NOT NULL AND btrim(c.email) <> ''
     ORDER BY lower(btrim(c.email)), c.created_date DESC NULLS LAST`);
  return rows.map((r) => {
    const place = placeLabel(r);
    return {
      email: String(r.email),
      name: str(r.name),
      firstName: str(r.first_name),
      lastName: str(r.last_name),
      phone: str(r.phone),
      // The CBS name when the place is known, else the city as typed.
      city: place.locality ?? str(r.city),
      subdistrict: place.subdistrict,
      district: place.district,
      hasCv: isTrue(r.has_cv),
      createdAt: asDate(r.created_date),
    };
  });
}

export async function runSmoovPush(): Promise<{ rows: number; note: string }> {
  const list = listId();
  if (list === null) throw new Error("SMOOV_PUSH_LIST_ID is not set");
  const db = getDb();

  const keys = resolveFieldKeys(await smoov.contactFields());
  const candidates = await loadCandidates();
  const contacts = candidates.filter((c) => isPlausibleEmail(c.email)).map((c) => toBulkContact(c, keys));

  const sent = new Map<string, string>();
  for (const r of await db.select({ email: smoovPushed.email, hash: smoovPushed.hash }).from(smoovPushed)) sent.set(r.email, r.hash);
  const changed: { contact: SmoovBulkContact; hash: string }[] = [];
  for (const contact of contacts) {
    const hash = contactHash(contact);
    if (sent.get(contact.email) !== hash) changed.push({ contact, hash });
  }

  const totals = { inserted: 0, updated: 0, invalids: 0, blacklisted: 0, quotaExceeded: 0 };
  for (let i = 0; i < changed.length; i += BULK_IMPORT_MAX) {
    const batch = changed.slice(i, i + BULK_IMPORT_MAX);
    const { importReport } = await smoov.bulkImport(list, batch.map((b) => b.contact)).catch((err: unknown) => {
      // SMOOV's error text can echo the contacts; the sync log (shown at /admin/sync) gets the status only.
      throw new Error(`SMOOV bulk import failed (HTTP ${err instanceof SmoovError ? err.status : "?"}) after ${i} of ${changed.length}`);
    });
    for (const k of Object.keys(totals) as (keyof typeof totals)[]) totals[k] += Number(importReport?.[k] ?? 0);
    // Recorded batch by batch: a run that fails halfway resumes where it stopped.
    const now = new Date();
    await db
      .insert(smoovPushed)
      .values(batch.map((b) => ({ email: b.contact.email, hash: b.hash, pushedAt: now })))
      .onConflictDoUpdate({ target: smoovPushed.email, set: { hash: sql`excluded.hash`, pushedAt: now } });
  }

  // Addresses no longer among the candidates are forgotten here (so they are sent again if they come back), not removed in SMOOV.
  const current = new Set(contacts.map((c) => c.email));
  const gone = [...sent.keys()].filter((e) => !current.has(e));
  for (let i = 0; i < gone.length; i += 1000) await db.delete(smoovPushed).where(inArray(smoovPushed.email, gone.slice(i, i + 1000)));

  await db
    .insert(syncState)
    .values({ object: PUSH_OBJECT, rowCount: contacts.length })
    .onConflictDoUpdate({ target: syncState.object, set: { rowCount: contacts.length } });
  if (changed.length) {
    await writeAudit("system:sync-worker", "smoov.contacts_pushed", String(list), { sent: changed.length, ...totals });
  }
  return {
    rows: changed.length,
    note: `${changed.length}/${contacts.length} sent to list ${list}: ${totals.inserted} new, ${totals.updated} updated, ` +
      `${totals.blacklisted} unsubscribed/blacklisted, ${totals.invalids} invalid` +
      (candidates.length > contacts.length ? `; ${candidates.length - contacts.length} malformed addresses skipped` : ""),
  };
}

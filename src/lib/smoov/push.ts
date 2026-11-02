import { eq, inArray, sql } from "drizzle-orm";
import { writeAudit } from "@/lib/audit";
import { getDb } from "@/lib/db/client";
import { smoovPushed, syncState } from "@/lib/db/schema";
import { CANDIDATES } from "@/lib/entities/candidates";
import { asDate, isTrue, run, str } from "@/lib/entities/search";
import { placeLabel } from "@/lib/geo/filters";
import { safeErrorMessage } from "@/lib/log";
import { BULK_IMPORT_MAX, smoov, smoovConfigured, SmoovError, type SmoovBulkContact } from "./client";
import { contactHash, isPlausibleEmail, redactSmoovError, resolveFieldKeys, toBulkContact } from "./push-payload";

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

/**
 * Every push is written to the activity log — also one that sent nothing, and one that failed —
 * under the person who asked for it at /admin/sync, or the sync worker when it ran on schedule.
 */
export async function runSmoovPush(trigger: string): Promise<{ rows: number; note: string }> {
  const list = listId();
  if (list === null) throw new Error("SMOOV_PUSH_LIST_ID is not set");
  const actor = trigger.startsWith("manual:") ? trigger.slice("manual:".length) : "system:sync-worker";
  const progress = { sent: 0, of: 0 };
  try {
    const result = await push(list, progress);
    await writeAudit(actor, "smoov.contacts_pushed", String(list), { trigger, ...result.details });
    return result;
  } catch (err) {
    await writeAudit(actor, "smoov.push_failed", String(list), { trigger, ...progress, error: safeErrorMessage(err).slice(0, 200) });
    throw err;
  }
}

/**
 * When SMOOV rejects the first contact ("Schema is invalid") it does not say which field. Sends that
 * contact again, one field more each time, and logs the first field SMOOV refuses — by name only.
 * Each accepted step imports that contact, which the run was sending anyway.
 */
async function probeRejectedField(list: number, contact: SmoovBulkContact): Promise<void> {
  const steps: [string, SmoovBulkContact][] = [];
  let acc: SmoovBulkContact = { email: contact.email, customFields: {} };
  steps.push(["email", acc]);
  for (const k of ["firstName", "lastName", "cellPhone"] as const) {
    if (contact[k] === undefined) continue;
    acc = { ...acc, [k]: contact[k] };
    steps.push([k, acc]);
  }
  for (const [k, v] of Object.entries(contact.customFields)) {
    acc = { ...acc, customFields: { ...acc.customFields, [k]: v } };
    steps.push([`customFields.${k} (${typeof v})`, acc]);
  }
  for (const [name, body] of steps) {
    try {
      await smoov.bulkImport(list, [body]);
    } catch (err) {
      console.error(`[smoov-push] probe: SMOOV refuses the contact once "${name}" is added: ${redactSmoovError(err instanceof Error ? err.message : String(err))}`);
      return;
    }
  }
  console.error("[smoov-push] probe: every field is accepted one at a time; the full contact fails for another reason");
}

async function push(
  list: number,
  progress: { sent: number; of: number },
): Promise<{ rows: number; note: string; details: Record<string, number> }> {
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
  progress.of = changed.length;
  // One contact goes first, alone: only once SMOOV accepts it do the batches of 500 follow.
  // The rest of the loop is the same import, so the first "batch" is that single contact.
  for (let i = 0; i < changed.length; i = i === 0 ? 1 : i + BULK_IMPORT_MAX) {
    const batch = changed.slice(i, i === 0 ? 1 : i + BULK_IMPORT_MAX);
    const { importReport } = await smoov.bulkImport(list, batch.map((b) => b.contact)).catch(async (err: unknown) => {
      // SMOOV's error text can echo the contacts; the sync log (shown at /admin/sync) gets the status only,
      // and the server log the reason with addresses and numbers masked.
      console.error(`[smoov-push] ${i === 0 ? "first contact" : `batch from ${i}`}: ${redactSmoovError(err instanceof Error ? err.message : String(err))}`);
      if (i === 0 && err instanceof SmoovError && err.status === 400) await probeRejectedField(list, batch[0]!.contact);
      throw new Error(`SMOOV bulk import failed (HTTP ${err instanceof SmoovError ? err.status : "?"}) after ${i} of ${changed.length}`);
    });
    for (const k of Object.keys(totals) as (keyof typeof totals)[]) totals[k] += Number(importReport?.[k] ?? 0);
    // Recorded batch by batch: a run that fails halfway resumes where it stopped.
    const now = new Date();
    await db
      .insert(smoovPushed)
      .values(batch.map((b) => ({ email: b.contact.email, hash: b.hash, pushedAt: now })))
      .onConflictDoUpdate({ target: smoovPushed.email, set: { hash: sql`excluded.hash`, pushedAt: now } });
    progress.sent += batch.length;
  }

  // Addresses no longer among the candidates are forgotten here (so they are sent again if they come back), not removed in SMOOV.
  const current = new Set(contacts.map((c) => c.email));
  const gone = [...sent.keys()].filter((e) => !current.has(e));
  for (let i = 0; i < gone.length; i += 1000) await db.delete(smoovPushed).where(inArray(smoovPushed.email, gone.slice(i, i + 1000)));

  await db
    .insert(syncState)
    .values({ object: PUSH_OBJECT, rowCount: contacts.length })
    .onConflictDoUpdate({ target: syncState.object, set: { rowCount: contacts.length } });
  return {
    rows: changed.length,
    details: { sent: changed.length, candidates: contacts.length, ...totals },
    note: `${changed.length}/${contacts.length} sent to list ${list}: ${totals.inserted} new, ${totals.updated} updated, ` +
      `${totals.blacklisted} unsubscribed/blacklisted, ${totals.invalids} invalid` +
      (candidates.length > contacts.length ? `; ${candidates.length - contacts.length} malformed addresses skipped` : ""),
  };
}

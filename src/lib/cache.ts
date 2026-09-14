/**
 * A short-lived, per-process memo for the dashboard's heavy loaders.
 *
 * The mirror only changes when the sync worker runs (every 10 minutes), so a
 * figure a minute or two old is still current. More importantly, renders that
 * arrive together — several tabs, a refresh, a health probe on "/" — share one
 * computation instead of each queueing the same heavy queries on the database.
 * A failed computation is dropped at once, so the next render retries.
 */

const TTL_MS = 2 * 60_000;
const MAX_ENTRIES = 100;

const entries = new Map<string, { at: number; value: Promise<unknown> }>();

export function cached<T>(key: string, compute: () => Promise<T>, ttlMs = TTL_MS): Promise<T> {
  const now = Date.now();
  const hit = entries.get(key);
  if (hit && now - hit.at < ttlMs) return hit.value as Promise<T>;

  const value = compute().catch((err: unknown) => {
    if (entries.get(key)?.value === value) entries.delete(key);
    throw err;
  });
  // Re-inserting keeps the Map in age order, so the first key is always the oldest.
  entries.delete(key);
  entries.set(key, { at: now, value });
  while (entries.size > MAX_ENTRIES) entries.delete(entries.keys().next().value as string);
  return value;
}

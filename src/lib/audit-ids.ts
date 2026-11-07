/**
 * Which people a hand-over carried, for its audit entry: so "who received person X's details"
 * has an answer later, when the same query on today's mirror would return other rows. Pulled
 * from the result itself (not re-queried): the Salesforce ids and email addresses at keys named
 * like an id or an email, at any depth, each once, at most MAX_LOGGED_IDS.
 */
export const MAX_LOGGED_IDS = 200;

const ID_KEY = /(^|_)(id|ids|contact|email)$|Id$/i;
const SF_ID = /^[a-zA-Z0-9]{15}([a-zA-Z0-9]{3})?$/;
const EMAIL = /^[^\s@]{1,64}@[^\s@]{1,190}$/;
/** Salesforce key prefixes that are not people or their records: users (005), files (068/069), record types (012). */
const NOT_A_RECORD = /^(005|012|068|069)/;

export interface LoggedIds {
  ids: string[];
  /** More were found than were logged. */
  more: boolean;
}

export function recordIds(result: unknown, max = MAX_LOGGED_IDS): LoggedIds {
  const seen = new Set<string>();
  let more = false;
  const add = (v: string) => {
    const t = v.trim();
    const ok = (SF_ID.test(t) && /\d/.test(t) && !NOT_A_RECORD.test(t)) || EMAIL.test(t);
    if (!ok || seen.has(t.toLowerCase())) return;
    if (seen.size >= max) more = true;
    else seen.add(t.includes("@") ? t.toLowerCase() : t);
  };
  const walk = (v: unknown, key: string, depth: number) => {
    if (depth > 8 || v == null) return;
    if (typeof v === "string") {
      if (ID_KEY.test(key)) add(v);
    } else if (Array.isArray(v)) {
      for (const x of v) walk(x, key, depth + 1);
    } else if (typeof v === "object") {
      for (const [k, x] of Object.entries(v as Record<string, unknown>)) walk(x, k, depth + 1);
    }
  };
  walk(result, "", 0);
  return { ids: [...seen], more };
}

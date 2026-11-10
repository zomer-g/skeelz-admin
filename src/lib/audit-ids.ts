/**
 * Which people a hand-over carried, for its audit entry: so "who received person X's details"
 * has an answer later, when the same query on today's mirror would return other rows. Pulled
 * from the result itself (not re-queried): the Salesforce ids and email addresses at keys named
 * like an id or an email, at any depth, each once, at most MAX_LOGGED_IDS.
 */
export const MAX_LOGGED_IDS = 200;

/** snake_case (`contact_id`, `email`) or camelCase (`contactId`, `candidateEmail`) — "paid" or "valid" are not ids. */
const ID_KEY = /(^|_)(id|ids|contact|email)$/i;
const CAMEL_ID_KEY = /[a-z](Id|Ids|Email)$/;
const SF_ID = /^[a-zA-Z0-9]{15}([a-zA-Z0-9]{3})?$/;
const EMAIL = /^[^\s@]{1,64}@[^\s@]{1,190}$/;
/** Salesforce key prefixes that are not people or their records: users (005, the staff), record types (012), file versions (068). */
const NOT_A_RECORD = /^(005|012|068)/;

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
      if (ID_KEY.test(key) || CAMEL_ID_KEY.test(key)) add(v);
    } else if (Array.isArray(v)) {
      for (const x of v) walk(x, key, depth + 1);
    } else if (typeof v === "object") {
      for (const [k, x] of Object.entries(v as Record<string, unknown>)) walk(x, k, depth + 1);
    }
  };
  walk(result, "", 0);
  return { ids: [...seen], more };
}

/** How many ids a screen's records.shown entry keeps: enough for every row a list renders. */
export const MAX_SHOWN_IDS = 1_000;

/**
 * How many of a screen's rows are people not shown to this person earlier today: a row is new when
 * none of its ids (contact, record, email) is in `seen`. Re-opening a page, or the same candidate on
 * two applications, counts once. `rows` is the list the screen rendered.
 */
export function countNewRows(rows: unknown, seen: ReadonlySet<string>): number {
  const list = Array.isArray(rows) ? rows : [rows];
  const taken = new Set(seen);
  let n = 0;
  for (const row of list) {
    const { ids } = recordIds(row, MAX_SHOWN_IDS);
    if (!ids.length || ids.some((id) => taken.has(id))) continue;
    n++;
    for (const id of ids) taken.add(id);
  }
  return n;
}

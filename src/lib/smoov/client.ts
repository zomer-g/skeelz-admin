/**
 * SMOOV REST API (https://rest.smoove.io): reads lists and campaign statistics,
 * and writes one thing only — the bulk import that fills the job-seekers list
 * (`src/lib/smoov/push.ts`). Nothing here deletes, unsubscribes or sends.
 *
 * The spec names an API key in the Authorization header without saying whether
 * it takes a "Bearer " prefix; integrations in the wild use both. The client
 * tries Bearer first, falls back to the bare key on 401/403, and remembers what
 * worked. There is no endpoint that lists campaigns, so campaigns to track are
 * registered by id in the admin screen.
 */

const BASE = "https://rest.smoove.io/v1";
const TIMEOUT_MS = 60_000;

export class SmoovError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message);
  }
}

export function smoovConfigured(): boolean {
  return Boolean(process.env.SMOOV_API_KEY);
}

type AuthScheme = "bearer" | "raw";
let workingScheme: AuthScheme | null = null;

export function smoovAuthScheme(): AuthScheme | null {
  return workingScheme;
}

/**
 * The account's key has full permissions, so the client cannot send just any
 * request: GET anywhere, POST only to the paths named here.
 */
const WRITABLE = new Set(["/Contacts_BulkImport"]);

async function request<T>(
  method: "GET" | "POST",
  path: string,
  query: Record<string, string | number | boolean> = {},
  body?: unknown,
): Promise<T> {
  if (method !== "GET" && !WRITABLE.has(path)) throw new SmoovError(`SMOOV ${method} ${path} is not allowed`, 0);
  // Trimmed: a key pasted into an env form easily picks up a trailing newline, which SMOOV rejects as 401.
  const key = process.env.SMOOV_API_KEY?.trim();
  if (!key) throw new SmoovError("SMOOV_API_KEY is not set", 0);

  const url = new URL(`${BASE}${path}`);
  for (const [k, v] of Object.entries(query)) url.searchParams.set(k, String(v));

  const schemes: AuthScheme[] = workingScheme ? [workingScheme] : ["bearer", "raw"];
  let last: SmoovError | null = null;
  for (const scheme of schemes) {
    const res = await fetch(url, {
      method,
      headers: {
        Authorization: scheme === "bearer" ? `Bearer ${key}` : key,
        Accept: "application/json",
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (res.ok) {
      workingScheme = scheme;
      const text = await res.text();
      return (text ? JSON.parse(text) : null) as T;
    }
    last = new SmoovError(`SMOOV ${res.status}: ${(await res.text()).slice(0, 300)}`, res.status);
    if (res.status !== 401 && res.status !== 403) break;
  }
  throw last ?? new SmoovError("SMOOV request failed", 0);
}

function get<T>(path: string, query: Record<string, string | number | boolean> = {}): Promise<T> {
  return request<T>("GET", path, query);
}

async function allPages<T>(path: string, query: Record<string, string | number | boolean> = {}, pageSize = 100): Promise<T[]> {
  const out: T[] = [];
  for (let page = 1; page <= 500; page++) {
    const batch = await get<T[] | null>(path, { ...query, page, itemsPerPage: pageSize });
    if (!Array.isArray(batch) || batch.length === 0) break;
    out.push(...batch);
    if (batch.length < pageSize) break;
  }
  return out;
}

export interface SmoovList {
  id: number;
  name?: string;
  contactsCount?: number;
  [key: string]: unknown;
}

export type SmoovStatistics = Record<string, unknown>;

/** A system or custom contact field; `key` is what payloads use ("email", "i65"). */
export interface SmoovContactField {
  key: string;
  label: string;
  type?: string;
  custom: boolean;
}

/** One contact of a bulk import, as SMOOV names the fields. */
export interface SmoovBulkContact {
  email: string;
  firstName?: string;
  lastName?: string;
  cellPhone?: string;
  customFields: Record<string, string | boolean>;
}

export interface SmoovImportReport {
  inserted?: number;
  updated?: number;
  invalids?: number;
  blacklisted?: number;
  quotaExceeded?: number;
}

/** SMOOV takes at most this many contacts per bulk import, and one import at a time. */
export const BULK_IMPORT_MAX = 500;

export const smoov = {
  lists: () => allPages<SmoovList>("/Lists", { includeContactsCount: true }),
  campaignStatistics: (campaignId: number) =>
    get<SmoovStatistics>(`/Campaigns/${encodeURIComponent(String(campaignId))}/Statistics`, { by: "CampaignId" }),
  contactFields: () => get<SmoovContactField[]>("/Account/ContactFields"),
  /** The addresses subscribed to a list, lowercased. */
  listEmails: async (listId: number) =>
    (await allPages<{ email?: string }>(`/Lists/${encodeURIComponent(String(listId))}/Contacts`, { fields: "id,email" }))
      .map((c) => c.email?.trim().toLowerCase())
      .filter((e): e is string => Boolean(e)),
  /** Every unsubscribed or blacklisted address in the account, lowercased (one response, not paged). */
  blacklistedEmails: async () => {
    const body = await get<{ email?: string }[] | { blacklistContacts?: { email?: string }[] } | null>("/Contacts_Blacklisted", { fields: "id,email" });
    const rows = Array.isArray(body) ? body : (body?.blacklistContacts ?? []);
    return rows.map((c) => c.email?.trim().toLowerCase()).filter((e): e is string => Boolean(e));
  },
  /**
   * Adds or updates contacts and subscribes them to one list. Unsubscribed and
   * blacklisted addresses stay that way (SMOOV reports them as `blacklisted`).
   */
  bulkImport: (listId: number, contacts: SmoovBulkContact[]) =>
    request<{ status?: string; importReport?: SmoovImportReport }>("POST", "/Contacts_BulkImport", {}, {
      lists_ToSubscribe: [listId],
      contacts,
    }),
};

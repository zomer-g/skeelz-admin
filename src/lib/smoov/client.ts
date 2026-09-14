/**
 * SMOOV REST API (https://rest.smoove.io), read-only use.
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

async function get<T>(path: string, query: Record<string, string | number | boolean> = {}): Promise<T> {
  // Trimmed: a key pasted into an env form easily picks up a trailing newline, which SMOOV rejects as 401.
  const key = process.env.SMOOV_API_KEY?.trim();
  if (!key) throw new SmoovError("SMOOV_API_KEY is not set", 0);

  const url = new URL(`${BASE}${path}`);
  for (const [k, v] of Object.entries(query)) url.searchParams.set(k, String(v));

  const schemes: AuthScheme[] = workingScheme ? [workingScheme] : ["bearer", "raw"];
  let last: SmoovError | null = null;
  for (const scheme of schemes) {
    // Read-only by construction: the account's key has full permissions, so this
    // client must never gain a request method other than GET.
    const res = await fetch(url, {
      method: "GET",
      headers: { Authorization: scheme === "bearer" ? `Bearer ${key}` : key, Accept: "application/json" },
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

export const smoov = {
  lists: () => allPages<SmoovList>("/Lists", { includeContactsCount: true }),
  campaignStatistics: (campaignId: number) =>
    get<SmoovStatistics>(`/Campaigns/${encodeURIComponent(String(campaignId))}/Statistics`, { by: "CampaignId" }),
};

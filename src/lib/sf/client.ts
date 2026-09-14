import type { SfDescribe, SfGlobalDescribe, SfLimits, SfQueryResult } from "./types";

/**
 * A deliberately small, read-only Salesforce REST client.
 *
 * Phase 1 must never write to Salesforce, and the surest way to guarantee that
 * is a client that cannot: apart from the OAuth token request, every call here
 * is an HTTP GET. The integration user's read-only permission set is the second
 * line of defence. Write support arrives as a separate module in a later phase.
 *
 * Auth is the OAuth 2.0 Client Credentials flow of an External Client App whose
 * Run-As user is the integration user (docs/setup-salesforce-eca.md).
 */

const DEFAULT_API_VERSION = "65.0";
const TOKEN_MAX_AGE_MS = 60 * 60_000;
const REQUEST_TIMEOUT_MS = 90_000;

interface Token {
  accessToken: string;
  instanceUrl: string;
  fetchedAt: number;
}

export class SalesforceError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly errorCode?: string,
  ) {
    super(message);
  }
}

function config() {
  const loginUrl = process.env.SF_LOGIN_URL?.replace(/\/+$/, "");
  const clientId = process.env.SF_CLIENT_ID;
  const clientSecret = process.env.SF_CLIENT_SECRET;
  if (!loginUrl || !clientId || !clientSecret) {
    throw new SalesforceError("Salesforce is not configured (SF_LOGIN_URL, SF_CLIENT_ID, SF_CLIENT_SECRET)", 0, "NOT_CONFIGURED");
  }
  return { loginUrl, clientId, clientSecret, apiVersion: process.env.SF_API_VERSION || DEFAULT_API_VERSION };
}

export function salesforceConfigured(): boolean {
  return Boolean(process.env.SF_LOGIN_URL && process.env.SF_CLIENT_ID && process.env.SF_CLIENT_SECRET);
}

let token: Token | null = null;
let pendingToken: Promise<Token> | null = null;

async function requestToken(): Promise<Token> {
  const { loginUrl, clientId, clientSecret } = config();
  const res = await fetch(`${loginUrl}/services/oauth2/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "client_credentials", client_id: clientId, client_secret: clientSecret }),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  const body = (await res.json().catch(() => ({}))) as Record<string, string>;
  if (!res.ok || !body.access_token) {
    // The error body names the problem (invalid_client, no run-as user…) and never echoes the secret.
    throw new SalesforceError(
      `Salesforce token request failed: ${body.error ?? res.status} ${body.error_description ?? ""}`.trim(),
      res.status,
      body.error,
    );
  }
  return { accessToken: body.access_token, instanceUrl: body.instance_url!.replace(/\/+$/, ""), fetchedAt: Date.now() };
}

async function revokeToken(t: Token): Promise<void> {
  try {
    const { loginUrl } = config();
    await fetch(`${loginUrl}/services/oauth2/revoke`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ token: t.accessToken }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch {
    // Best effort: a failed revoke only delays the permission refresh.
  }
}

async function getToken(forceRefresh: boolean): Promise<Token> {
  const stale = token !== null && Date.now() - token.fetchedAt >= TOKEN_MAX_AGE_MS;
  if (!forceRefresh && token && !stale) return token;
  // Concurrent callers share one token request.
  pendingToken ??= (async () => {
    // The Client Credentials flow hands back the Run-As user's existing session
    // while it lives, and a session keeps the permissions it started with. The
    // sync never lets it idle out, so without this a permission granted in
    // Salesforce would never take effect. Ending it hourly bounds that to an hour.
    if (stale && token) await revokeToken(token);
    return requestToken();
  })().finally(() => {
    pendingToken = null;
  });
  token = await pendingToken;
  return token;
}

let lastLimitInfo: string | null = null;

async function get<T>(pathOrUrl: string): Promise<T> {
  for (let attempt = 0; attempt < 2; attempt++) {
    const t = await getToken(attempt > 0);
    const url = pathOrUrl.startsWith("http") ? pathOrUrl : `${t.instanceUrl}${pathOrUrl}`;
    const res = await fetch(url, {
      method: "GET",
      headers: { Authorization: `Bearer ${t.accessToken}`, Accept: "application/json" },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    lastLimitInfo = res.headers.get("sforce-limit-info") ?? lastLimitInfo;

    // An expired or revoked session: fetch a fresh token once and retry.
    if (res.status === 401 && attempt === 0) continue;

    if (!res.ok) {
      const text = await res.text();
      let errorCode: string | undefined;
      let message = text.slice(0, 500);
      try {
        const [first] = JSON.parse(text) as { errorCode?: string; message?: string }[];
        errorCode = first?.errorCode;
        message = first?.message ?? message;
      } catch {
        // Not JSON; keep the raw text.
      }
      throw new SalesforceError(`Salesforce ${res.status}${errorCode ? ` ${errorCode}` : ""}: ${message}`, res.status, errorCode);
    }
    return (await res.json()) as T;
  }
  throw new SalesforceError("Salesforce rejected a freshly issued token", 401, "INVALID_SESSION_ID");
}

function versionPath(): string {
  return `/services/data/v${config().apiVersion}`;
}

export interface QueryOptions {
  /** queryAll: also returns deleted (recycle bin) and archived records. */
  includeDeleted?: boolean;
}

export const sf = {
  apiVersion: () => config().apiVersion,

  instanceUrl: async () => (await getToken(false)).instanceUrl,

  /** "api-usage=1234/100000" from the last response, for sync bookkeeping. */
  lastLimitInfo: () => lastLimitInfo,

  /** Yields one page (≤2,000 records) at a time so large objects stream instead of piling up in memory. */
  async *queryPages<T>(soql: string, options: QueryOptions = {}): AsyncGenerator<T[], number> {
    const endpoint = options.includeDeleted ? "queryAll" : "query";
    let next: string | undefined = `${versionPath()}/${endpoint}?q=${encodeURIComponent(soql)}`;
    let total = 0;
    while (next) {
      const page: SfQueryResult<T> = await get<SfQueryResult<T>>(next);
      total = page.totalSize;
      yield page.records;
      next = page.done ? undefined : page.nextRecordsUrl;
    }
    return total;
  },

  async query<T>(soql: string, options: QueryOptions = {}): Promise<T[]> {
    const all: T[] = [];
    for await (const page of sf.queryPages<T>(soql, options)) all.push(...page);
    return all;
  },

  /** For `SELECT COUNT() FROM …`, which returns only totalSize. */
  async count(soql: string): Promise<number> {
    const result = await get<SfQueryResult<never>>(`${versionPath()}/query?q=${encodeURIComponent(soql)}`);
    return result.totalSize;
  },

  describeGlobal: () => get<SfGlobalDescribe>(`${versionPath()}/sobjects`),

  describe: (objectName: string) => get<SfDescribe>(`${versionPath()}/sobjects/${encodeURIComponent(objectName)}/describe`),

  limits: () => get<SfLimits>(`${versionPath()}/limits`),

  /** The Run-As user the token acts for. */
  userInfo: () =>
    get<{ preferred_username: string; name: string; user_id: string; organization_id: string }>("/services/oauth2/userinfo"),

  /** API versions the instance serves; needs no token. */
  async availableVersions(): Promise<string[]> {
    const res = await fetch(`${await sf.instanceUrl()}/services/data/`, { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
    const body = (await res.json()) as { version: string }[];
    return body.map((v) => v.version);
  },
};

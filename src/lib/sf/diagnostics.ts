import { sf, SalesforceError } from "./client";

export interface ObjectAccess {
  name: string;
  ok: boolean;
  count?: number;
  error?: string;
}

export interface ConnectionResult {
  instanceUrl: string;
  runAs: string | null;
  apiVersion: string;
  apiVersionAvailable: boolean | null;
  apiUsage: { used: number; max: number } | null;
  objects: ObjectAccess[];
  ms: number;
}

const CORE_OBJECTS = ["Account", "Contact", "Case"];

/**
 * Proves the whole chain in one go: the token request (External Client App +
 * Run-As user), then a count per core object, which fails per object when the
 * permission set is missing a Read. Throws only when the token itself fails.
 */
export async function testConnection(): Promise<ConnectionResult> {
  const started = Date.now();
  const instanceUrl = await sf.instanceUrl();

  const [runAs, versions] = await Promise.all([
    sf
      .userInfo()
      .then((u) => u.preferred_username)
      .catch(() => null),
    sf.availableVersions().catch(() => null),
  ]);
  const apiVersion = sf.apiVersion();

  const objects = await Promise.all(
    CORE_OBJECTS.map(async (name): Promise<ObjectAccess> => {
      try {
        return { name, ok: true, count: await sf.count(`SELECT COUNT() FROM ${name}`) };
      } catch (err) {
        return { name, ok: false, error: err instanceof SalesforceError ? err.message : String(err) };
      }
    }),
  );

  // /limits needs "View Setup and Configuration"; a read-only user may not have it.
  const limits = await sf.limits().catch(() => null);
  const daily = limits?.DailyApiRequests;

  return {
    instanceUrl,
    runAs,
    apiVersion,
    apiVersionAvailable: versions ? versions.includes(apiVersion) : null,
    apiUsage: daily ? { used: daily.Max - daily.Remaining, max: daily.Max } : null,
    objects,
    ms: Date.now() - started,
  };
}

import { readFileSync } from "node:fs";
import { JWT } from "google-auth-library";

/**
 * Service-account access to Google's REST APIs (GA4 Data, Tag Manager).
 * Plain REST with a JWT token keeps the server lean — the official SDKs pull in
 * gRPC and hundreds of megabytes the dashboard doesn't need. Scopes are
 * read-only; the service account is added as Viewer (GA4) / Read (GTM).
 */

const SCOPES = [
  "https://www.googleapis.com/auth/analytics.readonly",
  "https://www.googleapis.com/auth/tagmanager.readonly",
];

export class GoogleError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message);
  }
}

interface ServiceAccount {
  client_email?: string;
  private_key?: string;
}

/**
 * Production: the key's JSON in GOOGLE_SERVICE_ACCOUNT_JSON (an xhostd secret).
 * Local development: GOOGLE_SERVICE_ACCOUNT_FILE pointing at the downloaded key
 * in the gitignored .secrets/ folder, so it never has to be pasted into .env.
 */
function readServiceAccount(): ServiceAccount | null {
  let raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (!raw && process.env.GOOGLE_SERVICE_ACCOUNT_FILE) {
    try {
      raw = readFileSync(process.env.GOOGLE_SERVICE_ACCOUNT_FILE, "utf8");
    } catch {
      return null;
    }
  }
  if (!raw) return null;
  try {
    // Editors on Windows sometimes save the key with a byte-order mark.
    return JSON.parse(raw.replace(/^﻿/, "").trim()) as ServiceAccount;
  } catch {
    return null;
  }
}

export function googleConfigured(): boolean {
  const sa = readServiceAccount();
  return Boolean(sa?.client_email && sa.private_key);
}

/** The address to add in GA4 / GTM user management. Not a secret. */
export function serviceAccountEmail(): string | null {
  return readServiceAccount()?.client_email ?? null;
}

let client: JWT | null = null;

function jwt(): JWT {
  if (client) return client;
  const sa = readServiceAccount();
  if (!sa) throw new GoogleError("GOOGLE_SERVICE_ACCOUNT_JSON is missing or not valid JSON", 0);
  if (!sa.client_email || !sa.private_key) {
    throw new GoogleError("GOOGLE_SERVICE_ACCOUNT_JSON has no client_email / private_key", 0);
  }
  // A key pasted through an env form sometimes arrives with literal "\n".
  client = new JWT({ email: sa.client_email, key: sa.private_key.replace(/\\n/g, "\n"), scopes: SCOPES });
  return client;
}

export async function googleFetch<T>(url: string, init: { method?: "GET" | "POST"; body?: unknown } = {}): Promise<T> {
  const { token } = await jwt().getAccessToken();
  const res = await fetch(url, {
    method: init.method ?? "GET",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", Accept: "application/json" },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
    signal: AbortSignal.timeout(90_000),
  });
  const text = await res.text();
  if (!res.ok) {
    let message = text.slice(0, 400);
    try {
      message = (JSON.parse(text) as { error?: { message?: string } }).error?.message ?? message;
    } catch {
      // Not JSON; keep the raw text.
    }
    throw new GoogleError(`Google ${res.status}: ${message}`, res.status);
  }
  return JSON.parse(text) as T;
}

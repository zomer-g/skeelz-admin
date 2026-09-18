# SKEELZ Connect — one API standard across the three apps

Apps:
- **admin**: `skeelz`, https://skeelz-zomerg.xhostd.app, repo `Skeelz`. Salesforce mirror and dashboard.
- **crm**: `skeelz-crm`, https://skeelz-crm-zomerg.xhostd.app.
- **site**: `skeelz-site`, https://skeelz-site-zomerg.xhostd.app.

Every app implements the same five parts. Copy this file into each repo as `docs/connect-api.md`, adapted where it says "per app".

## 1. API keys, issued in the UI (inbound)
- **Screen:** new admin screen `/admin/api` ("API ומפתחות"), admin role only. It creates, lists and revokes keys.
- **Table `api_keys`:**
  - id (uuid)
  - name — who it is for, e.g. "site → crm"
  - `prefix` — the first 8 characters after `sk_<app>_`, shown in lists
  - `hash` — sha256 of the full key, hex
  - `scopes text[]`
  - created_by, created_at
  - expires_at (nullable), last_used_at, last_used_ip, revoked_at
- **Key format:** `sk_<app>_<43 chars base64url of 32 random bytes>`.
  - Shown exactly once on creation, with a copy button.
  - Never stored in plain text and never logged.
- **Verification:**
  - Read from `Authorization: Bearer <key>` only. A key in the URL gets 400 `token_in_url`.
  - Look up by sha256 hash.
  - Compare in constant time.
  - Reject revoked or expired keys.
  - Check the route's scope: 403 `insufficient_scope`.
  - Update last_used at most once a minute.
- **Env tokens that already exist keep working as legacy keys**, so nothing breaks:
  - admin: `API_TOKEN` / `API_TOKEN_PREVIOUS` get scopes `jobs:read metrics:read`; `SITE_FEED_TOKEN` gets `site-feed:read`.
  - crm: `CRM_INTAKE_TOKEN` (+ `_PREVIOUS`) gets `intake:write`.
  - The screen lists them as "מפתח מהגדרות השרת (env)" and they cannot be revoked in the UI.
- **Rate limits and lockout:** the in-memory limits each app already has, now per key (bucket = key id).
- **Audit:** `api_key.created`, `api_key.revoked`, `api.denied` (throttled), `api.used` (first use per hour per key).

## 2. Connections to the other apps (outbound)
- **Screen:** `/admin/connections` ("חיבורים"), admin only. One row per peer app: base URL, the key that peer issued to us, enabled on/off.
- **Table `connections`:**
  - peer (`admin` | `crm` | `site`), base_url
  - key_ciphertext, key_last4
  - enabled, updated_by, updated_at
  - last_check_at, last_check_ok, last_check_detail
- **Key storage:** encrypted with AES-256-GCM.
  - The encryption key is env `CONNECT_SECRET_KEY` (secret, 64 hex = 32 bytes, already set on all three apps).
  - Format `v1:<iv b64url>:<tag b64url>:<ct b64url>`.
  - Never sent back to the browser. The form shows only `••••last4`; an empty field means "keep".
- **base_url:** must be `https://` (or `http://localhost` in dev) with no path, query or credentials, to avoid SSRF.
- **"בדיקת חיבור" button:** calls the peer's `GET /api/v1/ping` with a 5s timeout. Shows the peer app, its version and the scopes our key has there, and stores last_check_*.
- **Fallback:** when no DB row exists for a peer, the connection comes from the existing env, so today's wiring keeps working:
  - site → admin: `ADMIN_API_URL` + `SITE_FEED_TOKEN`
  - site → crm: `CRM_URL` + `CRM_INTAKE_TOKEN`
- **One helper:** `src/lib/connect/client.ts` → `peerFetch(peer, path, init)`. It resolves the connection (DB first, then env), sets the Bearer header, applies the timeout, returns parsed JSON or throws a typed error, and never logs the key. Every cross-app call goes through it.

## 3. Common API contract
- **Paths:** all under `/api/v1/`. JSON UTF-8, `Cache-Control: no-store`, `X-Content-Type-Options: nosniff`.
- **Errors:** always `{"error":{"code":"snake_case","message":"..."}}`. Codes:
  - 400 invalid / token_in_url
  - 401 unauthorized
  - 403 insufficient_scope
  - 404 not_found
  - 413, 415, 429 (with Retry-After)
  - 503 disabled
- **Lists:** `?limit=` (1–200, default 50) and `?cursor=` (opaque), returning `{data:[...], next_cursor|null}`. Existing endpoints keep their current shape (additive only).
- **Rate limit headers:** `X-RateLimit-Limit`, `X-RateLimit-Remaining`, `X-RateLimit-Reset`.
- **`GET /api/v1/ping`:** any valid key. Returns `{"app":"admin|crm|site","version":"<git sha short or XHOST_SHA>","time":ISO,"key":{"name","scopes"}}`.
- **`GET /api/v1/openapi.json`:** no auth needed (it holds no data). An OpenAPI 3.1 document of that app's endpoints, generated from one TS spec object, the same source as the docs page.
- **Docs page** `/api-docs` (signed-in staff): human docs from the same spec, including the scopes table and curl examples with `<KEY>` placeholders.
- **Personal data:** no endpoint returns candidate names, emails, phones or files unless this spec lists the scope explicitly. The admin app's rule (jobs, statuses, ids, aggregates only) stays.

## 4. Scopes per app
**admin**
- `jobs:read` — existing /api/v1/jobs, /jobs/:id
- `metrics:read` — existing /api/v1/metrics
- `site-feed:read` — existing /api/v1/site/jobs

**crm**
- `intake:write` — existing POST /api/v1/intake/applications. Also keep the current path `/api/intake/applications` as an alias.
- `jobs:read` — GET /api/v1/jobs: jobs with status, site_job_key, flags; no contacts.
- `applications:read` — GET /api/v1/applications?since=ISO: id, job id, site_job_key, status, status_changed_at, source, site_application_id. No candidate personal data.
- `applications:status:read` — GET /api/v1/applications/by-site-id/:site_application_id. The status of one application the site forwarded, so the site can show "נשלחה / בטיפול".

**site**
- `content:read` — GET /api/v1/content: current editable texts, pins and active banners.
- `applications:read` — GET /api/v1/applications?since=: site_application_id, job_key, created_at, forward status, crm_application_id. No profile fields.

## 5. User management (crm and site; admin already has it)
- **Copy the admin app's model and screens:**
  - Tables `users` (sub, email, name, role, status), `invites` (email, role, expires, created_by) and `access_requests` (refused sign-ins).
  - Invite redeemed on first sign-in, keyed by `sub`.
  - `ADMIN_EMAILS` stays the bootstrap super-admin and cannot be demoted or removed in the UI.
  - Screens `/admin/users`: list, invite, change role, suspend, reactivate, pending access requests with approve/dismiss.
  - Audit of every change.
  - Reference implementation: the admin app `src/lib/auth/session.ts`, `src/lib/auth/roles.ts`, `src/app/(app)/admin/users/*`.
- **Roles:**
  - **crm:** viewer (read everything) < recruiter (edit records, change statuses, tasks) < admin (users, API keys, connections, seed).
  - **site:** editor (texts, pins, banners) < admin (users, API keys, connections, applications view).
  - Every page and action checks the role on the server.
- **Admin "view as" a lower role** (like the admin app): nice to have, only if cheap.
- The site stays invisible to anyone without a role, as before.


## Amendments (security review)

The same in all three apps.

- **C1 SSRF.** A peer `base_url` is https only, and its host may not be an IP literal, `localhost`, a name ending
  `.localhost` `.local` `.internal` `.lan`, or a single label; no credentials, path, query or fragment. Only in
  development, `http://localhost:<port>` and `http://127.0.0.1:<port>` are also allowed. `peerFetch` checks again before
  every request and resolves the host: any loopback, private, link-local, CGNAT, unspecified, ULA, multicast or
  IPv4-mapped address of those is refused. Codes `invalid_base_url` / `blocked_address`. Still `redirect: "error"` and 5s.
- **C2.** Saving a connection with a different origin requires the key again ("כתובת השתנתה — יש להזין את המפתח מחדש").
- **C3.** Ciphertext format `v2:`: AES-256-GCM with a 12-byte IV, a 16-byte tag (`authTagLength: 16`), and the peer name
  as AAD. `v1` is invalid: re-enter the key.
- **C4.** Any query parameter whose value starts with `sk_` also gets 400 `token_in_url`.
- **C5.** The key is checked before the lockout: a valid key is never refused because its address is locked out. Only a
  missing or invalid key counts toward, or is refused by, the lockout. The address `unknown` is never locked out or
  limited per address; only per-key limits apply to it.
- **C6.** `peerFetch` refuses answers over 5 MB (by `Content-Length`, and by counting the streamed bytes), before parsing
  JSON. The site's job feed may use 10 MB.
- **C7.** Errors are logged as `where` + the pg SQLSTATE / our typed error's code / the error's class name, through one
  helper (`logError`). Never a database error's message (it holds SQL and values), request bodies or form data.

---

## In this app (admin)

How the admin app implements the parts above. Where the spec left a choice open, the choice is listed.

- **Code:**
  - Contract (scopes, legacy keys, endpoints, errors, the OpenAPI generator): `src/lib/api/spec.ts`. The docs page
    (`/api-docs`) and `GET /api/v1/openapi.json` are both built from it.
  - Key issue and check: `src/lib/api/keys.ts`. The gate: `withApiKey(path, scope, handler)` in `src/lib/api/inbound.ts`;
    it refuses to load if the scope a route declares differs from `spec.ts`.
  - Connections: `src/lib/connect/client.ts` (`peerFetch`, `normalizeBaseUrl`), `src/lib/connect/crypto.ts` (AES-256-GCM).
  - Screens: `/admin/api` and `/admin/connections`. The old "חיבורים" tab for Salesforce, Google and SMOOV is now
    `/admin/integrations` "מקורות נתונים".
  - Tables: `api_keys`, `connections` (migration `drizzle/0009_*`).
- **Peers:** crm and site. Admin has no env fallback: it called neither app before SKEELZ Connect, so a peer without a
  `connections` row is "not configured".
- **Choices where the spec is open:**
  - Legacy env tokens are compared first, in constant time, then a value that starts with `sk_admin_` is looked up by
    hash. Each legacy token is its own key for rate limits (`env:API_TOKEN`, `env:API_TOKEN_PREVIOUS`, `env:SITE_FEED_TOKEN`).
  - The API has no global off switch any more, so 503 `disabled` is never returned here: with no key at all every call is 401.
  - Existing endpoints keep their error codes (`invalid_parameter`, `invalid_id`, `range_too_long`) and `/api/v1/jobs` keeps
    `page` paging; `cursor` paging is for new list endpoints.
  - `openapi.json` needs no key but is limited to 30 requests a minute per address.
  - C1: the resolve-time address check lives in `src/lib/net/public-address.ts`, shared with the outbound webhooks.
    C7: `src/lib/log.ts` (`logError`, and `safeErrorMessage` for errors that are stored, such as `sync_state.last_error`).
  - `version` is `XHOST_SHA` (7 characters), else `git rev-parse --short HEAD`, else `dev`.
  - "בדיקת חיבור" also fails when the peer answers with a different `app` than expected (a wrong URL).
  - Key expiry is chosen at creation: none, 30, 90 or 365 days.

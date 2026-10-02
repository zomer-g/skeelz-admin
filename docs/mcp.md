# SKEELZ Admin MCP server

AI clients (Claude, ChatGPT, Claude Code, Cursor, the MCP Inspector) connect to the admin's data at
`https://<host>/mcp`. Each connection acts **as one signed-in person, with that person's role on the
site**. Users find the address and their own connections at `/connectors`; admins see everyone's at
`/admin/mcp`.

## 1. Who may connect, and with what

- **Sign-in** is the site's own Google sign-in through xhostd (`/xhost-auth/`). There is no separate
  Google OAuth client: the authorize page is an ordinary page of the site, so it sees the
  `__Host-xhost_id` cookie, and `pageAuth("viewer")` applies the usual access rules (ADMIN_EMAILS,
  active `users` row, open invite). An anonymous visitor gets the sign-in screen and comes back.
- **Consent.** The person sees which application asks, where it will be sent back, and picks the
  connection's **role ceiling** (`max_role`): any role up to their own. An admin can give Claude a
  viewer-only connection.
- **Effective role = min(site role now, ceiling)**, computed on **every** request from the `users`
  table (`verifyAccessToken`, `src/lib/mcp/oauth.ts`). Changing someone's role or deactivating them at
  `/admin/users` takes effect on their connections at the next call; a deactivated user's tokens stop
  working. ADMIN_EMAILS count as admin, as on the site. The "view as" preview cookie plays no part.
- **Tools follow the role** (`src/lib/mcp/tools.ts`, each tool has `minRole`): `tools/list` returns only
  what the role allows and `tools/call` checks again (refusals are audited as `mcp.denied`).

| Role | Tools |
|---|---|
| viewer | `whoami`, `dashboard_summary`, `marketing_summary`, `ga_report`, `list_campaigns`, `get_campaign`, `search_jobs`, `get_job`, `search_applications`, `get_application`, `search_candidates`, `get_candidate`, `lookup_email`, `search_companies`, `get_company`, `search_payments` |
| editor | + `update_campaign`, `link_campaign_job`, `unlink_campaign_job` (same code as the campaign page, `src/lib/campaigns/edit.ts`) |
| admin | + `list_users`, `query_audit_log`, `sync_status` (read only) |

`search_jobs` filters combine (AND): `active_only` (default true), `paid_only`, `marked_only` (the site's crown /
featured mark, `isMarked_cambium__c`), and `total` counts what matches all of them. `get_job` and `get_application`
return every field of the Salesforce job / application card; `search_companies` counts marked jobs per company.

Google Analytics: every figure the sync keeps (six GA4 reports, daily, `src/lib/integrations/marketing-sync.ts`) is
reachable. `ga_report` groups and sums any of them (pages, events, channels, campaigns, campaign_events,
campaign_landing_pages) by any of their dimensions and by date / week / month, with filters; its column names come only
from the whitelists in `src/lib/metrics/ga-report.ts` and every value is a query parameter. `marketing_summary` is the marketing
tab, `get_campaign` the campaign page, and `get_job` carries the job's GA (totals, every event, opens per day). GA keeps
users per day, so summed users are not unique users over a range. GTM container snapshots are not exposed.

This mirrors the site: viewers read every dashboard and record screen, editors also edit campaign
settings, admins also manage. Nothing writes to Salesforce. Candidate files are not served over MCP.
Admin *write* operations (inviting users, keys, sync) are deliberately not exposed.

## 2. OAuth 2.1 (what the clients see)

| Path | What |
|---|---|
| `/.well-known/oauth-protected-resource/mcp` (and without `/mcp`) | RFC 9728. `resource` = `<origin>/mcp`, `authorization_servers` = `[<origin>]` |
| `/.well-known/oauth-authorization-server` | RFC 8414. Issuer = the origin |
| `POST /mcp/oauth/register` | Dynamic client registration (RFC 7591). Public clients only (PKCE, no secret); redirect URIs https or http-loopback; 10/hour per address, 200/day overall |
| `/mcp/oauth/authorize` | The consent page. PKCE S256 required; `redirect_uri` must match the registration exactly, and nothing redirects until it does; RFC 8707 `resource`, if sent, must be this server; the answer carries `iss` (RFC 9207) |
| `POST /mcp/oauth/token` | `authorization_code` (single-use, 10 min, PKCE) and `refresh_token` (rotating: the old one dies at once). Form-encoded or JSON |
| `POST /mcp` | Streamable HTTP, stateless JSON responses (no sessions, no SSE; GET/DELETE → 405). Without a valid token: 401 + `WWW-Authenticate: Bearer … resource_metadata=…` |

Tokens are opaque (`skm_at_…` 1 hour, `skm_rt_…` 30 days sliding), and only their sha256 is stored, in
`mcp_grants` (one row per approved connection). No new secret or env variable is needed. The public
origin comes from the request's host only when it is listed in `XHOST_AUTH_AUDIENCES`.

The consent form posts through a server action and the browser then navigates to the client itself:
a plain form post that redirects off-site would be blocked by the CSP's `form-action 'self'`.

## 3. Logging and limits

- Audit (`/admin/audit`, actions `mcp.*`): `mcp.authorized` / `mcp.refused` (consent), `mcp.connected`
  (token issued), `mcp.initialize`, `mcp.call` (every tool call with its arguments, like `page.view`),
  `mcp.denied`, `mcp.revoked`.
- `mcp_grants` keeps last use, address and a call count, shown on both screens.
- 60 calls/min per connection; `dashboard_summary` and `list_campaigns` 10/min per person; 30 wrong
  tokens per address per 10 min → 10 min lockout. In memory, like the API limits.

## 4. Connecting

- Claude: Settings → Connectors → Add custom connector → `https://<host>/mcp`.
- Claude Code: `claude mcp add --transport http skeelz https://<host>/mcp`.
- Disconnect at `/connectors` (own) or `/admin/mcp` (any): immediate.

## 5. Adding a tool

Add an entry to `TOOLS` in `src/lib/mcp/tools.ts` with the `minRole` the matching screen or action
uses (`pageAuth` / `requireUser`), set `writes: true` if it changes anything, reuse the function the
page uses, and validate ids with `isSfId` before they reach a query. The connect page's tool table
follows automatically; update the table above.

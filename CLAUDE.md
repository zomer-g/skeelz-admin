# SKEELZ Admin

Admin + dashboard platform for SKEELZ (jobs.skeelz.co.il) over Salesforce. Hebrew, RTL.
The approved plan lives at `C:\Users\zomer\.claude\plans\dazzling-floating-island.md` (milestones M0–M6).

## Stack
Next.js 16 (App Router) · React 19 · TypeScript · Tailwind 4 · Drizzle ORM + pg · jose. Hosted on xhostd
(template `app`: `install.sh` builds, `launch.sh` migrates + `next start`). Exact-pinned dependencies.

## Commands
- `npm run dev` — local (set `DEV_AUTH_EMAIL` + `DATABASE_URL`; there is no xhostd sign-in on localhost)
- `npm run typecheck` · `npm test` (node:test, `src/**/*.test.ts`) · `npm run build`
- `npm run db:generate` after editing `src/lib/db/schema.ts` (commit `drizzle/`); `npm run db:migrate` applies

## Rules that matter
- **Auth:** identity = xhostd SSO cookie `__Host-xhost_id`, verified in `src/lib/auth/xhost.ts`. Access =
  `ADMIN_EMAILS` / active `users` row / open invite (`src/lib/auth/session.ts`). Every page calls
  `pageAuth(minRole, path)`; every server action / route handler calls `requireUser(minRole)` (`/api/v1` routes use
  `withApiKey` instead). Never rely on the layout.
  The only pages without it hold no data: `/accessibility` and `/privacy` (public by law, framed by `PublicDoc`) and `not-found.tsx`.
- **Security headers:** CSP and friends in `next.config.ts`. The browser loads nothing cross-origin (fonts self-hosted,
  GA/SMOOV/SF server-side only) — keep it that way or extend the CSP. The candidate file route sends its own sandboxing
  CSP and is limited per Israel day (`src/lib/security/files.ts`): 20 files a user, an admin alert at the 10th, and an admin
  grants 30 more at a time at `/admin/security`; counted from the audit log.
- **Security & privacy duties** (`docs/cv-security.md`): every candidate-file open and every search inside CVs (with its
  results, `cvs.text_search`) is logged; logs are kept 24 months and purged nightly (`purgeOldLogs`, `LOG_RETENTION_MONTHS`).
  Admins confirm every active user's access each Israel month at `/admin/users` (`src/lib/security/reviews.ts`); open alerts and
  due reviews show on every page for admins (`AdminAlerts`). `/privacy` renders the policy plus three admin-editable chapters:
  `privacy-logs`, `database-definition`, `security-procedure` — keep them true when logging, limits or retention change.
- **External API = SKEELZ Connect** (`docs/connect-api.md`, shared with the crm and site apps; contract, scopes and limits in
  `src/lib/api/spec.ts`, which also generates `/api/v1/openapi.json` (public) and the docs page `/api-docs`). Inbound
  `GET /api/v1/{ping,jobs,jobs/:id,metrics,site/jobs}` through `withApiKey(path, scope, handler)`: Bearer header only,
  keys `sk_admin_…` issued at `/admin/api` (table `api_keys`, sha256 only, shown once, revocable), scopes `jobs:read`
  `metrics:read` `site-feed:read`, 403 `insufficient_scope`. Env tokens stay as legacy keys: `API_TOKEN` (+ `_PREVIOUS`) =
  jobs+metrics, `SITE_FEED_TOKEN` = site feed only. In-memory rate limits per key, lockout per address. Outbound to the
  other apps only via `peerFetch` (`src/lib/connect/client.ts`); connections set at `/admin/connections`, peer keys
  AES-256-GCM encrypted under `CONNECT_SECRET_KEY` and never sent to the browser. Outbound webhooks
  (`src/lib/api/outbound.ts`) are detected and delivered by the sync worker: `webhook_case_state` remembers what was
  reported, `webhook_deliveries` queues events with retries, each POST is HMAC-signed with `WEBHOOK_TOKEN`. All
  directions carry jobs, statuses, ids and aggregates only — never candidate names, contact details or files
  (`src/lib/api/data.ts`). A new endpoint, scope or event must keep that and be added to `spec.ts` (the docs page and
  openapi.json follow).
- **MCP server** (`docs/mcp.md`, code in `src/lib/mcp/`): AI clients connect at `/mcp` with OAuth 2.1 + PKCE (DCR at
  `/mcp/oauth/register`, metadata under `/.well-known/`, issuer = the origin). Sign-in is the site's own xhostd Google
  sign-in on the consent page `/mcp/oauth/authorize` (`pageAuth`), where the person picks a role ceiling ≤ their role.
  `/mcp` routes use `verifyAccessToken` instead of `requireUser`: effective role = min(site role read from `users` on every
  call, ceiling). Every tool in `src/lib/mcp/tools.ts` declares the `minRole` its screen/action uses; `tools/list` and
  `tools/call` both filter by it. Tokens are opaque, sha256-stored in `mcp_grants`; users disconnect at `/connectors`,
  admins at `/admin/mcp`. Every call is audited (`mcp.call`). Never expose Salesforce writes, candidate files or admin
  write operations over MCP. CVs are searchable over MCP (`search_cvs`, `cv_summary`, by words or `topic`; `cv_topics` lists the
  topics) as metadata and matches only — never the file or its text.
  Registered vs. quick-apply analysis (`application_status_counts`, `registration_cohorts`, `dashboard_summary` `segment`) is
  aggregates only; exclusions (internal/test, duplicates within 60 s) and CV-arrival rules live once in `src/lib/metrics/segments.ts`
  (definitions: `docs/candidates-tab-metrics.md`, "רשומים מול הגשה מהירה"). History funnel ≠ current-status counts — keep both.
- **Roles:** viewer < editor (dashboard config) < admin (users, integrations, API keys, connections, sync). Admins can "view as" a lower
  role (cookie `skeelz_view_as`, honoured only when `realRole` is admin); `user.role` is the effective role that every
  check uses — only the preview switch itself checks `realRole`. `/admin/users` shows them as permission boxes (צופה always,
  עורך, אדמין ⊇ עורך; `src/lib/auth/permissions.ts`); adding a box asks for confirmation first.
- **Staff data (מנהל עובדים, `docs/staff.md`) is the most sensitive data between employees.** A separate flag
  `users.staff_manager`, not a role: admin does not include it, only a staff manager grants it (ADMIN_EMAILS are staff managers
  by configuration), invites never grant it, "view as" drops it (`user.staffManager` false), `/api` never carries it, and MCP only
  through `src/lib/mcp/staff-tools.ts` (`staff_monthly`, `staff_employee`, `staff: true`) when `McpPrincipal.staffData`: a staff manager
  now AND staff data turned on for that connection at `/connectors` (`mcp_grants.staff_data`) — `permissions.test.ts` fails otherwise. Pages use `pageAuthStaff`, actions `requireStaffManager`, never `hasRole`.
  Who is which Salesforce User / monday user (`users.sf_user_id`, `users.monday_user_id`, both unique) is set at `/admin/staff-links`
  (not on `/admin/users`); changing a link takes admin + staff manager. Follow the checklist in docs/staff.md for every step.
  `/staff` (one month, every linked employee) and `/staff/[id]` (month by month), code in `src/lib/staff/`: hours and done tasks of
  the monday.com board "משימות סיילספורס" (only linked employees' are stored, `staff_work_items`; synced hourly by the worker and on
  demand, `MONDAY_TOKEN` secret, queries only, state in `staff_source_state` — never `sync_runs`/`sync_state`), plus the `sf_task`
  rows they own by Israel month: emails = TaskSubtype Email (Salesforce logs every sent email so), calls = Call, also by the type of
  Case they sit on (`loadSfActivity`). monday tasks keep their board and when they entered Done (`done_at`, the status changed_at). monday also shows
  on `/admin/integrations` (board check only) and `/admin/sync`. Employees don't see their own.
- **Salesforce is read-only in phase 1.** The SF client must expose no write methods. Candidates/employer
  contacts = Contact, companies = Account, jobs/applications/leads = Case by RecordType.
- **Job key:** the public site's job URL is `/job/<24-hex Mongo id>`; that id (`site_job_key`) joins SF Cases to GA4.
  In SF: job = Case RecordType `Position`, Mongo id in `PID_cambium__c`, link formula `Field47__c`;
  site application = RecordType `RecordType2` (הגשות קמביום) with the job's Mongo id in `A_PID_cambium__c`.
  Application → job is the standard `ParentId` (RecordType2, skeelz2, staff_leads, Placement_cambium → Position);
  `Interested` mostly has ParentId → `Client`. `Case__c` is unused. Only ~half of Position Cases have `PID_cambium__c`.
  The Case sync copies every field the integration user can read into `sf_case.data` (describe-driven, cursor
  `SystemModstamp`, which any field change bumps), so a new Salesforce field needs no SOQL change or migration — read it
  from `data` like paid/active. Rows synced before a field became readable lack it until a full sync. Formula fields
  (e.g. `Field17__c` case age) and Contact-derived fields (`ContactEmail`) go stale in the mirror: compute or join instead.
  Full schema: `npm run sf:describe` writes `docs/sf-schema-report.md` (gitignored — org-specific); connectivity: `npm run sf:check`.
- **Employers:** employer lead = an Account with "סטטוס מעסיק" (`acount_status__c`); the lead and the employer are one record,
  pipeline = that field's history (AccountHistory → `sf_account_history`; חדש → פנייה ראשונה → … → נחתם חוזה → פורסמו משרות לפי חוזה).
  Calls/emails on the lead are those logged on the Account (Task/Event/EmailMessage sync includes Account-related rows).
  The old Case leads (`lead_employer`) are no longer read. A job is live on the site when `PStatus__c` = `Active` (Case `Status` is not maintained
  on jobs). The site's crown / featured mark = `isMarked_cambium__c` (`marked` on `Position`, `filterPositions`;
  `withCrown_cambium__c` exists but is never set). Definitions in `docs/employers-tab-metrics.md`, code in `src/lib/metrics/employers.ts`.
- **Dashboard tabs** (`docs/dashboard-tabs.md`): `/` executive summary · `/talent` candidate pool · `/jobs` jobs ·
  `/matching` demand (open jobs) vs supply (candidates) by CBS district / sub-district and skill (`src/lib/metrics/geo.ts`) ·
  `/pipeline` applications in three views sharing one filter box (`pipeline/shared.tsx`, `docs/applications-tab.md`): the
  anchored funnel + leaks + a side-by-side period comparison (`?cmp=1&cfrom=&cto=`, `CompareFunnels`), `/pipeline/active` the
  applications list (application/event date basis, `now` status and `moved` = status entered in the range, from `statusEvents`), `/pipeline/metrics` counts by status (`src/lib/metrics/statuses.ts`, application/event date basis) + `ApplicationPipeline` · `/employers` · `/marketing` · `/analytics` Google Analytics (every
  mirrored GA report through `src/lib/metrics/ga-report.ts`, shared with the MCP `ga_report`) · `/campaigns` (with campaigns from send to apply, `CampaignFunnel`, SMOOV + GA). A job has two pages: `/jobs/[id]`
  (dashboard analytics) and `/positions/[id]` (the entity card, under מעסיקים) — entity pages link to `/positions`.
- **Entities** (`/applications`, `/companies`, `/positions` (jobs list), `/candidates`, `/emails`, `/cvs`, `/outreach` (פעילות יזומה), `/leads`, `/payments` — the SF "מעקב תשלומים" list view, read-only; code in `src/lib/entities/`, docs in `docs/entities.md`): URL-driven
  GET search forms, 50 per page, each sortable by column (`?sort=&dir=`, `src/lib/entities/sort.ts`: a list declares its
  `SortColumn[]`, `Table` turns the headings into links and shows the same choices as pills on phones, where the headings are hidden). A company is jobs grouped by normalized `company_cambium__c` (`src/lib/metrics/company.ts`).
  Candidate files are never mirrored: listed live via `ContentDocumentLink` and served only through
  `/api/candidates/[id]/files/[documentId]` or `/api/emails/[email]/files/[documentId]`, which check the file really is that
  person's, write an audit entry and share the per-Israel-day limit of `src/lib/security/files.ts` (`src/lib/entities/serve-file.ts`; both routes are left
  out of the config CSP in `next.config.ts` so their sandboxing policy survives).
  **Copying contact details:** `/candidates` hands over the emails or phones behind the *whole* filter (not the page) through
  `/api/candidates/contacts` + `CopyContacts` — `candidateFilters()` parses the URL once for both the page and that route, each
  value appears once (phones compared by digits), it stops at 5,000, and every copy writes `candidates.contacts_copied` with the
  filter and the count. **Daily export budget** (`src/lib/security/exports.ts`): those counts, `cvs.contacts_copied` and
  `mcp.people_listed` (every MCP tool that returns people declares `people(result)`) are summed per user per Israel day:
  10,000 a day, admin alert at 5,000, past it a copy is cut then refused and a tool call refused, until an admin grants
  10,000 more at `/admin/security` (`export_quota_grants`). Any new route or tool that hands out names/emails/phones must count there.
  **Finding a CV** (`src/lib/entities/cv.ts`, the box on `/emails/<address>`): it sits in one of three places — on the Contact,
  on one of the person's Cases (an application, or a `cv_message` "קורות חיים" Case), or attached to an **email of such a Case**,
  where a CV that arrived by mail actually lands (the file hangs off the EmailMessage). All three are searched, a file is
  counted in every place it is linked, and when nothing is found the box says what was checked.
  **All CVs** (`/cvs`, `src/lib/entities/cvs.ts`): one row per file, from the mirrored file links (`sf_file_link`, filled by
  `src/lib/sf/sync-files.ts` after the other objects — metadata only, never the files). "Never handled" = a CV Case touched by
  nobody but the 14.10.2026 bulk closure — internal: in the data and MCP only, never shown on screen (`BULK_CLOSURE`; what that user's automation sets in the first 10 minutes is not
  handling). Words inside files are searched live with SOSL (`sf.search`). **Topics** (`src/lib/cv-topics.ts`): professions and
  broad skills in groups (עבודה סוציאלית, עריכת דין, הנדסה › חשמל…), each a set of phrases searched with every Hebrew prefix
  (ו/ה/ב/ל/מ/ש/כ…) and both gershayim forms; `src/lib/sf/sync-topics.ts` tags each file once into `cv_topics` (document, topic
  or group, phrases found): hourly it searches only files not in `cv_topic_scans` at the list's current `TOPICS_VERSION` and at
  least an hour old (SOSL filtered to their ids; none → no calls). Editing the list re-tags everything once; a manual full sync
  rebuilds; reconcile skips it. Many files at once use one SOSL per phrase over the whole index, split by file date past 2,000.
  `/cvs?topic=` filters by it — a grouped select in the filter box (`SearchForm` `groups` + `note`), with counts; topic searches are logged like word searches. To add a topic or phrase,
  edit the list — prefer what a person *is or studied*, singular (plurals mostly name colleagues). District/sub-district filters
  use the file's Contact's place (`candidatePlaceSql`); `cvFilters()` parses the URL once for the page and
  `/api/cvs/contacts`, which hands `CopyContacts` the emails or phones behind the whole filter (5,000 max, logged as
  `cvs.contacts_copied`). Who opened each file is read back from the audit
  log (`src/lib/entities/file-access.ts`, partial index `audit_log_file_idx`): the "פתיחות" column and `/cvs/[documentId]`.
  Security plan for the CV data: `docs/cv-security.md`.
  **Outreach** ("פעילות יזומה", `/outreach` + `/outreach/[id]`, `src/lib/entities/outreach.ts`): for a job, the people whose CVs fit
  it, to approach before they apply. The job's field = the same `cv-topics` phrases matched in code against its title (×3),
  description and skills (`src/lib/job-topics.ts`, gender forms like "מנהל/ת", "רכז.ת" folded first); with no topic, the title's
  words are searched in the files live (SOSL). Ranked per person (best file): topic/word match + same sub-district/district as
  the job + recent file; people who applied are hidden unless asked. Every search writes `cvs.text_search` with its results.
  **Employer lead Cases** (`/leads`, `src/lib/entities/leads.ts`): Cases of type `lead_employer`, listed as records (the
  employers tab still counts leads by the Account's employer status).
  `/emails` treats one address as one person: every Contact with that email, and every Case on them plus Contact-less
  Cases whose `SuppliedEmail` is it (`src/lib/entities/emails.ts`).
  The record pages' timeline (`loadFullCaseTimeline`) adds, live from Salesforce and never mirrored, the case's Chatter
  posts, case comments and email texts; the mirror keeps email metadata only. Task/Event descriptions come from the mirror.
  Anything interpolated into SOQL must pass `isSfId` first.
- **Places and skills** (`docs/geo-and-skills.md`): regions are CBS districts (מחוז) and sub-districts (נפה), resolved from
  `citySymbol_cambium__c` (CBS locality code) then the city name (`src/lib/geo/localities.ts`, SQL via `GEO_CTES` + `geoPlaceSql`);
  map outlines in `src/lib/geo/map.ts`, drawn by `RegionMap`. Skills are Mongo ids on jobs (`PSkills_cambium__c`) and candidates
  (`skills_cambium__c`), named in `src/lib/skills.ts` — always show names, never ids.
- **Paid scope:** every figure built on jobs or applications honours `?scope=` (default `paid`, or `all`). Paid job =
  `isSponserd_cambium__c` or `Field18__c`; paid application = `A_Money__c` or a paid job (the site never sets
  `isSponserd_cambium__c` on applications). Defined once in `src/lib/metrics/paid.ts`; show `PaidSplit` so the other side
  stays visible. Site-wide GA traffic has no job and is not scoped.
- **Design:** tokens in `src/app/globals.css` (brand magenta `#CD0077` for CTAs, teal `#218283` panels, pill
  controls, 20px cards). Rubik only. Use logical CSS (`ms-*`, `text-start`), never left/right. Every dashboard `StatCard`
  carries `info` from `src/lib/dashboard/explain.ts` (hover/focus/tap explanation). Horizontal bars (`BarList`, `Meter`)
  share one shape: square at the start, `rounded-e-[4px]` at the data end. The dashboard sub-nav is a tinted pill track
  labelled "דשבורד ›", one level below the main nav's pills.
- **Accessibility (IS 5568 = WCAG 2.1 AA, legally required):** text ≥ 4.5:1 and field borders ≥ 3:1 — `danger`, `success`
  and `field` tokens were darkened for this, don't lighten them; light-teal card bands take `text-ink`. One h1 per page
  (dashboard tabs render an sr-only h1; pass `heading={false}` where the page has its own). `Card` titles are headings:
  `level={3}` under a section h2. Status/error messages live in an always-mounted `role="status"`. Repeated link/button
  text gets sr-only context (`Salesforce<span className="sr-only"> · name</span>`); new-tab links say so. Charts keep
  the "הצגה כטבלה" table. Visually-hidden text inside a scroll box needs `relative` on the box or it widens the page.
  `/accessibility` and `/privacy` are linked from the footer, sign-in and refusal screens; their wording is edited by
  admins at `/admin/texts` (the contact address in the built-in text is `CONTACT_EMAIL` in `PublicDoc.tsx`).
- **Editable texts:** `src/lib/texts/registry.ts` lists them (key, page, built-in text). The current text is in
  `site_texts`, every saved version in `site_text_versions` (restorable). Render with `loadText()` + `<RichText>`, a small
  safe format (paragraphs, `##`, `- `, `**`, `[text](https|mailto|/path)`), never raw HTML.
- **Mobile:** every page must work at 320–375px with no sideways page scroll. Wide tables scroll inside `Table`; the main
  nav and dashboard tabs are one sideways-scrolling row on phones (`useActiveInStrip` keeps the current item visible).
- Secrets only via xhostd `set_env(secret=true)`; never log them or send them to the client.
- No server-side redirects to absolute URLs: behind xhostd the server doesn't know its public host, and Next's
  proxy rejects a relative `Location`. Anonymous page requests render `SignInScreen` (200); `src/proxy.ts` only 401s the API.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

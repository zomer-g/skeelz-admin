# SKEELZ Admin

Admin + dashboard platform for SKEELZ (jobs.skeelz.co.il) over Salesforce. Hebrew, RTL.
The approved plan lives at `C:\Users\zomer\.claude\plans\dazzling-floating-island.md` (milestones M0–M6).

## Stack
Next.js 16 (App Router) · React 19 · TypeScript · Tailwind 4 · Drizzle ORM + pg · jose. Hosted on xhostd
(template `app`: `install.sh` builds, `launch.sh` migrates + `next start`). Exact-pinned dependencies.

## Commands
- `npm run dev` — local (set `DEV_AUTH_EMAIL` + `DATABASE_URL`; there is no xhostd sign-in on localhost)
- `npm run typecheck` · `npm run build`
- `npm run db:generate` after editing `src/lib/db/schema.ts` (commit `drizzle/`); `npm run db:migrate` applies

## Rules that matter
- **Auth:** identity = xhostd SSO cookie `__Host-xhost_id`, verified in `src/lib/auth/xhost.ts`. Access =
  `ADMIN_EMAILS` / active `users` row / open invite (`src/lib/auth/session.ts`). Every page calls
  `pageAuth(minRole, path)`; every server action / route handler calls `requireUser(minRole)` (`/api/v1` routes use
  `withApiToken` instead). Never rely on the layout.
  The only pages without it hold no data: `/accessibility` and `/privacy` (public by law, framed by `PublicDoc`) and `not-found.tsx`.
- **Security headers:** CSP and friends in `next.config.ts`. The browser loads nothing cross-origin (fonts self-hosted,
  GA/SMOOV/SF server-side only) — keep it that way or extend the CSP. The candidate file route sends its own sandboxing
  CSP and is rate-limited (60 opens/hour per user, counted from the audit log).
- **External API** (contract and limits in `src/lib/api/spec.ts`, docs page `/api-docs` for signed-in users): inbound
  `GET /api/v1/{jobs,jobs/:id,metrics}` behind the shared `API_TOKEN` (+ `API_TOKEN_PREVIOUS` while rotating) through
  `withApiToken` — constant-time compare, header only, in-memory rate limits and lockout. Outbound webhooks
  (`src/lib/api/outbound.ts`) are detected and delivered by the sync worker: `webhook_case_state` remembers what was
  reported, `webhook_deliveries` queues events with retries, each POST is HMAC-signed with `WEBHOOK_TOKEN`. Both
  directions carry jobs, statuses, ids and aggregates only — never candidate names, contact details or files
  (`src/lib/api/data.ts`). A new endpoint or event must keep that and be added to `spec.ts` and the docs page.
- **Roles:** viewer < editor (dashboard config) < admin (users, integrations, sync). Admins can "view as" a lower
  role (cookie `skeelz_view_as`, honoured only when `realRole` is admin); `user.role` is the effective role that every
  check uses — only the preview switch itself checks `realRole`.
- **Salesforce is read-only in phase 1.** The SF client must expose no write methods. Candidates/employer
  contacts = Contact, companies = Account, jobs/applications/leads = Case by RecordType.
- **Job key:** the public site's job URL is `/job/<24-hex Mongo id>`; that id (`site_job_key`) joins SF Cases to GA4.
  In SF: job = Case RecordType `Position`, Mongo id in `PID_cambium__c`, link formula `Field47__c`;
  site application = RecordType `RecordType2` (הגשות קמביום) with the job's Mongo id in `A_PID_cambium__c`.
  Application → job is the standard `ParentId` (RecordType2, skeelz2, staff_leads, Placement_cambium → Position);
  `Interested` mostly has ParentId → `Client`. `Case__c` is unused. Only ~half of Position Cases have `PID_cambium__c`.
  Full schema: `npm run sf:describe` writes `docs/sf-schema-report.md` (gitignored — org-specific); connectivity: `npm run sf:check`.
- **Employers:** employer lead = Case RecordType `lead_employer`, employer = its `AccountId`, pipeline = `Status` history
  (פנייה ראשונה → … → נחתם חוזה). A job is live on the site when `PStatus__c` = `Active` (Case `Status` is not maintained
  on jobs). Definitions in `docs/employers-tab-metrics.md`, code in `src/lib/metrics/employers.ts`.
- **Dashboard tabs** (`docs/dashboard-tabs.md`): `/` executive summary · `/talent` candidate pool · `/jobs` jobs + the
  application pipeline (`ApplicationPipeline`) · `/employers` · `/marketing` · `/campaigns`. A job has two pages: `/jobs/[id]`
  (dashboard analytics) and `/positions/[id]` (the entity card, under מעסיקים) — entity pages link to `/positions`.
- **Entities** (`/applications`, `/companies`, `/candidates`; code in `src/lib/entities/`, docs in `docs/entities.md`): URL-driven
  GET search forms, 50 per page. A company is jobs grouped by normalized `company_cambium__c` (`src/lib/metrics/company.ts`).
  Candidate files are never mirrored: listed live via `ContentDocumentLink` and served only through
  `/api/candidates/[id]/files/[documentId]`, which checks the file is linked to that candidate and writes an audit entry.
  Anything interpolated into SOQL must pass `isSfId` first.
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
  Keep `/accessibility` and `/privacy` current (review date; the contact address is `CONTACT_EMAIL` in `PublicDoc.tsx`) —
  both are linked from the footer, sign-in and refusal screens.
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

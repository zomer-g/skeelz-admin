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
  `pageAuth(minRole, path)`; every server action / route handler calls `requireUser(minRole)`. Never rely on the layout.
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
- **Paid scope:** every figure built on jobs or applications honours `?scope=` (default `paid`, or `all`). Paid job =
  `isSponserd_cambium__c` or `Field18__c`; paid application = `A_Money__c` or a paid job (the site never sets
  `isSponserd_cambium__c` on applications). Defined once in `src/lib/metrics/paid.ts`; show `PaidSplit` so the other side
  stays visible. Site-wide GA traffic has no job and is not scoped.
- **Design:** tokens in `src/app/globals.css` (brand magenta `#CD0077` for CTAs, teal `#218283` panels, pill
  controls, 20px cards). Rubik only. Use logical CSS (`ms-*`, `text-start`), never left/right.
- Secrets only via xhostd `set_env(secret=true)`; never log them or send them to the client.
- No server-side redirects to absolute URLs: behind xhostd the server doesn't know its public host, and Next's
  proxy rejects a relative `Location`. Anonymous page requests render `SignInScreen` (200); `src/proxy.ts` only 401s the API.

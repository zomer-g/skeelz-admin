# SKEELZ Admin

An admin platform and dashboard for [SKEELZ](https://jobs.skeelz.co.il), a Hebrew job board whose back office lives in Salesforce. The UI is right-to-left Hebrew.

**What's in phase 1**

- **Read-only mirror:** a copy of Salesforce in Postgres, kept current by a background sync worker.
- **Candidates dashboard:** applications, CV requests, submissions to employers, employer responses, interviews and hires. The date filter works by application date or by event date.
- **Sign-in and roles:** sign-in through the hosting platform's SSO, with viewer, dashboard editor and admin roles.
- **Admin screens:**
  - users and invites
  - integration status
  - Salesforce connection test and schema report
  - sync status
  - an activity log of screens viewed and actions taken

**Later phases:** GA4 and Tag Manager statistics per job, SMOOV campaigns, writing back to Salesforce, and finally replacing the public job site.

## Stack

- Next.js 16 (App Router), React 19, TypeScript, Tailwind CSS 4
- Postgres with Drizzle ORM
- `jose` for verifying sign-in tokens
- A small fetch-based Salesforce REST client that only reads: apart from the OAuth token request, every call is a GET
- Deployed on [xhostd](https://xhostd.com): `install.sh` builds the app, and `launch.sh` runs migrations, starts the sync worker and starts `next start`

## Project layout

```
src/app/(app)/          dashboard and admin screens
src/lib/auth/           SSO token verification, sessions, roles, page guard
src/lib/sf/             Salesforce client, schema report, sync engine
src/lib/metrics/        dashboard metric definitions
src/worker/             background sync worker
scripts/                migrate, sf:check, sf:describe, sync:once
docs/                   setup guides and metric definitions (Hebrew)
```

## Local development

No local Postgres install is needed: PGlite runs one inside Node.

```bash
npm install
npm run db:local           # PGlite on 127.0.0.1:5433 (leave running)
npm run db:migrate:local
npm run sync:once          # needs Salesforce credentials in .env
npm run dev
```

Create `.env.local` (Next loads it automatically):

```
DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5433/postgres
DEV_AUTH_EMAIL=you@example.com
ADMIN_EMAILS=you@example.com
```

Create `.env` with the Salesforce credentials. The full list of variables is in [`.env.example`](.env.example). Both files are gitignored.

Other commands:

- `npm run typecheck`
- `npm run build`
- `npm run db:generate` after changing `src/lib/db/schema.ts`
- `npm run sf:check` for a step-by-step Salesforce connectivity check

## Configuration

| Variable | Purpose |
|---|---|
| `DATABASE_URL` | Postgres (injected by the host in production) |
| `ADMIN_EMAILS` | Emails that are always admins; this is how the first admin gets in |
| `XHOST_AUTH_AUDIENCES` | Hostnames sign-in tokens are accepted for (required) |
| `SF_LOGIN_URL`, `SF_CLIENT_ID`, `SF_CLIENT_SECRET` | Salesforce External Client App, Client Credentials flow |
| `SYNC_WORKER`, `SYNC_INTERVAL_MIN` | Turn on the background sync, and how often it runs |

Setup guides for Salesforce, Google Analytics / Tag Manager and SMOOV are in [`docs/`](docs/).

## Security notes

- **Secrets:** they live only in the host's secret store and in local gitignored files. They are never logged or sent to the browser.
- **Salesforce access:** the integration user has a read-only permission set, and the client has no write methods.
- **Access checks:**
  - Every page, server action and API route checks the user's role on the server; nothing relies on the layout.
  - Sign-in tokens must be RS256, carry the expected issuer, and have an audience in the configured list. Request `Host` headers are never trusted for this check.
- **Personal data:** candidate data appears only to signed-in, invited users. Email bodies are never copied from Salesforce, only metadata.

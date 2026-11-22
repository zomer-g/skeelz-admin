# The app on phones: install and push notices

## Rule

A service worker (`public/sw.js`) that handles **`push` and `notificationclick` only**. No `fetch` handler, no Cache
Storage, no `importScripts`: every page comes live from the server and nothing personal is kept on the device.
`push.test.ts` fails if a fetch handler or `caches` appears.

## Install

- `src/app/manifest.ts`: `id`, `description`, `categories`, and `shortcuts` (דשבורד `/`, משרות `/positions`, הגשות
  `/applications`, מועמדים `/candidates`). The manifest is the same for everyone, so shortcuts point only at viewer
  screens; each screen still runs `pageAuth`. No `screenshots`: real ones would show people's data.
- `InstallApp` (`src/components/pwa/InstallApp.tsx`), in the footer and on `/notifications`: a button when the browser
  fires `beforeinstallprompt` (Chrome, Edge, Android); on iPhone/iPad a button that opens "Add to Home Screen"
  instructions; nothing inside the installed app (`display-mode: standalone`).

## Push notices

**Turning on** — `/notifications` (footer link "התראות ואפליקציה", `pageAuth("viewer")`). The `PushToggle` asks
`Notification.requestPermission` only on a click, subscribes with the VAPID public key and posts the subscription to
`POST /api/push/subscribe` (`requireUser("viewer")`; the cross-site check in `src/proxy.ts` applies). Off =
`POST /api/push/unsubscribe` + `unsubscribe()`. iPhone: only in the app added to the Home Screen (iOS 16.4+); the page
says so. Both are written to the audit log (`push.subscribed` with the device kind only, `push.unsubscribed`).

**Table** `push_subscriptions`: user, endpoint (unique), p256dh, auth, user agent, created, last success, failures.
A row is deleted when the user turns it off, when the push service answers 404/410, after 10 failures in a row, and
when the user is no longer active (`pruneSubscriptions`, every worker pass). `push_notices` records every event a
notice went out for (`alert:<id>`, `review:<user>:<state>:<valid_until>`), so each is sent once; purged with the logs.

**Sending** — hand-written Web Push in `src/lib/push/webpush.ts` (RFC 8291 aes128gcm + RFC 8292 VAPID, `node:crypto`
and `jose` only). Chosen over the `web-push` package to match the project's no-library style (CSV/XLSX are written by
hand too), keep exact-pinned dependencies at zero new ones, and keep the outbound call on `pinnedFetch`. Endpoints are
accepted only over https on `fcm.googleapis.com`, `updates.push.services.mozilla.com`, `*.notify.windows.com` and
`web.push.apple.com` — at subscribe time and again at send time — so a subscription cannot make the server call
an arbitrary address.

**Events** (`src/lib/push/events.ts`), checked by the sync worker every minute (`runPushPass`):

| kind | when | opens | who |
| --- | --- | --- | --- |
| `security_alert` | a new open row in `security_alerts` (file limit, export budget) | `/admin/security` | admin |
| `access_review` | a user's review becomes due or enters its last 10 days | `/admin/users` | admin |
| `audit_failure` | an audit write fails in a process (at most once per 6 h per process) | `/admin/audit` | admin |

One notice per kind per pass, however many events. The recipient's role is read from `users` at send time (active
users only), so "view as" and a role changed since subscribing don't matter. A push failure never breaks its caller.

**Privacy, the hard rule.** A notice crosses Google's / Apple's / Mozilla's / Microsoft's servers. Its payload is
`buildPayload(kind)` and nothing else: a fixed Hebrew title and body, a same-origin path and a tag — no names, emails,
phones, CV words, staff figures, ids or counts. `push.test.ts` pins it. A new event adds a kind with its `minRole`
(the role of the screen it opens) and keeps that.

## Keys

`VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` (a secret: xhostd `set_env(secret=true)` only), `VAPID_SUBJECT` (`mailto:…`).
Without all three, nothing shows and nothing is sent; a worker registered earlier is unregistered.
`node --import tsx scripts/vapid-keys.ts mailto:…` writes a pair to `.secrets/vapid.env` (gitignored) and prints only
the path. Replacing the keys invalidates every subscription: people turn notices on again.

## Checking

Locally (`npm run dev`, `DEV_AUTH_EMAIL`, keys in `.env.local`): `/notifications`, DevTools › Application › Service
workers shows `/sw.js`; DevTools can send a test push. Real delivery and the iPhone flow need the deployed https site.

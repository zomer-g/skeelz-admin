# The app on phones: install

## Rule

No service worker, on purpose: every page comes live from the server and nothing personal is kept on the device.
Push notices were added (PR 8) and removed again by decision; migration 0031 created their tables and 0032 drops them.
A new service worker, push or offline cache needs a new decision and a privacy review first.

## Install

- `src/app/manifest.ts`: `id`, `name`, `description`, `categories`, icons from `public/icons` (rendered from
  `app/icon.svg`, plus a maskable one), and `shortcuts` (דשבורד `/`, משרות `/positions`, הגשות `/applications`,
  מועמדים `/candidates`). The manifest is the same for everyone, so shortcuts point only at viewer screens; each
  screen still runs `pageAuth`. No `screenshots`: real ones would show people's data.
- iPhone: `appleWebApp` in the root layout and `app/apple-icon.png`; theme colour in the root layout's `viewport`.
- `InstallApp` (`src/components/pwa/InstallApp.tsx`), in the footer: a "התקנת האפליקציה" button when the browser
  fires `beforeinstallprompt` (Chrome, Edge, Android); on iPhone/iPad a button that opens the "Add to Home Screen"
  steps; nothing inside the installed app (`display-mode: standalone`). Messages in an always-mounted `role="status"`.
  A browser that doesn't fire `beforeinstallprompt` (Firefox, Safari on the Mac) shows no button; its own menu installs.

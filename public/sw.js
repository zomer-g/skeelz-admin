/*
 * SKEELZ Admin service worker: push notices and their clicks, nothing else (docs/pwa.md).
 *
 * On purpose there is no "fetch" handler and no Cache Storage: every page and every figure comes
 * live from the server, and nothing personal is ever kept on the device. A notice carries only a
 * fixed title, body and a path on this site; the details are on that screen, behind sign-in.
 */

const ICON = "/icons/icon-192.png";

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

/** Only a path on this origin may be opened: "/x", never "//host" or "https://elsewhere". */
function safePath(path) {
  if (typeof path !== "string" || !path.startsWith("/") || path.startsWith("//") || path.includes("\\")) return "/";
  try {
    const url = new URL(path, self.location.origin);
    return url.origin === self.location.origin ? url.pathname + url.search : "/";
  } catch {
    return "/";
  }
}

self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = {};
  }
  const title = typeof data.title === "string" && data.title ? data.title.slice(0, 100) : "SKEELZ ניהול";
  const body = typeof data.body === "string" ? data.body.slice(0, 300) : "יש עדכון במערכת הניהול.";
  event.waitUntil(
    self.registration.showNotification(title, {
      body,
      dir: "rtl",
      lang: "he",
      icon: ICON,
      badge: ICON,
      tag: typeof data.tag === "string" ? data.tag.slice(0, 50) : undefined,
      data: { url: safePath(data.url) },
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const path = safePath(event.notification.data && event.notification.data.url);
  const target = new URL(path, self.location.origin).href;
  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      for (const client of windows) {
        if (new URL(client.url).origin !== self.location.origin) continue;
        await client.focus();
        if (client.url !== target && "navigate" in client) await client.navigate(target).catch(() => {});
        return;
      }
      await self.clients.openWindow(target);
    })(),
  );
});

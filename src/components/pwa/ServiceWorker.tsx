"use client";

import { useEffect } from "react";

/**
 * Registers /sw.js for a signed-in person when push is configured (docs/pwa.md); the worker
 * handles push notices only — no fetch handler, nothing cached. With push off it removes a worker
 * registered earlier, so turning the keys off really turns everything off.
 */
export function ServiceWorker({ enabled }: { enabled: boolean }) {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    if (enabled) {
      navigator.serviceWorker.register("/sw.js", { scope: "/", updateViaCache: "none" }).catch(() => {});
      return;
    }
    void navigator.serviceWorker.getRegistrations().then((regs) => {
      for (const r of regs) if (r.active?.scriptURL.endsWith("/sw.js")) void r.unregister();
    });
  }, [enabled]);
  return null;
}

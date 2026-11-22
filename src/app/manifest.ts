import type { MetadataRoute } from "next";

/**
 * Lets Chrome (and Android) install the admin as an app: its own window, icon and name.
 * Icons in public/icons are rendered from app/icon.svg (192/512, plus a full-bleed maskable one
 * for Android's round and squircle masks). The service worker (public/sw.js) handles push notices
 * only: no fetch handler, no Cache Storage — the data is live and personal, nothing is kept offline.
 *
 * Shortcuts (long-press on the icon) open screens every role may see, since the manifest is the
 * same for everyone; a screen still checks the role itself. No screenshots: real ones would show
 * people's data (docs/pwa.md).
 */
const ICON = [{ src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" }];
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: "SKEELZ ניהול",
    short_name: "SKEELZ",
    description: "מערכת הניהול והדשבורד של SKEELZ: משרות, הגשות, מועמדים ומעסיקים",
    categories: ["business", "productivity"],
    lang: "he",
    dir: "rtl",
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: "#ffffff",
    theme_color: "#218283",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
    shortcuts: [
      { name: "דשבורד", url: "/", icons: ICON },
      { name: "משרות", url: "/positions", icons: ICON },
      { name: "הגשות", url: "/applications", icons: ICON },
      { name: "מועמדים", url: "/candidates", icons: ICON },
    ],
  };
}

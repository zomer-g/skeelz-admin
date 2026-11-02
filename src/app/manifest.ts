import type { MetadataRoute } from "next";

/**
 * Lets Chrome (and Android) install the admin as an app: its own window, icon and name.
 * Icons in public/icons are rendered from app/icon.svg (192/512, plus a full-bleed maskable one
 * for Android's round and squircle masks). No service worker: the data is live and personal,
 * so nothing is cached offline.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: "SKEELZ ניהול",
    short_name: "SKEELZ",
    description: "מערכת הניהול והדשבורד של SKEELZ",
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
  };
}

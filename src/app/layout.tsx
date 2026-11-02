import type { Metadata, Viewport } from "next";
import { Rubik } from "next/font/google";
import "./globals.css";

const rubik = Rubik({ subsets: ["hebrew", "latin"], variable: "--font-rubik", display: "swap" });

export const metadata: Metadata = {
  title: { default: "SKEELZ ניהול", template: "%s · SKEELZ ניהול" },
  robots: { index: false, follow: false },
  // Installed on an iPhone home screen, it opens in its own window like on Android (app/manifest.ts).
  appleWebApp: { capable: true, title: "SKEELZ", statusBarStyle: "default" },
};

/** The installed app's title bar and Android's task switcher take the brand teal. */
export const viewport: Viewport = { themeColor: "#218283" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="he" dir="rtl" className={rubik.variable}>
      <body className="min-h-dvh font-sans antialiased">{children}</body>
    </html>
  );
}

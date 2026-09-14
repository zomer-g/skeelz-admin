import Link from "next/link";
import type { ReactNode } from "react";
import { setPreviewRole } from "@/app/(app)/preview-actions";
import { ROLE_LABELS } from "@/lib/auth/roles";
import type { SessionUser } from "@/lib/auth/session";
import { logoutUrl } from "@/lib/auth/urls";
import { NavLinks } from "./NavLinks";
import { PreviewSwitcher } from "./PreviewSwitcher";
import { PublicDocLinks } from "./PublicDoc";
import { Badge, buttonClass } from "./ui";

// A red deep enough for white text to stay readable (AA) at banner size.
const PREVIEW_RED = "#b42318";

export function AppShell({ user, children }: { user: SessionUser; children: ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:start-4 focus:top-4 focus:z-50 focus:rounded-full focus:bg-ink focus:px-5 focus:py-3 focus:font-medium focus:text-white"
      >
        דילוג לתוכן הראשי
      </a>
      {user.previewing ? (
        <div role="region" aria-label="מצב צפייה" className="text-white" style={{ background: PREVIEW_RED }}>
          <div className="mx-auto flex w-full max-w-[75rem] flex-wrap items-center justify-between gap-3 px-4 py-2">
            <p className="text-sm font-medium">
              מצב צפייה: המערכת מוצגת בהרשאת <span className="font-bold">{ROLE_LABELS[user.role]}</span>. מה שמעבר להרשאה הזו מוסתר ונחסם, כמו אצל
              משתמש אמיתי.
            </p>
            <form action={setPreviewRole}>
              <button
                name="role"
                value="admin"
                className="rounded-full bg-white px-4 py-1.5 text-sm font-bold transition-opacity hover:opacity-90 focus-visible:outline-white"
                style={{ color: PREVIEW_RED }}
              >
                יציאה ממצב צפייה
              </button>
            </form>
          </div>
        </div>
      ) : null}

      <header className="border-b-2 border-black bg-white">
        {/* Phones: logo and account on top, the nav as its own scrolling row below. From `lg` all three share one row. */}
        <div className="mx-auto flex w-full max-w-[75rem] flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3 lg:py-4">
          <Link href="/" className="order-1 flex items-center gap-3" aria-label="SKEELZ ניהול — דשבורד">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/brand/logo.svg" alt="" width={72} height={40} />
            <span className="text-sm font-medium text-accent-dark">ניהול</span>
          </Link>

          <NavLinks isAdmin={user.role === "admin"} className="order-3 -mx-1 w-[calc(100%+0.5rem)] lg:order-2 lg:mx-0 lg:w-auto" />

          <div className="order-2 ms-auto flex flex-wrap items-center justify-end gap-3 lg:order-3">
            {user.realRole === "admin" ? <PreviewSwitcher current={user.role} /> : null}
            <div className="flex flex-col items-end leading-tight">
              <span className="text-sm font-medium">{user.name ?? user.email}</span>
              <Badge tone={user.previewing ? "warning" : user.role === "admin" ? "brand" : "accent"}>
                {ROLE_LABELS[user.role]}
                {user.previewing ? " · תצוגה" : ""}
              </Badge>
            </div>
            <a href={logoutUrl("/")} className={buttonClass("secondary", "sm")}>
              יציאה
            </a>
          </div>
        </div>
      </header>

      <main id="main" tabIndex={-1} className="mx-auto w-full max-w-[75rem] flex-1 px-4 py-6 focus:outline-none sm:py-8">
        {children}
      </main>

      <footer className="bg-black text-white">
        <div className="mx-auto flex w-full max-w-[75rem] flex-wrap items-center justify-between gap-4 px-4 py-8">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/brand/whiteLogo.svg" alt="" width={72} height={40} />
          <span className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-white/70">
            מערכת הניהול של SKEELZ
            <PublicDocLinks linkClassName="text-white focus-visible:outline-white" />
            <Link href="/api-docs" className="font-medium text-white underline underline-offset-4 focus-visible:outline-white">
              תיעוד API
            </Link>
          </span>
        </div>
      </footer>
    </div>
  );
}

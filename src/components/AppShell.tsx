import Link from "next/link";
import type { ReactNode } from "react";
import { setPreviewRole } from "@/app/(app)/preview-actions";
import { ROLE_LABELS } from "@/lib/auth/roles";
import type { SessionUser } from "@/lib/auth/session";
import { logoutUrl } from "@/lib/auth/urls";
import { NavLinks } from "./NavLinks";
import { PreviewSwitcher } from "./PreviewSwitcher";
import { Badge, buttonClass } from "./ui";

// A red deep enough for white text to stay readable (AA) at banner size.
const PREVIEW_RED = "#b42318";

export function AppShell({ user, children }: { user: SessionUser; children: ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col">
      {user.previewing ? (
        <div role="status" className="text-white" style={{ background: PREVIEW_RED }}>
          <div className="mx-auto flex w-full max-w-[75rem] flex-wrap items-center justify-between gap-3 px-4 py-2">
            <p className="text-sm font-medium">
              מצב צפייה: המערכת מוצגת בהרשאת <span className="font-bold">{ROLE_LABELS[user.role]}</span>. מה שמעבר להרשאה הזו מוסתר ונחסם, כמו אצל
              משתמש אמיתי.
            </p>
            <form action={setPreviewRole}>
              <button
                name="role"
                value="admin"
                className="rounded-full bg-white px-4 py-1.5 text-sm font-bold transition-opacity hover:opacity-90"
                style={{ color: PREVIEW_RED }}
              >
                יציאה ממצב צפייה
              </button>
            </form>
          </div>
        </div>
      ) : null}

      <header className="border-b-2 border-black bg-white">
        <div className="mx-auto flex w-full max-w-[75rem] flex-wrap items-center gap-x-6 gap-y-3 px-4 py-4">
          <Link href="/" className="flex items-center gap-3" aria-label="SKEELZ — דשבורד">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/brand/logo.svg" alt="SKEELZ" width={72} height={40} />
            <span className="text-sm font-medium text-accent">ניהול</span>
          </Link>

          <NavLinks isAdmin={user.role === "admin"} />

          <div className="ms-auto flex flex-wrap items-center gap-3">
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

      <main className="mx-auto w-full max-w-[75rem] flex-1 px-4 py-8">{children}</main>

      <footer className="bg-black text-white">
        <div className="mx-auto flex w-full max-w-[75rem] items-center justify-between gap-4 px-4 py-8">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/brand/whiteLogo.svg" alt="SKEELZ" width={72} height={40} />
          <span className="text-sm text-white/70">מערכת הניהול של SKEELZ</span>
        </div>
      </footer>
    </div>
  );
}

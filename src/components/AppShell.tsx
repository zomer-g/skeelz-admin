import Link from "next/link";
import type { ReactNode } from "react";
import { ROLE_LABELS } from "@/lib/auth/roles";
import type { SessionUser } from "@/lib/auth/session";
import { logoutUrl } from "@/lib/auth/urls";
import { NavLinks } from "./NavLinks";
import { Badge, buttonClass } from "./ui";

export function AppShell({ user, children }: { user: SessionUser; children: ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col">
      <header className="border-b-2 border-black bg-white">
        <div className="mx-auto flex w-full max-w-[75rem] flex-wrap items-center gap-x-6 gap-y-3 px-4 py-4">
          <Link href="/" className="flex items-center gap-3" aria-label="SKEELZ — דשבורד">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/brand/logo.svg" alt="SKEELZ" width={72} height={40} />
            <span className="text-sm font-medium text-accent">ניהול</span>
          </Link>

          <NavLinks isAdmin={user.role === "admin"} />

          <div className="ms-auto flex items-center gap-3">
            <div className="flex flex-col items-end leading-tight">
              <span className="text-sm font-medium">{user.name ?? user.email}</span>
              <Badge tone={user.role === "admin" ? "brand" : "accent"}>{ROLE_LABELS[user.role]}</Badge>
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

import Link from "next/link";
import type { ReactNode } from "react";

/** Where people write about accessibility, privacy and the API. */
export const CONTACT_EMAIL = "guy@skeelz.co.il";

export function ContactLink() {
  return (
    <a href={`mailto:${CONTACT_EMAIL}`} dir="ltr" className="font-medium text-accent-dark underline underline-offset-4">
      {CONTACT_EMAIL}
    </a>
  );
}

/** Links to the public documents, for the footer, sign-in and refusal screens. */
export function PublicDocLinks({ className = "", linkClassName = "text-accent-dark" }: { className?: string; linkClassName?: string }) {
  return (
    <nav aria-label="מסמכים" className={`flex flex-wrap items-center gap-x-4 gap-y-1 text-sm ${className}`}>
      <Link href="/accessibility" className={`font-medium underline underline-offset-4 ${linkClassName}`}>
        הצהרת נגישות
      </Link>
      <Link href="/privacy" className={`font-medium underline underline-offset-4 ${linkClassName}`}>
        מדיניות פרטיות
      </Link>
    </nav>
  );
}

/**
 * Frame for the public documents. They hold no data, so they render without
 * `pageAuth` and without the app chrome — the sign-in screen must reach them.
 */
export function PublicDoc({ title, updated, children }: { title: string; updated: string; children: ReactNode }) {
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-3xl flex-col gap-6 px-4 py-10">
      <p>
        <Link href="/" className="inline-flex items-center gap-3 text-sm font-medium text-accent-dark underline underline-offset-4">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/brand/logo.svg" alt="" width={72} height={40} />
          חזרה למערכת הניהול של SKEELZ
        </Link>
      </p>
      <header>
        <h1 className="text-3xl font-bold">{title}</h1>
        <p className="mt-2 text-sm text-muted">עודכן לאחרונה ב-{updated}</p>
      </header>
      <div className="flex flex-col gap-4 leading-relaxed">{children}</div>
      <PublicDocLinks className="mt-auto border-t-2 border-line pt-4" />
    </main>
  );
}

"use client";

import Link from "next/link";
import { useRef } from "react";
import { useActiveInStrip } from "../useActiveInStrip";

const TABS = [
  { key: "summary", label: "תקציר מנהלים", href: "/" },
  { key: "candidates", label: "מועמדים", href: "/talent" },
  { key: "jobs", label: "משרות", href: "/jobs" },
  { key: "employers", label: "מעסיקים", href: "/employers" },
  { key: "marketing", label: "שיווק", href: "/marketing" },
  { key: "campaigns", label: "דיוורים", href: "/campaigns" },
] as const;

export type DashboardTab = (typeof TABS)[number]["key"];

/**
 * `query` carries the date range across tabs so switching keeps the same slice.
 * The tabs stand in for the page title, so they also give the page its h1 —
 * except where the page has its own (a job, a campaign): pass `heading={false}`.
 *
 * One level below the main nav, in the same pill language: a tinted track that
 * says "דשבורד ›", with the current tab raised in white. On phones the label
 * stays put and only the tabs scroll, so it is always clear which section you are in.
 */
export function DashboardTabs({ active, query = "", heading = true }: { active: DashboardTab; query?: string; heading?: boolean }) {
  const activeRef = useRef<HTMLAnchorElement>(null);
  useActiveInStrip(activeRef, active);
  const activeLabel = TABS.find((t) => t.key === active)?.label;

  return (
    <>
      {heading ? <h1 className="sr-only">דשבורד {activeLabel}</h1> : null}
      <nav className="mb-6 flex items-center gap-1 rounded-card bg-accent/10 p-1.5" aria-label="לשוניות הדשבורד">
        <span className="shrink-0 ps-3 pe-2 text-sm font-bold text-accent-dark" aria-hidden>
          דשבורד ›
        </span>
        <div className="relative flex min-w-0 flex-1 gap-1 overflow-x-auto [scrollbar-width:none] md:flex-wrap md:overflow-visible">
          {TABS.map((t) => {
            const isActive = t.key === active;
            const className = `shrink-0 whitespace-nowrap rounded-full px-4 py-2 text-sm font-medium transition-colors sm:text-base ${
              isActive ? "bg-white font-bold text-accent-dark shadow-sm ring-1 ring-accent" : "text-ink hover:bg-white/70"
            }`;
            return (
              <Link
                key={t.key}
                ref={isActive ? activeRef : undefined}
                href={query ? `${t.href}?${query}` : t.href}
                aria-current={isActive ? "page" : undefined}
                className={className}
              >
                {t.label}
              </Link>
            );
          })}
        </div>
      </nav>
    </>
  );
}

"use client";

import Link from "next/link";
import { useRef } from "react";
import { useActiveInStrip } from "./useActiveInStrip";

export interface SubNavTab {
  key: string;
  label: string;
  href: string;
}

/**
 * The second level under a main-nav section (דשבורד, רשומות): a tinted track that
 * names the section ("דשבורד ›"), with the current tab raised in white. On phones
 * the section name stays put and only the tabs scroll, so it is always clear
 * where you are. `query` is appended to every tab (e.g. the dashboard's date range).
 */
export function SubNav({ section, ariaLabel, tabs, active, query = "" }: { section: string; ariaLabel: string; tabs: readonly SubNavTab[]; active: string; query?: string }) {
  const activeRef = useRef<HTMLAnchorElement>(null);
  useActiveInStrip(activeRef, active);

  return (
    <nav className="mb-6 flex items-center gap-1 rounded-card bg-accent/10 p-1.5" aria-label={ariaLabel}>
      <span className="shrink-0 ps-3 pe-2 text-sm font-bold text-accent-dark" aria-hidden>
        {section} ›
      </span>
      <div className="relative flex min-w-0 flex-1 gap-1 overflow-x-auto [scrollbar-width:none] md:flex-wrap md:overflow-visible">
        {tabs.map((t) => {
          const isActive = t.key === active;
          return (
            <Link
              key={t.key}
              ref={isActive ? activeRef : undefined}
              href={query ? `${t.href}?${query}` : t.href}
              aria-current={isActive ? "page" : undefined}
              className={`shrink-0 whitespace-nowrap rounded-full px-4 py-2 text-sm font-medium transition-colors sm:text-base ${
                isActive ? "bg-white font-bold text-accent-dark shadow-sm ring-1 ring-accent" : "text-ink hover:bg-white/70"
              }`}
            >
              {t.label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}

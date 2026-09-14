"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useRef } from "react";
import { useActiveInStrip } from "./useActiveInStrip";

interface NavItem {
  href: string;
  label: string;
  /** Paths (besides href itself) that belong to this item. */
  also?: string[];
  /** Not built yet: shown so the shape of the product is visible, but inert. */
  soon?: boolean;
}

const ITEMS: NavItem[] = [
  { href: "/", label: "דשבורד", also: ["/jobs", "/employers", "/marketing", "/campaigns"] },
  { href: "/applications", label: "הגשות" },
  { href: "/companies", label: "מעסיקים" },
  { href: "/candidates", label: "מועמדים" },
];

const ADMIN: NavItem = { href: "/admin/users", label: "ניהול", also: ["/admin"] };

function isActive(item: NavItem, pathname: string): boolean {
  if (item.href === "/" ? pathname === "/" : pathname.startsWith(item.href)) return true;
  return (item.also ?? []).some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

/** One scrolling row on phones, wrapping from `lg` up. */
export function NavLinks({ isAdmin, className = "" }: { isAdmin: boolean; className?: string }) {
  const pathname = usePathname();
  const activeRef = useRef<HTMLAnchorElement>(null);
  useActiveInStrip(activeRef, pathname);
  const items = isAdmin ? [...ITEMS, ADMIN] : ITEMS;

  return (
    <nav className={`flex items-center gap-1 overflow-x-auto p-1 [scrollbar-width:thin] lg:flex-wrap lg:overflow-visible ${className}`} aria-label="ניווט ראשי">
      {items.map((item) => {
        if (item.soon) {
          return (
            <span key={item.href} className="shrink-0 cursor-default rounded-full px-4 py-2 text-muted" title="בקרוב">
              {item.label}
            </span>
          );
        }
        const active = isActive(item, pathname);
        return (
          <Link
            key={item.href}
            ref={active ? activeRef : undefined}
            href={item.href}
            aria-current={active ? (pathname === item.href ? "page" : "true") : undefined}
            className={`shrink-0 whitespace-nowrap rounded-full px-3 py-2 font-medium transition-colors sm:px-4 ${active ? "bg-accent text-white" : "text-ink hover:bg-accent/10"}`}
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}

"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

interface NavItem {
  href: string;
  label: string;
  /** Paths (besides href itself) that belong to this item. */
  also?: string[];
  /** Not built yet: shown so the shape of the product is visible, but inert. */
  soon?: boolean;
}

const ITEMS: NavItem[] = [
  { href: "/", label: "דשבורד", also: ["/jobs", "/marketing", "/campaigns"] },
  { href: "/applications", label: "הגשות", soon: true },
  { href: "/companies", label: "חברות", soon: true },
  { href: "/candidates", label: "מועמדים", soon: true },
];

const ADMIN: NavItem = { href: "/admin/users", label: "ניהול", also: ["/admin"] };

function isActive(item: NavItem, pathname: string): boolean {
  if (item.href === "/" ? pathname === "/" : pathname.startsWith(item.href)) return true;
  return (item.also ?? []).some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

export function NavLinks({ isAdmin }: { isAdmin: boolean }) {
  const pathname = usePathname();
  const items = isAdmin ? [...ITEMS, ADMIN] : ITEMS;

  return (
    <nav className="flex flex-wrap items-center gap-1" aria-label="ניווט ראשי">
      {items.map((item) => {
        if (item.soon) {
          return (
            <span key={item.href} className="cursor-default rounded-full px-4 py-2 text-muted/60" title="בקרוב">
              {item.label}
            </span>
          );
        }
        const active = isActive(item, pathname);
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? "page" : undefined}
            className={`rounded-full px-4 py-2 font-medium transition-colors ${active ? "bg-accent text-white" : "text-ink hover:bg-accent/10"}`}
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}

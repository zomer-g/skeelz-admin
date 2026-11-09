"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect } from "react";

/**
 * A page that moved: the browser goes on to `href` itself. Not a server redirect — behind xhostd
 * the server doesn't know its public host and Next's proxy rejects a relative `Location`.
 * The link stays for anyone whose browser doesn't run it.
 */
export function ClientRedirect({ href, label }: { href: string; label: string }) {
  const router = useRouter();
  useEffect(() => router.replace(href), [router, href]);
  return (
    <p role="status" className="py-8 text-center text-sm">
      העמוד עבר. <Link href={href} className="font-medium underline underline-offset-4">{label}</Link>
    </p>
  );
}

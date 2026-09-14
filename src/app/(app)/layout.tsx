import { AppShell } from "@/components/AppShell";
import { getSession } from "@/lib/auth/session";

/**
 * Chrome only. Signed-in users get the header and footer; everyone else gets
 * the page bare, and each page renders its own sign-in or refusal screen
 * (see lib/auth/guard.tsx — the layout is never the access check).
 */
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();
  if (session.status !== "ok") return children;
  return <AppShell user={session.user}>{children}</AppShell>;
}

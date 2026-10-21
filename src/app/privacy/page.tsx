import type { Metadata } from "next";
import { PublicDoc } from "@/components/PublicDoc";
import { RichText } from "@/components/RichText";
import { fmtDate } from "@/lib/format";
import { findText } from "@/lib/texts/registry";
import { loadText } from "@/lib/texts/store";

export const metadata: Metadata = { title: "מדיניות פרטיות" };
// The text is edited at /admin/texts and must show as soon as it is saved.
export const dynamic = "force-dynamic";

/** The policy, then its chapters — the logs, the database definitions and the security procedure — each edited on its own. */
const SECTIONS = ["privacy", "privacy-logs", "database-definition", "security-procedure"] as const;

/** Public on purpose, like the accessibility statement: it is linked from the sign-in screen. */
export default async function PrivacyPage() {
  const defs = SECTIONS.map((key) => findText(key)!);
  const texts = await Promise.all(defs.map((d) => loadText(d.key)));
  // The page's date is the latest of its sections: a saved version's date, or the built-in text's.
  const dayOf = (dmy: string) => {
    const [d, m, y] = dmy.split(".").map(Number);
    return new Date(y!, m! - 1, d!);
  };
  const latest = new Date(Math.max(...texts.map((t, i) => (t.updatedAt ?? dayOf(defs[i]!.defaultUpdated)).getTime())));

  return (
    <PublicDoc title={defs[0]!.title} updated={fmtDate(latest)}>
      {texts.map((t, i) => (
        <section key={defs[i]!.key} aria-label={i ? defs[i]!.title : undefined} className={i ? "mt-6 border-t border-line pt-6" : undefined}>
          <RichText body={t.body} />
        </section>
      ))}
    </PublicDoc>
  );
}

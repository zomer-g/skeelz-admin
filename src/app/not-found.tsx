import type { Metadata } from "next";
import Link from "next/link";
import { buttonClass } from "@/components/ui";

export const metadata: Metadata = { title: "העמוד לא נמצא" };

/** Hebrew 404 for unknown URLs and for records that `notFound()` refuses. Shows no data, so no auth check. */
export default function NotFound() {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-6 px-4 py-12 text-center">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/brand/logo.svg" alt="SKEELZ" width={128} height={72} />
      <h1 className="text-3xl font-bold">העמוד לא נמצא</h1>
      <p className="text-muted">ייתכן שהקישור שגוי, או שהרשומה כבר לא קיימת.</p>
      <Link href="/" className={buttonClass("primary")}>
        חזרה לדשבורד
      </Link>
    </main>
  );
}

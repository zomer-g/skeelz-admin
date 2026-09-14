import { ROLE_LABELS, type Role } from "@/lib/auth/roles";
import { logoutUrl } from "@/lib/auth/urls";
import { buttonClass } from "./ui";

export function Forbidden({ email, reason, required }: { email: string; reason: "not_invited" | "role"; required?: Role }) {
  if (reason === "role") {
    return (
      <div className="mx-auto max-w-lg rounded-card border-2 border-line bg-surface p-8 text-center">
        <h1 className="text-2xl font-bold">אין הרשאה לעמוד הזה</h1>
        <p className="mt-3 text-muted">
          העמוד דורש הרשאת {required ? ROLE_LABELS[required] : "גבוהה יותר"}. אפשר לבקש שינוי הרשאה מאדמין המערכת.
        </p>
      </div>
    );
  }

  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-10 px-4 py-12">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/brand/logo.svg" alt="SKEELZ" width={128} height={72} />
      <div className="w-full max-w-md overflow-hidden rounded-modal border-2 border-line">
        <div className="bg-accent px-8 py-6 text-center text-2xl font-medium text-white">הגישה טרם אושרה</div>
        <div className="flex flex-col items-center gap-6 bg-surface px-8 py-8 text-center">
          <p className="text-muted">
            החשבון <span dir="ltr" className="font-medium text-ink">{email}</span> אינו מורשה עדיין.
            <br />
            הבקשה נרשמה, ואדמין המערכת יכול לאשר אותה.
          </p>
          <a href={logoutUrl("/")} className={`${buttonClass("secondary")} w-full`}>
            התחברות עם חשבון אחר
          </a>
        </div>
      </div>
    </main>
  );
}

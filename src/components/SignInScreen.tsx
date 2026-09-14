import { loginUrl } from "@/lib/auth/urls";
import { PublicDocLinks } from "./PublicDoc";
import { buttonClass } from "./ui";

export function SignInScreen({ returnTo }: { returnTo: string }) {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-10 px-4 py-12">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/brand/logo.svg" alt="SKEELZ" width={128} height={72} />
      <div className="w-full max-w-md overflow-hidden rounded-modal border-2 border-line">
        <h1 className="bg-accent px-8 py-6 text-center text-2xl font-medium text-white">מערכת הניהול של SKEELZ</h1>
        <div className="flex flex-col items-center gap-6 bg-surface px-8 py-8 text-center">
          <p className="text-muted">
            הכניסה מתבצעת עם חשבון Google דרך XHOST.
            <br />
            הגישה מותרת רק למשתמשים שהוזמנו.
          </p>
          <a href={loginUrl(returnTo)} className={`${buttonClass("primary")} w-full`}>
            התחברות
          </a>
        </div>
      </div>
      <PublicDocLinks className="justify-center" />
    </main>
  );
}

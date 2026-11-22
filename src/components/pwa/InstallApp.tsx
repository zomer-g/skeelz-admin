"use client";

import { useEffect, useId, useState } from "react";
import { isIos, isStandalone } from "./platform";

interface InstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

/**
 * "התקנת האפליקציה": shown only when the browser offers installation (`beforeinstallprompt`, Chrome,
 * Edge and Android), or on iPhone/iPad, where it opens short "Add to Home Screen" instructions.
 * Hidden inside the installed app. `className` styles the button for where it sits.
 */
export function InstallApp({ className = "" }: { className?: string }) {
  const [prompt, setPrompt] = useState<InstallPromptEvent | null>(null);
  const [ios, setIos] = useState(false);
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState("");
  const panel = useId();

  useEffect(() => {
    if (isStandalone()) return;
    setIos(isIos());
    const onPrompt = (e: Event) => {
      e.preventDefault();
      setPrompt(e as InstallPromptEvent);
    };
    const onInstalled = () => {
      setPrompt(null);
      setIos(false);
      setMessage("האפליקציה הותקנה.");
    };
    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  async function install() {
    if (!prompt) return;
    await prompt.prompt();
    const { outcome } = await prompt.userChoice;
    setPrompt(null);
    if (outcome === "dismissed") setMessage("ההתקנה בוטלה.");
  }

  return (
    <span className="inline-flex flex-col gap-1">
      {prompt ? (
        <button type="button" onClick={install} className={className}>
          התקנת האפליקציה
        </button>
      ) : ios ? (
        <>
          <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} aria-controls={panel} className={className}>
            התקנת האפליקציה
          </button>
          <span id={panel} hidden={!open} className="max-w-xs text-sm">
            בספארי: לוחצים על כפתור השיתוף (ריבוע עם חץ למעלה), בוחרים &quot;הוספה למסך הבית&quot; ומאשרים.
          </span>
        </>
      ) : null}
      <span role="status" className="text-sm">
        {message}
      </span>
    </span>
  );
}

"use client";

import { useEffect, useState } from "react";
import { buttonClass } from "@/components/ui";
import { isIos, isStandalone } from "./platform";

type State = "loading" | "unsupported" | "ios-install" | "denied" | "off" | "on" | "busy";

function keyBytes(base64url: string): Uint8Array<ArrayBuffer> {
  const b64 = base64url.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(base64url.length / 4) * 4, "=");
  const raw = atob(b64);
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

async function currentSubscription(): Promise<PushSubscription | null> {
  const reg = await navigator.serviceWorker.getRegistration("/");
  return (await reg?.pushManager.getSubscription()) ?? null;
}

/**
 * The person's own on/off switch for push notices on this device. Permission is asked only when
 * they press "turn on", never on page load. On iPhone, web push works only in the app added to the
 * Home Screen (iOS 16.4+), so there the switch explains that first.
 */
export function PushToggle({ publicKey }: { publicKey: string }) {
  const [state, setState] = useState<State>("loading");
  const [message, setMessage] = useState("");

  useEffect(() => {
    const supported = "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
    if (!supported) {
      setState(isIos() && !isStandalone() ? "ios-install" : "unsupported");
      return;
    }
    if (Notification.permission === "denied") {
      setState("denied");
      return;
    }
    currentSubscription()
      .then((s) => setState(s ? "on" : "off"))
      .catch(() => setState("off"));
  }, []);

  async function turnOn() {
    setState("busy");
    setMessage("");
    try {
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        setState(permission === "denied" ? "denied" : "off");
        setMessage("לא ניתן אישור להתראות בדפדפן.");
        return;
      }
      const reg = await navigator.serviceWorker.register("/sw.js", { scope: "/", updateViaCache: "none" });
      await navigator.serviceWorker.ready;
      const sub =
        (await reg.pushManager.getSubscription()) ?? (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(publicKey) }));
      const res = await fetch("/api/push/subscribe", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(sub.toJSON()) });
      if (!res.ok) {
        await sub.unsubscribe().catch(() => {});
        throw new Error(String(res.status));
      }
      setState("on");
      setMessage("ההתראות הופעלו במכשיר הזה.");
    } catch {
      setState("off");
      setMessage("הפעלת ההתראות נכשלה. אפשר לנסות שוב.");
    }
  }

  async function turnOff() {
    setState("busy");
    setMessage("");
    try {
      const sub = await currentSubscription();
      if (sub) {
        await fetch("/api/push/unsubscribe", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ endpoint: sub.endpoint }) });
        await sub.unsubscribe();
      }
      setState("off");
      setMessage("ההתראות כובו במכשיר הזה.");
    } catch {
      setState("on");
      setMessage("כיבוי ההתראות נכשל. אפשר לנסות שוב.");
    }
  }

  const label = state === "on" ? "פעיל" : state === "off" ? "כבוי" : "…";
  return (
    <div className="flex flex-col gap-3">
      {state === "ios-install" ? (
        <p className="text-sm">
          באייפון התראות פועלות רק מהאפליקציה שנוספה למסך הבית (iOS 16.4 ומעלה): בספארי לוחצים על כפתור השיתוף, בוחרים &quot;הוספה למסך הבית&quot;, פותחים את
          האפליקציה ממסך הבית ומפעילים כאן.
        </p>
      ) : null}
      {state === "unsupported" ? <p className="text-sm">הדפדפן הזה לא תומך בהתראות.</p> : null}
      {state === "denied" ? <p className="text-sm">ההתראות חסומות בהגדרות הדפדפן לאתר הזה. כדי להפעיל אותן, מאשרים התראות בהגדרות האתר ומרעננים את הדף.</p> : null}
      {state === "off" || state === "on" || state === "busy" || state === "loading" ? (
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-sm">
            במכשיר הזה: <strong>{label}</strong>
          </span>
          {state === "on" ? (
            <button type="button" className={buttonClass("secondary", "sm")} onClick={turnOff}>
              כיבוי התראות
            </button>
          ) : (
            <button type="button" className={buttonClass("primary", "sm")} onClick={turnOn} disabled={state !== "off"}>
              הפעלת התראות
            </button>
          )}
        </div>
      ) : null}
      <p role="status" className="min-h-5 text-sm">
        {message}
      </p>
    </div>
  );
}

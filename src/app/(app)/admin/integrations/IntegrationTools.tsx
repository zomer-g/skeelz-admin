"use client";

import { useActionState } from "react";
import { buttonClass, smallFieldClass } from "@/components/ui";
import { addSmoovCampaign, testGa4, testGtm, testSmoov, type TestState } from "./actions";

const ACTIONS = { ga4: testGa4, gtm: testGtm, smoov: testSmoov } as const;

function Result({ state }: { state: TestState }) {
  if (!state) return null;
  return (
    <ul role="status" className={`mt-3 flex flex-col gap-1 rounded-card px-4 py-3 text-sm ${state.ok ? "bg-success-soft text-success" : "bg-danger-soft/40 text-danger"}`}>
      {state.lines.map((line) => (
        <li key={line} dir="auto">
          {line}
        </li>
      ))}
    </ul>
  );
}

export function TestButton({ integration, disabled }: { integration: keyof typeof ACTIONS; disabled: boolean }) {
  const [state, action, pending] = useActionState<TestState, FormData>(ACTIONS[integration], null);
  return (
    <div>
      <form action={action}>
        <button type="submit" disabled={disabled || pending} className={buttonClass("secondary", "sm")}>
          {pending ? "בודק…" : "בדיקת חיבור"}
        </button>
      </form>
      <Result state={state} />
    </div>
  );
}

export function AddCampaignForm() {
  const [state, action, pending] = useActionState<TestState, FormData>(addSmoovCampaign, null);
  return (
    <div>
      <form action={action} className="flex flex-wrap items-end gap-2">
        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium text-muted">מזהה קמפיין ב-SMOOV</span>
          <input name="id" inputMode="numeric" required dir="ltr" className={`${smallFieldClass} w-36`} />
        </label>
        <label className="flex flex-1 flex-col gap-1">
          <span className="text-xs font-medium text-muted">שם לתצוגה</span>
          <input name="label" required className={`${smallFieldClass} min-w-[12rem]`} />
        </label>
        <button type="submit" disabled={pending} className={buttonClass("primary", "sm")}>
          {pending ? "בודק…" : "הוספה למעקב"}
        </button>
      </form>
      <Result state={state} />
    </div>
  );
}

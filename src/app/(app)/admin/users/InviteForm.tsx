"use client";

import { useActionState } from "react";
import { buttonClass, fieldClass } from "@/components/ui";
import { inviteUser, type ActionState } from "./actions";
import { PermissionFields } from "./PermissionBoxes";

export function InviteForm() {
  const [state, action, pending] = useActionState<ActionState, FormData>(inviteUser, null);
  const failed = Boolean(state && !state.ok);

  return (
    <form action={action} className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end gap-3">
        <label className="flex min-w-[min(16rem,100%)] flex-1 flex-col gap-2">
          <span className="text-sm font-medium text-muted">אימייל (חשבון Google, חובה)</span>
          <input
            name="email"
            type="email"
            required
            dir="ltr"
            placeholder="name@example.com"
            aria-invalid={failed || undefined}
            aria-describedby="invite-result"
            className={`${fieldClass} text-start`}
          />
        </label>
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-2 text-sm font-medium text-muted">הרשאות</legend>
          <PermissionFields />
        </fieldset>
        <button type="submit" disabled={pending} className={buttonClass("primary")}>
          {pending ? "יוצר הזמנה…" : "הזמנה"}
        </button>
      </div>
      {/* Always mounted, so the result is announced when it arrives. */}
      <p id="invite-result" role="status" className={`text-sm ${failed ? "text-danger" : "text-success"}`}>
        {state?.message ?? ""}
      </p>
    </form>
  );
}

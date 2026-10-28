"use client";

import { useActionState } from "react";
import { buttonClass } from "@/components/ui";
import { syncStaffNow, type StaffActionState } from "./actions";

export function SyncButton() {
  const [state, action, pending] = useActionState<StaffActionState, FormData>(syncStaffNow, null);
  return (
    <form action={action} className="flex flex-wrap items-center gap-3">
      <button type="submit" disabled={pending} className={buttonClass("primary", "sm")}>
        {pending ? "מסנכרן…" : "סנכרון עכשיו"}
      </button>
      {/* Always mounted, so the result is announced when it arrives. */}
      <p role="status" className={`text-sm ${state && !state.ok ? "text-danger" : "text-success"}`}>
        {state?.message ?? ""}
      </p>
    </form>
  );
}

"use client";

import { useRef } from "react";
import { setPreviewRole } from "@/app/(app)/preview-actions";
import { ROLE_LABELS, ROLES, type Role } from "@/lib/auth/roles";
import { smallFieldClass } from "./ui";

/** Shown to real admins only: switch the whole platform to a lower role's view. */
export function PreviewSwitcher({ current }: { current: Role }) {
  const formRef = useRef<HTMLFormElement>(null);
  return (
    <form ref={formRef} action={setPreviewRole} className="flex items-center gap-2">
      <label htmlFor="view-as" className="text-xs text-muted">
        צפייה כ
      </label>
      <select
        key={current}
        id="view-as"
        name="role"
        defaultValue={current}
        onChange={() => formRef.current?.requestSubmit()}
        className={smallFieldClass}
      >
        {[...ROLES].reverse().map((r) => (
          <option key={r} value={r}>
            {ROLE_LABELS[r]}
          </option>
        ))}
      </select>
    </form>
  );
}

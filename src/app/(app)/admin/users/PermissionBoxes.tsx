"use client";

import { useId, useRef, useState, useTransition } from "react";
import { buttonClass } from "@/components/ui";
import { CATEGORY_HINTS, CATEGORY_LABELS, type Category } from "@/lib/auth/permissions";
import { setCategory } from "./actions";

/**
 * Permission categories as boxes. Ticking one opens a confirmation window first: adding access is
 * the step that must be deliberate. Unticking applies at once — removing access is always safe.
 */

type Boxes = Record<Category, boolean>;

/** The confirmation window: a native modal dialog (focus moves in, Escape cancels). */
function useConfirm() {
  const ref = useRef<HTMLDialogElement>(null);
  const [text, setText] = useState<{ title: string; body: string } | null>(null);
  const resolver = useRef<((ok: boolean) => void) | null>(null);
  const titleId = useId();

  const ask = (title: string, body: string) =>
    new Promise<boolean>((resolve) => {
      resolver.current = resolve;
      setText({ title, body });
      requestAnimationFrame(() => ref.current?.showModal());
    });
  const close = (ok: boolean) => {
    ref.current?.close();
    resolver.current?.(ok);
    resolver.current = null;
  };

  const dialog = (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      onCancel={(e) => {
        e.preventDefault();
        close(false);
      }}
      className="m-auto w-[min(28rem,calc(100%-2rem))] rounded-card border-2 border-line bg-surface p-6 text-start text-ink backdrop:bg-ink/40"
    >
      <h2 id={titleId} className="text-lg font-bold">
        {text?.title}
      </h2>
      <p className="mt-3 text-sm text-muted">{text?.body}</p>
      <div className="mt-6 flex flex-wrap justify-end gap-2">
        <button type="button" className={buttonClass("quiet", "sm")} onClick={() => close(false)} autoFocus>
          ביטול
        </button>
        <button type="button" className={buttonClass("primary", "sm")} onClick={() => close(true)}>
          כן, להוסיף
        </button>
      </div>
    </dialog>
  );
  return { ask, dialog };
}

const confirmText = (category: Category, who: string) => ({
  title: `להוסיף ל-${who} הרשאת ${CATEGORY_LABELS[category]}?`,
  body: CATEGORY_HINTS[category],
});

function Box({
  label,
  hint,
  checked,
  disabled,
  note,
  onChange,
  name,
}: {
  label: string;
  hint: string;
  checked: boolean;
  disabled?: boolean;
  note?: string;
  onChange?: (on: boolean) => void;
  name?: string;
}) {
  return (
    <label className={`flex items-center gap-1.5 whitespace-nowrap text-sm ${disabled ? "text-muted" : ""}`} title={note ?? hint}>
      <input
        type="checkbox"
        name={name}
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange?.(e.target.checked)}
        className="size-5 accent-[var(--color-accent)]"
      />
      {label}
      {note ? <span className="sr-only"> ({note})</span> : null}
    </label>
  );
}

/** One user's boxes in the users table; every change is saved at once (after the confirmation, when adding). */
export function PermissionBoxes({ userId, who, boxes, canGrantStaff }: { userId: string; who: string; boxes: Boxes; canGrantStaff: boolean }) {
  const { ask, dialog } = useConfirm();
  const [pending, start] = useTransition();
  const [error, setError] = useState("");

  const change = async (category: Category, on: boolean) => {
    setError("");
    if (on) {
      const t = confirmText(category, who);
      if (!(await ask(t.title, t.body))) return;
    }
    const form = new FormData();
    form.set("id", userId);
    form.set("category", category);
    form.set("on", String(on));
    start(async () => {
      try {
        await setCategory(form);
      } catch {
        setError("השינוי לא נשמר");
      }
    });
  };

  return (
    <div className="flex flex-col gap-1" aria-busy={pending || undefined}>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1" role="group" aria-label={`הרשאות · ${who}`}>
        <Box label={CATEGORY_LABELS.view} hint={CATEGORY_HINTS.view} checked disabled note="לכל משתמש" />
        <Box
          label={CATEGORY_LABELS.edit}
          hint={CATEGORY_HINTS.edit}
          checked={boxes.edit}
          disabled={pending || boxes.admin}
          note={boxes.admin ? "כלול באדמין" : undefined}
          onChange={(on) => change("edit", on)}
        />
        <Box
          label={CATEGORY_LABELS.staff}
          hint={CATEGORY_HINTS.staff}
          checked={boxes.staff}
          disabled={pending || !canGrantStaff}
          note={canGrantStaff ? undefined : "רק מנהל עובדים יכול לשנות"}
          onChange={(on) => change("staff", on)}
        />
        <Box label={CATEGORY_LABELS.admin} hint={CATEGORY_HINTS.admin} checked={boxes.admin} disabled={pending} onChange={(on) => change("admin", on)} />
      </div>
      <p role="status" className="text-xs text-danger">
        {error}
      </p>
      {dialog}
    </div>
  );
}

/** The edit/admin boxes inside an invite or approval form; ticking asks first, cancelling unticks. */
export function PermissionFields({ who }: { who?: string }) {
  const { ask, dialog } = useConfirm();
  const [boxes, setBoxes] = useState({ edit: false, admin: false });

  const change = async (category: "edit" | "admin", on: boolean) => {
    if (on) {
      const t = confirmText(category, who || "המשתמש");
      if (!(await ask(t.title, t.body))) return;
    }
    setBoxes((b) => ({ ...b, [category]: on }));
  };

  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1" role="group" aria-label={who ? `הרשאות · ${who}` : "הרשאות"}>
      <Box label={CATEGORY_LABELS.view} hint={CATEGORY_HINTS.view} checked disabled note="לכל משתמש" />
      <Box
        name="edit"
        label={CATEGORY_LABELS.edit}
        hint={CATEGORY_HINTS.edit}
        checked={boxes.edit || boxes.admin}
        disabled={boxes.admin}
        note={boxes.admin ? "כלול באדמין" : undefined}
        onChange={(on) => change("edit", on)}
      />
      <Box name="admin" label={CATEGORY_LABELS.admin} hint={CATEGORY_HINTS.admin} checked={boxes.admin} onChange={(on) => change("admin", on)} />
      {dialog}
    </div>
  );
}

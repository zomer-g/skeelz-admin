"use client";

import { useActionState } from "react";
import { buttonClass } from "@/components/ui";
import { deleteDemo, importSheet, loadDemo, type TimesheetActionState } from "./actions";

/** Always mounted, so the result is announced when it arrives. */
function Status({ state }: { state: TimesheetActionState }) {
  return (
    <div role="status" className={`text-sm ${state && !state.ok ? "text-danger" : "text-success"}`}>
      {state?.message ?? ""}
      {state?.errors?.length ? (
        <ul className="mt-2 list-disc ps-5 text-danger">
          {state.errors.map((e) => (
            <li key={`${e.line}-${e.message}`}>
              שורה {e.line}: {e.message}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

export function DemoButtons() {
  const [loadState, loadAction, loading] = useActionState<TimesheetActionState, FormData>(loadDemo, null);
  const [deleteState, deleteAction, deleting] = useActionState<TimesheetActionState, FormData>(deleteDemo, null);
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-3">
        <form action={loadAction}>
          <button type="submit" disabled={loading || deleting} className={buttonClass("primary", "sm")}>
            {loading ? "טוען…" : "טעינת דוח שעות דמו (שרית)"}
          </button>
        </form>
        <form
          action={deleteAction}
          onSubmit={(e) => {
            if (!window.confirm("למחוק את כל נתוני הדמו?")) e.preventDefault();
          }}
        >
          <button type="submit" disabled={loading || deleting} className={buttonClass("danger", "sm")}>
            {deleting ? "מוחק…" : "מחיקת נתוני דמו"}
          </button>
        </form>
      </div>
      <Status state={loadState} />
      <Status state={deleteState} />
    </div>
  );
}

export function SheetImport() {
  const [state, action, pending] = useActionState<TimesheetActionState, FormData>(importSheet, null);
  return (
    <form action={action} className="flex flex-col gap-3">
      <label className="flex flex-col gap-1 text-sm">
        <span className="font-medium">הדבקת דוח שעות</span>
        <textarea
          name="text"
          rows={6}
          dir="ltr"
          placeholder={"email,date,from,to\nsarit@example.com,2026-10-25,09:00,13:30"}
          className="rounded-card border border-field bg-white p-3 font-mono text-sm text-ink focus:outline-hidden focus:ring-2 focus:ring-accent"
        />
      </label>
      <label className="flex flex-col gap-1 text-sm">
        <span className="font-medium">או קובץ CSV</span>
        <input type="file" name="file" accept=".csv,.tsv,.txt,text/csv,text/plain" className="text-sm" />
      </label>
      <div>
        <button type="submit" disabled={pending} className={buttonClass("primary", "sm")}>
          {pending ? "קולט…" : "קליטת הדוח"}
        </button>
      </div>
      <Status state={state} />
    </form>
  );
}

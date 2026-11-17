"use client";

import { useActionState } from "react";
import { buttonClass } from "@/components/ui";
import { addSheet, deleteDemo, fitTimesheet, importSheet, loadDemo, pullSheets, removeSheet, type TimesheetActionState } from "./actions";

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
      <label className="flex items-start gap-2 text-sm">
        <input type="checkbox" name="reconstructed" className="mt-1" />
        <span>
          <span className="font-medium">שחזור, לא דוח שהוגש</span>
          <span className="block text-muted">דוח שנבנה בדיעבד (למשל מהפעילות ב-Salesforce). נשמר כ&quot;ידני&quot; ומסומן במסך כשחזור.</span>
        </span>
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

/** Fits one employee's reconstructed timesheet in the shown range to their actions, after a confirmation. */
export function FitButton({ userId, name, from, to }: { userId: string; name: string; from: string; to: string }) {
  const [state, action, pending] = useActionState<TimesheetActionState, FormData>(fitTimesheet, null);
  return (
    <form
      action={action}
      className="flex flex-col gap-2"
      onSubmit={(e) => {
        if (!window.confirm(`להתאים את דוח השעות המשוחזר של ${name} בטווח הזה לפעולות שלו? החלונות הנוכחיים יוחלפו.`)) e.preventDefault();
      }}
    >
      <input type="hidden" name="userId" value={userId} />
      <input type="hidden" name="from" value={from} />
      <input type="hidden" name="to" value={to} />
      <div>
        <button type="submit" disabled={pending} className={buttonClass("primary", "sm")}>
          {pending ? "מתאים…" : "התאמת הדוח לפעולות"}
          <span className="sr-only"> · {name}</span>
        </button>
      </div>
      <Status state={state} />
    </form>
  );
}

/** Adds a Google Sheet by its link, and pulls every listed sheet now. */
export function SheetSources() {
  const [addState, addAction, adding] = useActionState<TimesheetActionState, FormData>(addSheet, null);
  const [pullState, pullAction, pulling] = useActionState<TimesheetActionState, FormData>(pullSheets, null);
  return (
    <div className="flex flex-col gap-4">
      <form action={addAction} className="flex flex-col gap-2">
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium">קישור לגיליון</span>
          <input
            name="sheet"
            dir="ltr"
            required
            placeholder="https://docs.google.com/spreadsheets/d/…"
            className="rounded-pill border border-field bg-white px-4 py-2 text-sm text-ink focus:outline-hidden focus:ring-2 focus:ring-accent"
          />
        </label>
        <div>
          <button type="submit" disabled={adding} className={buttonClass("primary", "sm")}>
            {adding ? "מוסיף ומושך…" : "הוספה"}
          </button>
        </div>
        <Status state={addState} />
      </form>
      <form action={pullAction} className="flex flex-col gap-2">
        <div>
          <button type="submit" disabled={pulling} className={buttonClass("secondary", "sm")}>
            {pulling ? "מושך…" : "משיכה עכשיו"}
          </button>
        </div>
        <Status state={pullState} />
      </form>
    </div>
  );
}

export function RemoveSheetButton({ id, title }: { id: string; title: string }) {
  const [state, action, pending] = useActionState<TimesheetActionState, FormData>(removeSheet, null);
  return (
    <form
      action={action}
      onSubmit={(e) => {
        if (!window.confirm(`להפסיק למשוך את "${title}"? מה שכבר נקלט נשאר.`)) e.preventDefault();
      }}
    >
      <input type="hidden" name="sheet" value={id} />
      <button type="submit" disabled={pending} className={buttonClass("quiet", "sm")}>
        הפסקת משיכה<span className="sr-only"> · {title}</span>
      </button>
      <Status state={state} />
    </form>
  );
}

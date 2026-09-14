"use client";

import { useActionState, useId, useState, useTransition } from "react";
import { Badge, buttonClass, smallFieldClass } from "@/components/ui";
import { findJobs, linkJob, saveCampaign, type FormState } from "./actions";

export function CampaignSettingsForm({
  campaignKey,
  label,
  smoovCampaignId,
  sendDay,
  detectedSendDay,
}: {
  campaignKey: string;
  label: string | null;
  smoovCampaignId: number | null;
  sendDay: string | null;
  detectedSendDay: string;
}) {
  const [state, action, pending] = useActionState<FormState, FormData>(saveCampaign, null);
  return (
    <form action={action} className="flex flex-col gap-3">
      <input type="hidden" name="key" value={campaignKey} />
      <div className="flex flex-wrap items-end gap-3">
        <label className="flex min-w-[min(14rem,100%)] flex-1 flex-col gap-1">
          <span className="text-xs font-medium text-muted">שם לתצוגה</span>
          <input name="label" defaultValue={label ?? ""} placeholder={campaignKey} className={smallFieldClass} />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium text-muted">מזהה קמפיין ב-SMOOV</span>
          <input name="smoovCampaignId" inputMode="numeric" dir="ltr" defaultValue={smoovCampaignId ?? ""} className={`${smallFieldClass} w-36`} />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium text-muted">יום שליחה (ברירת מחדל: יום השיא {detectedSendDay})</span>
          <input name="sendDay" type="date" defaultValue={sendDay ?? ""} className={smallFieldClass} />
        </label>
        <button type="submit" disabled={pending} className={buttonClass("primary", "sm")}>
          {pending ? "שומר…" : "שמירה"}
        </button>
      </div>
      {/* Always mounted, so the result is announced when it arrives. */}
      <p role="status" className={`text-sm ${state?.ok ? "text-success" : "text-danger"}`}>
        {state?.message ?? ""}
      </p>
    </form>
  );
}

type Found = Awaited<ReturnType<typeof findJobs>>[number];

const MIN_QUERY = 2;

export function JobLinker({ campaignKey, linkedIds }: { campaignKey: string; linkedIds: string[] }) {
  const [q, setQ] = useState("");
  const [results, setResults] = useState<Found[]>([]);
  const [searched, setSearched] = useState(false);
  const [searching, startSearch] = useTransition();
  const hintId = useId();

  const search = () =>
    startSearch(async () => {
      setResults(await findJobs(q));
      setSearched(true);
    });

  return (
    <div className="flex flex-col gap-3">
      <form
        role="search"
        className="flex flex-wrap items-center gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (q.trim().length >= MIN_QUERY) search();
        }}
      >
        <input
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          aria-label="חיפוש משרה לקישור"
          aria-describedby={hintId}
          placeholder="חיפוש משרה לקישור: שם, חברה או מספר Case"
          className={`${smallFieldClass} min-w-[min(16rem,100%)] flex-1`}
        />
        <button type="submit" disabled={searching || q.trim().length < MIN_QUERY} className={buttonClass("secondary", "sm")}>
          {searching ? "מחפש…" : "חיפוש"}
        </button>
      </form>
      <p id={hintId} className="-mt-1 text-xs text-muted">
        לפחות {MIN_QUERY} תווים
      </p>
      <p role="status" className="sr-only">
        {searching ? "מחפש…" : searched ? `נמצאו ${results.length} משרות` : ""}
      </p>
      {results.length ? (
        <ul className="divide-y divide-line rounded-card bg-white ring-1 ring-line">
          {results.map((r) => (
            <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2 text-sm">
              <span>
                <span className="font-medium">{r.title ?? "(ללא שם)"}</span> {r.paid ? <Badge tone="brand">בתשלום</Badge> : null}
                <span className="text-muted">
                  {" "}
                  · {r.company ?? "—"}
                  {r.caseNumber ? ` · ${r.caseNumber}` : ""}
                  {r.created ? ` · ${r.created}` : ""}
                </span>
              </span>
              {linkedIds.includes(r.id) ? (
                <span className="text-xs text-success">מקושרת</span>
              ) : (
                <form action={linkJob}>
                  <input type="hidden" name="key" value={campaignKey} />
                  <input type="hidden" name="jobId" value={r.id} />
                  <button className={buttonClass("primary", "sm")}>
                    קישור<span className="sr-only"> · {r.title ?? ""}</span>
                  </button>
                </form>
              )}
            </li>
          ))}
        </ul>
      ) : searched && !searching ? (
        <p className="text-sm text-muted">לא נמצאו משרות</p>
      ) : null}
    </div>
  );
}

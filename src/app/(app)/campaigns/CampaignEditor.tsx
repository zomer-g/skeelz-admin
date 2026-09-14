"use client";

import { useActionState, useState, useTransition } from "react";
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
        <label className="flex min-w-[14rem] flex-1 flex-col gap-1">
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
      {state ? <p className={`text-sm ${state.ok ? "text-success" : "text-danger"}`}>{state.message}</p> : null}
    </form>
  );
}

type Found = Awaited<ReturnType<typeof findJobs>>[number];

export function JobLinker({ campaignKey, linkedIds }: { campaignKey: string; linkedIds: string[] }) {
  const [q, setQ] = useState("");
  const [results, setResults] = useState<Found[]>([]);
  const [searching, startSearch] = useTransition();

  const search = () =>
    startSearch(async () => {
      setResults(await findJobs(q));
    });

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <input
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              search();
            }
          }}
          placeholder="חיפוש משרה לקישור: שם, חברה או מספר Case"
          className={`${smallFieldClass} min-w-[16rem] flex-1`}
        />
        <button type="button" onClick={search} disabled={searching || q.trim().length < 2} className={buttonClass("secondary", "sm")}>
          {searching ? "מחפש…" : "חיפוש"}
        </button>
      </div>
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
                  <button className={buttonClass("primary", "sm")}>קישור</button>
                </form>
              )}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

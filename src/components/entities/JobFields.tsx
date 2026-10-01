import Link from "next/link";
import type { ReactNode } from "react";
import { Badge, formatDateTime } from "@/components/ui";
import { jobStatusLabel, type JobDetails } from "@/lib/entities/companies";
import { fmtDate, fmtInt } from "@/lib/format";
import type { Position } from "@/lib/metrics/jobs";

const yesNo = (v: boolean) => (v ? "כן" : "לא");

function Crown() {
  return (
    <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true" className="shrink-0" fill="currentColor">
      <path d="M3 7l4.5 4L12 4l4.5 7L21 7l-2 11H5L3 7zm2 13h14v2H5v-2z" />
    </svg>
  );
}

/** The site's crown / featured mark (`isMarked_cambium__c`). */
export function MarkedBadge() {
  return (
    <Badge tone="warning">
      <span className="inline-flex items-center gap-1">
        <Crown />
        כתר
      </span>
    </Badge>
  );
}

const mail = (v: string | null) => (v ? <a href={`mailto:${v}`} dir="ltr">{v}</a> : null);
const tel = (v: string | null) => (v ? <a href={`tel:${v}`} dir="ltr">{v}</a> : null);

/**
 * Every field of the job's Salesforce card, in its order, for the job card (/positions/[id]) and the
 * dashboard's job page (/jobs/[id]). Checkboxes always show כן / לא, so an unchecked box is visible too.
 */
export function jobFieldItems(position: Position, d: JobDetails | null): [string, ReactNode][] {
  const companyHref = d?.companyKey ? `/companies/${encodeURIComponent(d.companyKey)}` : null;
  const company = position.company ?? d?.companyName ?? null;
  return [
    ["שם המשרה", position.title],
    ["סטטוס באתר", d?.status ? jobStatusLabel(d.status) : null],
    ["כתר (isMarked_cambium)", d ? (d.marked ? <MarkedBadge /> : "לא") : null],
    ["משרה בתשלום (לפי הדשבורד)", yesNo(position.paid)],
    ["isSponserd_cambium", d ? yesNo(d.sponsored) : null],
    ["משרה בתשלום (שדה)", d ? yesNo(d.paidFlag) : null],
    ["מעסיק", companyHref ? <Link href={companyHref} className="underline underline-offset-4">{company}</Link> : company],
    ["Account Name", d?.accountName],
    ["גודל חברה", d?.companySize],
    ["היקף משרה", d?.time],
    ["מיקום", d?.location],
    ["עיר", d?.city],
    ["מחוז", d?.district],
    ["איש קשר באתר", d?.contactName],
    ["מייל איש הקשר באתר", mail(d?.contactEmail ?? null)],
    ["טלפון איש הקשר באתר", tel(d?.contactPhone ?? null)],
    ["Contact Name", d?.caseContactName],
    ["Contact Email", mail(d?.caseContactEmail ?? null)],
    ["Contact Phone", tel(d?.caseContactPhone ?? null)],
    ["בעלים (Case Owner)", d?.ownerName],
    ["נפתחה", fmtDate(position.createdAt)],
    ["נסגרה", d?.closedAt ? fmtDate(d.closedAt) : null],
    ["אורך חיי המקרה", d?.ageDays != null ? `${fmtInt(d.ageDays)} ימים` : null],
    ["נוצרה באתר (PCreatedDate)", d?.siteCreatedAt ? formatDateTime(d.siteCreatedAt) : null],
    ["עודכנה באתר (PModifiedDate)", d?.siteUpdatedAt ? formatDateTime(d.siteUpdatedAt) : null],
    ["הגשה עצמית באתר (isSelfApply)", d ? yesNo(d.selfApply) : null],
    ["בדיקות", d ? yesNo(d.tests) : null],
    ["משרה של זהר", d ? yesNo(d.zohar) : null],
    ["פולו-אפ", d?.followUp ? fmtDate(new Date(`${d.followUp}T00:00:00`)) : null],
    [
      "קישור חדש למשרה",
      d?.siteLink ? (
        <a href={d.siteLink} target="_blank" rel="noreferrer" dir="ltr" className="underline underline-offset-4">
          {d.siteLink.replace(/^https:\/\//, "")}
          <span className="sr-only"> (נפתח בלשונית חדשה)</span>
        </a>
      ) : null,
    ],
  ];
}

/** The job's description and internal comments (PDescription_cambium, PComments_cambium). */
export function JobTexts({ details }: { details: JobDetails | null }) {
  if (!details?.comments && !details?.description) return null;
  return (
    <>
      {details.comments ? (
        <div className="mt-4">
          <p className="text-xs text-muted">הערות פנימיות (PComments_cambium)</p>
          <p className="whitespace-pre-line" dir="auto">
            {details.comments}
          </p>
        </div>
      ) : null}
      {details.description ? (
        <details className="mt-4">
          <summary className="cursor-pointer text-sm font-medium text-accent-dark">תיאור המשרה (PDescription_cambium)</summary>
          <p className="mt-2 whitespace-pre-line text-sm" dir="auto">
            {details.description}
          </p>
        </details>
      ) : null}
    </>
  );
}

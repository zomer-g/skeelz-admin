import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { EntityHeader, FieldList, Timeline } from "@/components/entities/EntityParts";
import { Badge, Card } from "@/components/ui";
import { pageAuth } from "@/lib/auth/guard";
import { loadFullCaseTimeline } from "@/lib/entities/activity";
import { emailPath } from "@/lib/entities/emails";
import { loadLead } from "@/lib/entities/leads";
import { isSfId, sfRecordUrl } from "@/lib/entities/search";
import { fmtDate } from "@/lib/format";

export const metadata: Metadata = { title: "ליד מעסיק" };
export const dynamic = "force-dynamic";

/** One employer lead Case: its fields, the employer and contact, and everything logged on it. */
export default async function LeadPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isSfId(id)) notFound();
  const auth = await pageAuth("viewer", `/leads/${id}`);
  if (!auth.ok) return auth.render;

  const lead = await loadLead(id);
  if (!lead) notFound();
  const { items: timeline, live } = await loadFullCaseTimeline(id);

  return (
    <>
      <EntityHeader
        back={{ href: "/leads", label: "כל לידי המעסיקים" }}
        title={lead.accountName ?? lead.subject ?? "ליד מעסיק"}
        subtitle={lead.subject && lead.accountName ? <span dir="auto">{lead.subject}</span> : undefined}
        badges={
          <>
            {lead.status ? <Badge tone={lead.status === "נחתם חוזה" ? "success" : "accent"}>{lead.status}</Badge> : null}
            {lead.caseNumber ? <span className="tabular-nums text-muted">Case {lead.caseNumber}</span> : null}
          </>
        }
        links={[
          { href: sfRecordUrl(lead.id), label: "Salesforce", external: true },
          { href: lead.accountId ? sfRecordUrl(lead.accountId) : null, label: "המעסיק (Account) ב-Salesforce", external: true },
          { href: lead.contactEmail ? emailPath(lead.contactEmail) : null, label: "כל הפניות לפי המייל" },
        ]}
      />
      <Card title="פרטי הליד">
        <FieldList
          items={[
            ["מעסיק (Account)", lead.accountName],
            ["סטטוס מעסיק ב-Account", lead.accountStatus],
            ["איש קשר", lead.contactName],
            ["מייל", lead.contactEmail ? <a href={`mailto:${lead.contactEmail}`} dir="ltr">{lead.contactEmail}</a> : null],
            ["טלפון", lead.contactPhone ? <a href={`tel:${lead.contactPhone}`} dir="ltr">{lead.contactPhone}</a> : null],
            ["מטפל", lead.ownerName],
            ["נפתח", lead.createdAt ? fmtDate(lead.createdAt) : null],
            ["שינוי סטטוס אחרון", lead.statusChangedAt ? fmtDate(lead.statusChangedAt) : null],
            ["נסגר", lead.closedAt ? fmtDate(lead.closedAt) : null],
          ]}
        />
        {lead.description ? (
          <details className="mt-4 text-sm">
            <summary className="cursor-pointer font-medium text-accent-dark">תיאור</summary>
            <p className="mt-2 whitespace-pre-line" dir="auto">
              {lead.description}
            </p>
          </details>
        ) : null}
      </Card>
      <Card title="פעילות על הליד" className="mt-4">
        <Timeline items={timeline} empty="לא נרשמה פעילות על הליד" />
        {live === "failed" ? <p className="mt-3 text-xs text-muted">התוכן המלא (הערות ותוכן המיילים) לא נטען כרגע מ-Salesforce; אפשר לרענן את הדף.</p> : null}
      </Card>
    </>
  );
}

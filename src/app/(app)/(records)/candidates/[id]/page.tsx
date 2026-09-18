import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ApplicationsTable, EntityHeader, FieldList } from "@/components/entities/EntityParts";
import { Badge, Card } from "@/components/ui";
import { pageAuth } from "@/lib/auth/guard";
import { searchApplications } from "@/lib/entities/applications";
import { fileName, loadCandidate, loadCandidateFiles } from "@/lib/entities/candidates";
import { isSfId, sfRecordUrl } from "@/lib/entities/search";
import { fmtDate, fmtInt } from "@/lib/format";

export const metadata: Metadata = { title: "מועמד" };
export const dynamic = "force-dynamic";

const MAX_APPLICATIONS = 100;

const fileSize = (bytes: number) => (bytes >= 1_048_576 ? `${(bytes / 1_048_576).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`);

export default async function CandidatePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isSfId(id)) notFound();
  const auth = await pageAuth("viewer", `/candidates/${id}`);
  if (!auth.ok) return auth.render;

  const candidate = await loadCandidate(id);
  if (!candidate) notFound();
  const [{ files, error }, applications] = await Promise.all([
    loadCandidateFiles(id),
    searchApplications({ q: "", status: "", paid: "", owner: "", fromDay: "", toDay: "", contactId: id }, { pageSize: MAX_APPLICATIONS }),
  ]);

  return (
    <>
      <EntityHeader
        back={{ href: "/candidates", label: "כל המועמדים" }}
        title={candidate.name ?? "מועמד"}
        subtitle={
          <span dir="ltr">
            {[candidate.email, candidate.phone].filter(Boolean).join(" · ")}
          </span>
        }
        badges={
          <>
            {files.length ? <Badge tone="accent">{fmtInt(files.length)} קבצים</Badge> : candidate.hasCv ? <Badge tone="accent">מסומן: יש קו&quot;ח</Badge> : <Badge>אין קו&quot;ח</Badge>}
            <Badge>{fmtInt(candidate.applications)} הגשות</Badge>
            {candidate.accountName ? <span className="text-muted">{candidate.accountName}</span> : null}
          </>
        }
        links={[
          { href: sfRecordUrl(candidate.id), label: "Salesforce", external: true },
          { href: candidate.applications ? `/applications?candidate=${candidate.id}` : null, label: "ההגשות בחיפוש" },
        ]}
      />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card title="פרטים" className="lg:col-span-2">
          <FieldList
            items={[
              ["מייל", candidate.email ? <a href={`mailto:${candidate.email}`} dir="ltr">{candidate.email}</a> : null],
              ["טלפון", candidate.phone ? <a href={`tel:${candidate.phone}`} dir="ltr">{candidate.phone}</a> : null],
              ["עיר", candidate.city],
              ["מחוז", candidate.district],
              ["תאריך לידה", candidate.birthDate],
              ["מגדר", candidate.gender],
              ["Account", candidate.accountName],
              ["סוג איש קשר", candidate.contactType],
              ["נוסף", fmtDate(candidate.createdAt)],
              ["הגשה אחרונה", candidate.lastApplicationAt ? fmtDate(candidate.lastApplicationAt) : null],
              ["פעילות אחרונה ב-Salesforce", candidate.lastActivityDate],
              ["הגשה מהירה", candidate.fastApply ? "כן" : null],
              ["טאלנט", candidate.talent ? "כן" : null],
            ]}
          />
        </Card>
        <Card title='קבצים וקו"ח'>
          {files.length ? (
            <ul className="flex flex-col gap-3">
              {files.map((f) => (
                <li key={f.documentId} className="flex flex-col">
                  <a
                    href={`/api/candidates/${candidate.id}/files/${f.documentId}`}
                    target="_blank"
                    rel="noreferrer"
                    className="font-medium text-accent-dark underline underline-offset-4"
                    dir="auto"
                  >
                    {fileName(f)}
                    <span className="sr-only"> (נפתח בלשונית חדשה)</span>
                  </a>
                  <span className="text-xs text-muted">
                    {fileSize(f.size)} · {fmtDate(f.createdAt)}
                    {f.applicationId ? (
                      <>
                        {" · "}
                        <Link href={`/applications/${f.applicationId}`} className="underline underline-offset-2">
                          צורף להגשה
                        </Link>
                      </>
                    ) : null}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-muted">{error ?? (candidate.hasCv ? 'המועמד מסומן כבעל קו"ח, אבל לא נמצא קובץ מצורף ב-Salesforce.' : "אין קבצים מצורפים.")}</p>
          )}
          <p className="mt-3 text-xs text-muted">הקבצים נטענים ישירות מ-Salesforce. כל פתיחה נרשמת ביומן הפעילות.</p>
        </Card>
      </div>

      {candidate.skills.length ? (
        <Card title="כישורים" className="mt-4">
          <div className="flex flex-wrap gap-2">
            {candidate.skills.map((s) => (
              <Badge key={s} tone="accent">
                {s}
              </Badge>
            ))}
          </div>
        </Card>
      ) : null}

      <Card title={`הגשות · ${fmtInt(applications.total)}`} tone="accent-light" className="mt-4">
        <ApplicationsTable rows={applications.rows} hide={["candidate"]} empty="המועמד לא הגיש מועמדות" />
      </Card>
    </>
  );
}

import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { EntityHeader, FieldList } from "@/components/entities/EntityParts";
import { Badge, Card, formatDateTime, Table } from "@/components/ui";
import { pageAuth } from "@/lib/auth/guard";
import { TOPICS } from "@/lib/cv-topics";
import { fileSize } from "@/lib/entities/cv";
import { CV_SOURCE_LABELS, loadCv, loadCvTopics } from "@/lib/entities/cvs";
import { emailPath } from "@/lib/entities/emails";
import { loadFileAccessLog } from "@/lib/entities/file-access";
import { sfRecordUrl } from "@/lib/entities/search";
import { fmtDate, fmtInt } from "@/lib/format";

export const metadata: Metadata = { title: "קובץ קורות חיים" };
export const dynamic = "force-dynamic";

/** One CV: who it belongs to, every place it hangs in Salesforce, and everyone who opened it. */
export default async function CvPage({ params }: { params: Promise<{ documentId: string }> }) {
  const { documentId } = await params;
  const auth = await pageAuth("viewer", `/cvs/${documentId}`);
  if (!auth.ok) return auth.render;

  const found = await loadCv(documentId);
  if (!found) notFound();
  const { cv, links } = found;
  const [log, tagged] = await Promise.all([loadFileAccessLog(documentId), loadCvTopics(documentId)]);
  // The topics themselves; a group only repeats them.
  const topics = tagged.flatMap((t) => {
    const topic = TOPICS.find((x) => x.id === t.topicId);
    return topic ? [{ ...topic, found: t.phrases }] : [];
  });
  const opens = log.filter((e) => e.opened);
  const people = new Set(opens.map((e) => e.actor)).size;

  return (
    <>
      <EntityHeader
        back={{ href: "/cvs", label: "כל קורות החיים" }}
        title={cv.title ?? "קובץ"}
        subtitle={<span>{cv.name ?? cv.email ?? "—"}</span>}
        badges={
          <>
            <Badge>{fmtInt(opens.length)} פתיחות</Badge>
            {cv.extension ? <span className="text-muted">{cv.extension.toUpperCase()} · {fileSize(cv.size)}</span> : null}
          </>
        }
        links={[
          { href: cv.openPath, label: "פתיחת הקובץ (נרשם ביומן)", external: true },
          { href: cv.email ? emailPath(cv.email) : cv.contactId ? `/candidates/${cv.contactId}` : null, label: "דף המועמד" },
          { href: cv.caseId ? sfRecordUrl(cv.caseId) : null, label: "ה-Case ב-Salesforce", external: true },
        ]}
      />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card title="הקובץ">
          <FieldList
            items={[
              ["מועמד", cv.name],
              ["מייל", cv.email ? <span dir="ltr">{cv.email}</span> : null],
              ["הגיע", cv.receivedAt ? fmtDate(cv.receivedAt) : null],
              ["Case", cv.caseNumber ? `${cv.caseNumber}${cv.caseType ? ` · ${cv.caseType}` : ""}${cv.caseStatus ? ` · ${cv.caseStatus}` : ""}` : null],
              [
                "תחומים",
                topics.length ? (
                  <ul className="flex flex-col gap-1">
                    {topics.map((t) => (
                      <li key={t.id}>
                        <Link href={`/cvs?topic=${t.id}`} className="font-medium underline underline-offset-2">
                          {t.label}
                        </Link>
                        <span className="text-xs text-muted"> · נמצא: {t.found.join(" · ")}</span>
                      </li>
                    ))}
                  </ul>
                ) : null,
              ],
            ]}
          />
        </Card>
        <Card title={`איפה הקובץ ב-Salesforce · ${fmtInt(links.length)}`}>
          <ul className="flex flex-col gap-2 text-sm">
            {links.map((l) => (
              <li key={`${l.type}-${l.entityId}`} className="flex flex-wrap items-center gap-2">
                <Badge>{CV_SOURCE_LABELS[l.type]}</Badge>
                {l.type === "contact" ? (
                  <Link href={`/candidates/${l.entityId}`} className="underline underline-offset-2">
                    איש הקשר
                  </Link>
                ) : l.caseId ? (
                  <a href={sfRecordUrl(l.caseId) ?? "#"} target="_blank" rel="noreferrer" className="underline underline-offset-2">
                    Case<span className="sr-only"> ב-Salesforce (נפתח בלשונית חדשה)</span>
                  </a>
                ) : null}
                {l.subject ? <span className="text-muted" dir="auto">{l.subject}</span> : null}
                {l.at ? <span className="tabular-nums text-muted">{fmtDate(l.at)}</span> : null}
              </li>
            ))}
          </ul>
        </Card>
      </div>

      <Card title={`יומן גישה · ${fmtInt(opens.length)} פתיחות על ידי ${fmtInt(people)} אנשים`} tone="accent-light" className="mt-4">
        <Table head={["מתי", "מי", "דרך", "תוצאה"]} empty={log.length === 0 ? "אף אחד עוד לא פתח את הקובץ דרך המערכת" : undefined}>
          {log.map((e, i) => (
            <tr key={i}>
              <td className="whitespace-nowrap px-3 py-2 tabular-nums">{formatDateTime(e.at)}</td>
              <td className="px-3 py-2">
                {e.actorName ?? e.actor}
                {e.actorName ? (
                  <p className="text-xs text-muted" dir="ltr">
                    {e.actor}
                  </p>
                ) : null}
              </td>
              <td className="px-3 py-2 text-xs" dir="auto">
                {e.via ? (e.via.includes("@") ? `דף הכתובת ${e.via}` : "דף המועמד") : "—"}
              </td>
              <td className="px-3 py-2">{e.opened ? <Badge tone="success">נפתח</Badge> : <Badge tone="brand">נחסם (מגבלה יומית)</Badge>}</td>
            </tr>
          ))}
        </Table>
        <p className="mt-3 text-xs text-muted">
          כל פתיחה של קובץ מועמד דרך המערכת נרשמת ביומן הפעילות (מי, מתי, איזה קובץ ודרך איזה דף), וכך גם ניסיון שנחסם במגבלה היומית (20 קבצים ליום, ועוד 30 בכל אישור של מנהל). פתיחה ישירות
          ב-Salesforce לא עוברת דרך המערכת ולא מופיעה כאן.
        </p>
      </Card>
    </>
  );
}

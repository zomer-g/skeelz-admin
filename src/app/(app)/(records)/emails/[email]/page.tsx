import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { EntityHeader, EntityTabs } from "@/components/entities/EntityParts";
import { Badge, Card, formatDateTime, NewTabNote, Table } from "@/components/ui";
import { pageAuth } from "@/lib/auth/guard";
import { cvCount, cvFilePath, fileSize, loadEmailCvs, type CvFile, type EmailCvs } from "@/lib/entities/cv";
import { casePath, emailPath, loadEmailCases, loadEmailContacts, MAX_EMAIL_CASES, normEmail } from "@/lib/entities/emails";
import { param, sfRecordUrl, type SearchParams } from "@/lib/entities/search";
import { fileName } from "@/lib/entities/serve-file";
import { fmtDate, fmtInt } from "@/lib/format";

export const metadata: Metadata = { title: "כתובת דוא״ל" };
export const dynamic = "force-dynamic";

const TABS = [
  { key: "cases", label: "פניות והגשות" },
  { key: "contacts", label: "אנשי קשר" },
  { key: "files", label: 'קורות חיים וקבצים' },
] as const;
type Tab = (typeof TABS)[number]["key"];

/** A link to the same email page with some parameters changed ("" removes one). */
function hrefWith(email: string, current: Record<string, string>, change: Record<string, string>): string {
  const q = new URLSearchParams(Object.entries({ ...current, ...change }).filter(([, v]) => v));
  const s = q.toString();
  return s ? `${emailPath(email)}?${s}` : emailPath(email);
}

export default async function EmailPage({ params, searchParams }: { params: Promise<{ email: string }>; searchParams: Promise<SearchParams> }) {
  const [{ email: raw }, search] = await Promise.all([params, searchParams]);
  let decoded = raw;
  try {
    decoded = decodeURIComponent(raw);
  } catch {}
  const email = normEmail(decoded);
  if (!email) notFound();
  const tab: Tab = TABS.find((t) => t.key === param(search, "tab"))?.key ?? "cases";
  const type = param(search, "type");
  const order = param(search, "order") === "desc" ? "desc" : "";
  const current = { tab: tab === "cases" ? "" : tab, type, order };
  const auth = await pageAuth("viewer", hrefWith(email, current, {}));
  if (!auth.ok) return auth.render;

  const [contacts, { cases, total }, cvs] = await Promise.all([loadEmailContacts(email), loadEmailCases(email), loadEmailCvs(email)]);
  if (!contacts.length && !cases.length) notFound();

  const names = [...new Set(contacts.map((c) => c.name).filter((n): n is string => Boolean(n)))];
  const phones = [...new Set(contacts.map((c) => c.phone).filter((p): p is string => Boolean(p)))];
  const bySender = cases.filter((c) => !c.contactId).length;

  const typeCounts = [...cases.reduce((m, c) => m.set(c.recordType ?? "", { label: c.typeLabel, n: (m.get(c.recordType ?? "")?.n ?? 0) + 1 }), new Map<string, { label: string; n: number }>())]
    .sort((a, b) => b[1].n - a[1].n);
  const shown = cases.filter((c) => !type || c.recordType === type);
  if (order === "desc") shown.reverse();
  const showContact = contacts.length > 1 || bySender > 0;
  const contactName = new Map(contacts.map((c, i) => [c.id, c.name ? `${c.name}${names.length < contacts.length ? ` (${i + 1})` : ""}` : `איש קשר ${i + 1}`]));

  return (
    <>
      <EntityHeader
        back={{ href: "/emails", label: "כל הכתובות" }}
        title={email}
        subtitle={names.length ? <span dir="auto">{names.join(" · ")}</span> : undefined}
        badges={
          <>
            <Badge tone={contacts.length > 1 ? "warning" : "neutral"}>{fmtInt(contacts.length)} אנשי קשר</Badge>
            <Badge>{fmtInt(total)} פניות</Badge>
            {phones.length ? (
              <span className="text-muted" dir="ltr">
                {phones.join(" · ")}
              </span>
            ) : null}
          </>
        }
        links={[{ href: `mailto:${email}`, label: "שליחת מייל" }]}
      />

      <EntityTabs
        label="לשוניות הכתובת"
        tabs={TABS.map((t) => ({
          href: hrefWith(email, {}, { tab: t.key === "cases" ? "" : t.key }),
          label: t.label,
          count: t.key === "cases" ? total : t.key === "contacts" ? contacts.length : undefined,
          active: t.key === tab,
        }))}
      />

      <CvBox email={email} cvs={cvs} allHref={hrefWith(email, {}, { tab: "files" })} onFilesTab={tab === "files"} />

      {tab === "cases" ? (
        <Card title={`פניות והגשות · ${fmtInt(shown.length)}`}>
          <p className="mb-3 text-sm text-muted">
            כל ה-Cases של אנשי הקשר עם הכתובת הזו
            {bySender ? `, ועוד ${fmtInt(bySender)} בלי איש קשר שנשלחו מהכתובת` : ""}. מסודרים לפי תאריך הפתיחה,{" "}
            {order === "desc" ? "מהחדש לישן" : "מהישן לחדש"}.{" "}
            <Link href={hrefWith(email, current, { order: order ? "" : "desc" })} className="font-medium text-accent-dark underline underline-offset-4">
              {order ? "מהישן לחדש" : "מהחדש לישן"}
            </Link>
          </p>
          {typeCounts.length > 1 ? (
            <nav aria-label="סינון לפי סוג" className="mb-4 flex flex-wrap gap-2">
              {[["", { label: "הכל", n: cases.length }] as const, ...typeCounts].map(([key, t]) => {
                const active = key === type;
                return (
                  <Link
                    key={key || "all"}
                    href={hrefWith(email, current, { type: key })}
                    aria-current={active ? "true" : undefined}
                    className={`rounded-full px-3 py-1 text-sm font-medium ${active ? "bg-accent text-white" : "bg-accent/10 text-accent-dark hover:bg-accent/20"}`}
                  >
                    {t.label} <span className="tabular-nums">({fmtInt(t.n)})</span>
                  </Link>
                );
              })}
            </nav>
          ) : null}
          <Table
            head={["נפתחה", "סוג", "נושא", "סטטוס", ...(showContact ? ["איש קשר"] : []), "מטפל", ""]}
            empty={shown.length === 0 ? "אין פניות" : undefined}
          >
            {shown.map((c) => {
              const path = casePath(c);
              const sf = sfRecordUrl(c.id);
              return (
                <tr key={c.id}>
                  <td className="whitespace-nowrap px-3 py-2">
                    {path ? (
                      <Link href={path} className="font-medium tabular-nums underline-offset-4 hover:underline">
                        {formatDateTime(c.createdAt)}
                      </Link>
                    ) : (
                      <span className="font-medium tabular-nums">{formatDateTime(c.createdAt)}</span>
                    )}
                    <p className="text-xs tabular-nums text-muted">{c.caseNumber}</p>
                  </td>
                  <td className="px-3 py-2">
                    <Badge tone="accent">{c.typeLabel}</Badge>
                  </td>
                  <td className="min-w-0 px-3 py-2">
                    <span dir="auto" className="break-words">
                      {c.subject ?? "—"}
                    </span>
                    {c.jobId ? (
                      <p className="text-xs">
                        משרה:{" "}
                        <Link href={`/positions/${c.jobId}`} className="underline underline-offset-2" dir="auto">
                          {c.jobTitle ?? "(ללא שם)"}
                        </Link>
                        {c.company ? <span className="text-muted"> · {c.company}</span> : null}
                      </p>
                    ) : null}
                  </td>
                  <td className="px-3 py-2">
                    {c.status ?? "—"}
                    {c.closedAt ? <p className="text-xs text-muted">נסגר {fmtDate(c.closedAt)}</p> : null}
                  </td>
                  {showContact ? (
                    <td className="px-3 py-2 text-xs">
                      {c.contactId ? (
                        <Link href={`/candidates/${c.contactId}`} className="underline underline-offset-2" dir="auto">
                          {contactName.get(c.contactId) ?? c.contactName ?? "איש קשר"}
                        </Link>
                      ) : (
                        <span className="text-muted">בלי איש קשר (לפי כתובת השולח)</span>
                      )}
                    </td>
                  ) : null}
                  <td className="px-3 py-2">{c.ownerName ?? "—"}</td>
                  <td className="whitespace-nowrap px-3 py-2">
                    {sf ? (
                      <a href={sf} target="_blank" rel="noreferrer" className="font-medium text-accent-dark underline underline-offset-4">
                        Salesforce<span className="sr-only"> · {c.caseNumber ?? c.typeLabel}</span>
                        <NewTabNote />
                      </a>
                    ) : null}
                  </td>
                </tr>
              );
            })}
          </Table>
          {total > MAX_EMAIL_CASES ? <p className="mt-3 text-sm text-muted">מוצגות {fmtInt(MAX_EMAIL_CASES)} הפניות הראשונות מתוך {fmtInt(total)}.</p> : null}
        </Card>
      ) : null}

      {tab === "contacts" ? (
        <Card title={`אנשי קשר · ${fmtInt(contacts.length)}`}>
          <p className="mb-3 text-sm text-muted">כל אנשי הקשר ב-Salesforce עם הכתובת הזו, מהוותיק לחדש. אותו אדם, שנרשם כמה פעמים.</p>
          <Table head={["איש קשר", "טלפון", "עיר", "Account", 'קו"ח', "פניות", "נוסף", ""]} empty={contacts.length === 0 ? "אין איש קשר עם הכתובת הזו" : undefined}>
            {contacts.map((c) => {
              const sf = sfRecordUrl(c.id);
              return (
                <tr key={c.id}>
                  <td className="px-3 py-2">
                    <Link href={`/candidates/${c.id}`} className="font-medium underline-offset-4 hover:underline" dir="auto">
                      {contactName.get(c.id)}
                    </Link>
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 tabular-nums" dir="ltr">
                    {c.phone ?? "—"}
                  </td>
                  <td className="px-3 py-2 text-xs">{c.city ?? "—"}</td>
                  <td className="px-3 py-2 text-xs">{c.accountName ?? "—"}</td>
                  <td className="px-3 py-2">{c.hasCv ? <Badge tone="accent">יש</Badge> : <span className="text-muted">—</span>}</td>
                  <td className="px-3 py-2 tabular-nums">{fmtInt(c.cases)}</td>
                  <td className="whitespace-nowrap px-3 py-2 tabular-nums">{fmtDate(c.createdAt)}</td>
                  <td className="whitespace-nowrap px-3 py-2">
                    {sf ? (
                      <a href={sf} target="_blank" rel="noreferrer" className="font-medium text-accent-dark underline underline-offset-4">
                        Salesforce<span className="sr-only"> · {contactName.get(c.id)}</span>
                        <NewTabNote />
                      </a>
                    ) : null}
                  </td>
                </tr>
              );
            })}
          </Table>
        </Card>
      ) : null}

      {tab === "files" ? (
        <Card title={`כל הקבצים שנמצאו · ${fmtInt(cvs.files.length)}`}>
          <p className="mb-3 text-sm text-muted">
            כל הקבצים של האדם הזה ב-Salesforce: על אנשי הקשר, על התיקים שלהם, ועל המיילים שבתוך התיקים. קבצים שנראים כמו קורות חיים
            מופיעים ראשונים. קבצים קטנים שהם חתימות מייל או הזמנות יומן לא נכללים.
          </p>
          {cvs.files.length ? (
            <ul className="flex flex-col gap-3">
              {cvs.files.map((f) => (
                <li key={f.documentId} className="flex flex-col">
                  <CvFileLink email={email} file={f} />
                  <CvFileWhere file={f} />
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-muted">{cvs.error ?? "לא נמצאו קבצים."}</p>
          )}
          <p className="mt-3 text-xs text-muted">הקבצים נטענים ישירות מ-Salesforce ולא נשמרים כאן. כל פתיחה נרשמת ביומן הפעילות.</p>
        </Card>
      ) : null}
    </>
  );
}

/**
 * The CV box. Finding someone's CV is the thing this page is used for, so it
 * sits above the tabs and says plainly whether one was found and, when it was
 * not, where we looked — the three places a CV can sit in Salesforce.
 */
function CvBox({ email, cvs, allHref, onFilesTab }: { email: string; cvs: EmailCvs; allHref: string; onFilesTab: boolean }) {
  const cvFiles = cvs.files.filter((f) => f.looksLikeCv);
  const found = cvFiles.length > 0;
  const onContact = cvs.files.filter((f) => f.sources.includes("contact"));
  const onCase = cvs.files.filter((f) => f.sources.includes("case"));
  const onMail = cvs.files.filter((f) => f.sources.includes("email"));
  const cvCaseFiles = cvs.files.filter((f) => f.caseType === "cv_message");

  return (
    <Card
      title={`קורות חיים${found ? ` · ${fmtInt(cvCount(cvs.files))}` : ""}`}
      level={2}
    >
      <p className="mb-3 flex flex-wrap items-center gap-2 text-sm">
        {cvs.error ? (
          <Badge tone="warning">{cvs.error}</Badge>
        ) : found ? (
          <Badge tone="success">נמצאו קורות חיים</Badge>
        ) : cvs.files.length ? (
          <Badge tone="warning">נמצאו קבצים, אף אחד לא מזוהה כקורות חיים</Badge>
        ) : (
          <Badge tone="neutral">לא נמצא קובץ</Badge>
        )}
        {cvs.cvFlag ? <Badge tone="accent">תיבת קו&quot;ח מסומנת באיש הקשר</Badge> : null}
        {!cvs.cvFlag && found ? <span className="text-muted">תיבת קו&quot;ח באיש הקשר לא מסומנת, אף שיש קובץ</span> : null}
      </p>

      <ul className="mb-4 flex flex-col gap-1 text-sm">
        <CvWhereRow label="קובץ על איש הקשר" files={onContact} empty={`נבדקו ${fmtInt(cvs.checked.contacts)} אנשי קשר`} />
        <CvWhereRow
          label='תיק מסוג "קורות חיים"'
          files={cvCaseFiles}
          empty={cvs.checked.cvCases ? `יש ${fmtInt(cvs.checked.cvCases)} תיקים כאלה, בלי קובץ` : "אין תיק כזה"}
        />
        <CvWhereRow
          label="קובץ מצורף למייל בתיק"
          files={onMail}
          empty={`נבדקו ${fmtInt(cvs.checked.emails)} מיילים ב-${fmtInt(cvs.checked.cases)} תיקים`}
        />
        {onCase.length ? <CvWhereRow label="קובץ על התיק עצמו" files={onCase} empty="" /> : null}
      </ul>

      {cvs.files.length && !onFilesTab ? (
        <>
          <ul className="flex flex-col gap-3">
            {cvs.files.slice(0, 3).map((f) => (
              <li key={f.documentId} className="flex flex-col">
                <CvFileLink email={email} file={f} />
                <CvFileWhere file={f} />
              </li>
            ))}
          </ul>
          <p className="mt-3 text-sm">
            <Link href={allHref} className="font-medium text-accent-dark underline underline-offset-4">
              {cvs.files.length > 3 ? `כל ${fmtInt(cvs.files.length)} הקבצים` : "לשונית הקבצים"}
            </Link>
          </p>
        </>
      ) : null}
    </Card>
  );
}

/** One of the three places a CV can sit: how many files are there, or what was checked. */
function CvWhereRow({ label, files, empty }: { label: string; files: CvFile[]; empty: string }) {
  return (
    <li className="flex flex-wrap items-baseline gap-2">
      <span aria-hidden="true" className={files.length ? "text-success" : "text-muted"}>
        {files.length ? "✓" : "—"}
      </span>
      <span className="font-medium">{label}:</span>
      <span className={files.length ? "" : "text-muted"}>
        {files.length ? `${fmtInt(files.length)} קבצים` : empty}
        <span className="sr-only">{files.length ? "" : " — לא נמצא"}</span>
      </span>
    </li>
  );
}

function CvFileLink({ email, file }: { email: string; file: CvFile }) {
  return (
    <a
      href={cvFilePath(email, file.documentId)}
      target="_blank"
      rel="noreferrer"
      className="font-medium text-accent-dark underline underline-offset-4"
      dir="auto"
    >
      {fileName(file)}
      <NewTabNote />
    </a>
  );
}

/** Where the file was found, in words, with a link to the Case it came from. */
function CvFileWhere({ file }: { file: CvFile }) {
  const path = file.caseId ? casePath({ id: file.caseId, recordType: file.caseType }) : null;
  const sfUrl = file.caseId ? sfRecordUrl(file.caseId) : null;
  const caseLabel = `${file.caseTypeLabel ?? "תיק"}${file.caseNumber ? ` ${file.caseNumber}` : ""}`;
  return (
    <span className="text-xs text-muted">
      {fileSize(file.size)} · {fmtDate(file.createdAt)}
      {file.sources.includes("contact") ? <> · על איש הקשר{file.contactName ? ` ${file.contactName}` : ""}</> : null}
      {file.sources.includes("case") ? <> · על התיק עצמו</> : null}
      {file.sources.includes("email") ? (
        <>
          {" · "}
          מייל {file.emailIncoming === false ? "יוצא" : "נכנס"}
          {file.emailSubject ? <span dir="auto">: {file.emailSubject}</span> : null}
        </>
      ) : null}
      {file.caseId ? (
        <>
          {" · "}
          {path ? (
            <Link href={path} className="underline underline-offset-2">
              {caseLabel}
            </Link>
          ) : sfUrl ? (
            <a href={sfUrl} target="_blank" rel="noreferrer" className="underline underline-offset-2">
              {caseLabel}
              <span className="sr-only"> ב-Salesforce</span>
              <NewTabNote />
            </a>
          ) : (
            caseLabel
          )}
        </>
      ) : null}
    </span>
  );
}

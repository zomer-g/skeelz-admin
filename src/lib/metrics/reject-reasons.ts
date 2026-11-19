import { sql, type SQL } from "drizzle-orm";

/**
 * סיבת הדחייה של הגשה: the multi-select picklist `Field21__c` ("חוסר התאמה" in Salesforce) on the
 * application Case. Filled on both "נדחה על ידנו" and "נדחה על ידי מועמד" (about half of each), rarely
 * elsewhere. Salesforce stores each choice's API value, joined by ";"; the screens show the label
 * people pick in Salesforce. Values no longer in the picklist (גיאוגרפי, דתיות) are shown as stored.
 */
export const REJECT_REASON_FIELD = "Field21__c";

/** API value → label, as the Case describe returned them on 19.11.2026. Keys are whitespace-normalised. */
export const REJECT_REASON_LABELS: Readonly<Record<string, string>> = {
  "תנאי סף ניסיון": "ניסיון",
  "תנאי סף הכשרה/השכלה": "הכשרה/השכלה",
  "שכר": "שכר",
  "מוכר.ת במאגר": "מוכר.ת במאגר",
  "גילאי": "גיל",
  "אינו מתאים להשמה": "לא בר/ת השמה",
  "טעות מערכת": "תקלה טכנית",
  "נשלח בטעות עי מועמד": "מועמדות נשלחה בטעות",
  "הבין את המשר וויתר": "הסיר/ה מועמדות לאחר שיחה",
  "לא עבר /ה ראיון שלנו": "לא עבר/ה ראיון שלנו",
  "גיאוגרפי 2": "גיאוגרפי 2",
};

const norm = (v: string) => v.replace(/[ \s]+/g, " ").trim();

/** One reason's label; an unknown value is shown as stored. */
export function rejectReasonLabel(value: string): string {
  const v = norm(value);
  return REJECT_REASON_LABELS[v] ?? v;
}

/** The labels of a stored `Field21__c` value, each once, in the stored order. */
export function rejectReasonLabels(raw: string | null | undefined): string[] {
  if (!raw) return [];
  const labels = raw.split(";").map(norm).filter(Boolean).map(rejectReasonLabel);
  return [...new Set(labels)];
}

/** The stored values that show as `label` (several when an old value shares it), for filtering in SQL. */
export function rejectReasonValues(label: string): string[] {
  const l = norm(label);
  const values = Object.entries(REJECT_REASON_LABELS)
    .filter(([, lab]) => lab === l)
    .map(([v]) => v);
  // A value no longer in the picklist is its own label.
  return [...new Set([...values, l])];
}

/**
 * SQL: the application `alias` has any of the reasons shown as `label` (whitespace-normalised on both
 * sides, as normStatusSql does); "none" = no reason recorded.
 */
export function rejectReasonSql(alias: string, label: string): SQL {
  const field = sql.raw(`${alias}.data->>'${REJECT_REASON_FIELD}'`);
  if (label === "none") return sql`coalesce(${field}, '') = ''`;
  const values = rejectReasonValues(label);
  return sql`EXISTS (
    SELECT 1 FROM unnest(string_to_array(${field}, ';')) AS rr(v)
     WHERE btrim(regexp_replace(replace(rr.v, chr(160), ' '), '[[:space:]]+', ' ', 'g')) IN ${values})`;
}

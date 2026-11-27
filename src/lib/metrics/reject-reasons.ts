import { sql, type SQL } from "drizzle-orm";

/**
 * סיבת הדחייה של הגשה: the multi-select picklist `Field21__c` ("חוסר התאמה" in Salesforce) on the
 * application Case. Filled on both "נדחה על ידנו" and "נדחה על ידי מועמד" (about half of each), rarely
 * elsewhere. Salesforce stores each choice's API value, joined by ";"; the screens show the label
 * people pick in Salesforce, read from the Case describe the sync keeps (`sf_picklist_value`, loaded by
 * `ensureRejectReasonLabels` in ./reject-reasons-load.ts). Values no longer in the picklist (גיאוגרפי,
 * דתיות) are shown as stored. Two reasons are shown as one: the old "גיאוגרפי" and its replacement
 * "גיאוגרפי 2" are both "גיאוגרפי" (REJECT_REASON_MERGE).
 */
export const REJECT_REASON_FIELD = "Field21__c";

/**
 * API value → label, as the Case describe returned them on 27.11.2026: used until the describe has been
 * synced (and for a value the describe no longer lists). Keys are whitespace-normalised.
 */
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
  "לא עבר /ה ראיון שלנו": "לא עבר /ה ראיון שלנו",
  "גיאוגרפי 2": "גיאוגרפי 2",
};

/**
 * Label → the label shown, applied after the describe: reasons counted as one, and a label tidied
 * (Salesforce's has a stray space). Keys and values whitespace-normalised.
 */
export const REJECT_REASON_MERGE: Readonly<Record<string, string>> = {
  "גיאוגרפי 2": "גיאוגרפי",
  "לא עבר /ה ראיון שלנו": "לא עבר/ה ראיון שלנו",
};

/** Shown when an application in a rejection status has no reason recorded. */
export const NO_REASON_LABEL = "לא צוינה סיבה";

const norm = (v: string) => v.replace(/[ \s]+/g, " ").trim();

// The describe's labels once loaded (ensureRejectReasonLabels), over the built-in ones.
let describeLabels: Readonly<Record<string, string>> = {};

/** Sets the labels the Case describe holds for `Field21__c` (value → label); keys are normalised here. */
export function setRejectReasonDescribe(labels: Readonly<Record<string, string>>): void {
  describeLabels = Object.fromEntries(Object.entries(labels).map(([v, l]) => [norm(v), norm(l) || norm(v)]));
}

/** Every known value → its label before merging: the describe's over the built-in ones. */
function knownLabels(): Record<string, string> {
  return { ...REJECT_REASON_LABELS, ...describeLabels };
}

/** One reason's label; an unknown value is shown as stored. */
export function rejectReasonLabel(value: string): string {
  const v = norm(value);
  const label = describeLabels[v] ?? REJECT_REASON_LABELS[v] ?? v;
  return REJECT_REASON_MERGE[label] ?? label;
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
  const values = Object.keys(knownLabels()).filter((v) => rejectReasonLabel(v) === l);
  // A value no longer in the picklist is its own label (גיאוגרפי, under the merged "גיאוגרפי").
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

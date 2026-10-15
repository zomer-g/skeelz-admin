import { sql } from "drizzle-orm";

/**
 * The site's skill list. Jobs (`PSkills_cambium__c`) and candidates (`skills_cambium__c`) hold
 * it as comma-separated Mongo ids; candidates also have one checkbox per skill on the Contact.
 * The ids were matched to the checkboxes on 1,331 candidates who have both: every checkbox is
 * set only when its id is listed, so each id has exactly one name.
 */
export interface Skill {
  id: string;
  label: string;
  /** The Contact checkbox for the same skill. */
  field: string;
}

export const SKILLS: readonly Skill[] = [
  { id: "677e68ea063529e50d3e9824", label: "עבודה בצוות", field: "Team_work__c" },
  { id: "677e68ea063529e50d3e981e", label: "שירותיות", field: "Service__c" },
  { id: "677e68ea063529e50d3e9828", label: "חשיבה יצירתית", field: "Creative_thinking__c" },
  { id: "677e68ea063529e50d3e981a", label: "לימוד עצמי ומהיר", field: "Self_study_and_fast__c" },
  { id: "677e68ea063529e50d3e9826", label: "התבטאות בכתב ובעל פה", field: "expression__c" },
  { id: "677e68ea063529e50d3e9822", label: "אדמיניסטרציה", field: "administration__c" },
  { id: "677e68ea063529e50d3e9827", label: "מולטיטסקינג", field: "Multitasking__c" },
  { id: "677e68ea063529e50d3e981d", label: "מיומנויות דיגיטליות", field: "Digital_skills__c" },
  { id: "677e68ea063529e50d3e981f", label: "הדרכה והוראה", field: "Training_and_teaching__c" },
  { id: "677e68ea063529e50d3e9821", label: "טיפול ואמפתיה", field: "Care_and_empathy__c" },
  { id: "677e68ea063529e50d3e9819", label: "ניתוח והצגת נתונים", field: "Analysis_and_presentation__c" },
  { id: "677e68ea063529e50d3e9825", label: "יזמות", field: "Entrepreneurship__c" },
  { id: "67e3d09b217be927119cb96b", label: "ידע טכנולוגי", field: "skill_tech__c" },
  { id: "677e68ea063529e50d3e981c", label: "ידע פיננסי", field: "Financial_knowledge__c" },
  { id: "677e68ea063529e50d3e9823", label: "ניהול זמן עצמאי", field: "time_management__c" },
  { id: "677e68ea063529e50d3e981b", label: "ניהול אנשים", field: "people_management__c" },
  { id: "677e68ea063529e50d3e9820", label: "שיווק ומכירות", field: "marketing_and_sales__c" },
];

/** Skill checkboxes on the Contact, with their labels. */
export const SKILL_FIELDS: [field: string, label: string][] = SKILLS.map((s) => [s.field, s.label]);

const BY_ID = new Map(SKILLS.map((s) => [s.id, s]));
const MONGO_ID = /^[0-9a-f]{24}$/;

export const isSkillId = (v: string) => BY_ID.has(v);

/**
 * Skill names from a comma-separated list (ids or, on some older candidates, names) plus any
 * checked boxes, in the site's order, each once. An id that is not on the list is kept as it is,
 * so a skill the site adds later still shows until it is named here.
 */
export function skillNames(list: string | null | undefined, data?: Record<string, unknown>): string[] {
  const names = new Set<string>();
  for (const raw of (list ?? "").split(",")) {
    const v = raw.trim();
    if (!v) continue;
    names.add(BY_ID.get(v)?.label ?? v);
  }
  if (data) for (const s of SKILLS) if (data[s.field] === true || data[s.field] === "true") names.add(s.label);
  const order = new Map(SKILLS.map((s, i) => [s.label, i]));
  return [...names].sort((a, b) => (order.get(a) ?? 99) - (order.get(b) ?? 99) || (MONGO_ID.test(a) ? 1 : 0) - (MONGO_ID.test(b) ? 1 : 0));
}

/** The skill list as an SQL relation `sk(id, label)`. */
export const SKILLS_SQL = sql`(VALUES ${sql.join(
  SKILLS.map((s) => sql`(${s.id}::text, ${s.label}::text)`),
  sql`, `,
)}) AS sk(id, label)`;

/**
 * SQL rows `(owner, skill)` for every skill named on a record: `list` is the comma-separated
 * column, `owner` the record id, `checkboxes` the record's jsonb when it has the Contact
 * checkboxes. Expressions are written in code, never user input.
 */
export function skillRowsSql(owner: string, list: string, checkboxes?: string) {
  const fromList = sql`
    SELECT ${sql.raw(owner)} AS owner, coalesce(sk.label, btrim(s)) AS skill
      FROM unnest(string_to_array(${sql.raw(list)}, ',')) s
      LEFT JOIN ${SKILLS_SQL} ON sk.id = btrim(s)
     WHERE btrim(s) <> ''`;
  if (!checkboxes) return fromList;
  return sql`${fromList}
    UNION
    SELECT ${sql.raw(owner)}, flag FROM unnest(array_remove(ARRAY[${sql.join(
      SKILLS.map((s) => sql`CASE WHEN ${sql.raw(checkboxes)}->>${s.field} = 'true' THEN ${s.label}::text END`),
      sql`, `,
    )}], NULL)) flag`;
}

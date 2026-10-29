"use client";

import { useMemo, useState } from "react";
import { StackedAreaChart, type AreaLayer } from "@/components/dashboard/StackedAreaChart";

export interface TrendPerson {
  id: string;
  name: string;
  emails: number[];
  calls: number[];
  casesByType: Record<string, number[]>;
}

/**
 * Written out in full so Tailwind keeps every one of these theme variables (it only emits the
 * names it finds in the source). Fixed order, never cycled: a ninth person has no hue of their own.
 */
const PERSON_COLORS = [
  "var(--color-series-1)",
  "var(--color-series-2)",
  "var(--color-series-3)",
  "var(--color-series-4)",
  "var(--color-series-5)",
  "var(--color-series-6)",
  "var(--color-series-7)",
  "var(--color-series-8)",
];
const OTHERS_COLOR = "#98a2b3";
const CALLS_OPACITY = 0.45;

const sum = (a: number[]) => a.reduce((t, v) => t + v, 0);
const add = (a: number[], b: number[]) => a.map((v, i) => v + (b[i] ?? 0));

function Chip({ on, onClick, color, children, disabled }: { on: boolean; onClick: () => void; color?: string; children: React.ReactNode; disabled?: boolean }) {
  return (
    <button
      type="button"
      aria-pressed={on}
      disabled={disabled}
      onClick={onClick}
      className={`inline-flex items-center gap-2 rounded-full px-3 py-1 text-sm font-medium ring-1 transition-colors disabled:opacity-50 ${
        on ? "bg-white text-ink ring-ink" : "bg-panel text-muted ring-transparent hover:bg-accent/10"
      }`}
    >
      {color ? <span className="inline-block size-3 rounded-[3px]" style={{ background: on ? color : "transparent", outline: `2px solid ${color}`, outlineOffset: -2 }} aria-hidden /> : null}
      {children}
    </button>
  );
}

/**
 * The 12-month trends, filtered in the browser: which employees (by default those with any
 * activity in the range; the rest are off) and which case types (all, by default), several at
 * once. Each employee keeps one colour, given by the order of the employees with activity; past
 * eight, the rest share a grey "אחרים" layer.
 */
export function StaffTrends({ months, people, caseTypes }: { months: string[]; people: TrendPerson[]; caseTypes: string[] }) {
  const zeros = months.map(() => 0);
  const totals = useMemo(
    () =>
      new Map(
        people.map((p) => [p.id, sum(p.emails) + sum(p.calls) + sum(Object.values(p.casesByType).reduce(add, zeros))]),
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [people],
  );
  const active = people.filter((p) => (totals.get(p.id) ?? 0) > 0);
  const colorOf = new Map(active.map((p, i) => [p.id, PERSON_COLORS[i] ?? OTHERS_COLOR]));
  const ordered = [...active, ...people.filter((p) => !colorOf.has(p.id))];

  const [shownPeople, setShownPeople] = useState<Set<string>>(() => new Set(active.map((p) => p.id)));
  const [shownTypes, setShownTypes] = useState<Set<string>>(() => new Set(caseTypes));
  const toggle = <T,>(set: Set<T>, v: T) => {
    const next = new Set(set);
    if (next.has(v)) next.delete(v);
    else next.add(v);
    return next;
  };

  const picked = ordered.filter((p) => shownPeople.has(p.id));
  // Everyone without a hue of their own (past eight, or no activity) is one grey layer.
  const coloured = picked.filter((p) => (colorOf.get(p.id) ?? OTHERS_COLOR) !== OTHERS_COLOR);
  const grey = picked.filter((p) => !coloured.includes(p));
  const layersFor = (values: (p: TrendPerson) => number[]) => [
    ...coloured.map((p) => ({ label: p.name, color: colorOf.get(p.id)!, values: values(p) })),
    ...(grey.length ? [{ label: grey.length === 1 ? grey[0]!.name : `אחרים (${grey.length})`, color: OTHERS_COLOR, values: grey.map(values).reduce(add, zeros) }] : []),
  ];

  const casesOf = (p: TrendPerson) => [...shownTypes].map((t) => p.casesByType[t] ?? zeros).reduce(add, zeros);
  const caseLayers: AreaLayer[] = layersFor(casesOf);
  const emailLayers = layersFor((p) => p.emails);
  const callLayers = layersFor((p) => p.calls);
  const actionLayers: AreaLayer[] = emailLayers.flatMap((e, i) => [
    { ...e, label: `${e.label} · מיילים` },
    { ...callLayers[i]!, label: `${callLayers[i]!.label} · שיחות`, opacity: CALLS_OPACITY },
  ]);
  const personLegend = emailLayers.map((l) => ({ label: l.label, color: l.color }));

  const allTypes = shownTypes.size === caseTypes.length;
  const typesLabel = allTypes ? "" : shownTypes.size === 1 ? ` · ${[...shownTypes][0]}` : ` · ${shownTypes.size} סוגים`;

  return (
    <div className="flex flex-col gap-8">
      <fieldset>
        <legend className="mb-2 text-sm font-medium text-muted">עובדים (אפשר לבחור כמה)</legend>
        <div className="flex flex-wrap gap-2">
          {ordered.map((p) => (
            <Chip key={p.id} on={shownPeople.has(p.id)} color={colorOf.get(p.id) ?? OTHERS_COLOR} onClick={() => setShownPeople((s) => toggle(s, p.id))}>
              {p.name}
              {(totals.get(p.id) ?? 0) === 0 ? <span className="text-xs font-normal text-muted">(בלי פעילות)</span> : null}
            </Chip>
          ))}
          <button type="button" onClick={() => setShownPeople(new Set(active.map((p) => p.id)))} className="px-2 text-sm text-accent-dark underline underline-offset-4">
            רק מי שפעיל
          </button>
        </div>
      </fieldset>

      <section aria-labelledby="cases-trend-h">
        <h3 id="cases-trend-h" className="mb-1 font-medium">
          מקרים שנפתחו לפי חודש{typesLabel}
        </h3>
        <p className="mb-3 text-sm text-muted">שכבה לכל עובד: המקרים שנפתחו באותו חודש והוא הבעלים שלהם היום. הקצה העליון הוא הסה״כ.</p>
        {caseTypes.length > 1 ? (
          <fieldset className="mb-4">
            <legend className="mb-2 text-sm font-medium text-muted">סוגי מקרים (אפשר לבחור כמה)</legend>
            <div className="flex flex-wrap gap-2">
              {caseTypes.map((t) => (
                <Chip key={t} on={shownTypes.has(t)} onClick={() => setShownTypes((s) => toggle(s, t))}>
                  {t}
                </Chip>
              ))}
              <button
                type="button"
                onClick={() => setShownTypes(allTypes ? new Set() : new Set(caseTypes))}
                className="px-2 text-sm text-accent-dark underline underline-offset-4"
              >
                {allTypes ? "נקה הכול" : "כל הסוגים"}
              </button>
            </div>
          </fieldset>
        ) : null}
        <StackedAreaChart columns={months} layers={caseLayers} unit="מקרים" />
      </section>

      <section aria-labelledby="actions-trend-h">
        <h3 id="actions-trend-h" className="mb-1 font-medium">
          מיילים ושיחות לפי חודש
        </h3>
        <p className="mb-3 text-sm text-muted">לכל עובד צבע משלו: הגוון הכהה הוא המיילים שנשלחו מ-Salesforce, והבהיר הוא השיחות שתועדו.</p>
        <StackedAreaChart
          columns={months}
          layers={actionLayers}
          unit="מיילים ושיחות"
          legend={[
            ...personLegend,
            { label: "כהה: מיילים", color: "var(--color-ink)" },
            { label: "בהיר: שיחות", color: "var(--color-ink)", opacity: CALLS_OPACITY },
          ]}
        />
      </section>
    </div>
  );
}

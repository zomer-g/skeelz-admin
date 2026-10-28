const hours = new Intl.NumberFormat("he-IL", { maximumFractionDigits: 2 });

/** "1.5 ש׳", or "—" for none. */
export const fmtHours = (n: number | null) => (n == null ? "—" : `${hours.format(n)} ש׳`);

const MONTHS = ["ינואר", "פברואר", "מרץ", "אפריל", "מאי", "יוני", "יולי", "אוגוסט", "ספטמבר", "אוקטובר", "נובמבר", "דצמבר"];

/** "אוקטובר 2026" from "2026-10". */
export const monthLabel = (month: string) => `${MONTHS[Number(month.slice(5, 7)) - 1] ?? month} ${month.slice(0, 4)}`;

/** "25.10.2026" from "2026-10-25". */
export const dayLabel = (day: string | null) => (day ? `${Number(day.slice(8, 10))}.${Number(day.slice(5, 7))}.${day.slice(0, 4)}` : "—");

const counts = new Intl.NumberFormat("he-IL");

/** A count, in Hebrew digits grouping. */
export const fmtCount = (n: number) => counts.format(n);

const intFormat = new Intl.NumberFormat("he-IL");
const oneDecimal = new Intl.NumberFormat("he-IL", { maximumFractionDigits: 1 });

export const fmtInt = (n: number) => intFormat.format(n);

export const fmtDecimal = (n: number | null | undefined) => (n == null ? "—" : oneDecimal.format(n));

export function fmtPercent(part: number, whole: number): string {
  if (!whole) return "—";
  return `${Math.round((part / whole) * 100)}%`;
}

export function fmtRelative(date: Date | null, now = new Date()): string {
  if (!date) return "—";
  const minutes = Math.round((now.getTime() - date.getTime()) / 60_000);
  if (minutes < 1) return "עכשיו";
  if (minutes < 60) return `לפני ${minutes} דק׳`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `לפני ${hours} שע׳`;
  return `לפני ${Math.round(hours / 24)} ימים`;
}

export function fmtDate(date: Date | null): string {
  if (!date) return "—";
  return new Intl.DateTimeFormat("he-IL", { dateStyle: "short", timeZone: "Asia/Jerusalem" }).format(date);
}

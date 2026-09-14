import type { ReactNode } from "react";

type ButtonVariant = "primary" | "secondary" | "quiet" | "danger";

const BUTTON: Record<ButtonVariant, string> = {
  primary: "bg-brand text-white hover:bg-brand-hover",
  secondary: "border border-brand bg-white text-brand hover:bg-brand/5",
  quiet: "bg-transparent text-accent-dark hover:bg-accent/10",
  danger: "border border-danger bg-white text-danger hover:bg-danger/5",
};

/** Pill buttons, as on the public site. `size="sm"` for table rows. */
export function buttonClass(variant: ButtonVariant = "primary", size: "md" | "sm" = "md"): string {
  const sizing = size === "md" ? "h-12 px-6 text-base" : "h-9 px-4 text-sm";
  return `inline-flex items-center justify-center gap-2 rounded-full font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${sizing} ${BUTTON[variant]}`;
}

export const fieldClass =
  "h-12 rounded-full border border-field bg-white px-5 text-base text-ink shadow-field placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-accent";

export const smallFieldClass =
  "h-9 rounded-full border border-field bg-white px-3 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-accent";

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: string; actions?: ReactNode }) {
  return (
    <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 className="text-3xl font-bold text-ink">{title}</h1>
        {subtitle ? <p className="mt-1 text-muted">{subtitle}</p> : null}
      </div>
      {actions}
    </div>
  );
}

/** A two-tone card: a teal title band over a light grey body. */
export function Card({
  title,
  tone = "accent",
  children,
  className = "",
}: {
  title?: ReactNode;
  tone?: "accent" | "accent-light";
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`overflow-hidden rounded-card border-2 border-line bg-surface ${className}`}>
      {title ? (
        <header className={`${tone === "accent" ? "bg-accent" : "bg-accent-light"} px-6 py-3 text-lg font-medium text-white`}>
          {title}
        </header>
      ) : null}
      <div className="p-6">{children}</div>
    </section>
  );
}

export function StatCard({ label, value, hint }: { label: string; value: ReactNode; hint?: string }) {
  return (
    <div className="flex overflow-hidden rounded-card border-2 border-line bg-surface">
      <div className="flex w-2 shrink-0 bg-accent" aria-hidden />
      <div className="flex flex-1 flex-col gap-1 px-5 py-4">
        <span className="text-sm font-medium text-muted">{label}</span>
        <span className="text-3xl font-bold text-ink">{value}</span>
        {hint ? <span className="text-xs text-muted">{hint}</span> : null}
      </div>
    </div>
  );
}

type BadgeTone = "success" | "neutral" | "brand" | "accent" | "warning";

const BADGE: Record<BadgeTone, string> = {
  success: "bg-success-soft text-success",
  neutral: "bg-panel text-muted",
  brand: "bg-brand/10 text-brand",
  accent: "bg-accent/10 text-accent-dark",
  warning: "bg-hot/30 text-[#93370d]",
};

export function Badge({ tone = "neutral", children }: { tone?: BadgeTone; children: ReactNode }) {
  return <span className={`inline-flex items-center rounded-full px-3 py-0.5 text-xs font-medium ${BADGE[tone]}`}>{children}</span>;
}

/** Tables scroll inside their own box so the page never scrolls sideways. */
export function Table({ head, children, empty }: { head: string[]; children: ReactNode; empty?: string }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[40rem] border-collapse text-start text-sm">
        <thead>
          <tr className="border-b-2 border-line text-muted">
            {head.map((h) => (
              <th key={h} className="px-3 py-2 text-start font-medium">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-line">{children}</tbody>
      </table>
      {empty ? <p className="px-3 py-6 text-center text-muted">{empty}</p> : null}
    </div>
  );
}

export function formatDateTime(value: Date | null | undefined): string {
  if (!value) return "—";
  return new Intl.DateTimeFormat("he-IL", {
    dateStyle: "short",
    timeStyle: "short",
    timeZone: "Asia/Jerusalem",
  }).format(value);
}

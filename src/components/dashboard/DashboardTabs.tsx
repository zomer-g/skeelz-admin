const TABS = [
  { key: "candidates", label: "מועמדים" },
  { key: "employers", label: "מעסיקים", soon: true },
  { key: "marketing", label: "שיווק", soon: true },
];

export function DashboardTabs({ active }: { active: string }) {
  return (
    <div className="mb-6 flex flex-wrap gap-1 border-b-2 border-black" role="tablist" aria-label="לשוניות הדשבורד">
      {TABS.map((t) => {
        const isActive = t.key === active;
        return (
          <span
            key={t.key}
            role="tab"
            aria-selected={isActive}
            aria-disabled={t.soon || undefined}
            title={t.soon ? "בקרוב" : undefined}
            className={`-mb-[2px] rounded-t-card px-6 py-3 text-lg font-medium ${
              isActive ? "bg-accent text-white" : t.soon ? "cursor-default text-muted/60" : "text-ink"
            }`}
          >
            {t.label}
            {t.soon ? <span className="ms-2 text-xs">בקרוב</span> : null}
          </span>
        );
      })}
    </div>
  );
}

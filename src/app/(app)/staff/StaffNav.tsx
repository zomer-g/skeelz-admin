import { SubNav } from "@/components/SubNav";

const TABS = [
  { key: "month", label: "לפי חודש", href: "/staff" },
  { key: "windows", label: "פעולות ביחידת זמן", href: "/staff/windows" },
] as const;

/** The staff screens' sub-navigation (staff managers only, like every page under /staff). */
export function StaffNav({ active }: { active: (typeof TABS)[number]["key"] }) {
  return <SubNav section="עובדים" ariaLabel="מסכי העובדים" tabs={TABS} active={active} />;
}

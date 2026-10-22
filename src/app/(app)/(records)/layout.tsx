import type { ReactNode } from "react";
import { RecordsTabs } from "./RecordsTabs";

/**
 * The records section (הגשות, מעסיקים, משרות, מועמדים, כתובות דוא״ל, קורות חיים, פעילות יזומה, לידי מעסיקים, מעקב תשלומים).
 * The layout holds navigation only: every page still checks access itself.
 */
export default function RecordsLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <RecordsTabs />
      {children}
    </>
  );
}

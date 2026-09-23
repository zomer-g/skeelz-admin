import type { ReactNode } from "react";
import { RecordsTabs } from "./RecordsTabs";

/**
 * The records section (הגשות, מעסיקים, מועמדים, כתובות דוא״ל, and the job card under employers).
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

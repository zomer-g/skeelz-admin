"use client";

import { useRef, useState } from "react";
import { logExport } from "@/app/(app)/export-actions";
import { svgToPng, type LegendItem } from "@/lib/export/chart-image";
import { cellFromText, encode, fileName, MIME, type Cell, type ExportFormat } from "@/lib/export/tabular";

/**
 * The download buttons of a table or chart that carries no personal data (only those offer one).
 * - `list`: the whole list behind the page's filter, built and logged on the server
 *   (/api/lists/[list]/export) — not just the rows on screen;
 * - otherwise the table next to the buttons, read from the page as shown;
 * - `image`: the chart's SVG as a PNG.
 * Every download is logged (report.exported).
 */
export function Download({
  name,
  list,
  query = "",
  image,
}: {
  /** What it is, for the file name and the log: "משרות", "הגשות לפי יום". */
  name: string;
  list?: string;
  /** The page's filters and sort, for `list`. */
  query?: string;
  image?: { legend?: LegendItem[] };
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState("");
  const stamp = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jerusalem" }).format(new Date());
  const screen = () => `${location.pathname}${location.search}`;

  const save = (blob: Blob, file: string) => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = file;
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  };

  const fromScreen = async (format: ExportFormat) => {
    const table = ref.current?.closest("[data-export]")?.querySelector("table");
    if (!table) return setStatus("לא נמצאה טבלה להורדה");
    const t = readTable(table, name);
    save(new Blob([encode(t, format) as BlobPart], { type: MIME[format] }), fileName(`${name}_${stamp()}`, format));
    setStatus(`הקובץ ירד: ${t.rows.length.toLocaleString("he-IL")} שורות`);
    await logExport({ screen: screen(), name, format, rows: t.rows.length }).catch(() => undefined);
  };

  const fromServer = async (format: ExportFormat) => {
    setStatus("מכין את כל הרשימה לפי הסינון…");
    try {
      const res = await fetch(href(format), { cache: "no-store" });
      if (!res.ok) return setStatus((await res.text()).slice(0, 300) || "ההורדה נכשלה");
      const disposition = res.headers.get("Content-Disposition") ?? "";
      const named = /filename\*=UTF-8''([^;]+)/.exec(disposition)?.[1];
      save(await res.blob(), named ? decodeURIComponent(named) : fileName(`${name}_${stamp()}`, format));
      setStatus("הקובץ ירד");
    } catch {
      setStatus("ההורדה נכשלה");
    }
  };

  const asImage = async () => {
    const svg = ref.current?.closest("[data-export]")?.querySelector<SVGSVGElement>("svg[role=img]");
    if (!svg) return setStatus("לא נמצא גרף להורדה");
    try {
      setStatus("מכין תמונה…");
      save(await svgToPng(svg, { title: name, legend: image?.legend }), fileName(`${name}_${stamp()}`, "png"));
      setStatus("התמונה ירדה");
      await logExport({ screen: screen(), name, format: "png", rows: 0 }).catch(() => undefined);
    } catch {
      setStatus("לא ניתן היה ליצור תמונה בדפדפן הזה");
    }
  };

  const button = "rounded-full bg-white px-3 py-1 text-xs font-medium text-ink ring-1 ring-field hover:bg-surface";
  const context = <span className="sr-only"> · {name}</span>;
  const href = (format: ExportFormat) => `/api/lists/${list}/export?${new URLSearchParams([...new URLSearchParams(query), ["format", format]])}`;

  return (
    <div ref={ref} className="flex flex-wrap items-center gap-2 text-xs text-muted">
      <span aria-hidden>הורדה:</span>
      {list ? (
        <>
          <button type="button" className={button} onClick={() => void fromServer("xlsx")}>
            Excel{context} (כל הרשימה)
          </button>
          <button type="button" className={button} onClick={() => void fromServer("csv")}>
            CSV{context} (כל הרשימה)
          </button>
        </>
      ) : (
        <>
          <button type="button" className={button} onClick={() => void fromScreen("xlsx")}>
            Excel{context}
          </button>
          <button type="button" className={button} onClick={() => void fromScreen("csv")}>
            CSV{context}
          </button>
        </>
      )}
      {image ? (
        <button type="button" className={button} onClick={() => void asImage()}>
          תמונה{context}
        </button>
      ) : null}
      <span role="status" className="text-muted">
        {status}
      </span>
    </div>
  );
}

/** The table as shown: visually-hidden helper text and decorative marks left out, the actions column dropped. */
function readTable(table: HTMLTableElement, name: string): { name: string; headers: string[]; rows: Cell[][] } {
  const text = (el: Element) => {
    const copy = el.cloneNode(true) as Element;
    copy.querySelectorAll(".sr-only, [aria-hidden='true']").forEach((n) => n.remove());
    return (copy.textContent ?? "").replace(/\s+/g, " ").trim();
  };
  const headRow = table.tHead?.rows[table.tHead.rows.length - 1];
  const headers = headRow ? Array.from(headRow.cells).map(text) : [];
  const keep = headers.map((h, i) => (h ? i : -1)).filter((i) => i >= 0);
  const rows = Array.from(table.tBodies).flatMap((b) =>
    Array.from(b.rows).map((r) => {
      const cells = Array.from(r.cells);
      return keep.map((i) => (cells[i] ? cellFromText(text(cells[i]!)) : null));
    }),
  );
  return { name, headers: keep.map((i) => headers[i]!), rows };
}

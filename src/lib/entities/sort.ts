import { sql, type SQL } from "drizzle-orm";
import type { TableSort } from "@/components/ui";
import { param, type SearchParams } from "./search";

/**
 * Column sorting for the record lists. Each list declares its sortable columns
 * once; the URL carries `?sort=<key>&dir=asc|desc`, the heading links flip it,
 * and the direction a column starts in follows its kind — text reads א–ת,
 * dates and numbers start with the newest and the largest, which is what a
 * list of records is usually asked for first.
 */

export type SortDir = "asc" | "desc";
export type SortKind = "text" | "date" | "number";

export interface SortColumn {
  /** The value in `?sort=`, and the key a column heading passes to `Table`. */
  key: string;
  kind: SortKind;
  /** The ordering itself, without a direction: `dir` and NULLS are added here. */
  by: SQL;
}

export interface Sort {
  key: string;
  dir: SortDir;
}

/** Which way a column starts when it is first picked. */
export const startDir = (kind: SortKind): SortDir => (kind === "text" ? "asc" : "desc");

const DIR_WORDS: Record<SortKind, Record<SortDir, string>> = {
  text: { asc: "מא׳ עד ת׳", desc: "מת׳ עד א׳" },
  date: { asc: "מהישן לחדש", desc: "מהחדש לישן" },
  number: { asc: "מהנמוך לגבוה", desc: "מהגבוה לנמוך" },
};

/** `?sort=`/`?dir=` if they name a real column, otherwise the list's own default. */
export function sortParam(search: SearchParams, columns: readonly SortColumn[], fallback: string): Sort {
  const asked = param(search, "sort", 40);
  const column = columns.find((c) => c.key === asked) ?? columns.find((c) => c.key === fallback) ?? columns[0]!;
  const dir = param(search, "dir", 4);
  return { key: column.key, dir: dir === "asc" || dir === "desc" ? dir : startDir(column.kind) };
}

/**
 * ORDER BY for the chosen column. Empty values always sink to the bottom, and
 * `tiebreak` keeps paging stable when a column holds the same value many times.
 */
export function orderBy(columns: readonly SortColumn[], sort: Sort, tiebreak: SQL): SQL {
  const column = columns.find((c) => c.key === sort.key) ?? columns[0]!;
  const direction = sort.dir === "asc" ? sql`ASC NULLS LAST` : sql`DESC NULLS LAST`;
  return sql`${column.by} ${direction}, ${tiebreak}`;
}

/**
 * What `Table` needs to draw the headings: where each column's link goes (the
 * same search, re-sorted — picking the current column flips it, and a new one
 * starts in its own direction) and how each direction is said in words.
 */
export function tableSort(columns: readonly SortColumn[], sort: Sort, action: string, values: Record<string, string>): TableSort {
  return {
    key: sort.key,
    dir: sort.dir,
    href: (key) => {
      const column = columns.find((c) => c.key === key)!;
      const dir = key === sort.key ? (sort.dir === "asc" ? "desc" : "asc") : startDir(column.kind);
      const params = new URLSearchParams();
      for (const [name, value] of Object.entries(values)) if (value) params.set(name, value);
      params.set("sort", key);
      params.set("dir", dir);
      // A new order starts from the first page.
      params.delete("page");
      return `${action}?${params.toString()}`;
    },
    dirLabel: (key, dir) => DIR_WORDS[columns.find((c) => c.key === key)?.kind ?? "text"][dir],
  };
}

/**
 * The same ordering for a list already held in memory (the payments list, which
 * has no paging). Empty values sink to the bottom, text compares in Hebrew.
 */
export interface SortField<T> {
  key: string;
  kind: SortKind;
  value: (row: T) => string | number | boolean | Date | null | undefined;
}

export function sortRows<T>(rows: readonly T[], fields: readonly SortField<T>[], sort: Sort): T[] {
  const field = fields.find((f) => f.key === sort.key) ?? fields[0]!;
  const sign = sort.dir === "asc" ? 1 : -1;
  const collator = new Intl.Collator("he");
  return [...rows].sort((a, b) => {
    const x = field.value(a);
    const y = field.value(b);
    const emptyX = x == null || x === "";
    const emptyY = y == null || y === "";
    if (emptyX || emptyY) return emptyX && emptyY ? 0 : emptyX ? 1 : -1;
    if (field.kind === "text") return sign * collator.compare(String(x), String(y));
    const nx = x instanceof Date ? x.getTime() : typeof x === "boolean" ? Number(x) : Number(x);
    const ny = y instanceof Date ? y.getTime() : typeof y === "boolean" ? Number(y) : Number(y);
    return sign * (nx - ny);
  });
}

/** Sortable column keys for a list that has no SQL ordering of its own. */
export const fieldSorts = <T>(fields: readonly SortField<T>[]): SortColumn[] =>
  fields.map((f) => ({ key: f.key, kind: f.kind, by: sql`true` }));

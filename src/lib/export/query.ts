/** A list page's filters and sort as the query string its download route reads (empty values left out). */
export const listQuery = (values: Record<string, string | undefined>) =>
  new URLSearchParams(Object.entries(values).filter((e): e is [string, string] => Boolean(e[1]))).toString();

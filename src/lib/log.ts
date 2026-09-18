/**
 * Error logging without personal data. A drizzle/pg error's message holds the SQL and its
 * parameter values ("Key (email)=(x) already exists"), so it is never logged or stored:
 * only where it happened and a code — the pg SQLSTATE, our own typed error's code, or the
 * error's class name.
 */

type Coded = { code?: unknown; severity?: unknown; cause?: unknown; name?: unknown; message?: unknown };

const asCoded = (v: unknown): Coded | null => (v && typeof v === "object" ? (v as Coded) : null);

/** A pg error (or one wrapping it): it carries a five-character SQLSTATE. */
function sqlState(err: unknown): string | null {
  for (let e = asCoded(err), depth = 0; e && depth < 4; e = asCoded(e.cause), depth++) {
    if (typeof e.code === "string" && /^[0-9A-Z]{5}$/.test(e.code) && ("severity" in e || depth > 0)) return e.code;
  }
  return null;
}

const isDbError = (err: unknown): boolean => {
  if (sqlState(err)) return true;
  const e = asCoded(err);
  return typeof e?.message === "string" && e.message.startsWith("Failed query:");
};

/** What may be logged about an error: the SQLSTATE, a typed error's code, else its class name. */
export function errorCode(err: unknown): string {
  const state = sqlState(err);
  if (state) return `sqlstate ${state}`;
  const e = asCoded(err);
  if (typeof e?.code === "string" && /^[a-z_]+$/i.test(e.code)) return e.code;
  return typeof e?.name === "string" ? e.name : typeof err;
}

export function logError(where: string, err: unknown): void {
  console.error(`[${where}] failed: ${errorCode(err)}`);
}

/** A message safe to store or show to staff: a database error becomes its code, anything else keeps its message. */
export function safeErrorMessage(err: unknown): string {
  if (isDbError(err)) return `database error (${errorCode(err)})`;
  return err instanceof Error ? err.message : String(err);
}

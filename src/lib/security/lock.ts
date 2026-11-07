import { connectDirect } from "@/lib/db/client";
import { logError } from "@/lib/log";

/**
 * One hand-over of personal data at a time per person. The daily limits (files, exported people)
 * are counted from the audit log, so "check the count, do the work, write the entry" must not
 * interleave: two parallel requests would both see the same allowance. A Postgres advisory lock,
 * keyed by the budget and the person, serialises them across processes.
 *
 * The lock lives on its own direct connection, not on the pool: a request waiting for the lock
 * then holds no pool connection, so the holder can always run its queries. A wait is bounded.
 */
export class LockTimeoutError extends Error {
  readonly code = "lock_timeout";
  constructor() {
    super("lock timeout");
    this.name = "LockTimeoutError";
  }
}

export async function withUserLock<T>(budget: "files" | "exports", email: string, fn: () => Promise<T>): Promise<T> {
  const client = await connectDirect();
  try {
    // A transaction-scoped lock: it stays on one server connection even behind a transaction-mode
    // pooler, and COMMIT (or the connection ending) releases it whatever happened.
    try {
      await client.query("BEGIN");
      await client.query("SET LOCAL lock_timeout = '20s'");
      await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [`${budget}:${email.toLowerCase()}`]);
    } catch (err) {
      if ((err as { code?: string }).code === "55P03") throw new LockTimeoutError();
      throw err;
    }
    try {
      return await fn();
    } finally {
      await client.query("COMMIT").catch((err: unknown) => logError("user lock commit", err));
    }
  } finally {
    await client.end().catch((err: unknown) => logError("user lock end", err));
  }
}

/** The answer when a person's previous hand-over is still running for too long. */
export const lockBusy = () =>
  new Response("בקשה קודמת שלך עדיין בטיפול. נסו שוב בעוד רגע.", {
    status: 429,
    headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store", "Retry-After": "10" },
  });

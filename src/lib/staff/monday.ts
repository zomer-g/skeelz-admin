import { eq, isNotNull } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { staffSourceState, staffWorkItems, users } from "@/lib/db/schema";
import { safeErrorMessage } from "@/lib/log";
import { MONDAY_BOARD, parseMondayItem, rowsForLinked, type MondayItem } from "./hours";

/**
 * Staff hours from monday.com (docs/staff.md): the done tasks of the "משימות סיילספורס" board, kept
 * only for employees linked to a monday user. Read-only: queries, never mutations. The token
 * (MONDAY_TOKEN, an xhostd secret) can do everything its owner can in monday, so it stays on the
 * server and is never logged or sent to the browser.
 */

const ENDPOINT = "https://api.monday.com/v2";
/** Pinned: monday retires old versions and routes them to newer ones. */
const API_VERSION = "2026-01";
const PAGE = 500;
export const MONDAY_SOURCE = "monday";

export const mondayConfigured = () => Boolean(process.env.MONDAY_TOKEN);

const QUERY = `
query ($boardId: [ID!], $cursor: String) {
  boards(ids: $boardId) {
    items_page(
      limit: ${PAGE}
      cursor: $cursor
      query_params: { rules: [{ column_id: "${MONDAY_BOARD.status}", compare_value: [${MONDAY_BOARD.doneIndex}], operator: any_of }] }
    ) {
      cursor
      items {
        id name url
        column_values(ids: ["${MONDAY_BOARD.doneOn}", "${MONDAY_BOARD.hours}", "${MONDAY_BOARD.people}", "${MONDAY_BOARD.notes}"]) { id text value }
      }
    }
  }
}`;

async function mondayQuery<T>(query: string, variables: Record<string, unknown> = {}): Promise<T> {
  const res = await fetch(ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: process.env.MONDAY_TOKEN ?? "", "API-Version": API_VERSION },
    body: JSON.stringify({ query, variables }),
    signal: AbortSignal.timeout(30_000),
  });
  // Never the body of a failure in full: it is shown on the staff screen and in the worker log.
  if (!res.ok) throw new Error(`monday.com answered ${res.status}`);
  const json = (await res.json()) as { data?: T; errors?: { message?: string }[] };
  if (json.errors?.length) throw new Error(`monday.com: ${json.errors.map((e) => e.message ?? "error").join("; ").slice(0, 300)}`);
  return json.data as T;
}

/** Every done task on the board, page by page (a cursor lives 60 minutes). */
async function fetchDoneItems(): Promise<MondayItem[]> {
  type Page = { boards: { items_page: { cursor: string | null; items: MondayItem[] } }[] };
  const items: MondayItem[] = [];
  let cursor: string | null = null;
  for (let page = 0; page < 200; page++) {
    const data: Page = await mondayQuery<Page>(QUERY, { boardId: [MONDAY_BOARD.id], cursor });
    const board = data.boards?.[0];
    if (!board) throw new Error("the board is not visible to this token");
    items.push(...board.items_page.items);
    cursor = board.items_page.cursor;
    if (!cursor) break;
  }
  return items;
}

export interface MondayUser {
  id: string;
  name: string;
  email: string | null;
}

/** The account's members (not guests), for linking employees on /admin/staff-links. */
export async function listMondayUsers(): Promise<MondayUser[]> {
  if (!mondayConfigured()) return [];
  const data = await mondayQuery<{ users: { id: string; name: string; email: string | null }[] }>(
    `query { users(kind: non_guests, limit: 500) { id name email } }`,
  );
  return (data.users ?? []).map((u) => ({ id: String(u.id), name: u.name, email: u.email?.toLowerCase() ?? null }));
}

/** The connection test on /admin/integrations: the board is visible, and how big it is. Nothing per person. */
export async function checkMonday(): Promise<{ board: string; items: number }> {
  const data = await mondayQuery<{ boards: { name: string; items_count: number }[] }>(
    `query ($boardId: [ID!]) { boards(ids: $boardId) { name items_count } }`,
    { boardId: [MONDAY_BOARD.id] },
  );
  const board = data.boards?.[0];
  if (!board) throw new Error("the board is not visible to this token");
  return { board: board.name, items: board.items_count };
}

export interface StaffSyncResult {
  rows: number;
  error: string | null;
  skipped?: string;
}

/** Pulls the board and replaces the stored rows of the linked employees in one transaction. */
export async function syncMonday(): Promise<StaffSyncResult> {
  if (!mondayConfigured()) return { rows: 0, error: null, skipped: "MONDAY_TOKEN is not set" };
  const db = getDb();
  const started = new Date();
  await db
    .insert(staffSourceState)
    .values({ source: MONDAY_SOURCE, lastStartedAt: started })
    .onConflictDoUpdate({ target: staffSourceState.source, set: { lastStartedAt: started } });
  try {
    const linked = await db.select({ id: users.id, mondayUserId: users.mondayUserId }).from(users).where(isNotNull(users.mondayUserId));
    const map = new Map(linked.map((u) => [u.mondayUserId!, u.id]));
    // Nobody linked: nothing of anybody's is fetched or kept.
    const rows = map.size ? rowsForLinked((await fetchDoneItems()).map(parseMondayItem), map) : [];
    await db.transaction(async (tx) => {
      await tx.delete(staffWorkItems).where(eq(staffWorkItems.source, MONDAY_SOURCE));
      for (let i = 0; i < rows.length; i += 500) await tx.insert(staffWorkItems).values(rows.slice(i, i + 500));
    });
    await db
      .update(staffSourceState)
      .set({ lastSuccessAt: new Date(), lastError: null, items: rows.length })
      .where(eq(staffSourceState.source, MONDAY_SOURCE));
    return { rows: rows.length, error: null };
  } catch (err) {
    const error = safeErrorMessage(err);
    await db.update(staffSourceState).set({ lastError: error }).where(eq(staffSourceState.source, MONDAY_SOURCE));
    return { rows: 0, error };
  }
}

/** When it last ran, for the worker's schedule and the staff screen. */
export async function staffSourceStatus(source = MONDAY_SOURCE) {
  const [row] = await getDb().select().from(staffSourceState).where(eq(staffSourceState.source, source));
  return row ?? null;
}

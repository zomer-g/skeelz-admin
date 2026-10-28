import { eq, isNotNull } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { staffSourceState, staffWorkItems, users } from "@/lib/db/schema";
import { safeErrorMessage } from "@/lib/log";
import { boardColumns, HOURS_COLUMN, parseMondayItem, rowsForLinked, type MondayBoard, type MondayColumn, type MondayItem, type WorkItem } from "./hours";

/**
 * Staff hours from monday.com (docs/staff.md): the done tasks of every board with an hours column
 * ("שעות (בחירה)", subitems boards included), kept only for employees linked to a monday user. Read-only: queries, never mutations. The token
 * (MONDAY_TOKEN, an xhostd secret) can do everything its owner can in monday, so it stays on the
 * server and is never logged or sent to the browser.
 */

const ENDPOINT = "https://api.monday.com/v2";
/** Pinned: monday retires old versions and routes them to newer ones. */
const API_VERSION = "2026-01";
const PAGE = 500;
export const MONDAY_SOURCE = "monday";

export const mondayConfigured = () => Boolean(process.env.MONDAY_TOKEN);

/** Column ids go into the query text; monday's ids are short words, anything else is refused. */
const COLUMN_ID = /^[A-Za-z0-9_]{1,64}$/;

/** One board's done tasks (its own status column and done indexes), with the columns hours are read from. */
const itemsQuery = (b: MondayBoard) => {
  const cols = [b.status, b.doneOn, b.hours, b.people, b.notes].filter((c): c is string => Boolean(c));
  if (!cols.every((c) => COLUMN_ID.test(c))) throw new Error(`monday board ${b.id}: unexpected column id`);
  return `
query ($boardId: [ID!], $cursor: String) {
  boards(ids: $boardId) {
    items_page(
      limit: ${PAGE}
      cursor: $cursor
      query_params: { rules: [{ column_id: "${b.status}", compare_value: [${b.doneIndices.map(Number).join(", ")}], operator: any_of }] }
    ) {
      cursor
      items {
        id name url
        ${b.subitems ? "parent_item { name }" : ""}
        column_values(ids: [${cols.map((c) => `"${c}"`).join(", ")}]) { id text value }
      }
    }
  }
}`;
};

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

/** Every board the token sees that has an hours column, with its columns resolved by title. */
async function hoursBoards(): Promise<MondayBoard[]> {
  type Page = { boards: { id: string; name: string | null; columns: MondayColumn[] }[] };
  const boards: MondayBoard[] = [];
  for (let page = 1; page <= 50; page++) {
    const data = await mondayQuery<Page>(
      `query ($page: Int) { boards(limit: 100, page: $page, state: active) { id name columns(types: [status, date, people, text]) { id title type settings_str } } }`,
      { page },
    );
    for (const b of data.boards ?? []) {
      const resolved = boardColumns({ id: String(b.id), name: b.name, columns: b.columns ?? [] });
      if (resolved) boards.push(resolved);
    }
    if ((data.boards ?? []).length < 100) break;
  }
  return boards;
}

/** Every done task on one board, page by page (a cursor lives 60 minutes). */
async function fetchDoneItems(board: MondayBoard): Promise<WorkItem[]> {
  type Page = { boards: { items_page: { cursor: string | null; items: MondayItem[] } }[] };
  const query = itemsQuery(board);
  const items: WorkItem[] = [];
  let cursor: string | null = null;
  for (let page = 0; page < 200; page++) {
    const data: Page = await mondayQuery<Page>(query, { boardId: [board.id], cursor });
    const found = data.boards?.[0];
    if (!found) break;
    items.push(...found.items_page.items.map((item) => parseMondayItem(item, board)));
    cursor = found.items_page.cursor;
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

/** The connection test on /admin/integrations: which boards have hours, and how big they are. Nothing per person. */
export async function checkMonday(): Promise<{ boards: { name: string; items: number }[] }> {
  const boards = await hoursBoards();
  if (!boards.length) throw new Error(`no board with a "${HOURS_COLUMN}" column is visible to this token`);
  const data = await mondayQuery<{ boards: { id: string; items_count: number }[] }>(`query ($ids: [ID!]) { boards(ids: $ids) { id items_count } }`, {
    ids: boards.map((b) => b.id),
  });
  const counts = new Map((data.boards ?? []).map((b) => [String(b.id), b.items_count]));
  return { boards: boards.map((b) => ({ name: `${b.name ?? b.id}${b.subitems ? " (תת-משימות)" : ""}`, items: counts.get(b.id) ?? 0 })) };
}

export interface StaffSyncResult {
  rows: number;
  error: string | null;
  skipped?: string;
}

/** Pulls every hours board and replaces the stored rows of the linked employees in one transaction. */
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
    let rows: ReturnType<typeof rowsForLinked> = [];
    if (map.size) {
      const items: WorkItem[] = [];
      for (const board of await hoursBoards()) items.push(...(await fetchDoneItems(board)));
      rows = rowsForLinked(items, map);
    }
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

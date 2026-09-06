/**
 * League activity feed — M4 task L.D4.2, `GET /api/leagues/[id]/activity`
 * (spec §15.3, §13.4; PROGRESS D296/D298).
 *
 * §13.4 wants ONE unified feed — "adds, drops, waivers, trades, draft, and,
 * clearly labeled, commissioner actions, with filters". **This is the M4
 * SLICE of it**, and the slice is exactly what exists to read today:
 *
 *   - `transactions` (§12.9) — every executed move. In M4 the only writer is
 *     113's `roster_add_drop` (`type = 'add_drop'`); M5 adds waivers/trades
 *     and M6 `commissioner_move`, and they land in this feed with no change
 *     here because the read is over the TABLE, not over one writer.
 *   - the league room's SYSTEM chat posts — the D97 in-transaction notices
 *     that 111's `schedule_remix_confirm` / `schedule_edit_matchup` and
 *     112's commissioner lineup edit write. They are the only record of a
 *     commissioner action until `commissioner_actions` exists (D290's
 *     interim posture), so leaving them out would make the feed silent about
 *     the very events §13.4 says to label.
 *
 * **`context = 'league'` is a scoping decision, not an accident.** Every
 * league-room system post carries that literal (`111:749`, `111:1124`,
 * `112:1141`); DRAFT-room posts carry `'draft:<draft_id>'` — and a *mock*
 * draft's posts carry the launcher's league_id with a draft context, so a
 * feed that took "every system post of this league" would publish one
 * member's solo practice to the whole league. The narrow filter is the
 * no-leak choice; the draft room and the recap render their own posts.
 * Non-system chat is never included (chat is its own surface, §16.2).
 *
 * **Membership is asserted FIRST, and a non-member gets the family's no-leak
 * 403 (R807 — F248(d) ruled at PR #261's review).** `transactions` is
 * member-SELECTable (109:259) and `league_chat` is member-SELECTable
 * (095:604), so a non-member's RLS read returns nothing — and this feed
 * first shipped serving that as an EMPTY feed under the D114(5) league-read
 * posture. The in-season family's posture is refuse-by-name (§11.5
 * v2.16.23: "never handed an empty table"; 112/113/117's single 42501;
 * CLAUDE.md's "assert the reason for emptiness rather than inferring it"),
 * so `assertLeagueMember` (`inseason-reads.ts`) now precedes the first
 * `.from(` here exactly as it does in `rosters-service.ts` /
 * `matchups-service.ts`: one 403 for a non-member and a nonexistent league
 * alike, a 404 by name for a member whose league was soft-deleted (R812),
 * and an empty feed only ever means a member's league has no activity yet.
 *
 * **Loud emptiness (tasks-M4 §4 rule 10 / CLAUDE.md).** A PostgREST error is
 * never served as an empty list: both reads propagate as a 500 with the
 * driver's message. And the page size is an EXPLICIT limit that is asserted
 * to sit far below PostgREST's 1000-row cap, with `has_more` derived from an
 * over-fetch — the feed never infers "that was everything" from a result set
 * that happens to be short.
 *
 * The M6 enrichment (rendering a commissioner action with the "✸
 * commissioner" treatment and linking it to its audit entry) needs
 * `commissioner_actions`, which does not exist — the task text says so
 * outright. `kind`/`type`/`context` ride on every item so the UI can label
 * today and link later.
 *
 * **The cursor is COMPOSITE — `(created_at, id)`, never the instant alone
 * (R770).** The feed orders by `(created_at DESC, id DESC)`, so an instant
 * alone does not identify a position in it: a `.lt('created_at', T)` next
 * page drops EVERY item that shares the page-boundary instant T — served on
 * no page, in either direction, silently. No M4 writer produces such a tie
 * (each of 111:749, 111:1124 and 112:1141 writes one post per transaction,
 * and `roster_add_drop` writes one `transactions` row), but the next ones
 * do: §13.2/§14's waiver processor resolves pending claims ATOMICALLY — N
 * `transactions` rows on one `now()` — and M6's `commissioner_move` writes a
 * transactions row and a system post in the same transaction. So the page
 * boundary is `created_at.lt.T OR (created_at.eq.T AND id.lt.ID)`, the exact
 * inverse of the sort, and the feed hands back both halves.
 *
 * No Date/random read anywhere in this file (the `src/lib/leagues/**` ESLint
 * fences): the cursor is the caller's, the ordering is the database's.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { z } from 'zod'

import type { Database, Json } from '@/types/database'

import { assertLeagueMember } from './inseason-reads'
import type { ServiceResult } from './leagues-service'

type Supabase = SupabaseClient<Database>

/** §12.9's `transactions.type` CHECK, verbatim — the filter vocabulary. */
export const TRANSACTION_TYPES = [
  'add',
  'drop',
  'add_drop',
  'waiver_claim',
  'trade',
  'commissioner_move',
] as const

/** The literal every league-room system post is stamped with (§12.13's
 *  context grammar; the draft room's is `draft:<draft_id>`). */
export const LEAGUE_CHAT_CONTEXT = 'league'

/** Page size ceiling. PostgREST's default row cap on this stack is 1000
 *  (the CLAUDE.md "exactly 1000 rows looked like the whole table" rule): a
 *  100-row ceiling means the over-fetch of `limit + 1` per source can never
 *  reach it, so a short result is always genuinely short. */
export const ACTIVITY_MAX_LIMIT = 100
export const ACTIVITY_DEFAULT_LIMIT = 50

/**
 * Query-string shape. Values arrive as strings, so each is coerced
 * explicitly rather than trusted: an unparseable `week` is a 400 naming the
 * field, never a silently dropped filter that would return a wider feed than
 * the caller asked for.
 */
export const activityQuerySchema = z.strictObject({
  kind: z.enum(['all', 'transaction', 'system']).default('all'),
  /** Comma-separated `transactions.type` values; absent = every type. */
  type: z
    .string()
    .transform((raw) => raw.split(',').map((part) => part.trim()).filter(Boolean))
    .pipe(z.array(z.enum(TRANSACTION_TYPES)).min(1))
    .optional(),
  week: z.coerce.number().int().min(1).max(18).optional(),
  team_id: z.uuid().optional(),
  limit: z.coerce.number().int().min(1).max(ACTIVITY_MAX_LIMIT).default(ACTIVITY_DEFAULT_LIMIT),
  /** Cursor, half 1: the boundary instant. Alone it means "strictly older
   *  than this instant" — a well-defined filter, but NOT a page boundary. */
  before: z.iso.datetime({ offset: true }).optional(),
  /** Cursor, half 2: the boundary item's id (R770). With `before` it means
   *  "older than the instant, OR at the instant with a smaller id" — the
   *  exact inverse of the `(created_at DESC, id DESC)` sort, so an item
   *  sharing the boundary instant is served exactly once instead of never. */
  before_id: z.uuid().optional(),
})
  .refine((query) => query.before !== undefined || query.before_id === undefined, {
    // A `before_id` with no `before` is not a narrower cursor, it is a
    // MEANINGLESS one — and silently ignoring it would page as if the caller
    // had asked for the whole feed. Refuse it by name.
    message: 'before_id needs the before instant it belongs to.',
    path: ['before_id'],
  })
export type ActivityQuery = z.input<typeof activityQuerySchema>

export interface TransactionActivityItem {
  kind: 'transaction'
  id: string
  created_at: string | null
  type: string
  status: string
  week: number | null
  team_id: string | null
  actor_id: string | null
  action_id: string | null
  payload: Json
}

export interface SystemActivityItem {
  kind: 'system'
  id: string
  created_at: string | null
  context: string | null
  message: string
  actor_id: string | null
}

export type ActivityItem = TransactionActivityItem | SystemActivityItem

export interface ActivityFeed {
  items: ActivityItem[]
  limit: number
  has_more: boolean
  /** Pass back as `before` for the next page; null when the feed is done. */
  next_before: string | null
  /** Pass back as `before_id` ALONGSIDE `next_before` (R770). Both halves or
   *  neither: the instant alone drops every item that shares it. */
  next_before_id: string | null
}

/** Sort key: newest first, id as the deterministic tie-break. A NULL
 *  `created_at` (both columns are DEFAULT NOW() but nullable) sorts LAST
 *  rather than crashing the comparator or masquerading as newest.
 *  `Date.parse` here is a PURE parse of a value the database wrote — not a
 *  clock read — so the M0 time fence (which bans `Date.now`/`new Date()`
 *  and every alias of the constructor) is untouched; lexicographic string
 *  compare was rejected because it is only accidentally correct while every
 *  row carries the same UTC offset. */
function sortKey(item: ActivityItem): [number, string] {
  const ms = item.created_at ? Date.parse(item.created_at) : Number.NEGATIVE_INFINITY
  return [Number.isNaN(ms) ? Number.NEGATIVE_INFINITY : ms, item.id]
}

/** Pure merge of the two already-sorted streams (exported for the node
 *  test: the paging arithmetic is where an off-by-one silently drops an
 *  event). Both inputs are over-fetched to `limit + 1`, so the top `limit`
 *  of the union is the true top `limit` — anything excluded is older than
 *  everything included. */
export function mergeActivity(
  transactions: TransactionActivityItem[],
  systemPosts: SystemActivityItem[],
  limit: number,
): ActivityFeed {
  const merged = [...transactions, ...systemPosts].sort((a, b) => {
    const [aMs, aId] = sortKey(a)
    const [bMs, bId] = sortKey(b)
    if (aMs !== bMs) return bMs - aMs
    return aId < bId ? 1 : aId > bId ? -1 : 0
  })
  const items = merged.slice(0, limit)
  const last = items[items.length - 1]
  const hasMore = merged.length > limit
  return {
    items,
    limit,
    has_more: hasMore,
    next_before: hasMore ? (last?.created_at ?? null) : null,
    // The id half travels WITH the instant — a next page built from
    // `next_before` alone would drop every item sharing that instant (R770).
    next_before_id: hasMore ? (last?.id ?? null) : null,
  }
}

/**
 * The page-boundary filter, as PostgREST spells it (R770) — exported so the
 * string itself is pinnable rather than inferred from a green page.
 *
 * `created_at.lt.T OR (created_at.eq.T AND id.lt.ID)` is the exact inverse of
 * the `(created_at DESC, id DESC)` sort, so the item AT the boundary is
 * excluded (it was the last item of the previous page) and every OTHER item
 * sharing its instant is included. Values are double-quoted because a
 * timestamptz carries `.`, `:` and `+`, all of which are structural in a
 * PostgREST filter string.
 *
 * Both source queries carry it identically — the two streams must cut at the
 * SAME boundary or the merge would page one of them out of step.
 */
export function activityCursorFilter(before: string, beforeId: string): string {
  return `created_at.lt."${before}",and(created_at.eq."${before}",id.lt."${beforeId}")`
}

/**
 * GET /api/leagues/[id]/activity — the unified feed (§15.3).
 */
export async function readActivity(
  supabase: Supabase,
  leagueId: string,
  rawQuery: unknown,
): Promise<ServiceResult> {
  const parsed = activityQuerySchema.safeParse(rawQuery ?? {})
  if (!parsed.success) {
    return { status: 400, body: { error: z.flattenError(parsed.error) as unknown as Json } }
  }
  const { kind, type, week, team_id, limit, before, before_id } = parsed.data

  // The family's gate BEFORE the first `.from(` (R807): a non-member is
  // refused by name, never handed an empty feed.
  const refused = await assertLeagueMember(supabase, leagueId)
  if (refused) return refused

  // Over-fetch by one PER SOURCE — that extra row is what makes `has_more`
  // a measurement instead of a guess.
  const fetchLimit = limit + 1

  let transactions: TransactionActivityItem[] = []
  if (kind !== 'system') {
    let query = supabase
      .from('transactions')
      .select('id, created_at, type, status, week, initiator_team_id, initiated_by, action_id, payload')
      .eq('league_id', leagueId)
      .order('created_at', { ascending: false })
      .order('id', { ascending: false })
      .limit(fetchLimit)
    if (type) query = query.in('type', type)
    if (week !== undefined) query = query.eq('week', week)
    if (team_id) query = query.eq('initiator_team_id', team_id)
    if (before) {
      // Both halves = a page boundary; the instant alone = a plain "older
      // than T" filter, which is well defined but never what a next page
      // should send (R770).
      query = before_id
        ? query.or(activityCursorFilter(before, before_id))
        : query.lt('created_at', before)
    }

    const { data, error } = await query
    if (error) {
      return { status: 500, body: { error: error.message } }
    }
    transactions = (data ?? []).map((row) => ({
      kind: 'transaction',
      id: row.id,
      created_at: row.created_at,
      type: row.type,
      status: row.status,
      week: row.week,
      team_id: row.initiator_team_id,
      actor_id: row.initiated_by,
      action_id: row.action_id,
      payload: row.payload,
    }))
  }

  let systemPosts: SystemActivityItem[] = []
  // A `type`, `week` or `team_id` filter is a TRANSACTION filter: system
  // posts carry none of those columns, so applying one means the caller
  // asked for transactions and the posts are correctly absent. Said out
  // loud rather than left to a silent empty branch.
  const systemFilteredOut = type !== undefined || week !== undefined || team_id !== undefined
  if (kind !== 'transaction' && !systemFilteredOut) {
    let query = supabase
      .from('league_chat')
      .select('id, created_at, context, message, user_id')
      .eq('league_id', leagueId)
      .eq('context', LEAGUE_CHAT_CONTEXT)
      .eq('is_system', true)
      .order('created_at', { ascending: false })
      .order('id', { ascending: false })
      .limit(fetchLimit)
    if (before) {
      query = before_id
        ? query.or(activityCursorFilter(before, before_id))
        : query.lt('created_at', before)
    }

    const { data, error } = await query
    if (error) {
      return { status: 500, body: { error: error.message } }
    }
    systemPosts = (data ?? []).map((row) => ({
      kind: 'system',
      id: row.id,
      created_at: row.created_at,
      context: row.context,
      message: row.message,
      actor_id: row.user_id,
    }))
  }

  return {
    status: 200,
    body: mergeActivity(transactions, systemPosts, limit) as unknown as Json,
  }
}

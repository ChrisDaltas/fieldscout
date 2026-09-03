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
 * **Reads are RLS-scoped** (D92): `transactions` is member-SELECTable
 * (109:259) and `league_chat` is member-SELECTable (095:604), so a
 * non-member's request reads nothing and answers an EMPTY feed rather than a
 * 404 — the established no-leak posture for league reads (D114(5)).
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
 * No Date/random read anywhere in this file (the `src/lib/leagues/**` ESLint
 * fences): the cursor is the caller's, the ordering is the database's.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { z } from 'zod'

import type { Database, Json } from '@/types/database'

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
  /** Cursor: return only items strictly OLDER than this instant. */
  before: z.iso.datetime({ offset: true }).optional(),
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
  return {
    items,
    limit,
    has_more: merged.length > limit,
    next_before: merged.length > limit ? (last?.created_at ?? null) : null,
  }
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
  const { kind, type, week, team_id, limit, before } = parsed.data
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
    if (before) query = query.lt('created_at', before)

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
    if (before) query = query.lt('created_at', before)

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

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
 * The M6 enrichment (the "✸ commissioner" treatment linking to its audit
 * entry) landed with L.E1.34: every item carries `commish_action_id`, the
 * receipt its act wrote (see `readActivity` / `attachReceipts`).
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
import { dbFailure } from './db-failure'
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

/** M6 L.E1.34: the feed's topics (the Activity page's Trades tab). */
export const ACTIVITY_TOPICS = ['trades'] as const
export type ActivityTopic = (typeof ACTIVITY_TOPICS)[number]

/**
 * M6 L.E1.34 (Q84 / F463): the executed trade's SECOND line. Every path that
 * executes a trade (151 / 153's `trade_execute_internal`, 156's) writes ONE
 * `transactions` row AND a NULL-actor league post opening with this literal,
 * in the same transaction; the feed shows the transaction's line ("completed
 * a trade: …") and never this post. Excluded in SQL — so a page's size and
 * `has_more` stay measured, never thinned after the read. The actor check
 * keeps a commissioner post that happens to open with the words (a team
 * renamed to them) in the feed (R1349's rule: a system post nobody wrote
 * opens with a fixed literal; every commissioner post carries its actor).
 * `activity-service.test.ts` reads 151 / 153 / 156 and fails if the literal
 * and the migrations ever part.
 */
export const TRADE_COMPLETED_POST_PREFIX = 'Trade completed: '
/** The league-vote veto's post (155, NULL actor) — a Trades-tab line. */
export const TRADE_VOTE_VETO_POST_PREFIX = 'Trade vetoed by league vote: '

/** The PostgREST tree that keeps every post EXCEPT the executed trade's (see above). */
export const NOT_TRADE_COMPLETED_POST_FILTER = `user_id.not.is.null,message.not.like."${TRADE_COMPLETED_POST_PREFIX}*"`
/** The Trades tab's transactions: a trade that went through, and a reversal. */
export const TRADE_TRANSACTIONS_FILTER = 'type.eq.trade,and(type.eq.commissioner_move,payload->>kind.eq.trade_reversal)'

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
  /** M6 L.E1.34 (Q84): `trades` — only the trades that went through, were
   *  vetoed or were reversed, one line each (see `readActivity`). Stands
   *  alone: it is its own filter, so a `type`, `week` or `team_id` beside it
   *  is refused by name rather than half-applied. */
  topic: z.enum(ACTIVITY_TOPICS).optional(),
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
    message: 'That filter combination isn’t supported.',
    path: ['before_id'],
  })
  .refine((query) => query.topic === undefined || (query.type === undefined && query.week === undefined && query.team_id === undefined), {
    message: 'That filter combination isn’t supported — a topic can’t be combined with a type, week or team.',
    path: ['topic'],
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
  /** M6 L.E1.34 (F233(d)): the §10.3 receipt this row's act wrote — the
   *  row's own `related_action_id` (a commissioner's move), else the receipt
   *  written in the same transaction (a trade he forced or approved); null
   *  when none. Optional only so older fixtures stay valid — the read always
   *  sets it. */
  commish_action_id?: string | null
}

export interface SystemActivityItem {
  kind: 'system'
  id: string
  created_at: string | null
  context: string | null
  message: string
  actor_id: string | null
  /** What the post is about, when the feed can say (M6 L.E2.3): a stat
   *  correction's league post (172's door) is `'stat_correction'`; every
   *  other post `null`. */
  topic: SystemPostTopic | null
  /** The NFL week a stat-correction post names; `null` for every other post. */
  week: number | null
  /** M6 L.E1.34 (F233(d)): the §10.3 receipt written in the same transaction
   *  by the post's actor — the ✸ line's log entry; null for a post nobody
   *  wrote or one with no receipt (a pre-123 post). Optional only so older
   *  fixtures stay valid — the read always sets it. */
  commish_action_id?: string | null
}

export type SystemPostTopic = 'stat_correction'

/**
 * M6 L.E2.3 — the stat-correction posts ARE feed items already (172's door
 * writes ONE `league_chat` system post per re-score, `context = 'league'`, in
 * the re-score's own transaction — D453(4)), so the feed reads them exactly
 * as every other league post; what it adds is the TAG, so the Activity page
 * can render and group a correction without matching copy itself.
 *
 * **Two markers, both required (R1349 — the spoofing finding).** (1) The
 * door's literal prefix (`v_post := 'Stat correction (Week ' || p_week ||
 * '): '`, 172 — `activity-service.test.ts` reads the migration and fails if
 * the two ever part). (2) **No actor**: the door writes `user_id = NULL`.
 * The prefix alone is not enough — a manager can name his team "Stat
 * correction (Week 3): …", and every commissioner post that OPENS with a
 * team name (the rename 170:2423, FAAB 147:293, autopilot 139:439, the
 * retire 169:1052) would then carry the prefix; every one of those writes
 * the acting commissioner (`auth.uid()`), never NULL. A member cannot write
 * a system post at all (065's policy: `is_system = FALSE`, `user_id =
 * auth.uid()`), and the other actor-less league posts (116 / 117 / 118
 * "Week N was finalized…", 151 / 153 / 156 "Trade completed:", 155 "Trade
 * vetoed…", 161 "Week N was re-scored:") open with fixed literals.
 * (Considered and not used: matching the post's `created_at` to a record's
 * `recorded_at` — the same transaction's now() — costs a second read per
 * page and couples the feed to 172's table on a pre-push database.)
 */
export const STAT_CORRECTION_POST_PREFIX = 'Stat correction (Week '
const STAT_CORRECTION_POST = /^Stat correction \(Week (\d+)\): /

/** Pure: the week a post names when it is the scoring door's correction post
 *  — the prefix AND no actor (R1349); `null` for every other post. */
export function statCorrectionPostWeek(message: string, actorId: string | null): number | null {
  if (actorId !== null) return null
  const match = STAT_CORRECTION_POST.exec(message)
  return match ? Number(match[1]) : null
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
  return [instantMicros(item.created_at), item.id]
}

/**
 * R1393: the instant in MICROSECONDS — the database's own precision. The
 * page boundary the next read sends (`activityCursorFilter`) is compared by
 * PostgreSQL to the microsecond, so the merge must order the streams to the
 * microsecond too: ordered by the millisecond, two rows of different streams
 * inside one millisecond fell back to the id tie-break, and the NEWER one
 * could land after the cut and never be served on either page. The fraction
 * is padded to 6 digits (PostgREST drops trailing zeros); the whole-ms part
 * is `Date.parse`'s (a pure parse, never a clock read). Pure; exported for
 * its pin. Unparseable / NULL → −∞ (sorts last, as before).
 */
export function instantMicros(instant: string | null): number {
  if (!instant) return Number.NEGATIVE_INFINITY
  const ms = Date.parse(instant)
  if (Number.isNaN(ms)) return Number.NEGATIVE_INFINITY
  const fraction = /T\d{2}:\d{2}:\d{2}\.(\d+)/.exec(instant)?.[1] ?? ''
  const extraMicros = Number(fraction.padEnd(6, '0').slice(3, 6))
  return ms * 1000 + extraMicros
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
  /** M6 L.E1.34: a third stream (the Trades tab's commissioner vetoes, read
   *  from the log) — over-fetched to `limit + 1` and cut at the same
   *  boundary like the other two. */
  receiptPosts: SystemActivityItem[] = [],
): ActivityFeed {
  const merged = [...transactions, ...systemPosts, ...receiptPosts].sort((a, b) => {
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
 * The Trades tab's commissioner veto, read from its receipt (M6 L.E1.34,
 * Q84): 156's veto writes ONE receipt (`veto_trade`) and ONE post opening
 * with the commissioner's name — which no SQL filter can tell from his other
 * posts. The receipt is the exact, pageable record, so the tab reads it and
 * words the line exactly as 156 words the post (`draft_actor_name()` —
 * the username since 077 — then " (commissioner) vetoed a trade: <deal>",
 * then the reason when one was given).
 *
 * R1394: the name is the commissioner's CURRENT username (the receipt's
 * actor, read through `profiles` now), while the post froze the name he had
 * when he vetoed — so after a username change the Trades tab and the All
 * tab (which shows the post) name him differently. The deal and the reason
 * are the receipt's own stored values.
 */
export function vetoReceiptPost(row: {
  id: string
  created_at: string
  actor_id: string
  reason: string | null
  metadata: Json | null
  actor: { username: string | null } | null
}): SystemActivityItem {
  const metadata = row.metadata !== null && typeof row.metadata === 'object' && !Array.isArray(row.metadata) ? row.metadata : {}
  const summary = typeof metadata.summary === 'string' && metadata.summary !== '' ? metadata.summary : 'a trade'
  const reason = row.reason?.trim() ? ` — reason: ${row.reason}` : ''
  return {
    kind: 'system',
    id: row.id,
    created_at: row.created_at,
    context: LEAGUE_CHAT_CONTEXT,
    message: `${row.actor?.username ?? 'a commissioner'} (commissioner) vetoed a trade: ${summary}${reason}`,
    actor_id: row.actor_id,
    topic: null,
    week: null,
    commish_action_id: row.id,
  }
}

/**
 * Pure: each page item's receipt (F233(d)). A commissioner's verb writes its
 * receipt, its post and any `transactions` row in ONE transaction, and every
 * one of those columns defaults to that transaction's `now()` — so they share
 * the instant exactly. A post takes the receipt its own actor wrote at its
 * instant; a transaction takes its own `related_action_id` when it has one,
 * else the receipt written at its instant (a trade executed inside a force or
 * an approval — the proposer is the row's initiator, not the commissioner).
 */
export function attachReceipts(
  items: ActivityItem[],
  relatedActionIds: ReadonlyMap<string, string | null>,
  receipts: ReadonlyArray<{ id: string; actor_id: string; created_at: string }>,
): ActivityItem[] {
  // Keyed on the instant's TEXT: PostgREST renders every timestamptz the same
  // way, to the microsecond, and the receipts were read with `in` on these
  // very strings — so equal text is the database's own equality. (A parsed
  // `Date` would round to the millisecond and could pair two transactions.)
  const byInstant = new Map<string, Array<{ id: string; actor_id: string; created_at: string }>>()
  for (const receipt of [...receipts].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))) {
    byInstant.set(receipt.created_at, [...(byInstant.get(receipt.created_at) ?? []), receipt])
  }
  return items.map((item) => {
    if (item.commish_action_id) return item
    const atInstant = item.created_at === null ? [] : (byInstant.get(item.created_at) ?? [])
    if (item.kind === 'system') {
      const own = item.actor_id === null ? undefined : atInstant.find((r) => r.actor_id === item.actor_id)
      return { ...item, commish_action_id: own?.id ?? null }
    }
    const related = relatedActionIds.get(item.id) ?? null
    return { ...item, commish_action_id: related ?? atInstant[0]?.id ?? null }
  })
}

/**
 * GET /api/leagues/[id]/activity — the unified feed (§15.3).
 *
 * **M6 L.E1.34 — what the feed shows (Q84, F463, F532; PROGRESS D459):**
 *  - the executed trade ONCE: its `transactions` line; the "Trade completed:"
 *    post is excluded in SQL (`NOT_TRADE_COMPLETED_POST_FILTER`);
 *  - `topic=trades` — the trades that went through, were vetoed or were
 *    reversed, one line each: `trade` rows, reversal rows, the league-vote
 *    veto post, and the commissioner's veto read from its receipt;
 *  - a `week` filter keeps THAT week's stat-correction posts (F532 — the only
 *    posts that carry a week, D454(4)); every other post has none and stays
 *    out of a week's feed, as before;
 *  - every item names the receipt its act wrote (`commish_action_id`), read
 *    by instant in one more query per page (`attachReceipts`).
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
  const { kind, topic, type, week, team_id, limit, before, before_id } = parsed.data

  // The family's gate BEFORE the first `.from(` (R807): a non-member is
  // refused by name, never handed an empty feed.
  const refused = await assertLeagueMember(supabase, leagueId)
  if (refused) return refused

  // Over-fetch by one PER SOURCE — that extra row is what makes `has_more`
  // a measurement instead of a guess.
  const fetchLimit = limit + 1
  const trades = topic === 'trades'

  let transactions: TransactionActivityItem[] = []
  const relatedActionIds = new Map<string, string | null>()
  if (kind !== 'system') {
    let query = supabase
      .from('transactions')
      .select('id, created_at, type, status, week, initiator_team_id, initiated_by, action_id, related_action_id, payload')
      .eq('league_id', leagueId)
      .order('created_at', { ascending: false })
      .order('id', { ascending: false })
      .limit(fetchLimit)
    if (trades) query = query.or(TRADE_TRANSACTIONS_FILTER)
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
    transactions = (data ?? []).map((row) => {
      relatedActionIds.set(row.id, row.related_action_id)
      return {
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
      }
    })
  }

  let systemPosts: SystemActivityItem[] = []
  // A `type` or `team_id` filter is a TRANSACTION filter: system posts carry
  // neither column, so the posts are correctly absent. A `week` keeps only
  // that week's stat-correction posts (F532). Said out loud rather than left
  // to a silent empty branch.
  const systemFilteredOut = type !== undefined || team_id !== undefined
  if (kind !== 'transaction' && !systemFilteredOut) {
    let query = supabase
      .from('league_chat')
      .select('id, created_at, context, message, user_id')
      .eq('league_id', leagueId)
      .eq('context', LEAGUE_CHAT_CONTEXT)
      .eq('is_system', true)
      .or(NOT_TRADE_COMPLETED_POST_FILTER)
      .order('created_at', { ascending: false })
      .order('id', { ascending: false })
      .limit(fetchLimit)
    if (week !== undefined) {
      // The scoring door's post for THIS week: no actor and its literal (R1349).
      query = query.is('user_id', null).like('message', `${STAT_CORRECTION_POST_PREFIX}${week}): *`)
    }
    if (trades) {
      // The league vote's veto (155) — a fixed literal nobody wrote. The
      // commissioner's veto is read from its receipt below.
      query = query.is('user_id', null).like('message', `${TRADE_VOTE_VETO_POST_PREFIX}*`)
    }
    if (before) {
      query = before_id
        ? query.or(activityCursorFilter(before, before_id))
        : query.lt('created_at', before)
    }

    const { data, error } = await query
    if (error) {
      return { status: 500, body: { error: error.message } }
    }
    systemPosts = (data ?? []).map((row) => {
      const correctionWeek = statCorrectionPostWeek(row.message, row.user_id)
      return {
        kind: 'system',
        id: row.id,
        created_at: row.created_at,
        context: row.context,
        message: row.message,
        actor_id: row.user_id,
        topic: correctionWeek === null ? null : 'stat_correction',
        week: correctionWeek,
      }
    })
  }

  let vetoPosts: SystemActivityItem[] = []
  if (trades && kind !== 'transaction') {
    let query = supabase
      .from('commissioner_actions')
      .select('id, created_at, actor_id, reason, metadata, actor:profiles!commissioner_actions_actor_id_fkey(username)')
      .eq('league_id', leagueId)
      .eq('action_type', 'veto_trade')
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
      return dbFailure('commissioner_actions', error)
    }
    vetoPosts = (data ?? []).map((row) => vetoReceiptPost({ ...row, actor: row.actor ?? null }))
  }

  const page = mergeActivity(transactions, systemPosts, limit, vetoPosts)

  // F233(d): each item's receipt, by instant — one read per page, only the
  // instants on it (≤ 100), never the whole log.
  const instants = [
    ...new Set(
      page.items
        .filter((item) => !item.commish_action_id && (item.kind === 'transaction' ? !relatedActionIds.get(item.id) : item.actor_id !== null))
        .map((item) => item.created_at)
        .filter((instant): instant is string => instant !== null),
    ),
  ]
  let receipts: Array<{ id: string; actor_id: string; created_at: string }> = []
  if (instants.length > 0) {
    const { data, error } = await supabase
      .from('commissioner_actions')
      .select('id, actor_id, created_at')
      .eq('league_id', leagueId)
      .in('created_at', instants)
    if (error) {
      return dbFailure('commissioner_actions', error)
    }
    receipts = data ?? []
  }

  return {
    status: 200,
    body: { ...page, items: attachReceipts(page.items, relatedActionIds, receipts) } as unknown as Json,
  }
}

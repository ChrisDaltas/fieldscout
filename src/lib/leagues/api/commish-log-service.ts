/**
 * The commissioner audit log READ — M6A task L.E1.11,
 * `GET /api/leagues/[id]/commish/log` (spec §15.4:1703 *"audit log (any
 * member can read)"*; §10.3; §12.12; migration 123; PROGRESS D351).
 *
 * **THIS IS THE ACTIVITY-SECTION READ SURFACE CHRIS NAMED.** Q66 (ruled
 * 2026-09-16, spec v2.16.41 §10.3): *"What is required is storing the
 * transaction and displaying it in the 'activity' section of the League
 * Home."* L.E1.13's League Home activity section reads THIS endpoint for
 * its commissioner-action rows. Every row carries `action_type`, the actor
 * (id + username), the target (`target_type` / `target_id`), `reason`,
 * `created_at`, and the `before` / `after` / `metadata` documents the verbs
 * wrote, so the section can render the human line §10.3:703 prints
 * ("{actor} changed Week 7: … — reason: '…'"). `reason` is `string | null`
 * (nullable since 130 §0, Q66): a NULL reason is rendered as ABSENT — never
 * the string "null", never an empty "— reason:" clause (§10.3: *"an entry
 * with no reason renders as such, never as an empty quote"*).
 *
 * **ANY MEMBER READS IT — and the read is gated BEFORE the first `.from(`.**
 * `123:333-334` is the SELECT policy: `is_league_member(league_id)`, not
 * `is_league_commish` — transparency is the point (§12.12:1205). But an
 * RLS-empty result for a non-member must not render as an empty log
 * (CLAUDE.md: "assert the reason for emptiness rather than inferring it"),
 * so `assertLeagueMember` (`inseason-reads.ts`) runs first: ONE no-leak 403
 * for a non-member and a nonexistent league alike — the same predicate the
 * policy evaluates, so the route and the policy cannot disagree about who
 * a member is — and a 404 by name only for a MEMBER whose league was
 * soft-deleted (R812). Nothing here answers "league does not exist"
 * differently from "not a member".
 *
 * **A ROW IS A CLAIM, NOT PROOF A VERB RAN (tasks-M6A §9 C70).** `123:335`
 * ships a client INSERT policy (`is_league_commish(league_id) AND actor_id
 * = auth.uid()`), so a commissioner's own client can append a row that no
 * verb wrote. What a row proves is that a commissioner CLAIMED an action;
 * what proves a verb ran is the verb's OWN state (the matchup's
 * `override_action_id`, the roster row, the team's name) and its replay
 * ledger. This endpoint therefore renders rows as they are and adds NO
 * "executed" / "applied" / "verified" field — and no future surface may
 * reason FROM this log as an execution record. D350 is why the replay
 * ledgers are separate tables with zero policies.
 *
 * **THE CURSOR IS COMPOSITE — `(created_at, id)`, never the instant alone
 * (R770).** The log orders by `(created_at DESC, id DESC)` over
 * `idx_commish_actions_league` (`123:322`, `(league_id, created_at DESC)`)
 * and `created_at` is NOT NULL by 123's deviation 2 (a NULL would be
 * unreachable by any cursor predicate). Two rows CAN share an instant:
 * every verb writes one row per transaction, but a single transaction's
 * `now()` is frozen, so a future verb writing two rows (an undo chain, a
 * bulk repair) puts both at one instant, and even today two commissioners'
 * transactions can commit in the same millisecond. A page boundary on the
 * instant alone would serve one of them on NO page. The boundary is the
 * activity feed's own filter, `activityCursorFilter` — imported, never
 * re-derived — `created_at.lt.T OR (created_at.eq.T AND id.lt.ID)`, the
 * exact inverse of the sort.
 *
 * **THE CURSOR IS OPAQUE ON THE WIRE.** The activity feed hands back two
 * halves (`before` / `before_id`) and must refuse a lone id by name; this
 * endpoint hands back ONE token — base64url of the `[created_at, id]` tuple
 * — so a caller cannot send half a boundary at all. It is decoded and
 * validated with Zod on the way in and refused BY NAME when malformed,
 * never treated as "no cursor" (which would silently page from the top).
 *
 * **Loud emptiness (tasks-M4 §4 rule 10).** A PostgREST error is a 500 with
 * the driver's message, never an empty list; `has_more` is derived from an
 * over-fetch of `limit + 1`, and the page size is bounded far below
 * PostgREST's 1000-row cap.
 *
 * No Date/random read anywhere in this file (the `src/lib/leagues/**`
 * ESLint fences): the cursor is the caller's, the ordering is the database's.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { z } from 'zod'

import type { Database, Json } from '@/types/database'

import { activityCursorFilter } from './activity-service'
import { assertLeagueMember } from './inseason-reads'
import type { ServiceResult } from './leagues-service'

type Supabase = SupabaseClient<Database>

/** Page size ceiling — far below PostgREST's 1000-row cap, so the over-fetch
 *  of `limit + 1` can never reach it and a short page is genuinely short. */
export const COMMISH_LOG_MAX_LIMIT = 100
export const COMMISH_LOG_DEFAULT_LIMIT = 50

/** The 400 for a cursor that does not decode to a `[created_at, id]` tuple. */
export const COMMISH_LOG_BAD_CURSOR_MESSAGE =
  'That page cursor is not one this log issued — reload the log from the top.'

/** The decoded cursor: the boundary row's instant and id, both required. */
const cursorTupleSchema = z.tuple([z.iso.datetime({ offset: true }), z.uuid()])

/** Encode a page boundary as ONE opaque token (base64url of the JSON tuple). */
export function encodeCommishLogCursor(createdAt: string, id: string): string {
  return Buffer.from(JSON.stringify([createdAt, id]), 'utf8').toString('base64url')
}

/** Decode a token back to its tuple, or `null` when it is not one this log
 *  issued (not base64url, not JSON, not a `[instant, uuid]` pair). */
export function decodeCommishLogCursor(token: string): { before: string; beforeId: string } | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(Buffer.from(token, 'base64url').toString('utf8'))
  } catch {
    return null
  }
  const tuple = cursorTupleSchema.safeParse(parsed)
  if (!tuple.success) return null
  return { before: tuple.data[0], beforeId: tuple.data[1] }
}

/** Query-string shape. Values arrive as strings, so each is coerced
 *  explicitly rather than trusted. */
export const commishLogQuerySchema = z.strictObject({
  limit: z.coerce.number().int().min(1).max(COMMISH_LOG_MAX_LIMIT).default(COMMISH_LOG_DEFAULT_LIMIT),
  /** The opaque token from a previous page's `next_cursor`. */
  cursor: z.string().min(1).max(512).optional(),
})
export type CommishLogQuery = z.input<typeof commishLogQuerySchema>

/** One audit row as rendered. A CLAIM (see the header) — no field here says
 *  a verb ran. */
export interface CommishLogItem {
  id: string
  action_type: string
  actor: { id: string; username: string | null }
  target_type: string | null
  target_id: string | null
  /** `string | null` — a NULL reason renders as ABSENT (Q66, 130 §0). */
  reason: string | null
  before: Json | null
  after: Json | null
  metadata: Json | null
  acting_as_team_id: string | null
  reverts_action_id: string | null
  created_at: string
}

export interface CommishLogPage {
  items: CommishLogItem[]
  limit: number
  has_more: boolean
  /** Pass back as `cursor` for the next page; null when the log is done. */
  next_cursor: string | null
}

/**
 * GET /api/leagues/[id]/commish/log — the §10.3 audit log, newest first.
 */
export async function readCommishLog(
  supabase: Supabase,
  leagueId: string,
  rawQuery: unknown,
): Promise<ServiceResult> {
  const parsed = commishLogQuerySchema.safeParse(rawQuery ?? {})
  if (!parsed.success) {
    return { status: 400, body: { error: z.flattenError(parsed.error) as unknown as Json } }
  }
  const { limit, cursor } = parsed.data

  // A malformed cursor is refused BY NAME before any read — never demoted
  // to "no cursor", which would page from the top and look like a reset.
  const boundary = cursor === undefined ? undefined : decodeCommishLogCursor(cursor)
  if (boundary === null) {
    return { status: 400, body: { error: { fieldErrors: { cursor: [COMMISH_LOG_BAD_CURSOR_MESSAGE] } } } }
  }

  // The family's gate BEFORE the first `.from(` (R807): a non-member is
  // refused by name, never handed an empty log.
  const refused = await assertLeagueMember(supabase, leagueId)
  if (refused) return refused

  const fetchLimit = limit + 1
  let query = supabase
    .from('commissioner_actions')
    .select(
      'id, action_type, actor_id, target_type, target_id, reason, before, after, metadata, acting_as_team_id, reverts_action_id, created_at, actor:profiles!commissioner_actions_actor_id_fkey(username)',
    )
    .eq('league_id', leagueId)
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(fetchLimit)
  if (boundary) {
    query = query.or(activityCursorFilter(boundary.before, boundary.beforeId))
  }

  const { data, error } = await query
  if (error) {
    return { status: 500, body: { error: error.message } }
  }
  const rows = data ?? []
  const hasMore = rows.length > limit
  const items: CommishLogItem[] = rows.slice(0, limit).map((row) => ({
    id: row.id,
    action_type: row.action_type,
    actor: { id: row.actor_id, username: row.actor?.username ?? null },
    target_type: row.target_type,
    target_id: row.target_id,
    reason: row.reason,
    before: row.before,
    after: row.after,
    metadata: row.metadata,
    acting_as_team_id: row.acting_as_team_id,
    reverts_action_id: row.reverts_action_id,
    created_at: row.created_at,
  }))
  const last = items[items.length - 1]

  const page: CommishLogPage = {
    items,
    limit,
    has_more: hasMore,
    next_cursor: hasMore && last ? encodeCommishLogCursor(last.created_at, last.id) : null,
  }
  return { status: 200, body: page as unknown as Json }
}

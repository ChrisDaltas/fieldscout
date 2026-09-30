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
 * **THE FILTERS (M6 L.E1.32; PROGRESS D455).** `type` / `team_id` / `week`
 * narrow the log for the console and the Activity page (L.E1.33 / L.E1.34);
 * each is a PostgREST filter on the same ordered read, so the cursor pages a
 * filtered log exactly as it pages the whole one (a client-side filter would
 * serve short pages and lie about `has_more`). What each one matches is what
 * the receipts STORE — measured over every commissioner verb's real receipt
 * (pgTAP 118's matrix world, 2026-09-30), never a guess:
 *   - `type` — `action_type`, one value or a comma-separated list (≤ 25).
 *     The vocabulary is not a CHECK (123:283), so any well-formed slug is
 *     accepted; one that no receipt carries matches nothing.
 *   - `team_id` — a team of THIS league (a foreign or unknown id is a 404 by
 *     name, never an empty log). A row concerns the team when ANY of the
 *     three places a receipt names a team holds it: `acting_as_team_id` (the
 *     team the commissioner acted for, D451), `target_type = 'team'` with
 *     `target_id` = the team (a lineup, a rename, autopilot, FAAB, a seat),
 *     or `metadata.affected_team_ids` containing it (a score, a result, a
 *     move, a trade, a draft pick, a schedule edit). A league-wide row (a
 *     setting, the draft clock, an invite) names no team and is in no
 *     team's log.
 *   - `week` — `metadata.week`, the week the verb recorded it ACTED ON (a
 *     score, a result, a lineup, a one-week schedule edit, a bracket
 *     round). A row with no `metadata.week` (a trade, a roster move, a
 *     setting) is in no week's log; `current_week` — the week it HAPPENED
 *     in — is deliberately not read as "the week it was about".
 *   - `entry` (L.E1.34) — an action id of THIS league (else a 404 by name):
 *     the page starts AT that row and runs older, so a ✸ line's door lands
 *     on its entry (F233(d)); combines with the filters and the cursor.
 *
 * **THE PEOPLE A RECEIPT NAMES (F549; PROGRESS D465).** A membership
 * receipt names people by user id (`manager_user_id`, `user_id`,
 * `commissioner_user_id`, …). The league's member list can name only the
 * people still in it — and the manager a takeover, a vacate or a retirement
 * REMOVED is by definition no longer there, so the log could never say who
 * left. Each item therefore carries `usernames`: every user id its before /
 * after / metadata holds under a `user_id` / `*_user_id` key, by his current
 * username, read in ONE extra `profiles` query per page (public identity —
 * `profiles` is readable by everyone, 001:581). No such id ⇒ no query; a
 * failed read is a 500 by name, never a receipt that silently lost a name.
 *
 * No Date/random read anywhere in this file (the `src/lib/leagues/**`
 * ESLint fences): the cursor is the caller's, the ordering is the database's.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { z } from 'zod'

import type { Database, Json } from '@/types/database'

import { activityCursorFilter } from './activity-service'
import { normalizedUuid } from './inseason-ids'
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

/** The most `action_type`s one `type` filter may name. */
export const COMMISH_LOG_MAX_TYPES = 25

/** The 404 for a `team_id` that is not one of this league's teams. */
export const COMMISH_LOG_UNKNOWN_TEAM_MESSAGE = 'That team isn’t part of this league.'

/** One `action_type` slug as the verbs write them (`edit_score`, `draft_pause`). */
const ACTION_TYPE_SLUG = /^[a-z][a-z0-9_]{0,63}$/

/** `type=edit_score,set_result` → the distinct slugs, each well-formed. */
const typeFilterSchema = z
  .string()
  .min(1)
  .max(COMMISH_LOG_MAX_TYPES * 65)
  .transform((raw) => [...new Set(raw.split(',').map((t) => t.trim()))])
  .refine((types) => types.length >= 1 && types.length <= COMMISH_LOG_MAX_TYPES, {
    message: `Name between 1 and ${COMMISH_LOG_MAX_TYPES} action types.`,
  })
  .refine((types) => types.every((t) => ACTION_TYPE_SLUG.test(t)), {
    message: 'Each action type is a lower-case word like edit_score.',
  })

/** Query-string shape. Values arrive as strings, so each is coerced
 *  explicitly rather than trusted. */
export const commishLogQuerySchema = z.strictObject({
  limit: z.coerce.number().int().min(1).max(COMMISH_LOG_MAX_LIMIT).default(COMMISH_LOG_DEFAULT_LIMIT),
  /** The opaque token from a previous page's `next_cursor`. */
  cursor: z.string().min(1).max(512).optional(),
  /** L.E1.32: only these `action_type`s (comma-separated). */
  type: typeFilterSchema.optional(),
  /** L.E1.32: only rows that name this team (see the header). */
  team_id: normalizedUuid.optional(),
  /** L.E1.32: only rows whose verb recorded acting on this week
   *  (`metadata.week`) — the house week bound (matchups, box score). */
  week: z.coerce.number().int().min(1).max(18).optional(),
  /** L.E1.34 (F233(d)): open the log AT this entry — the page starts with it
   *  and runs older (a ✸ line's door lands on its entry). */
  entry: normalizedUuid.optional(),
})
export type CommishLogQuery = z.input<typeof commishLogQuerySchema>

/** The 404 for an `entry` that is not one of this league's log rows. */
export const COMMISH_LOG_UNKNOWN_ENTRY_MESSAGE = 'That commissioner action isn’t in this league’s log.'

/**
 * The page boundary that STARTS at an entry: the entry itself and everything
 * older — `created_at < T OR (created_at = T AND id <= ID)`, the inclusive
 * twin of `activityCursorFilter` (L.E1.34). A later page's cursor is stricter
 * and is ANDed with it (two PostgREST trees), so paging on past the entry is
 * the log's ordinary paging.
 */
export function commishLogEntryFilter(createdAt: string, id: string): string {
  return `created_at.lt."${createdAt}",and(created_at.eq."${createdAt}",id.lte."${id}")`
}

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
  /** F549: user id → current username for every person the receipt names
   *  (`receiptUserIds`) — including one no longer in the league. Always
   *  set by this read; optional so a hand-built item (a test, a cached page
   *  from before F549) still types. */
  usernames?: Record<string, string>
}

const UUID_SHAPE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** F549: the user ids a receipt names — every top-level `user_id` /
 *  `*_user_id` key of its before / after / metadata holding a uuid. */
export function receiptUserIds(row: { before: Json | null; after: Json | null; metadata: Json | null }): string[] {
  const ids = new Set<string>()
  for (const doc of [row.before, row.after, row.metadata]) {
    if (doc === null || typeof doc !== 'object' || Array.isArray(doc)) continue
    for (const [key, value] of Object.entries(doc)) {
      if ((key === 'user_id' || key.endsWith('_user_id')) && typeof value === 'string' && UUID_SHAPE.test(value)) {
        ids.add(value.toLowerCase())
      }
    }
  }
  return [...ids]
}

/** The filters a page was read with, echoed (null = not filtered). */
export interface CommishLogAppliedFilters {
  type: string[] | null
  team_id: string | null
  week: number | null
  /** L.E1.34: present only when the page was opened at an entry. */
  entry?: string
}

export interface CommishLogPage {
  items: CommishLogItem[]
  limit: number
  /** L.E1.32: what this page is filtered by — the next page must be asked
   *  for with the same filters and the `next_cursor`. */
  filters: CommishLogAppliedFilters
  has_more: boolean
  /** Pass back as `cursor` for the next page; null when the log is done. */
  next_cursor: string | null
}

/**
 * The team filter's PostgREST `or` tree: the three places a receipt names a
 * team (the header's `team_id` paragraph). `teamId` is a validated,
 * lower-cased uuid, so nothing in it can break out of the tree.
 */
export function commishLogTeamFilter(teamId: string): string {
  return `acting_as_team_id.eq.${teamId},and(target_type.eq.team,target_id.eq.${teamId}),metadata->affected_team_ids.cs.["${teamId}"]`
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
  const types = parsed.data.type ?? null
  const teamId = parsed.data.team_id ?? null
  const week = parsed.data.week ?? null

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

  // A team filter names a team of THIS league, or it is refused by name —
  // never answered with an empty log that reads as "nothing happened to it".
  if (teamId !== null) {
    const { data: team, error: teamError } = await supabase
      .from('teams')
      .select('id')
      .eq('id', teamId)
      .eq('league_id', leagueId)
      .maybeSingle()
    if (teamError) return { status: 500, body: { error: `teams: ${teamError.message}` } }
    if (!team) return { status: 404, body: { error: COMMISH_LOG_UNKNOWN_TEAM_MESSAGE } }
  }

  // An entry names a row of THIS league's log, or it is refused by name —
  // never answered with the top of the log as if it were there.
  const entryId = parsed.data.entry ?? null
  let entryBoundary: { createdAt: string; id: string } | null = null
  if (entryId !== null) {
    const { data: row, error: entryError } = await supabase
      .from('commissioner_actions')
      .select('id, created_at')
      .eq('id', entryId)
      .eq('league_id', leagueId)
      .maybeSingle()
    if (entryError) return { status: 500, body: { error: `commissioner_actions: ${entryError.message}` } }
    if (!row) return { status: 404, body: { error: COMMISH_LOG_UNKNOWN_ENTRY_MESSAGE } }
    entryBoundary = { createdAt: row.created_at, id: row.id }
  }

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
  // The filters (L.E1.32). A second `or` is ANDed with the cursor's — two
  // separate PostgREST filter trees (proved on the stack: a filtered page
  // walk serves each matching row exactly once).
  if (types !== null) query = query.in('action_type', types)
  if (teamId !== null) query = query.or(commishLogTeamFilter(teamId))
  if (week !== null) query = query.eq('metadata->>week', String(week))
  if (entryBoundary !== null) query = query.or(commishLogEntryFilter(entryBoundary.createdAt, entryBoundary.id))

  const { data, error } = await query
  if (error) {
    return { status: 500, body: { error: error.message } }
  }
  const rows = data ?? []
  const hasMore = rows.length > limit
  const served = rows.slice(0, limit)

  // F549: the people these receipts name, by username — one read per page,
  // only the ids on it (a page is ≤ 100 rows; each names at most a few).
  const userIds = [...new Set(served.flatMap((row) => receiptUserIds(row)))]
  const usernameOf = new Map<string, string>()
  if (userIds.length > 0) {
    const { data: people, error: peopleError } = await supabase.from('profiles').select('id, username').in('id', userIds)
    if (peopleError) return { status: 500, body: { error: `profiles: ${peopleError.message}` } }
    for (const person of people ?? []) usernameOf.set(person.id.toLowerCase(), person.username)
  }

  const items: CommishLogItem[] = served.map((row) => ({
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
    usernames: Object.fromEntries(
      receiptUserIds(row).flatMap((id) => {
        const username = usernameOf.get(id)
        return username ? [[id, username] as const] : []
      }),
    ),
  }))
  const last = items[items.length - 1]

  const page: CommishLogPage = {
    items,
    limit,
    filters: { type: types, team_id: teamId, week, ...(entryId !== null ? { entry: entryId } : {}) },
    has_more: hasMore,
    next_cursor: hasMore && last ? encodeCommishLogCursor(last.created_at, last.id) : null,
  }
  return { status: 200, body: page as unknown as Json }
}

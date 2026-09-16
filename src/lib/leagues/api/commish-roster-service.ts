/**
 * Commissioner roster override services — M6A task L.E1.10,
 * `POST /api/leagues/[id]/commish/move-player` (spec §15.4:1694 →
 * `commish_move_player`) and `POST /api/leagues/[id]/commish/roster`
 * (§15.4:1695 → `commish_force_add_drop`); migration 127; PROGRESS D351.
 *
 * Two routes, ONE verb family, ONE replay namespace (127's
 * `commish_roster_actions`, D350): both doors wrap
 * `commish_roster_override_internal`, so an `action_id` spent by one is spent
 * for the other — the F65(b) guard checks the VERB as well as the identity
 * fields, or a move's `action_id` re-sent to `/commish/roster` would return
 * the move's document as a 200 for an add/drop nobody made.
 *
 * `commish-lineup-service.ts` is the template (D351: copied, not re-derived):
 * thin Route Handler, everything testable here over an INJECTED client
 * (D68/D71). The whole verb is the RPC's (server-authoritative — CLAUDE.md):
 * exclusivity, roster size, the game lock it lifts and NAMES, the lineup
 * sync, the pool mirror, the `transactions` row, the enqueue and the audit
 * row are all 127's, in one transaction under the league row lock. This layer
 * computes nothing about rosters.
 *
 * REASON — OPTIONAL (Q66, ruled by Chris 2026-09-16, spec v2.16.41). The
 * schema is `commish-matchup-service.ts`'s `optionalReason` — one shape for
 * every L.E1.10 route: trimmed, ≤ 500, blank / tab-only normalised to ABSENT.
 * Never `.min(1)` (F362; the lineup template's `:84` is the OLD contract).
 *
 * ⚠ TRANSITIONAL STATE, recorded not hidden: 127's in-body gate
 * (`127:759-763`) still REFUSES a blank reason with 22023 by name; L.E1.15
 * (F362) relaxes it. A no-reason request therefore passes this schema and
 * returns the mapper's 400 with 127's text verbatim — mapped like any other
 * refusal, never special-cased, and pinned by name in the stack suite so the
 * cell reds and gets re-cut when the sweep lands.
 *
 * SQLSTATE mapping is the family's (`inseason-errors.ts`), imported never
 * re-derived; only the 42501 copy is this route's. Refusal text verbatim.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { z } from 'zod'

import type { Database, Json } from '@/types/database'

import { optionalReason } from './commish-matchup-service'
import { mapInSeasonRpcError } from './inseason-errors'
import { normalizedUuid } from './inseason-ids'
import type { ServiceResult } from './leagues-service'

type Supabase = SupabaseClient<Database>

/** The 42501 arm's copy — one no-leak string for "no such league" and "not
 *  a commissioner" alike; it names the manager's own door. */
export const COMMISH_ROSTER_FORBIDDEN_MESSAGE =
  'Only this league’s commissioner can move a player between rosters or force an add/drop. A team’s own manager adds and drops the ordinary way.'

/** The 409 for a REUSED action_id naming a different move (the F65(b) class). */
export const COMMISH_ROSTER_ACTION_ID_REUSED_MESSAGE =
  'That didn’t go through — we couldn’t confirm it as the roster move you just submitted. Check the rosters and try again.'

/** A `players.id` — the catalog's text id, never a uuid. */
const playerId = z.string().trim().min(1).max(64)

/** `POST …/commish/move-player` — `commish_move_player(player_id, from, to,
 *  reason)`. `from`/`to` naming the same team is 127's own 22023
 *  (`127:690-694`); mirrored here as a field error so the form can route it. */
export const commishMovePlayerInputSchema = z
  .strictObject({
    player_id: playerId,
    from_team_id: normalizedUuid,
    to_team_id: normalizedUuid,
    action_id: normalizedUuid,
    reason: optionalReason,
  })
  .refine((body) => body.from_team_id !== body.to_team_id, {
    path: ['to_team_id'],
    message: 'from and to name the same team — a move changes which roster holds the player',
  })
export type CommishMovePlayerInput = z.infer<typeof commishMovePlayerInputSchema>

/** `POST …/commish/roster` — `commish_force_add_drop(team_id, add, drop,
 *  reason)` (127:244-268's signature, which §15.4:1695 prints as `(...)`).
 *  At least one of `add`/`drop`, and not the same player — 127's own 22023s
 *  (`127:699-707`), mirrored as field errors. */
export const commishForceAddDropInputSchema = z
  .strictObject({
    team_id: normalizedUuid,
    add_player_id: playerId.optional(),
    drop_player_id: playerId.optional(),
    action_id: normalizedUuid,
    reason: optionalReason,
  })
  .refine((body) => body.add_player_id !== undefined || body.drop_player_id !== undefined, {
    path: ['add_player_id'],
    message: 'nothing to do — give a player to add, a player to drop, or both',
  })
  .refine((body) => body.add_player_id === undefined || body.add_player_id !== body.drop_player_id, {
    path: ['drop_player_id'],
    message: 'add and drop name the same player — a move changes the roster',
  })
export type CommishForceAddDropInput = z.infer<typeof commishForceAddDropInputSchema>

/** 127's result document (`127:1464-1520`), returned whole; nothing here
 *  narrows it. `reason` is `string | null` under Q66 (130 §0) — never render
 *  the word "null". */
export interface CommishRosterOverrideResult {
  league_id: string
  verb: 'commish_move_player' | 'commish_force_add_drop'
  action_type: string
  arm: string
  action_id: string
  season: number
  week: number
  week_status: 'upcoming' | 'live' | 'correction_window' | 'final'
  /** The destination on a move; the team on an add/drop. */
  team_id: string
  from_team_id: string | null
  to_team_id: string | null
  player_id: string | null
  add_player_id: string | null
  drop_player_id: string | null
  moved_player_id: string | null
  added_player_id: string | null
  dropped_player_id: string | null
  drop_to_state: string | null
  drop_waivers_until: string | null
  pool_from_state: string | null
  acquisition_type: 'commissioner' | null
  /** A no-op wrote NOTHING and says WHY as a field (§4 rule 15). */
  no_changes: boolean
  no_changes_why: string | null
  /** THE RECEIPT. Null EXACTLY when `no_changes` is true. */
  commissioner_action_id: string | null
  transaction_id: string | null
  /** D353 — every team whose roster this touched. */
  affected_team_ids: string[]
  /** Every rule the override walked past, by name (the game lock a manager
   *  could not have crossed, the caps it neither obeys nor consumes). */
  bypassed: string[]
  drop_game_lock: unknown
  add_game_lock: unknown
  lineups: unknown[]
  vacated_current_slot: unknown
  roster: { roster_size: number; count_after_a: number | null; count_after_b: number | null }
  caps: {
    acquisitions_per_week: string | null
    acquisitions_per_season: string | null
    commissioner_move_not_counted: true
    team_id: string | null
    used_week_before: number | null
    used_season_before: number | null
  }
  score_enqueued: unknown
  score_not_enqueued: unknown
  score_reach_enqueued: unknown
  score_reachable: unknown
  /** TRUE when the roster moved and the SCORE did not (§4 rule 15). The UI
   *  must render this FIRST among the success branches (R971). */
  score_stale: boolean
  score_stale_reason: string | null
  edited_by_commish: boolean
  reason: string | null
  system_post: string | null
  evaluated_at: string
}

/** The slice this layer READS for the identity guard. */
interface ResultShape {
  verb?: unknown
  action_id?: unknown
  player_id?: unknown
  from_team_id?: unknown
  to_team_id?: unknown
  team_id?: unknown
  add_player_id?: unknown
  drop_player_id?: unknown
}

/**
 * POST /api/leagues/[id]/commish/move-player — the audited move of one player
 * from one roster to another (§15.4:1694 → `commish_move_player`).
 *
 * 200 for both a fresh move and a replay of the same submit; the body is
 * 127's document whole.
 */
export async function commishMovePlayer(
  supabase: Supabase,
  leagueId: string,
  rawBody: unknown,
): Promise<ServiceResult> {
  const parsed = commishMovePlayerInputSchema.safeParse(rawBody)
  if (!parsed.success) {
    return { status: 400, body: { error: z.flattenError(parsed.error) as unknown as Json } }
  }
  const { player_id, from_team_id, to_team_id, action_id, reason } = parsed.data

  // §15.4:1694's printed order: (player_id, from, to, reason) + league first,
  // action_id last. An absent reason is OMITTED (typegen: `p_reason?: string`).
  const { data, error } = await supabase.rpc('commish_move_player', {
    p_league_id: leagueId,
    p_player_id: player_id,
    p_from_team_id: from_team_id,
    p_to_team_id: to_team_id,
    ...(reason === undefined ? {} : { p_reason: reason }),
    p_action_id: action_id,
  })
  if (error) {
    return mapInSeasonRpcError(error, COMMISH_ROSTER_FORBIDDEN_MESSAGE)
  }

  // F65(b): identity for a move is (player, from, to) + the verb + the id.
  // 127 echoes the requested ids (`127:1473-1476`), and its replay is keyed on
  // (league_id, action_id) alone and shared with `/commish/roster`.
  const result = (data ?? {}) as ResultShape
  if (
    result.verb !== 'commish_move_player' ||
    result.action_id !== action_id ||
    result.player_id !== player_id ||
    result.from_team_id !== from_team_id ||
    result.to_team_id !== to_team_id
  ) {
    return { status: 409, body: { error: COMMISH_ROSTER_ACTION_ID_REUSED_MESSAGE } }
  }

  return { status: 200, body: data as unknown as Json }
}

/**
 * POST /api/leagues/[id]/commish/roster — the audited force add / drop on one
 * roster (§15.4:1695 → `commish_force_add_drop`).
 */
export async function commishForceAddDrop(
  supabase: Supabase,
  leagueId: string,
  rawBody: unknown,
): Promise<ServiceResult> {
  const parsed = commishForceAddDropInputSchema.safeParse(rawBody)
  if (!parsed.success) {
    return { status: 400, body: { error: z.flattenError(parsed.error) as unknown as Json } }
  }
  const { team_id, add_player_id, drop_player_id, action_id, reason } = parsed.data

  // 127:249's order: (team_id, add, drop, reason) + league first, action_id
  // last. Absent add/drop/reason are OMITTED — each DEFAULTS to NULL.
  const { data, error } = await supabase.rpc('commish_force_add_drop', {
    p_league_id: leagueId,
    p_team_id: team_id,
    ...(add_player_id === undefined ? {} : { p_add: add_player_id }),
    ...(drop_player_id === undefined ? {} : { p_drop: drop_player_id }),
    ...(reason === undefined ? {} : { p_reason: reason }),
    p_action_id: action_id,
  })
  if (error) {
    return mapInSeasonRpcError(error, COMMISH_ROSTER_FORBIDDEN_MESSAGE)
  }

  // F65(b): identity for an add/drop is (team, add, drop) + the verb + the
  // id. 127 echoes `add_player_id`/`drop_player_id` as sent, NULL when absent
  // (`127:1477-1478`), so an absent side compares as null on both ends.
  const result = (data ?? {}) as ResultShape
  if (
    result.verb !== 'commish_force_add_drop' ||
    result.action_id !== action_id ||
    result.team_id !== team_id ||
    (result.add_player_id ?? null) !== (add_player_id ?? null) ||
    (result.drop_player_id ?? null) !== (drop_player_id ?? null)
  ) {
    return { status: 409, body: { error: COMMISH_ROSTER_ACTION_ID_REUSED_MESSAGE } }
  }

  return { status: 200, body: data as unknown as Json }
}

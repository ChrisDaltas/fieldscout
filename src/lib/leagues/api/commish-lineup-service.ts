/**
 * Commissioner lineup override service — M6A task L.E1.2,
 * `POST /api/leagues/[id]/commish/lineup` (spec §15.4:1695, §11.2, §10.3;
 * migration 123's `commish_edit_lineup`; PROGRESS §3 STANDING RULE clauses
 * (b), (e) and (g)).
 *
 * THIS IS NOT `setLineup` WITH A FLAG. `lineup-service.ts` is the MANAGER's
 * door and is not touched by this file: `set_lineup` keeps both of its lock
 * arms (114:449-462, 114:464-476) for every caller, commissioner included.
 * This is the separate, lock-exempt, reason-required, AUDITED verb an
 * exception goes through — the shape §15.4 gives every commissioner override.
 *
 * Same D68/D71 layering as `lineup-service.ts` (extend the pattern, never
 * fork the module): the Route Handler is auth + param plumbing, and
 * everything testable lives here over an INJECTED Supabase client.
 *
 * **The whole verb is the RPC's** (server-authoritative — CLAUDE.md). This
 * layer computes nothing about slots, eligibility, locks, IR or scoring: the
 * bipartite fit (E16), the kickoff reads, the audit row, the `score_fanout`
 * enqueue and the no-op detection are all 123's, inside one transaction under
 * the league row lock.
 *
 * WHAT DIFFERS FROM `setLineup`, on the wire:
 *   - `reason` is REQUIRED, not `.nullish()` — §15.4:1689's header is "all
 *     require `reason`". Requiring it at the Zod layer turns 123's in-body
 *     22023 into a FIELD error the form can route, so the commissioner learns
 *     it before the round trip;
 *   - `team_id` rides the BODY rather than a path segment, because §15.4
 *     addresses this route at the league (`/commish/lineup`), not the team;
 *   - the result carries 123's own keys — `commissioner_action_id`,
 *     `bypassed[]`, `locked_players_moved[]`, `score_stale` — which the UI
 *     needs in order to say what the override actually did.
 *
 * Everything else is deliberately identical: the SQLSTATE mapping is the
 * family's (`inseason-errors.ts`), the refusal text is surfaced VERBATIM
 * (never re-worded — that text is the UX), `normalizedUuid` normalises at the
 * schema (R768) because the F65(b) guard compares against what POSTGRES
 * wrote, and the guard itself is the same shape: 123 replays by
 * `(league_id, action_id)` alone, so a caller who reuses an `action_id` for a
 * different team, week or placement would otherwise get the ORIGINAL document
 * back with no error and a 200 would report a lineup he never set.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { z } from 'zod'

import type { Database, Json } from '@/types/database'

import { mapInSeasonRpcError } from './inseason-errors'
import { normalizedUuid } from './inseason-ids'
import type { ServiceResult } from './leagues-service'
import { placementMatches, type LineupStarter } from './lineup-service'

type Supabase = SupabaseClient<Database>

/** The 42501 arm's copy. 123 raises ONE no-leak 42501 for "nonexistent
 *  league" and "not a commissioner" alike, so this string distinguishes
 *  neither — and it names the manager's own door, which is the useful thing
 *  to say to a manager who reached this route. */
export const COMMISH_LINEUP_FORBIDDEN_MESSAGE =
  'Only this league’s commissioner can use the audited lineup override. A team’s own manager sets its lineup the ordinary way.'

/** The 409 for a REUSED action_id naming a different edit (the F65(b) class). */
export const COMMISH_LINEUP_ACTION_ID_REUSED_MESSAGE =
  'That didn’t go through — we couldn’t confirm it as the lineup you just submitted. Check the lineup and try again.'

const slotKey = z.string().trim().min(1).max(32)
const playerId = z.string().trim().min(1).max(64)

/**
 * The wire body. `slot_map` is the FULL canonical map including IR keys, and
 * an absent IR key is a removal — the same contract `set_lineup` has, because
 * the override writes a BYTE-COMPATIBLE `team_lineups` row (the scoring
 * worker reads `slot_map` and the lock tick walks `starters[]`).
 *
 * `reason` is the one schema difference from `setLineupInputSchema`: REQUIRED
 * here, and bounded at 500 to match both the in-body check and the table
 * CHECK, so an over-long reason is a field error rather than a raise.
 */
export const commishEditLineupInputSchema = z.strictObject({
  team_id: normalizedUuid,
  week: z.number().int().min(1).max(18),
  slot_map: z.record(slotKey, playerId),
  action_id: normalizedUuid,
  reason: z.string().trim().min(1).max(500),
})
export type CommishEditLineupInput = z.infer<typeof commishEditLineupInputSchema>

/** 123's result document — `set_lineup`'s shape plus the override's own
 *  keys. Returned whole; nothing here narrows it. */
export interface CommishEditLineupResult {
  league_id: string
  team_id: string
  season: number
  week: number
  current_week: number
  action_id: string
  lineup_lock: 'per_player_kickoff'
  allow_illegal_lineups: boolean
  /** Chris's one condition, as a field: a no-op wrote NOTHING — no audit row,
   *  no chat post, no enqueue — and says so rather than being inferred. */
  no_changes: boolean
  rearranged: boolean
  moved: Array<{ player_id: string; from: string | null; to: string }>
  slot_map: Record<string, string>
  starters: LineupStarter[]
  bench: string[]
  ir: unknown[]
  ir_moves: { placed: unknown[]; removed: unknown[] }
  flags: {
    illegal: boolean
    bye: unknown[]
    out: unknown[]
    empty: unknown[]
    ir_ineligible: unknown[]
  }
  locked_at: string | null
  edited_by_commish: true
  reason: string
  system_post: string | null
  evaluated_at: string
  week_datum: { first_kickoff_at: string | null; datum_arm: string; kicked_off: boolean }
  current_week_datum: { first_kickoff_at: string | null; datum_arm: string; kicked_off: boolean }
  /** THE RECEIPT. Null EXACTLY when `no_changes` is true — the caller reads
   *  the absence rather than guessing at it. */
  commissioner_action_id: string | null
  week_status: 'upcoming' | 'live' | 'correction_window' | 'final'
  /** Every rule the override walked past, by name: `past_week`,
   *  `closed_week:<status>`, `per_player_kickoff_lock`,
   *  `ir_restricted_stint:<player>`, `ir_lock_timing:<player>`. */
  bypassed: string[]
  /** The kicked-off players this edit moved — the ones a manager could not
   *  have. Each carries the player, the slots and his kickoff. */
  locked_players_moved: Array<{
    player_id: string
    name: string | null
    from: string | null
    to: string | null
    kickoff_at: string | null
    datum_arm: string | null
  }>
  /** The changed starters that now have a claimable `score_fanout` row —
   *  "a row EXISTS for him", not "this call inserted one". */
  score_enqueued: string[]
  /** The changed starters that got NO row, each with the reason
   *  (`no_stat_row` — an absent line scores 0 either way, so no points moved;
   *  `stats_unstamped` — a line exists but carries no `updated_at`, which is
   *  the arm that also sets `score_stale`). An omission is never left to be
   *  inferred from a short `score_enqueued`. */
  score_not_enqueued: Array<{ player_id: string; why: string }>
  /** TRUE when the lineup moved and the SCORE did not — a `final` week, or a
   *  changed starter whose stats could not be queued. The verb never reports
   *  plain success for a write whose score consequence did not happen
   *  (CLAUDE.md: never let "nothing happened" mean "it worked"). The UI must
   *  RENDER this: `saveOutcomeCopy` has the arm. */
  score_stale: boolean
  score_stale_reason: 'week_final' | 'stats_unstamped' | null
}

/** The slice this layer READS for the identity guard. */
interface ResultShape {
  team_id?: unknown
  week?: unknown
  action_id?: unknown
  slot_map?: unknown
  moved?: unknown
}

/**
 * POST /api/leagues/[id]/commish/lineup — the audited commissioner lineup
 * override (§15.4:1695 → `commish_edit_lineup`).
 *
 * 200 for both a fresh edit and a replay of the same submit (the family's
 * replayed-submit convention); the body is 123's document whole.
 */
export async function commishEditLineup(
  supabase: Supabase,
  leagueId: string,
  rawBody: unknown,
): Promise<ServiceResult> {
  const parsed = commishEditLineupInputSchema.safeParse(rawBody)
  if (!parsed.success) {
    return { status: 400, body: { error: z.flattenError(parsed.error) as unknown as Json } }
  }
  const { team_id, week, slot_map, action_id, reason } = parsed.data

  const { data, error } = await supabase.rpc('commish_edit_lineup', {
    p_league_id: leagueId,
    p_team_id: team_id,
    p_week: week,
    p_slot_map: slot_map,
    p_reason: reason,
    p_action_id: action_id,
  })
  if (error) {
    return mapInSeasonRpcError(error, COMMISH_LINEUP_FORBIDDEN_MESSAGE)
  }

  // F65(b): the document that came back must be THIS submit — fresh, or the
  // same submit replayed. 123's replay is keyed on (league_id, action_id)
  // alone, so a reused id returns the ORIGINAL document with no error.
  const result = (data ?? {}) as ResultShape
  if (
    result.team_id !== team_id ||
    result.week !== week ||
    result.action_id !== action_id ||
    !placementMatches(slot_map, result.slot_map, result.moved)
  ) {
    return { status: 409, body: { error: COMMISH_LINEUP_ACTION_ID_REUSED_MESSAGE } }
  }

  return { status: 200, body: data as unknown as Json }
}

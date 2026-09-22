/**
 * Commissioner bracket hand-pick service — M6A task L.E1.16,
 * `POST /api/leagues/[id]/commish/bracket` (spec §11.5 "Bracket is
 * commissioner-editable" → `commish_edit_bracket`, migration 134; PROGRESS
 * F360 (ruled wanted, R1047), D351).
 *
 * `commish-schedule-service.ts` is the template (D351: copied, not
 * re-derived): thin Route Handler, everything testable here over an INJECTED
 * client (D68/D71). The whole verb is the RPC's (server-authoritative —
 * CLAUDE.md): the round's entrant set, the permutation and the bye slots, the
 * seeds that follow their teams, the timing gates it lifts and NAMES in
 * `bypassed[]`, the engine's re-seed it tells to stand down, the receipt
 * and the chat post — all 134's, in one transaction under the league row
 * lock. This layer computes nothing about brackets.
 *
 * A BYE is `away_team_id: null` on the wire (134:§2 (0): a bracket row
 * always has a home side; a bye is the away side absent) — the ONE place a
 * commissioner route sends a null id, and it is sent as `p_away: null`
 * because the RPC has no default for it (typegen prints it optional only
 * because the door declares `DEFAULT NULL`).
 *
 * REASON — OPTIONAL (Q66): `optionalReason`, one shape for every commissioner
 * route. SQLSTATE mapping is the family's (`inseason-errors.ts`); only the
 * 42501 copy is this route's. Refusal text verbatim.
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
 *  a commissioner" alike. */
export const COMMISH_BRACKET_FORBIDDEN_MESSAGE = 'Only this league’s commissioner can hand-pick a playoff matchup.'

/** The 409 for a REUSED action_id naming a different pairing (the F65(b) class). */
export const COMMISH_BRACKET_ACTION_ID_REUSED_MESSAGE =
  'That didn’t go through — we couldn’t confirm it as the playoff matchup you just submitted. Check the bracket and try again.'

/** `POST …/commish/bracket` — `commish_edit_bracket(matchup_id, home, away,
 *  reason)` (134's door, 130:781's argument order). `away_team_id` null = a
 *  bye for `home_team_id`. Home and away naming the same team is 134's own
 *  22023; mirrored here as a field error so the form can route it. */
export const commishEditBracketInputSchema = z
  .strictObject({
    matchup_id: normalizedUuid,
    home_team_id: normalizedUuid,
    away_team_id: normalizedUuid.nullable(),
    action_id: normalizedUuid,
    reason: optionalReason,
  })
  .refine((body) => body.home_team_id !== body.away_team_id, {
    path: ['away_team_id'],
    message: 'home and away name the same team — a matchup needs two (or a bye)',
  })
export type CommishEditBracketInput = z.infer<typeof commishEditBracketInputSchema>

/** One displaced pairing, as 134 reports it (`siblings[]`). */
export interface CommishBracketSibling {
  home_before: string
  away_before: string | null
  home_after: string
  away_after: string | null
  vacated_sides: Array<'home' | 'away'>
  /** Set when the vacated HOME side had nobody to take it and the pairing
   *  became a bye on the home side (134 §2 (13)). */
  bye_normalised?: boolean
}

/** 134's result document, returned whole; nothing here narrows it. */
export interface CommishEditBracketResult {
  league_id: string
  verb: 'commish_edit_bracket'
  action_type: 'edit_bracket'
  action_id: string
  season: number
  round: number
  weeks: [number, number]
  week: number
  /** `{ "<week>": status }` for every week of the round. */
  week_status: Record<string, 'upcoming' | 'live' | 'correction_window' | 'final'>
  matchup_status: string
  round_type: 'playoff'
  /** The round's entrants, seed order. */
  entrants: string[]
  matchup: {
    matchup_id: string
    before: { home_team_id: string; away_team_id: string | null; home_seed: number; away_seed: number | null }
    after: { home_team_id: string; away_team_id: string | null; home_seed: number; away_seed: number | null }
  }
  siblings: CommishBracketSibling[]
  rows_changed: number
  /** Every seeded row of the round carries the mark after a change. */
  rows_marked: number
  no_changes: boolean
  no_changes_why: string | null
  /** THE RECEIPT. Null EXACTLY when `no_changes` is true. */
  commissioner_action_id: string | null
  pairing_set_by_action_id: string | null
  /** Every gate the override walked past, by name — and the stand-down. */
  bypassed: string[]
  bypassed_why: Record<string, string>
  affected_team_ids: string[]
  scoring: unknown
  reason_required: false
  reason: string | null
  system_post: string | null
  evaluated_at: string
}

/** The slice this layer READS for the identity guard. */
interface ResultShape {
  verb?: unknown
  action_id?: unknown
  matchup?: { matchup_id?: unknown; after?: { home_team_id?: unknown; away_team_id?: unknown } }
}

/**
 * POST /api/leagues/[id]/commish/bracket — the audited hand-pick of one
 * playoff pairing (§11.5 → `commish_edit_bracket`).
 *
 * 200 for both a fresh edit and a replay of the same submit; the body is
 * 134's document whole.
 */
export async function commishEditBracket(
  supabase: Supabase,
  leagueId: string,
  rawBody: unknown,
): Promise<ServiceResult> {
  const parsed = commishEditBracketInputSchema.safeParse(rawBody)
  if (!parsed.success) {
    return { status: 400, body: { error: z.flattenError(parsed.error) as unknown as Json } }
  }
  const { matchup_id, home_team_id, away_team_id, action_id, reason } = parsed.data

  // 134's door order: (league, matchup, home, away, reason, action_id). An
  // absent reason is OMITTED (typegen: `p_reason?: string`); a bye is sent as
  // `p_away: null` explicitly — typegen prints `p_away?: string` because the
  // door declares DEFAULT NULL, so the null is what the verb reads as a bye.
  const { data, error } = await supabase.rpc('commish_edit_bracket', {
    p_league_id: leagueId,
    p_matchup_id: matchup_id,
    p_home: home_team_id,
    p_away: away_team_id as unknown as string,
    ...(reason === undefined ? {} : { p_reason: reason }),
    p_action_id: action_id,
  })
  if (error) {
    return mapInSeasonRpcError(error, COMMISH_BRACKET_FORBIDDEN_MESSAGE)
  }

  // F65(b): identity for a hand-pick is (matchup, home, away|null) + the verb
  // + the id. 134 echoes the requested pairing verbatim in `matchup.after`
  // (with the teams' own seeds beside it) and its replay is keyed on
  // (league_id, action_id) alone, so a reused id would otherwise return the
  // FIRST submit's document as a 200 for an edit nobody made. `away` is
  // compared with `===` on purpose: a bye is `null` on both sides.
  const result = (data ?? {}) as ResultShape
  if (
    result.verb !== 'commish_edit_bracket' ||
    result.action_id !== action_id ||
    result.matchup?.matchup_id !== matchup_id ||
    result.matchup?.after?.home_team_id !== home_team_id ||
    result.matchup?.after?.away_team_id !== away_team_id
  ) {
    return { status: 409, body: { error: COMMISH_BRACKET_ACTION_ID_REUSED_MESSAGE } }
  }

  return { status: 200, body: data as unknown as Json }
}

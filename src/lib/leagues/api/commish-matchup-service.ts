/**
 * Commissioner matchup override services — M6A task L.E1.10,
 * `POST /api/leagues/[id]/commish/score` (spec §15.4:1692 →
 * `commish_edit_score`) and `POST /api/leagues/[id]/commish/result`
 * (§15.4:1693 → `commish_set_result`); migration 126; PROGRESS D351.
 *
 * Two routes, ONE verb family, ONE replay namespace (126's
 * `commish_matchup_actions`, D350): both doors wrap
 * `commish_matchup_override_internal` over the same row, so a retry of either
 * replays and an `action_id` spent by one is spent for the other. That is why
 * the F65(b) guard below checks the VERB as well as the matchup — an
 * `action_id` first used on `/commish/result` and re-sent to `/commish/score`
 * would otherwise return the result document as a 200 for a score nobody set.
 *
 * `commish-lineup-service.ts` is the template (D351: copied, not re-derived):
 * the Route Handler is auth + param plumbing; everything testable lives here
 * over an INJECTED Supabase client (D68/D71). The whole verb is the RPC's
 * (server-authoritative — CLAUDE.md): the flag, the result derivation, the
 * FINAL-week rebuild, the freeze report, the audit row and the chat post are
 * all 126's, inside one transaction under the league row lock. This layer
 * computes no score and no result.
 *
 * REASON — OPTIONAL (Q66, ruled by Chris 2026-09-16, spec v2.16.41: "a
 * reason is optional on every commissioner action; the audit row is always
 * written"). The schema is `z.string().trim().max(500).optional()` with
 * blank / whitespace-only normalised to ABSENT (never `''`), so the route
 * never refuses a missing reason at the field level. Do NOT copy
 * `commish-lineup-service.ts:84`'s `.min(1)` — that file carries the OLD
 * contract and is on L.E1.15's list (F362).
 *
 * ⚠ TRANSITIONAL STATE, recorded not hidden: migration 126's in-body gate
 * (`126:720-725`) still REFUSES a blank reason with 22023 by name — its text
 * predates the ruling, and L.E1.15 (the reason-optional sweep, F362) is the
 * task that relaxes it. So today a request with no reason passes this schema,
 * reaches SQL, and comes back as the family mapper's 400 with 126's own
 * message verbatim. Nothing here special-cases that: it is mapped through
 * `mapInSeasonRpcError` like any other refusal, and the stack suite pins it by
 * name so the cell reds — and gets re-cut — when the sweep lands.
 *
 * SQLSTATE mapping is the family's (`inseason-errors.ts`), imported never
 * re-derived; only the 42501 copy is this route's. Refusal text is surfaced
 * VERBATIM (that text is the UX). `normalizedUuid` normalises at the schema
 * (R768) because the guard compares against what POSTGRES wrote.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { z } from 'zod'

import type { Database, Json } from '@/types/database'

import { mapInSeasonRpcError } from './inseason-errors'
import { normalizedUuid } from './inseason-ids'
import type { ServiceResult } from './leagues-service'

type Supabase = SupabaseClient<Database>

/** The 42501 arm's copy. 126 raises ONE no-leak 42501 for "nonexistent
 *  league" and "not a commissioner" alike, so this string distinguishes
 *  neither. */
export const COMMISH_MATCHUP_FORBIDDEN_MESSAGE =
  'Only this league’s commissioner can correct a matchup’s score or result.'

/** The 409 for a REUSED action_id naming a different override (the F65(b)
 *  class) — one string for both doors, since they share one ledger. */
export const COMMISH_MATCHUP_ACTION_ID_REUSED_MESSAGE =
  'That didn’t go through — we couldn’t confirm it as the correction you just submitted. Check the matchup and try again.'

/**
 * Q66's reason: optional, trimmed, bounded at 500 (the league_chat bound and
 * the `commissioner_actions` CHECK 130 §0 re-minted); blank / tab-only
 * normalises to ABSENT so the wire never carries `''`. A non-string (incl.
 * `null`) is a field error — one shape, used by every L.E1.10 schema.
 */
export const optionalReason = z
  .string()
  .trim()
  .max(500)
  .transform((value) => (value === '' ? undefined : value))
  .optional()

/** A fantasy score: any finite number. 126 stores `NUMERIC` unbounded
 *  (109:162) and derives the result from the pair, so the bound is the
 *  verb's to set, not this layer's. */
const score = z.number().finite()

/** `POST …/commish/score` — the SCORE arm: BOTH scores, always (126:766-770,
 *  D342 — `is_overridden` is one flag on the whole row). */
export const commishEditScoreInputSchema = z.strictObject({
  matchup_id: normalizedUuid,
  home_score: score,
  away_score: score,
  action_id: normalizedUuid,
  reason: optionalReason,
})
export type CommishEditScoreInput = z.infer<typeof commishEditScoreInputSchema>

/** `POST …/commish/result` — the RESULT arm: a winner who must be a side of
 *  the row (a tie goes through the score arm with equal scores — F351). */
export const commishSetResultInputSchema = z.strictObject({
  matchup_id: normalizedUuid,
  winner_team_id: normalizedUuid,
  action_id: normalizedUuid,
  reason: optionalReason,
})
export type CommishSetResultInput = z.infer<typeof commishSetResultInputSchema>

/** 126's result document (`126:976-1010`), returned whole; nothing here
 *  narrows it. `reason` is `string | null` — NULL is a stored value under
 *  Q66 (130 §0), never to be rendered as the word "null". */
export interface CommishMatchupOverrideResult {
  league_id: string
  matchup_id: string
  season: number
  week: number
  current_week: number
  round_type: string
  verb: 'commish_edit_score' | 'commish_set_result'
  action_type: 'edit_score' | 'set_result'
  action_id: string
  arm: 'score' | 'result' | 'score+result'
  home_team_id: string
  away_team_id: string | null
  home_score: number | null
  away_score: number | null
  result: 'home' | 'away' | 'tie' | null
  is_overridden: boolean
  override_action_id: string | null
  /** Chris's one condition, as a field: a no-op wrote NOTHING — no audit row,
   *  no chat post, no rebuild — and says so rather than being inferred. */
  no_changes: boolean
  /** THE RECEIPT. Null EXACTLY when `no_changes` is true. */
  commissioner_action_id: string | null
  week_status: 'upcoming' | 'live' | 'correction_window' | 'final'
  matchup_status: string
  /** Every rule the override walked past, by name. */
  bypassed: string[]
  /** D353 — the teams whose numbers this override restated. */
  affected_team_ids: string[]
  /** §4 rule 15: what did (not) follow. A FINAL week rebuilds standings
   *  in-body (D344) and says so; an open week names why it did not. */
  standings_rebuilt: boolean
  standings_not_rebuilt_why: string | null
  standings_rebuild: unknown
  /** Q61 (open): whether live scoring will overwrite this number, said in
   *  the document rather than discovered on the next drain. */
  live_scoring_frozen: boolean
  live_scoring_frozen_why: string | null
  reason: string | null
  system_post: string | null
  evaluated_at: string
}

/** The slice this layer READS for the identity guard. */
interface ResultShape {
  matchup_id?: unknown
  action_id?: unknown
  verb?: unknown
  home_score?: unknown
  away_score?: unknown
  away_team_id?: unknown
  result?: unknown
  home_team_id?: unknown
}

/**
 * POST /api/leagues/[id]/commish/score — the audited score correction
 * (§15.4:1692 → `commish_edit_score(matchup_id, home, away, reason)`).
 *
 * 200 for both a fresh edit and a replay of the same submit (the family's
 * replayed-submit convention); the body is 126's document whole.
 */
export async function commishEditScore(
  supabase: Supabase,
  leagueId: string,
  rawBody: unknown,
): Promise<ServiceResult> {
  const parsed = commishEditScoreInputSchema.safeParse(rawBody)
  if (!parsed.success) {
    return { status: 400, body: { error: z.flattenError(parsed.error) as unknown as Json } }
  }
  const { matchup_id, home_score, away_score, action_id, reason } = parsed.data

  // §15.4:1692's printed order: (matchup_id, home, away, reason) + the two
  // 126 adds (league first, action_id last — 123:1279-1286's posture). An
  // absent reason is OMITTED, not sent as null: the RPC's `p_reason` DEFAULTS
  // to NULL and typegen prints it optional (`p_reason?: string`).
  const { data, error } = await supabase.rpc('commish_edit_score', {
    p_league_id: leagueId,
    p_matchup_id: matchup_id,
    p_home: home_score,
    p_away: away_score,
    ...(reason === undefined ? {} : { p_reason: reason }),
    p_action_id: action_id,
  })
  if (error) {
    return mapInSeasonRpcError(error, COMMISH_MATCHUP_FORBIDDEN_MESSAGE)
  }

  // F65(b): the document that came back must be THIS submit — fresh, or the
  // same submit replayed. 126's replay is keyed on (league_id, action_id)
  // alone and SHARED with `/commish/result`, so a reused id returns the
  // ORIGINAL document (of either verb) with no error. Identity here is the
  // matchup, the verb, and both numbers — `home_score`/`away_score` are what
  // 126 wrote (`v_new_home`/`v_new_away` = p_home/p_away on the score arm,
  // 126:787-789). The away number is compared only when the row HAS an away
  // side: on a BYE row 126 keeps the stored NULL regardless of `p_away`.
  const result = (data ?? {}) as ResultShape
  if (
    result.matchup_id !== matchup_id ||
    result.action_id !== action_id ||
    result.verb !== 'commish_edit_score' ||
    Number(result.home_score) !== home_score ||
    (result.away_team_id !== null && Number(result.away_score) !== away_score)
  ) {
    return { status: 409, body: { error: COMMISH_MATCHUP_ACTION_ID_REUSED_MESSAGE } }
  }

  return { status: 200, body: data as unknown as Json }
}

/**
 * POST /api/leagues/[id]/commish/result — the audited result override
 * (§15.4:1693 → `commish_set_result(matchup_id, winner, reason)`).
 */
export async function commishSetResult(
  supabase: Supabase,
  leagueId: string,
  rawBody: unknown,
): Promise<ServiceResult> {
  const parsed = commishSetResultInputSchema.safeParse(rawBody)
  if (!parsed.success) {
    return { status: 400, body: { error: z.flattenError(parsed.error) as unknown as Json } }
  }
  const { matchup_id, winner_team_id, action_id, reason } = parsed.data

  // §15.4:1693's printed order: (matchup_id, winner, reason).
  const { data, error } = await supabase.rpc('commish_set_result', {
    p_league_id: leagueId,
    p_matchup_id: matchup_id,
    p_winner: winner_team_id,
    ...(reason === undefined ? {} : { p_reason: reason }),
    p_action_id: action_id,
  })
  if (error) {
    return mapInSeasonRpcError(error, COMMISH_MATCHUP_FORBIDDEN_MESSAGE)
  }

  // F65(b), this verb's identity: the matchup, the verb, and the winner —
  // read back through 126's `result` ('home' | 'away', 126:790-791) against
  // the sides the document names, since the verb stores an outcome, not the
  // winner's id.
  const result = (data ?? {}) as ResultShape
  const returnedWinner =
    result.result === 'home' ? result.home_team_id : result.result === 'away' ? result.away_team_id : null
  if (
    result.matchup_id !== matchup_id ||
    result.action_id !== action_id ||
    result.verb !== 'commish_set_result' ||
    returnedWinner !== winner_team_id
  ) {
    return { status: 409, body: { error: COMMISH_MATCHUP_ACTION_ID_REUSED_MESSAGE } }
  }

  return { status: 200, body: data as unknown as Json }
}

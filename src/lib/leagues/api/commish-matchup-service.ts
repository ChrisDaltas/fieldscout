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
 * never refuses a missing reason at the field level. `optionalReason` is
 * THE shape for every commissioner route (the lineup route adopted it in
 * L.E1.15); never `.min(1)`.
 *
 * END-TO-END since migration 131 (L.E1.15, F362): 126's in-body gate is a
 * normalisation, so a no-reason request LANDS with a NULL-reason receipt and
 * a post without a reason clause — the stack suite pins that shape per verb.
 * (Between L.E1.10 and L.E1.15 the gate still refused; that transitional 400
 * was pinned by name and re-cut when the sweep landed.)
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
 *  D342 — `is_overridden` is one flag on the whole row). On a BYE ROW there
 *  is no away side to score: `away_score` is `null` there and is sent as
 *  `p_away: null`, which is what 131:1058-1062 requires (PROGRESS F366 —
 *  before this the arm the verb's own bye refusal points the commissioner
 *  to was unreachable from the route). A bye is SAID (`null`), never
 *  implied by omission — the schema stays strict. */
export const commishEditScoreInputSchema = z.strictObject({
  matchup_id: normalizedUuid,
  home_score: score,
  away_score: score.nullable(),
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
  /** Whether live scoring is now frozen for this row, said in the document
   *  rather than discovered on the next drain. Since Q61's ruling (135) the
   *  verb always sets the flag, so this is never the `not_frozen` arm. */
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
  // `p_away` is sent PRESENT even when null (a bye — F366): the RPC has no
  // default for it, and typegen prints `number` only because 126 declares
  // no DEFAULT; the null is what the verb reads as "no away side".
  const { data, error } = await supabase.rpc('commish_edit_score', {
    p_league_id: leagueId,
    p_matchup_id: matchup_id,
    p_home: home_score,
    p_away: away_score as unknown as number,
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
  // 126:787-789). The away side is compared by SHAPE first (F366): a bye
  // submit (`away_score` null) must come back as a bye document
  // (`away_team_id` null — 131:1058-1062 REFUSES a non-null p_away on a
  // bye, so a bye document for a two-team submit, or the reverse, can only
  // be a replay of another submit), then by number when the row has an
  // away side.
  const result = (data ?? {}) as ResultShape
  const byeSubmit = away_score === null
  if (
    result.matchup_id !== matchup_id ||
    result.action_id !== action_id ||
    result.verb !== 'commish_edit_score' ||
    Number(result.home_score) !== home_score ||
    (result.away_team_id === null) !== byeSubmit ||
    (!byeSubmit && Number(result.away_score) !== away_score)
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

// ---------------------------------------------------------------------------
// Q61, AS RULED (M6A L.E1.18, migration 135; PROGRESS F378): the panel's ONE
// server read of whether this matchup can be corrected yet.
// ---------------------------------------------------------------------------

/** One starter whose NFL game has not finished (135's helper, verbatim). */
export interface CommishMatchupStillPlaying {
  team_id: string
  side: 'home' | 'away'
  slot: string
  player_id: string
  name: string
  nfl_team: string | null
  /** The measured `nfl_games.status` of his open game, or `no_game_rows`
   *  when the week has no game rows at all. */
  game_status: string
  kickoff_at: string | null
}

/**
 * `commish_matchup_edit_lock`'s document (135 §2). `editable` is the SAME
 * evaluation the verbs refuse on (one SQL helper), so the panel can never
 * disagree with the server; `message` is the verb's own refusal sentence,
 * rendered verbatim. ADVISORY: the verb re-decides under the league lock at
 * submit, so a read that goes stale is caught by the refusal.
 */
export interface CommishMatchupEditLock {
  league_id: string
  matchup_id: string
  season: number
  week: number
  editable: boolean
  /** `lineup_not_set` (R1097): outside a final week a side with NO lineup row
   *  is not finished — never read as "no starters". `no_starter_game` (Q67,
   *  migration 142): outside a final week a side whose row holds NO starter
   *  with a game is not finished either — it is a REFUSAL (editable false);
   *  until 142 it read "editable". */
  why: 'week_final' | 'lineup_not_set' | 'starters_not_finished' | 'every_starter_finished' | 'no_starter_game'
  week_status: 'upcoming' | 'live' | 'correction_window' | 'final' | null
  starters: number
  finished: number
  not_finished: number
  still_playing: CommishMatchupStillPlaying[]
  /** The sides with no lineup row for the week (home first); empty unless
   *  `why` is `lineup_not_set`. */
  no_lineup: CommishMatchupNoLineup[]
  /** Q67 (migration 142): the sides whose lineup row exists but holds no
   *  starter with a game (home first); empty in a final week. */
  no_starter_game_sides: CommishMatchupNoLineup[]
  message: string | null
}

/** One side with no stored lineup row for the week (135's helper, verbatim). */
export interface CommishMatchupNoLineup {
  team_id: string
  side: 'home' | 'away'
  team_name: string
}

export const commishMatchupEditLockQuerySchema = z.strictObject({
  matchup_id: normalizedUuid,
})

/**
 * GET /api/leagues/[id]/commish/matchup-lock?matchup_id= — may this matchup's
 * score / result be corrected yet (Q61, ruled per matchup: every starter on
 * both teams has finished his game; a final week always)? Commissioner-only,
 * the verb family's ONE no-leak 403; a matchup that is not this league's is
 * 404. A document that does not answer the question is a 500 — never read
 * as "editable".
 */
export async function readCommishMatchupEditLock(
  supabase: Supabase,
  leagueId: string,
  rawQuery: unknown,
): Promise<ServiceResult> {
  const parsed = commishMatchupEditLockQuerySchema.safeParse(rawQuery)
  if (!parsed.success) {
    return { status: 400, body: { error: z.flattenError(parsed.error) as unknown as Json } }
  }
  const { data, error } = await supabase.rpc('commish_matchup_edit_lock', {
    p_league_id: leagueId,
    p_matchup_id: parsed.data.matchup_id,
  })
  if (error) {
    return mapInSeasonRpcError(error, COMMISH_MATCHUP_FORBIDDEN_MESSAGE)
  }
  const doc = data as { editable?: unknown; matchup_id?: unknown } | null
  if (doc === null || typeof doc.editable !== 'boolean' || doc.matchup_id !== parsed.data.matchup_id) {
    return { status: 500, body: { error: 'The matchup lock read returned no usable answer.' } }
  }
  return { status: 200, body: data as unknown as Json }
}

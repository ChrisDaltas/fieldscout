/**
 * Playoffs service — M4 task L.D5.5, `GET /api/leagues/[id]/playoffs`
 * (spec §11.5's Playoffs bullet, v2.16.25 — Q39 (A)–(E); §16.1's standings
 * page "the 'Playoffs' tab shows the bracket ALL SEASON"; migration 118's
 * `league_playoff_bracket`; PROGRESS D318(6) — the read model; F256(a)/(c)/(g)
 * routed here).
 *
 * The L.D4.1 read-family shape (`standings-service.ts` is the sibling): the
 * RPC is the membership gate (SECURITY DEFINER, in-body `is_league_member`
 * — a non-member is REFUSED with 42501, the family's 403, never handed an
 * empty bracket), its document is passed through WHOLE, and nothing is
 * derived here: no seed, no total, no tiebreak, no instant (CLAUDE.md —
 * server-authoritative; §23.3 / the F226 posture: every instant rendered
 * is stored). The ONE thing this layer does is the F247(b) discipline —
 * the score figures a `numeric` column can render two ways are coerced to
 * a JS number (or kept NULL — E61's pending word is the door's, and a
 * NULL score must reach the UI as NULL, never a plausible 0.00), and a
 * document that cannot be read is refused by name (a 500).
 *
 * What the document says (118 §7/§9, D318(6)):
 *   - `kind`: `bracket` (an h2h league with `playoff_teams ≥ 2`),
 *     `points_race` (a `total_points` league — Q39 (C): the season-long
 *     points race IS its playoff), `no_playoffs` (`playoff_teams = 0` —
 *     Q39 (D)). The last two carry the regular season's instants and the
 *     stored champion only.
 *   - `view`: `projected` while `in_season` and round 1 is not yet written
 *     (`projected_round_1` — "what the bracket would be if the playoffs
 *     started today", seeded from `league_standings_projected`, with
 *     `projection_basis` naming the weeks final / projected / seeded), else
 *     `bracket` (`round_list` — the stored rounds: seeds frozen on the
 *     rows, per-week rows, the two-week totals, `decided_by` ∈ points ·
 *     higher_seed · bye, `final`, `survivors`, `foreign_rows`).
 *   - `rollover_week` / `rollover_at` / `corrections_close_at`: ONE
 *     absolute instant per league (`nfl_weeks.last_game_ends_at` of the
 *     last regular-season week — a `timestamptz`), NULL until ingestion
 *     records it (F238's posture: named, never inferred). The UI renders it
 *     in the viewer's zone — never "midnight" (Q39 (E)).
 *
 * No Date/random read here (the `src/lib/leagues/**` ESLint fences).
 */
import type { SupabaseClient } from '@supabase/supabase-js'

import type { Database, Json } from '@/types/database'

import { mapInSeasonRpcError } from './inseason-errors'
import { INSEASON_LEAGUE_GONE_MESSAGE, INSEASON_READ_FORBIDDEN_MESSAGE } from './inseason-reads'
import type { ServiceResult } from './leagues-service'
import { DECIMAL_FIGURE } from './standings-service'

type Supabase = SupabaseClient<Database>

/** One `league_weeks` row of a round, with the calendar's two instants. */
export interface BracketWeek {
  week: number
  status: string
  rollover_at: string | null
  corrections_close_at: string | null
}

/** One stored `matchups` row of a game (a two-week round has two). A NULL
 *  score is E61's pending word — it stays NULL through this layer. */
export interface BracketGameWeek {
  week: number
  matchup_id: string
  home_score: number | null
  away_score: number | null
  status: string
  result: string | null
  is_overridden: boolean
  /** M6A L.E1.16 (migration 134): the `commissioner_actions` receipt of the
   *  hand-pick that set this round's pairings, NULL when the engine paired
   *  it. Optional for documents read before 134. */
  hand_picked_action_id?: string | null
}

/** One pairing of a round. `away_team_id NULL` is a bye (rider (i)); the
 *  verdict is 118's — (B) the sum over the round's weeks, (A) equal ⇒ the
 *  higher seed, a bye ⇒ the home side. */
export interface BracketGame {
  home_team_id: string
  home_seed: number
  away_team_id: string | null
  away_seed: number | null
  weeks: BracketGameWeek[]
  home_total: number
  away_total: number
  winner_team_id: string
  decided_by: 'points' | 'higher_seed' | 'bye'
  final: boolean
}

export interface BracketSurvivor {
  team_id: string
  seed: number
  line: number
}

export interface BracketRound {
  round: number
  weeks: BracketWeek[]
  rollover_at: string | null
  corrections_close_at: string | null
  rolled: boolean
  built: boolean
  final: boolean
  /** F256(a): "the prior stage is final NOW", not the build's provenance. */
  source: 'provisional' | 'final' | null
  prior_stage_rolled: boolean
  prior_stage_final: boolean
  expected_games: number
  /** A playoff row with NO seed — not the engine's (D318(5)); named, never read. */
  foreign_rows: number
  games: BracketGame[]
  survivors: BracketSurvivor[]
}

/** One projected pairing (`playoff_round_pairs_internal` — `[{home, away}]`,
 *  byes first with `away` null). */
export interface ProjectedPair {
  home: BracketSurvivor
  away: BracketSurvivor | null
}

export interface ProjectionBasis {
  projected: true
  weeks_final: number
  weeks_projected: number
  /** How many seats the projected table could seed (`playoff_teams` when
   *  the projection is built; fewer ⇒ `projected_round_1` is null). */
  seeded: number
  /** `league_standings_projected`'s own reason (`no_final_weeks`) or null. */
  reason: string | null
}

interface PlayoffBracketBase {
  league_id: string
  season: number
  status: string
  schedule_mode: string
  playoff_teams: number
  regular_season: { first_week: number | null; last_week: number | null }
  regular_season_rolled: boolean
  regular_season_final: boolean
  /** The last regular-season week — the ONE instant's week. */
  rollover_week: number | null
  /** `nfl_weeks.last_game_ends_at` of that week — a `timestamptz`, NULL until
   *  ingestion records it (F238). Rendered in the viewer's zone (§16.4). */
  rollover_at: string | null
  corrections_close_at: string | null
  /** `leagues.champion_team_id` — STORED at the `complete` flip (Q39 (D)). */
  champion_team_id: string | null
}

/** Q39 (C)/(D): no bracket — the standings are the playoff. */
export interface PlayoffPointsRace extends PlayoffBracketBase {
  kind: 'points_race' | 'no_playoffs'
  view: 'points_race' | 'no_playoffs'
}

export interface PlayoffBracketDoc extends PlayoffBracketBase {
  kind: 'bracket'
  view: 'projected' | 'bracket'
  bracket_size: number
  rounds: number
  weeks_per_round: number
  reseed: boolean
  playoff_start_week: number
  round_list: BracketRound[]
  /** The first UNBUILT round, or null when every round is written. */
  next_round: number | null
  entrants_next: BracketSurvivor[] | null
  /** Derived by the read from the last round's verdict; equals the stored
   *  column once written (066 J7). */
  bracket_champion_team_id: string | null
  /** While `in_season`: "if the playoffs started today" — null when the
   *  projected table cannot seed `playoff_teams` seats (basis says why). */
  projected_round_1: ProjectedPair[] | null
  projection_basis: ProjectionBasis | null
}

export type PlayoffBracket = PlayoffPointsRace | PlayoffBracketDoc

/** A JSON number, a DECIMAL string, or NULL — and nothing else. The
 *  standings service's `figure` with the NULL arm E61 needs: a bracket
 *  row's score is NULL until the door writes it, and a NULL must stay
 *  NULL (never `Number(null) === 0`). Exported for its pins. */
export function nullableFigure(raw: unknown): number | null {
  if (raw === null || raw === undefined) return null
  if (typeof raw === 'number') return raw
  if (typeof raw === 'string' && DECIMAL_FIGURE.test(raw)) return Number(raw)
  return Number.NaN
}

function requireFigure(raw: unknown, what: string): number {
  const value = nullableFigure(raw)
  if (value === null || !Number.isFinite(value)) {
    throw new Error(`league_playoff_bracket: ${what} is not a finite number (${JSON.stringify(raw)}) — F247(b)`)
  }
  return value
}

/** The per-game figures coerced (F247(b)); everything else passes through
 *  as 118 wrote it. Exported for its pins. */
export function normalizeBracketGame(raw: Record<string, unknown>): BracketGame {
  const weeksRaw = Array.isArray(raw.weeks) ? (raw.weeks as Record<string, unknown>[]) : []
  const weeks: BracketGameWeek[] = weeksRaw.map((w) => {
    const home = nullableFigure(w.home_score)
    const away = nullableFigure(w.away_score)
    for (const [key, value] of [
      ['home_score', home],
      ['away_score', away],
    ] as const) {
      if (value !== null && !Number.isFinite(value)) {
        throw new Error(
          `league_playoff_bracket: ${key} on matchup ${String(w.matchup_id)} is not a finite number (${JSON.stringify(w[key])}) — F247(b)`,
        )
      }
    }
    return { ...(w as unknown as BracketGameWeek), home_score: home, away_score: away }
  })
  return {
    ...(raw as unknown as BracketGame),
    weeks,
    home_total: requireFigure(raw.home_total, `home_total for seed ${String(raw.home_seed)}`),
    away_total: requireFigure(raw.away_total, `away_total for seed ${String(raw.home_seed)}`),
  }
}

/**
 * GET /api/leagues/[id]/playoffs — the bracket document (§11.5 →
 * `league_playoff_bracket`, migration 118).
 */
export async function readPlayoffBracket(supabase: Supabase, leagueId: string): Promise<ServiceResult> {
  const { data, error } = await supabase.rpc('league_playoff_bracket', { p_league_id: leagueId })
  if (error) {
    const mapped = mapInSeasonRpcError(error, INSEASON_READ_FORBIDDEN_MESSAGE)
    // The standings service's F250(a) twin: 118 raises exactly ONE P0002
    // (`playoff_bracket_state_internal: league … not found` — a missing or
    // soft-deleted league) and the family answers that condition with ONE
    // copy, re-worded by STATUS so this file names no SQLSTATE (R812).
    if (mapped.status === 404) {
      return { status: 404, body: { error: INSEASON_LEAGUE_GONE_MESSAGE } }
    }
    return mapped
  }
  const doc = (data ?? null) as Record<string, unknown> | null
  if (!doc || typeof doc !== 'object' || typeof doc.kind !== 'string' || typeof doc.view !== 'string') {
    return { status: 500, body: { error: 'league_playoff_bracket: the RPC returned no bracket document' } }
  }
  if (doc.kind !== 'bracket') {
    return { status: 200, body: doc as unknown as Json }
  }
  if (!Array.isArray(doc.round_list)) {
    return { status: 500, body: { error: 'league_playoff_bracket: a bracket document without a round_list' } }
  }
  try {
    const rounds = (doc.round_list as Record<string, unknown>[]).map((round) => ({
      ...(round as unknown as BracketRound),
      games: (Array.isArray(round.games) ? (round.games as Record<string, unknown>[]) : []).map(normalizeBracketGame),
    }))
    const payload: PlayoffBracketDoc = { ...(doc as unknown as PlayoffBracketDoc), round_list: rounds }
    return { status: 200, body: payload as unknown as Json }
  } catch (cause) {
    return { status: 500, body: { error: (cause as Error).message } }
  }
}

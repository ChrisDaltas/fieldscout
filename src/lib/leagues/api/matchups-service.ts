/**
 * Matchups service — M4 task L.D4.1, `GET /api/leagues/[id]/matchups?week=`
 * (spec §15.3 "matchups + live scores"; §11.4, §12.8 `matchups`, §12.17
 * `league_weeks`, §12.18 `team_week_results`; PROGRESS D92, D296, D298).
 *
 * Same D68/D71 layering as the rest of the family; everything testable lives
 * here over an INJECTED client so the stack suite
 * (`inseason-reads-api-db.test.ts`) drives the production composition across
 * the real PostgREST wire.
 *
 * **`week` is REQUIRED — the spec prints `?week=` and this route reads it
 * literally.** Which week a surface shows by DEFAULT is the surface's call
 * (§16.5.1's "matchup of the week" hero, L.D5.2's matchup view) over the
 * week ladder `use-schedule` already exposes — this route does not infer a
 * "current" week, because §23.3 forbids inferring it from wall-clock math
 * and the only server definition (`lineup_current_week_internal`, 112) is an
 * internal helper deliberately not granted to clients. A missing or
 * malformed week is a 400 with a field error, never a guess.
 *
 * **Reads are RLS-scoped with the user's client (D92)** — `matchups`,
 * `team_week_results` (109) and `league_weeks` (056) are member-SELECT;
 * `teams` is world-readable (001). Membership is asserted FIRST
 * (`inseason-reads.ts`) so a non-member gets the family's no-leak 403 and
 * never an empty week (CLAUDE.md; tasks-M4 §4 rule 10).
 *
 * **What the payload is — the week as the database holds it, nothing
 * computed.** The `league_weeks` row (status — `upcoming` / `live` /
 * `correction_window` / `final` — the "final (pending corrections)" badge's
 * datum, §16.5.4 — plus `median_score`, the rounded store of the exact
 * median 116 compared, and `finalized_at`); every `matchups` row of the week
 * across every `round_type` (`regular`, `secondary` — the second-opponent
 * game 110 materialised, §11.7 — and, once L.D1.8 lands, `playoff`); every
 * `team_week_results` row of the week (the finalized H2H / median / second
 * results, PF counted once — §11.7); and the league's teams for names.
 * Scores ride as the database renders them: a NULL `home_score` /
 * `away_score` is the write door's word for PENDING (E61/F241(a)) and stays
 * `null` on the wire — never coerced to 0.00 (the R788 posture). `result`
 * and `is_overridden` are passed through; the badge lifecycle is the UI's.
 *
 * Loud emptiness (rule 10): a `week` that is not on the league's calendar is
 * a 404 BY NAME (the ladder's bounds are quoted), not an empty week; a
 * transport error is a 500, never an empty list; every read is asserted
 * below the PostgREST cap. An EMPTY `matchups` array for a calendar week is
 * a real state and is labelled with the reason the client can act on:
 * `schedule_mode = 'total_points'` generates no matchup rows at all
 * (§11.7 — the leaderboard variant, §16.5.3), and a playoff week has none
 * until the bracket is generated (L.D1.8). The `league_weeks` row is what
 * proves the week exists either way.
 *
 * No Date/random read anywhere in this file (the `src/lib/leagues/**`
 * ESLint fences) — the week's live/final state is the database's.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { z } from 'zod'

import type { Database, Json } from '@/types/database'

import { assertBelowPostgrestCap, assertLeagueMember } from './inseason-reads'
import type { ServiceResult } from './leagues-service'

type Supabase = SupabaseClient<Database>

/** The query string. `week` arrives as text and is coerced; 1–18 is the NFL
 *  calendar's bound (§12.20), the league's own bounds are the calendar
 *  read's 404. */
export const matchupsQuerySchema = z.strictObject({
  week: z.coerce.number().int().min(1).max(18),
})
export type MatchupsQuery = z.infer<typeof matchupsQuerySchema>

export interface MatchupRow {
  id: string
  season: number
  week: number
  round_type: string
  status: string
  home_team_id: string
  /** NULL = bye (§12.8). */
  away_team_id: string | null
  /** NULL = pending (E61) — never 0.00 by coercion. */
  home_score: number | null
  away_score: number | null
  result: string | null
  is_overridden: boolean
  updated_at: string | null
}

export interface TeamWeekResultRow {
  team_id: string
  points: number
  opponent_team_id: string | null
  h2h_result: string | null
  median_result: string | null
  second_opponent_team_id: string | null
  second_result: string | null
  is_final: boolean
}

export interface WeekMatchups {
  league_id: string
  season: number
  week: number
  /** `h2h` | `total_points` — the leaderboard variant has no matchup rows
   *  (§11.7/§16.5.3). */
  schedule_mode: string
  league_week: {
    status: string
    median_score: number | null
    finalized_at: string | null
  }
  teams: Array<{ id: string; name: string; status: string }>
  matchups: MatchupRow[]
  results: TeamWeekResultRow[]
}

/**
 * GET /api/leagues/[id]/matchups?week= — one week's matchups, scores and
 * results (§15.3).
 */
export async function readMatchups(
  supabase: Supabase,
  leagueId: string,
  rawQuery: unknown,
): Promise<ServiceResult> {
  const parsed = matchupsQuerySchema.safeParse(rawQuery)
  if (!parsed.success) {
    return { status: 400, body: { error: z.flattenError(parsed.error) as unknown as Json } }
  }
  const { week } = parsed.data

  const refused = await assertLeagueMember(supabase, leagueId)
  if (refused) return refused

  const { data: league, error: leagueError } = await supabase
    .from('leagues')
    .select('id, season, settings')
    .eq('id', leagueId)
    .is('deleted_at', null)
    .maybeSingle()
  if (leagueError) return { status: 500, body: { error: `leagues: ${leagueError.message}` } }
  // The gate saw a live row (a soft-deleted league is its 404 by name —
  // R812); empty here means deleted between the two reads: a fault.
  if (!league) {
    return { status: 500, body: { error: 'leagues: the league row read empty after membership passed' } }
  }
  const settings = (league.settings ?? {}) as Record<string, unknown>
  const scheduleMode = typeof settings.schedule_mode === 'string' ? settings.schedule_mode : 'h2h'

  const [weekRes, ladderRes, matchupsRes, resultsRes, teamsRes] = await Promise.all([
    supabase
      .from('league_weeks')
      .select('status, median_score, finalized_at')
      .eq('league_id', leagueId)
      .eq('season', league.season)
      .eq('week', week)
      .maybeSingle(),
    supabase.from('league_weeks').select('week').eq('league_id', leagueId).eq('season', league.season),
    supabase
      .from('matchups')
      .select(
        'id, season, week, round_type, status, home_team_id, away_team_id, home_score, away_score, result, is_overridden, updated_at',
      )
      .eq('league_id', leagueId)
      .eq('season', league.season)
      .eq('week', week)
      .order('round_type', { ascending: true })
      .order('id', { ascending: true }),
    supabase
      .from('team_week_results')
      .select(
        'team_id, points, opponent_team_id, h2h_result, median_result, second_opponent_team_id, second_result, is_final',
      )
      .eq('league_id', leagueId)
      .eq('season', league.season)
      .eq('week', week)
      .order('team_id', { ascending: true }),
    supabase
      .from('teams')
      .select('id, name, status')
      .eq('league_id', leagueId)
      .order('name', { ascending: true })
      .order('id', { ascending: true }),
  ])
  for (const [what, res] of [
    ['league_weeks', weekRes],
    ['league_weeks', ladderRes],
    ['matchups', matchupsRes],
    ['team_week_results', resultsRes],
    ['teams', teamsRes],
  ] as const) {
    if (res.error) return { status: 500, body: { error: `${what}: ${res.error.message}` } }
  }

  // The week must be ON the league's calendar — an absent row is a 404 by
  // name with the ladder's bounds, never an empty week (rule 10).
  if (!weekRes.data) {
    const weeks = (ladderRes.data ?? []).map((r) => r.week)
    const bounds =
      weeks.length > 0 ? `weeks ${Math.min(...weeks)}–${Math.max(...weeks)}` : 'no weeks (no season calendar yet)'
    return {
      status: 404,
      body: { error: `Week ${week} is not on this league’s calendar (season ${league.season}; league_weeks holds ${bounds})` },
    }
  }

  const teams = teamsRes.data ?? []
  const matchups = (matchupsRes.data ?? []) as MatchupRow[]
  const results = (resultsRes.data ?? []) as TeamWeekResultRow[]
  for (const [rows, what] of [
    [teams, 'teams'],
    [matchups, 'matchups'],
    [results, 'team_week_results'],
  ] as const) {
    const capped = assertBelowPostgrestCap(rows, what)
    if (capped) return capped
  }

  const payload: WeekMatchups = {
    league_id: leagueId,
    season: league.season,
    week,
    schedule_mode: scheduleMode,
    league_week: {
      status: weekRes.data.status,
      median_score: weekRes.data.median_score,
      finalized_at: weekRes.data.finalized_at,
    },
    teams,
    matchups,
    results,
  }
  return { status: 200, body: payload as unknown as Json }
}

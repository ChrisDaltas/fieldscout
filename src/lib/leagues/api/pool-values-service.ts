/**
 * GET /api/leagues/[id]/player-values?week=&players= — league-scored values
 * for the players page's browse window (League UX batch 5, Chris
 * 2026-10-03: "points this season, projection this week … using the
 * league's own scoring").
 *
 * **Why a read and not the table.** `league_player_values` (137) holds
 * ROSTERED players only — autopilot's population — so a free agent has no
 * row. This read computes the same numbers for any player in the window,
 * on demand, through the SAME code the hourly job writes with:
 * `computePlayerValue` (the canonical scorer under the league's frozen
 * snapshot, each past week under its own stored rules — 144 / F397) fed by
 * the job's own readers (`readPlayers` / `readWeeklyLines` /
 * `readSeasonLines` / `readOpenedWeekRules`). One engine, one namespace
 * (D33); nothing is written, nothing is stored.
 *
 * Semantics are the job's, field for field: `projected_points` is THIS
 * week's projection line through the league's rules (NULL with
 * `projected_missing` = 'no_line' | 'stale_line' — the freshness bound is
 * read at the TimeProvider's now); `season_points` / `season_games` sum the
 * weeks BEFORE `week` (NULL ⇔ zero games — never a 0.00).
 *
 * Reads are RLS-scoped (D92) behind the membership gate; the week must be
 * on the league's schedule (§23.3 — the calendar decides, nothing is
 * inferred). A broken snapshot is a loud 500, never a quiet empty list.
 */
import { dbFailure } from './db-failure'
import type { SupabaseClient } from '@supabase/supabase-js'
import { z } from 'zod'

import type { Database, Json } from '@/types/database'

import { computePlayerValue } from '../scoring/player-values'
import { readOpenedWeekRules, readPlayers, readSeasonLines, readWeeklyLines } from '../scoring/player-values-job'
import type { ScoringRulesDoc } from '../scoring/rules-doc'
import { assertSnapshotScorable, normalizePosition, weekScoringRules } from '../scoring/score-week-worker'
import type { TimeProvider } from '../time/time-provider'

import { assertLeagueMember } from './inseason-reads'
import type { ServiceResult } from './leagues-service'

type Supabase = SupabaseClient<Database>

/** The players page's browse window (`POOL_WINDOW`) is the most it asks for. */
export const MAX_POOL_VALUE_PLAYERS = 300

export const poolValuesQuerySchema = z.strictObject({
  week: z.coerce.number().int().min(1).max(30),
  players: z
    .string()
    .transform((s) => [...new Set(s.split(',').map((p) => p.trim()).filter((p) => p.length > 0))])
    .pipe(z.array(z.string().max(64)).min(1).max(MAX_POOL_VALUE_PLAYERS)),
})

export interface PoolPlayerValue {
  player_id: string
  projected_points: number | null
  projected_missing: 'no_line' | 'stale_line' | null
  season_points: number | null
  season_games: number
}

export interface PoolValues {
  league_id: string
  season: number
  week: number
  values: PoolPlayerValue[]
  /** Ids asked for that are not players (named, never silently dropped). */
  unknown_players: string[]
}

export async function readPoolValues(supabase: Supabase, leagueId: string, rawQuery: unknown, time: TimeProvider): Promise<ServiceResult> {
  const parsed = poolValuesQuerySchema.safeParse(rawQuery)
  if (!parsed.success) return { status: 400, body: { error: z.flattenError(parsed.error) as unknown as Json } }
  const { week, players: ids } = parsed.data

  const refused = await assertLeagueMember(supabase, leagueId)
  if (refused) return refused

  const { data: league, error: leagueError } = await supabase
    .from('leagues')
    .select('id, season, scoring_rules_snapshot')
    .eq('id', leagueId)
    .is('deleted_at', null)
    .maybeSingle()
  if (leagueError) return dbFailure('leagues', leagueError)
  if (!league) return { status: 500, body: { error: 'leagues: the league row read empty after membership passed' } }

  const weekRes = await supabase.from('league_weeks').select('week').eq('league_id', leagueId).eq('season', league.season).eq('week', week).maybeSingle()
  if (weekRes.error) return dbFailure('league_weeks', weekRes.error)
  if (!weekRes.data) return { status: 404, body: { error: `Week ${week} is not on this league’s schedule.` } }

  let snapshot: ScoringRulesDoc
  const pastWeekRules = new Map<number, ScoringRulesDoc>()
  try {
    const opened = await readOpenedWeekRules(supabase, league.season, [leagueId])
    assertSnapshotScorable(league.scoring_rules_snapshot)
    snapshot = league.scoring_rules_snapshot as unknown as ScoringRulesDoc
    for (const row of opened.get(leagueId) ?? []) pastWeekRules.set(row.week, weekScoringRules(row, null))
  } catch (err) {
    return { status: 500, body: { error: `scoring rules: ${err instanceof Error ? err.message : String(err)}` } }
  }

  let playerRows: Awaited<ReturnType<typeof readPlayers>>
  let lines: Awaited<ReturnType<typeof readWeeklyLines>>
  let seasonLines: Awaited<ReturnType<typeof readSeasonLines>>
  try {
    ;[playerRows, lines, seasonLines] = await Promise.all([
      readPlayers(supabase, ids),
      readWeeklyLines(supabase, league.season, [week], ids),
      readSeasonLines(supabase, league.season, week, ids),
    ])
  } catch (err) {
    return { status: 500, body: { error: err instanceof Error ? err.message : String(err) } }
  }

  const now = time.now()
  const values: PoolPlayerValue[] = []
  const unknown_players: string[] = []
  for (const id of ids) {
    const p = playerRows.get(id)
    if (!p) {
      unknown_players.push(id)
      continue
    }
    const row = computePlayerValue(
      snapshot,
      { league_id: leagueId, season: league.season, week, now },
      {
        player_id: id,
        position: normalizePosition(p.position),
        weekly: lines.get(`${week}:${id}`) ?? null,
        seasonRows: (seasonLines.get(id) ?? []).filter((r) => r.week < week),
        // Preseason is not read by this surface; the job's own input shape.
        preseason: null,
      },
      pastWeekRules,
    )
    values.push({
      player_id: id,
      projected_points: row.projected_points,
      projected_missing: row.projected_missing,
      season_points: row.season_points,
      season_games: row.season_games,
    })
  }
  const body: PoolValues = { league_id: leagueId, season: league.season, week, values, unknown_players }
  return { status: 200, body: body as unknown as Json }
}

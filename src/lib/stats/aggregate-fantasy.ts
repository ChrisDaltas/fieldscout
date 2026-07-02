import {
  calculateFantasyPoints,
  HALF_PPR_SCORING,
  PPR_SCORING,
  STANDARD_SCORING,
  type ScoringRules,
  type StatRow,
} from '@/lib/scoring/default'
import { fetchWeeklyStatsForPlayers } from '@/lib/stats/fetch-weekly-stats'
import type { SupabaseClient } from '@supabase/supabase-js'

export const CURRENT_SEASON = 2026
export const LAST_SEASON = 2025
export const ASSUMED_TOTAL_GAMES = 17

const STATS_SELECT =
  'player_id, season, week, source, ' +
  'pass_attempts, pass_completions, pass_yards, pass_tds, interceptions, sacks_taken, ' +
  'rush_attempts, rush_yards, rush_tds, fumbles_lost, ' +
  'targets, receptions, receiving_yards, receiving_tds, ' +
  'fg_made, fg_attempted, fg_made_40_plus, fg_made_50_plus, xp_made, xp_attempted, ' +
  'def_sacks, def_interceptions, def_fumble_recoveries, def_tds, def_safeties, ' +
  'two_point_conversions'

export type ScoringKey = 'ppr' | 'standard' | 'half_ppr'

export const SCORING_BY_KEY: Record<ScoringKey, ScoringRules> = {
  ppr: PPR_SCORING,
  standard: STANDARD_SCORING,
  half_ppr: HALF_PPR_SCORING,
}

const PROJECTION_COLUMN_BY_KEY: Record<ScoringKey, string> = {
  ppr: 'projected_pts_ppr',
  standard: 'projected_pts_standard',
  half_ppr: 'projected_pts_half_ppr',
}

export interface FantasyStatsForPlayer {
  current_pts: number
  current_games: number
  last_pts: number
  last_games: number
  /**
   * Pre-season: real Sleeper projection for the chosen scoring variant
   * (`null` if Sleeper has no projection for that player). In-season:
   * extrapolated from live (non-mock) current-season games.
   *
   * NOT a fallback to last_pts. A projection is by definition forward-
   * looking — last season's actual results are not a projection. If we
   * don't have one we surface `null` so the UI can show "—".
   */
  projected_pts: number | null
}

type Accumulator = Record<string, number> & { __games?: number }

function add(acc: Accumulator, row: Record<string, unknown>) {
  for (const [k, v] of Object.entries(row)) {
    if (k === 'player_id' || k === 'season' || k === 'week' || k === 'source') continue
    acc[k] = (acc[k] ?? 0) + Number(v ?? 0)
  }
  acc.__games = (acc.__games ?? 0) + 1
}

/**
 * Read the players' stored Sleeper projections for the chosen scoring
 * variant. Chunked by id to dodge PostgREST's 1000-row cap (same trap as
 * fetchWeeklyStatsForPlayers).
 */
async function fetchStoredProjections(
  supabase: SupabaseClient,
  playerIds: string[],
  scoring: ScoringKey,
): Promise<Map<string, number | null>> {
  const out = new Map<string, number | null>()
  if (playerIds.length === 0) return out
  const col = PROJECTION_COLUMN_BY_KEY[scoring]
  const CHUNK = 200
  const chunks: string[][] = []
  for (let i = 0; i < playerIds.length; i += CHUNK) {
    chunks.push(playerIds.slice(i, i + CHUNK))
  }
  const results = await Promise.all(
    chunks.map(async (chunk) => {
      const { data, error } = await supabase
        .from('players')
        .select(`id, ${col}` as string)
        .in('id', chunk)
      if (error) throw new Error(error.message)
      return (data ?? []) as unknown as Array<Record<string, unknown>>
    }),
  )
  for (const rows of results) {
    for (const row of rows) {
      const id = row.id as string
      const raw = row[col]
      const num = raw === null || raw === undefined ? null : Number(raw)
      out.set(id, Number.isFinite(num as number) ? (num as number) : null)
    }
  }
  return out
}

/**
 * Pulls weekly stat rows for the given players across the current and last
 * season and returns a map of fantasy-point summaries keyed by player_id.
 *
 * Projection rule (do not undo this without reading the comment on
 * `projected_pts` above):
 *   - If we have real (non-mock) current-season games → extrapolate live pace.
 *   - Else → use the stored Sleeper pre-season projection.
 *   - If neither exists → projection is null. We do NOT substitute last
 *     season's actual points. "Projection equals last year's results" is a
 *     bug we've already been bitten by once.
 */
export async function aggregateFantasyStats(
  supabase: SupabaseClient,
  playerIds: string[],
  scoring: ScoringKey = 'ppr',
): Promise<Map<string, FantasyStatsForPlayer>> {
  const result = new Map<string, FantasyStatsForPlayer>()
  if (playerIds.length === 0) return result

  const rules = SCORING_BY_KEY[scoring]
  const [data, storedProjections] = await Promise.all([
    fetchWeeklyStatsForPlayers<Record<string, unknown>>({
      supabase,
      playerIds,
      seasons: [CURRENT_SEASON, LAST_SEASON],
      select: STATS_SELECT,
    }),
    fetchStoredProjections(supabase, playerIds, scoring),
  ])

  const currentByPlayer = new Map<string, Accumulator>()
  const currentLiveByPlayer = new Map<string, Accumulator>()
  const lastByPlayer = new Map<string, Accumulator>()

  for (const row of data) {
    const pid = row.player_id as string
    const isMock = row.source === 'mock'

    if (row.season === CURRENT_SEASON) {
      let acc = currentByPlayer.get(pid)
      if (!acc) {
        acc = {}
        currentByPlayer.set(pid, acc)
      }
      add(acc, row)

      if (!isMock) {
        let liveAcc = currentLiveByPlayer.get(pid)
        if (!liveAcc) {
          liveAcc = {}
          currentLiveByPlayer.set(pid, liveAcc)
        }
        add(liveAcc, row)
      }
    } else {
      let acc = lastByPlayer.get(pid)
      if (!acc) {
        acc = {}
        lastByPlayer.set(pid, acc)
      }
      add(acc, row)
    }
  }

  for (const id of playerIds) {
    const currentAcc = currentByPlayer.get(id) ?? {}
    const liveAcc = currentLiveByPlayer.get(id) ?? {}
    const lastAcc = lastByPlayer.get(id) ?? {}
    const liveGames = liveAcc.__games ?? 0

    const currentPts = calculateFantasyPoints(currentAcc as StatRow, rules)
    const livePts = calculateFantasyPoints(liveAcc as StatRow, rules)
    const lastPts = calculateFantasyPoints(lastAcc as StatRow, rules)

    let projectedPts: number | null
    if (liveGames > 0) {
      const perGame = livePts / liveGames
      projectedPts =
        Math.round(
          (livePts + perGame * Math.max(0, ASSUMED_TOTAL_GAMES - liveGames)) * 10,
        ) / 10
    } else {
      const stored = storedProjections.get(id)
      projectedPts = typeof stored === 'number' ? Math.round(stored * 10) / 10 : null
    }

    result.set(id, {
      current_pts: Math.round(currentPts * 10) / 10,
      current_games: currentAcc.__games ?? 0,
      last_pts: Math.round(lastPts * 10) / 10,
      last_games: lastAcc.__games ?? 0,
      projected_pts: projectedPts,
    })
  }

  return result
}

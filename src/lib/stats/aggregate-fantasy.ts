import { PRESET_BY_BUILDER_KEY, PRESET_LINE_SELECT, presetLines, presetSeasonDisplay } from '@/lib/players/preset-scoring'
import { fetchWeeklyStatsForPlayers } from '@/lib/stats/fetch-weekly-stats'
import { ASSUMED_TOTAL_GAMES, CURRENT_SEASON, LAST_SEASON } from '@/lib/stats/seasons'
import type { SupabaseClient } from '@supabase/supabase-js'

export type ScoringKey = 'ppr' | 'standard' | 'half_ppr'

const PROJECTION_COLUMN_BY_KEY: Record<ScoringKey, string> = {
  ppr: 'projected_pts_ppr',
  standard: 'projected_pts_standard',
  half_ppr: 'projected_pts_half_ppr',
}

export interface FantasyStatsForPlayer {
  /** Null: a K or D/ST with no scored game (a dash, never a 0). The games
   *  counts are scored games only: a refused game is not a game. */
  current_pts: number | null
  current_games: number
  last_pts: number | null
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

/**
 * Read each player's position (the scorer needs it) and stored Sleeper
 * projection for the chosen scoring variant, in one read. Chunked by id to
 * dodge PostgREST's 1000-row cap (same trap as fetchWeeklyStatsForPlayers).
 */
async function fetchPlayerFacts(
  supabase: SupabaseClient,
  playerIds: string[],
  scoring: ScoringKey,
): Promise<Map<string, { position: string | null; projection: number | null }>> {
  const out = new Map<string, { position: string | null; projection: number | null }>()
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
        .select(`id, position, ${col}` as string)
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
      out.set(id, {
        position: typeof row.position === 'string' ? row.position : null,
        projection: Number.isFinite(num as number) ? (num as number) : null,
      })
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

  const preset = PRESET_BY_BUILDER_KEY[scoring]
  const [data, facts] = await Promise.all([
    fetchWeeklyStatsForPlayers<Record<string, unknown>>({
      supabase,
      playerIds,
      seasons: [CURRENT_SEASON, LAST_SEASON],
      select: PRESET_LINE_SELECT,
    }),
    fetchPlayerFacts(supabase, playerIds, scoring),
  ])

  // Each game is scored alone (a K or D/ST can't be scored from a sum), so the
  // rows stay per bucket. Mock rows count toward "current" but never toward
  // the live pace.
  const currentByPlayer = new Map<string, Record<string, unknown>[]>()
  const currentLiveByPlayer = new Map<string, Record<string, unknown>[]>()
  const lastByPlayer = new Map<string, Record<string, unknown>[]>()
  const push = (bucket: Map<string, Record<string, unknown>[]>, id: string, row: Record<string, unknown>) => {
    const list = bucket.get(id)
    if (list) list.push(row)
    else bucket.set(id, [row])
  }

  for (const row of data) {
    const pid = row.player_id as string
    if (row.season === CURRENT_SEASON) {
      push(currentByPlayer, pid, row)
      if (row.source !== 'mock') push(currentLiveByPlayer, pid, row)
    } else {
      push(lastByPlayer, pid, row)
    }
  }

  for (const id of playerIds) {
    const stored = currentByPlayer.get(id) ?? []
    const storedLast = lastByPlayer.get(id) ?? []
    const position = facts.get(id)?.position ?? ''
    // A position is what picks the scoring. Rows with none can't be scored, and
    // a list route catches this rather than showing a plausible 0.
    if (position === '' && (stored.length > 0 || storedLast.length > 0)) {
      throw new Error(`aggregateFantasyStats: player ${id} has stat rows but no position`)
    }

    // Refused games leave here, so every count below means scored games.
    const current = presetLines(position, stored)
    const live = presetLines(position, currentLiveByPlayer.get(id) ?? [])
    const last = presetLines(position, storedLast)
    const liveGames = live.length

    let projectedPts: number | null
    if (liveGames > 0) {
      const livePts = presetSeasonDisplay(preset, position, live) ?? 0
      const perGame = livePts / liveGames
      projectedPts =
        Math.round(
          (livePts + perGame * Math.max(0, ASSUMED_TOTAL_GAMES - liveGames)) * 10,
        ) / 10
    } else {
      const projection = facts.get(id)?.projection
      projectedPts = typeof projection === 'number' ? Math.round(projection * 10) / 10 : null
    }

    result.set(id, {
      current_pts: presetSeasonDisplay(preset, position, current),
      current_games: current.length,
      last_pts: presetSeasonDisplay(preset, position, last),
      last_games: last.length,
      projected_pts: projectedPts,
    })
  }

  return result
}

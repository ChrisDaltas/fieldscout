import { NextResponse } from 'next/server'

import {
  isOffensePosition,
  PRESET_LINE_SELECT,
  presetGamePoints,
  presetLines,
  presetSeasonDisplay,
  presetTotalsPoints,
  roundOneDecimal,
  type PresetSystem,
} from '@/lib/players/preset-scoring'
import { sumStatRows, type StatRow } from '@/lib/scoring/default'
import { ASSUMED_TOTAL_GAMES, CURRENT_SEASON, LAST_SEASON } from '@/lib/stats/seasons'
import { createServerClient } from '@/lib/supabase/server'

interface RouteParams {
  params: Promise<{ id: string }>
}

interface WeeklyStat extends StatRow {
  week: number | null
  season: number
  source: string | null
  is_live: boolean | null
}

/** A stored projection total, to 1 dp, or null when there is none. */
function storedPoints(value: number | null | undefined): number | null {
  if (value === null || value === undefined) return null
  const n = Number(value)
  return Number.isFinite(n) ? roundOneDecimal(n) : null
}

export async function GET(_request: Request, { params }: RouteParams) {
  const { id } = await params
  const supabase = await createServerClient()

  const { data: player, error: playerError } = await supabase
    .from('players')
    .select(
      'id, full_name, first_name, last_name, position, team, headshot_url, status, jersey_number, height, weight, birth_date, college, experience_years, bye_week, draft_year, draft_round, draft_pick, adp, sos, auction_value, projected_pts_ppr, projected_pts_standard, projected_pts_half_ppr, projected_stats, injury_body_part, injury_notes, injury_start_date, practice_participation',
    )
    .eq('id', id)
    .maybeSingle()

  if (playerError) {
    return NextResponse.json({ error: playerError.message }, { status: 500 })
  }
  if (!player) {
    return NextResponse.json({ error: 'Player not found' }, { status: 404 })
  }

  // No positional rank pre-season: rank on a board is an opinion; an
  // OBJECTIVE rank only exists once real points are scored. When the season
  // is live this can return, computed from actual fantasy points.
  const { data: rows, error: statsError } = await supabase
    .from('player_stats')
    .select(`${PRESET_LINE_SELECT}, is_live`)
    .eq('player_id', id)
    .in('season', [CURRENT_SEASON, LAST_SEASON])
    .order('season', { ascending: false })
    .order('week', { ascending: true, nullsFirst: false })

  if (statsError) {
    return NextResponse.json({ error: statsError.message }, { status: 500 })
  }

  const position = player.position
  const all = (rows ?? []) as unknown as WeeklyStat[]
  const currentRows = all.filter((r) => r.season === CURRENT_SEASON && r.week != null)
  // A refused game is not a game (K0): it adds no points, no totals and no
  // count. Every count and sum below reads these prepared lines; only the game
  // log keeps the refused row, as a dash.
  const currentWeekly = presetLines(position, currentRows)
  // Live (non-mock) rows are the only honest signal for projecting current
  // season totals — mock data is starter-level numbers for every player.
  const currentLiveWeekly = currentWeekly.filter((r) => r.source !== 'mock')
  const lastWeekly = presetLines(
    position,
    all.filter((r) => r.season === LAST_SEASON && r.week != null),
  )

  const currentTotals = sumStatRows(currentWeekly)
  const liveTotals = sumStatRows(currentLiveWeekly)
  const lastTotals = sumStatRows(lastWeekly)

  const gamesPlayed = currentWeekly.length
  const liveGames = currentLiveWeekly.length
  const remainingGames = Math.max(0, ASSUMED_TOTAL_GAMES - liveGames)

  const seasonFantasy = (lines: readonly object[]) => ({
    ppr: presetSeasonDisplay('ppr', position, lines),
    standard: presetSeasonDisplay('espn_standard', position, lines),
  })
  const currentFantasy = seasonFantasy(currentWeekly)
  const lastFantasy = seasonFantasy(lastWeekly)

  // Real projected stat line synced from Sleeper (sync-projections.ts), the
  // honest pre-season basis for the NFL view and for offense points.
  // Empty {} lines don't count: fall back to last season rather than
  // rendering a blank projection.
  const sleeperProjection =
    player.projected_stats &&
    typeof player.projected_stats === 'object' &&
    Object.keys(player.projected_stats).length > 0
      ? (player.projected_stats as StatRow)
      : null

  // Sleeper's own totals. A K or D/ST reads these pre-season, as the Stats
  // Center does: ESPN's table can't be computed from a season line, which has
  // no short field goals and no points allowed.
  const storedProjection = {
    ppr: storedPoints(player.projected_pts_ppr),
    standard: storedPoints(player.projected_pts_standard),
  }
  const offense = isOffensePosition(position)
  const hasStoredProjection = storedProjection.ppr !== null || storedProjection.standard !== null

  // Scored live games pick the basis. A season whose every game was refused
  // falls through to the stored projection, exactly as the Stats Center does.
  const basis =
    liveGames > 0
      ? 'pace'
      : sleeperProjection || (!offense && hasStoredProjection)
        ? 'projections'
        : 'last_season'

  // Projection: pace × remaining games when real games exist; otherwise the
  // synced projected stat line; last-season totals only as a final fallback.
  const projection: StatRow = (() => {
    if (liveGames === 0) {
      return sleeperProjection ? { ...sleeperProjection } : { ...lastTotals }
    }
    const proj: Record<string, number> = {}
    for (const [k, v] of Object.entries(liveTotals)) {
      const total = Number(v ?? 0)
      const perGame = total / liveGames
      proj[k] = Math.round(total + perGame * remainingGames)
    }
    return proj as StatRow
  })()

  // Offense scores the projected stat line (each stat paced, then rounded). A K
  // or D/ST can't score a summed line, so its pace is its points per scored game.
  const projectionFantasy = (() => {
    if (basis === 'last_season') return lastFantasy
    if (offense) {
      return {
        ppr: presetTotalsPoints('ppr', position, projection),
        standard: presetTotalsPoints('espn_standard', position, projection),
      }
    }
    if (basis === 'projections') return storedProjection
    const paced = (points: number | null) =>
      points === null ? null : roundOneDecimal(points + (points / liveGames) * remainingGames)
    const live = seasonFantasy(currentLiveWeekly)
    return { ppr: paced(live.ppr), standard: paced(live.standard) }
  })()

  /** One game at 1 dp (the route's contract), or null when it can't be scored. */
  const gameFantasy = (system: PresetSystem, row: WeeklyStat) => {
    const points = presetGamePoints(system, position, row)
    return points === null ? null : roundOneDecimal(points)
  }

  return NextResponse.json({
    player,
    seasons: {
      current: {
        season: CURRENT_SEASON,
        gamesPlayed,
        totals: currentTotals,
        fantasy: currentFantasy,
      },
      last: {
        season: LAST_SEASON,
        gamesPlayed: lastWeekly.length,
        totals: lastTotals,
        fantasy: lastFantasy,
      },
      projection: {
        season: CURRENT_SEASON,
        basis,
        totals: projection,
        fantasy: projectionFantasy,
      },
    },
    gameLog: currentRows.map((row) => ({
      week: row.week,
      source: row.source,
      is_live: row.is_live,
      stats: row,
      fantasy: {
        ppr: gameFantasy('ppr', row),
        standard: gameFantasy('espn_standard', row),
      },
    })),
  })
}

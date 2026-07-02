import { NextResponse } from 'next/server'

import {
  calculateFantasyPoints,
  PPR_SCORING,
  STANDARD_SCORING,
  sumStatRows,
  type StatRow,
} from '@/lib/scoring/default'
import { createServerClient } from '@/lib/supabase/server'

const CURRENT_SEASON = 2026
const LAST_SEASON = 2025

interface RouteParams {
  params: Promise<{ id: string }>
}

interface WeeklyStat extends StatRow {
  week: number | null
  season: number
  source: string | null
  is_live: boolean | null
}

const SELECT_COLS =
  'season, week, source, is_live, ' +
  'pass_attempts, pass_completions, pass_yards, pass_tds, interceptions, sacks_taken, ' +
  'rush_attempts, rush_yards, rush_tds, fumbles_lost, ' +
  'targets, receptions, receiving_yards, receiving_tds, ' +
  'fg_made, fg_attempted, fg_made_40_plus, fg_made_50_plus, xp_made, xp_attempted, ' +
  'def_sacks, def_interceptions, def_fumble_recoveries, def_tds, def_safeties, ' +
  'two_point_conversions'

export async function GET(_request: Request, { params }: RouteParams) {
  const { id } = await params
  const supabase = await createServerClient()

  const { data: player, error: playerError } = await supabase
    .from('players')
    .select(
      'id, full_name, first_name, last_name, position, team, headshot_url, status, jersey_number, height, weight, birth_date, college, experience_years, bye_week, draft_year, draft_round, draft_pick, adp',
    )
    .eq('id', id)
    .maybeSingle()

  if (playerError) {
    return NextResponse.json({ error: playerError.message }, { status: 500 })
  }
  if (!player) {
    return NextResponse.json({ error: 'Player not found' }, { status: 404 })
  }

  const { data: rows, error: statsError } = await supabase
    .from('player_stats')
    .select(SELECT_COLS)
    .eq('player_id', id)
    .in('season', [CURRENT_SEASON, LAST_SEASON])
    .order('season', { ascending: false })
    .order('week', { ascending: true, nullsFirst: false })

  if (statsError) {
    return NextResponse.json({ error: statsError.message }, { status: 500 })
  }

  const all = (rows ?? []) as unknown as WeeklyStat[]
  const currentWeekly = all.filter((r) => r.season === CURRENT_SEASON && r.week != null)
  // Live (non-mock) rows are the only honest signal for projecting current
  // season totals — mock data is starter-level numbers for every player.
  const currentLiveWeekly = currentWeekly.filter((r) => r.source !== 'mock')
  const lastWeekly = all.filter((r) => r.season === LAST_SEASON && r.week != null)

  const currentTotals = sumStatRows(currentWeekly)
  const liveTotals = sumStatRows(currentLiveWeekly)
  const lastTotals = sumStatRows(lastWeekly)

  const gamesPlayed = currentWeekly.length
  const liveGames = currentLiveWeekly.length
  const remainingGames = Math.max(0, 17 - liveGames)

  // Projection: pace × remaining games when real games exist; otherwise the
  // player's full last-season total stands in for the baseline.
  const projection: StatRow = (() => {
    if (liveGames === 0) {
      return { ...lastTotals }
    }
    const proj: Record<string, number> = {}
    for (const [k, v] of Object.entries(liveTotals)) {
      const total = Number(v ?? 0)
      const perGame = total / liveGames
      proj[k] = Math.round(total + perGame * remainingGames)
    }
    return proj as StatRow
  })()

  return NextResponse.json({
    player,
    seasons: {
      current: {
        season: CURRENT_SEASON,
        gamesPlayed,
        totals: currentTotals,
        fantasy: {
          ppr: calculateFantasyPoints(currentTotals, PPR_SCORING),
          standard: calculateFantasyPoints(currentTotals, STANDARD_SCORING),
        },
      },
      last: {
        season: LAST_SEASON,
        gamesPlayed: lastWeekly.length,
        totals: lastTotals,
        fantasy: {
          ppr: calculateFantasyPoints(lastTotals, PPR_SCORING),
          standard: calculateFantasyPoints(lastTotals, STANDARD_SCORING),
        },
      },
      projection: {
        season: CURRENT_SEASON,
        basis: liveGames === 0 ? 'last_season' : 'pace',
        totals: projection,
        fantasy: {
          ppr: calculateFantasyPoints(projection, PPR_SCORING),
          standard: calculateFantasyPoints(projection, STANDARD_SCORING),
        },
      },
    },
    gameLog: currentWeekly.map((row) => ({
      week: row.week,
      source: row.source,
      is_live: row.is_live,
      stats: row,
      fantasy: {
        ppr: calculateFantasyPoints(row, PPR_SCORING),
        standard: calculateFantasyPoints(row, STANDARD_SCORING),
      },
    })),
  })
}

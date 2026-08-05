import { NextResponse } from 'next/server'
import { z } from 'zod'

import {
  calculateFantasyPoints,
  PPR_SCORING,
  STANDARD_SCORING,
  HALF_PPR_SCORING,
  type StatRow,
} from '@/lib/scoring/default'
import { fetchWeeklyStatsForPlayers } from '@/lib/stats/fetch-weekly-stats'
import { createServerClient } from '@/lib/supabase/server'

const CURRENT_SEASON = 2026
const LAST_SEASON = 2025
const ASSUMED_TOTAL_GAMES = 17

const querySchema = z.object({
  positions: z
    .string()
    .optional()
    .transform((v) =>
      v
        ? v
            .split(',')
            .map((s) => s.trim().toUpperCase())
            .filter(Boolean)
        : undefined,
    ),
  teams: z
    .string()
    .optional()
    .transform((v) =>
      v
        ? v
            .split(',')
            .map((s) => s.trim().toUpperCase())
            .filter(Boolean)
        : undefined,
    ),
  scoring: z.enum(['ppr', 'standard', 'half_ppr']).default('ppr'),
  limit: z.coerce.number().int().min(1).max(1500).default(400),
})

const STATS_SELECT =
  'player_id, season, week, source, ' +
  'pass_attempts, pass_completions, pass_yards, pass_tds, interceptions, sacks_taken, ' +
  'rush_attempts, rush_yards, rush_tds, fumbles_lost, ' +
  'targets, receptions, receiving_yards, receiving_tds, ' +
  'fg_made, fg_attempted, fg_made_40_plus, fg_made_50_plus, xp_made, xp_attempted, ' +
  'def_sacks, def_interceptions, def_fumble_recoveries, def_tds, def_safeties, ' +
  'two_point_conversions'

const SCORING_BY_KEY = {
  ppr: PPR_SCORING,
  standard: STANDARD_SCORING,
  half_ppr: HALF_PPR_SCORING,
} as const

type SumAccumulator = Record<string, number> & {
  __games?: number
}

function addRowToAccumulator(acc: SumAccumulator, row: Record<string, unknown>) {
  for (const [k, v] of Object.entries(row)) {
    if (k === 'player_id' || k === 'season' || k === 'week') continue
    acc[k] = (acc[k] ?? 0) + Number(v ?? 0)
  }
  acc.__games = (acc.__games ?? 0) + 1
}

function stripMeta(acc: SumAccumulator): Record<string, number> {
  const out: Record<string, number> = {}
  for (const [k, v] of Object.entries(acc)) {
    if (k === '__games') continue
    out[k] = Number(v ?? 0)
  }
  return out
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const parsed = querySchema.safeParse({
    positions: searchParams.get('positions') ?? undefined,
    teams: searchParams.get('teams') ?? undefined,
    scoring: searchParams.get('scoring') ?? undefined,
    limit: searchParams.get('limit') ?? undefined,
  })
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 })
  }
  const { positions, teams, scoring, limit } = parsed.data
  const rules = SCORING_BY_KEY[scoring]

  const supabase = await createServerClient()

  const projectionColumn =
    scoring === 'standard'
      ? 'projected_pts_standard'
      : scoring === 'half_ppr'
        ? 'projected_pts_half_ppr'
        : 'projected_pts_ppr'

  let playerQuery = supabase
    .from('players')
    .select(
      `id, full_name, position, team, headshot_url, status, depth_chart_order, depth_chart_position, ${projectionColumn}`,
    )
    // Filter out retirees / free agents — Sleeper still flags these as
    // active=true, so the reliable signal is having a current team.
    .not('team', 'is', null)
    // Order by relevance BEFORE the limit truncates: the pool is ~1000+
    // players, so an alphabetical fetch order silently drops anyone whose
    // first name sorts past `limit` (Justin Herbert et al.) no matter how
    // good they are. ADP breaks ties among the projection-less tail.
    .order(projectionColumn, { ascending: false, nullsFirst: false })
    .order('adp', { ascending: true, nullsFirst: false })
    .order('full_name', { ascending: true })
    .limit(limit)

  const positionList =
    positions && positions.length > 0 ? positions : ['QB', 'RB', 'WR', 'TE', 'K', 'DEF']
  playerQuery = playerQuery.in('position', positionList)
  if (teams && teams.length > 0) playerQuery = playerQuery.in('team', teams)

  const { data: players, error: playersError } = await playerQuery
  if (playersError) {
    return NextResponse.json({ error: playersError.message }, { status: 500 })
  }
  if (!players || players.length === 0) {
    return NextResponse.json({ players: [] })
  }

  const playerIds = players.map((p) => p.id as string)

  let stats: Record<string, unknown>[]
  try {
    stats = await fetchWeeklyStatsForPlayers<Record<string, unknown>>({
      supabase,
      playerIds,
      seasons: [CURRENT_SEASON, LAST_SEASON],
      select: STATS_SELECT,
    })
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to load stats' },
      { status: 500 },
    )
  }

  // Track current-season totals two ways: all rows (used for the displayed
  // "current_pts" so the modal preview still works) and live-only rows
  // (excludes mock data — used for projection extrapolation so we don't
  // amplify fake numbers into absurd full-season projections).
  const currentByPlayer = new Map<string, SumAccumulator>()
  const currentLiveByPlayer = new Map<string, SumAccumulator>()
  const lastByPlayer = new Map<string, SumAccumulator>()
  for (const row of stats) {
    const pid = row.player_id as string
    const isMock = row.source === 'mock'

    if (row.season === CURRENT_SEASON) {
      let acc = currentByPlayer.get(pid)
      if (!acc) {
        acc = {}
        currentByPlayer.set(pid, acc)
      }
      addRowToAccumulator(acc, row)

      if (!isMock) {
        let liveAcc = currentLiveByPlayer.get(pid)
        if (!liveAcc) {
          liveAcc = {}
          currentLiveByPlayer.set(pid, liveAcc)
        }
        addRowToAccumulator(liveAcc, row)
      }
    } else {
      let acc = lastByPlayer.get(pid)
      if (!acc) {
        acc = {}
        lastByPlayer.set(pid, acc)
      }
      addRowToAccumulator(acc, row)
    }
  }

  const enriched = players.map((player) => {
    const id = player.id as string
    const currentAcc = currentByPlayer.get(id) ?? {}
    const liveAcc = currentLiveByPlayer.get(id) ?? {}
    const lastAcc = lastByPlayer.get(id) ?? {}
    const currentGames = currentAcc.__games ?? 0
    const liveGames = liveAcc.__games ?? 0
    const lastGames = lastAcc.__games ?? 0

    const currentPts = calculateFantasyPoints(currentAcc as StatRow, rules)
    const livePts = calculateFantasyPoints(liveAcc as StatRow, rules)
    const lastPts = calculateFantasyPoints(lastAcc as StatRow, rules)

    // Projection rule (don't undo this — the comment is load-bearing):
    //   - Real (non-mock) current-season games → extrapolate live pace.
    //   - Pre-season → use the stored Sleeper projection for the chosen
    //     scoring variant (synced via scripts/sync-projections.ts).
    //   - Neither → projected_pts is null. We never substitute last_pts:
    //     "projected = last year's actual" was a real bug we hit, and a
    //     forward-looking number must come from a forward-looking source.
    const playerRow = player as unknown as Record<string, unknown>
    const storedProjection = playerRow[projectionColumn]
    const storedProjectionNum =
      storedProjection === null || storedProjection === undefined
        ? null
        : Number(storedProjection)

    let projectedPts: number | null
    if (liveGames > 0) {
      const perGame = livePts / liveGames
      projectedPts =
        Math.round(
          (livePts + perGame * Math.max(0, ASSUMED_TOTAL_GAMES - liveGames)) * 10,
        ) / 10
    } else if (
      storedProjectionNum !== null &&
      Number.isFinite(storedProjectionNum)
    ) {
      projectedPts = Math.round(storedProjectionNum * 10) / 10
    } else {
      projectedPts = null
    }

    return {
      ...player,
      current_pts: Math.round(currentPts * 10) / 10,
      current_games: currentGames,
      last_pts: Math.round(lastPts * 10) / 10,
      last_games: lastGames,
      projected_pts: projectedPts,
      // Raw season totals (last season — most useful for the players spreadsheet
      // pre-Week-1; switches to current once games are played).
      stats_last: stripMeta(lastAcc),
      stats_current: stripMeta(currentAcc),
    }
  })

  // Sort by projected so the most relevant players surface first
  // Players without projections sort to the bottom rather than getting
  // promoted by NaN comparisons.
  enriched.sort((a, b) => (b.projected_pts ?? -1) - (a.projected_pts ?? -1))

  return NextResponse.json({
    players: enriched,
    season: { current: CURRENT_SEASON, last: LAST_SEASON },
    scoring,
  })
}

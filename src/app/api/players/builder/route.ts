import { NextResponse } from 'next/server'
import { z } from 'zod'

import { BUILDER_STATS_SELECT, BUILDER_TOTAL_COLUMNS, builderSeasonPoints, PRESET_BY_BUILDER_KEY } from '@/lib/players/preset-scoring'
import { currentSeasonHasGames, defaultStatsSeason } from '@/lib/players/stats-season'
import type { StatLineRow } from '@/lib/leagues/scoring/score-week-worker'
import { fetchWeeklyStatsForPlayers } from '@/lib/stats/fetch-weekly-stats'
import { pageAll } from '@/lib/supabase/page-all'
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
  /**
   * Omit for the WHOLE active pool (the default — see pageAll). Pass a limit
   * only for a deliberately bounded widget. Capped at 1000 because that is
   * PostgREST's per-response ceiling: a larger number is a promise the server
   * will not keep, which is precisely how players went missing before.
   */
  limit: z.coerce.number().int().min(1).max(1000).optional(),
})

type SumAccumulator = Record<string, number> & {
  __games?: number
}

/** Raw totals only — points are NOT computed from these (F576: each week
 *  is scored on its own by `builderSeasonPoints`). */
function addRowToAccumulator(acc: SumAccumulator, row: Record<string, unknown>) {
  for (const k of BUILDER_TOTAL_COLUMNS) acc[k] = (acc[k] ?? 0) + Number(row[k] ?? 0)
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
  const preset = PRESET_BY_BUILDER_KEY[scoring]

  const supabase = await createServerClient()

  const projectionColumn =
    scoring === 'standard'
      ? 'projected_pts_standard'
      : scoring === 'half_ppr'
        ? 'projected_pts_half_ppr'
        : 'projected_pts_ppr'

  const positionList =
    positions && positions.length > 0 ? positions : ['QB', 'RB', 'WR', 'TE', 'K', 'DEF']

  const poolQuery = (from: number, to: number) => {
    let q = supabase
      .from('players')
      .select(
        `id, full_name, position, team, headshot_url, status, depth_chart_order, depth_chart_position, ${projectionColumn}`,
        // Exact count is the finish line pageAll drains to — without it a
        // short page is indistinguishable from a server-side cap.
        { count: 'exact' },
      )
      // Filter out retirees / free agents — Sleeper still flags these as
      // active=true, so the reliable signal is having a current team.
      .not('team', 'is', null)
      .in('position', positionList)
    if (teams && teams.length > 0) q = q.in('team', teams)
    return (
      q
        // Order by relevance so that any bounded caller truncates the tail
        // rather than a random alphabetical slice (the Justin Herbert bug).
        .order(projectionColumn, { ascending: false, nullsFirst: false })
        .order('adp', { ascending: true, nullsFirst: false })
        .order('full_name', { ascending: true })
        // Unique final tiebreak — REQUIRED for stable paging. full_name is
        // not unique, so it cannot anchor a page boundary.
        .order('id', { ascending: true })
        .range(from, to)
    )
  }

  let players: Record<string, unknown>[]
  try {
    if (limit === undefined) {
      players = await pageAll<Record<string, unknown>>(poolQuery)
    } else {
      const { data, error } = await poolQuery(0, limit - 1)
      // supabase-js RESOLVES on PostgREST errors, so this must be checked
      // explicitly — the try/catch above only sees pageAll's throw.
      if (error) {
        return NextResponse.json({ error: error.message }, { status: 500 })
      }
      players = data ?? []
    }
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to load players' },
      { status: 500 },
    )
  }
  if (players.length === 0) {
    return NextResponse.json({ players: [] })
  }

  const playerIds = players.map((p) => p.id as string)

  let stats: Record<string, unknown>[]
  // Which season the tables open on (stats-season.ts) — asked of the whole
  // table, so it is the same answer whatever filters this read carries.
  let currentHasGames: boolean
  try {
    ;[stats, currentHasGames] = await Promise.all([
      fetchWeeklyStatsForPlayers<Record<string, unknown>>({
        supabase,
        playerIds,
        seasons: [CURRENT_SEASON, LAST_SEASON],
        select: BUILDER_STATS_SELECT,
      }),
      currentSeasonHasGames(supabase, CURRENT_SEASON),
    ])
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
  // The weekly lines themselves, for the per-week scorer (F576).
  const lines = { current: new Map<string, StatLineRow[]>(), live: new Map<string, StatLineRow[]>(), last: new Map<string, StatLineRow[]>() }
  const pushLine = (m: Map<string, StatLineRow[]>, pid: string, row: Record<string, unknown>) => {
    const list = m.get(pid) ?? []
    list.push(row as StatLineRow)
    m.set(pid, list)
  }
  for (const row of stats) {
    const pid = row.player_id as string
    const isMock = row.source === 'mock'
    if (row.season === CURRENT_SEASON) {
      pushLine(lines.current, pid, row)
      if (!isMock) pushLine(lines.live, pid, row)
    } else {
      pushLine(lines.last, pid, row)
    }

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

    // F576: the player page's scorer — each week alone, canonical engine,
    // the shipped ESPN template rules. No lines → 0 here (the games count
    // beside it says "none"), the route's long-standing number contract.
    const position = String(player.position ?? '')
    const currentPts = builderSeasonPoints(preset, id, position, lines.current.get(id) ?? [])
    const livePts = builderSeasonPoints(preset, id, position, lines.live.get(id) ?? [])
    const lastPts = builderSeasonPoints(preset, id, position, lines.last.get(id) ?? [])

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
      // Raw season totals for both seasons — the tables show the one
      // `season.default` names (current once it has games) or the viewer's pick.
      stats_last: stripMeta(lastAcc),
      stats_current: stripMeta(currentAcc),
    }
  })

  // Sort by projected so the most relevant players surface first.
  // -Infinity, not -1: the full pool now includes ~495 projection-less
  // players, and in-season a negative live-pace extrapolation would
  // otherwise sort BELOW them. Matches players-spreadsheet.tsx.
  enriched.sort(
    (a, b) => (b.projected_pts ?? -Infinity) - (a.projected_pts ?? -Infinity),
  )

  return NextResponse.json({
    players: enriched,
    season: { current: CURRENT_SEASON, last: LAST_SEASON, default: defaultStatsSeason(currentHasGames) },
    scoring,
  })
}

/**
 * GET /api/players/[id]/core-stats[?league=] — the player page's core-stats
 * row (D486(10)): season points, avg per game, this week's projection, and
 * his positional + overall rank by season points.
 *
 * ONE engine for both bases (D33): the league-player-values job's own code —
 * `computePlayerValue` for him (season to date + this week's projection) and
 * `seasonToDate` for every player in the pool (the ranks) — fed by the job's
 * readers (`readOpenedWeekRules` / `readWeeklyLines`).
 *
 *  - In a league: the league's frozen snapshot, each opened week under its
 *    own stored rules (144 / F397) — exactly the pool-values read (batch 5).
 *    The week is `valueWeekOf` over the league's schedule. Member-gated.
 *  - Outside one: "Scout Standard", FieldScout's own default template
 *    (templates.ts), and the NFL calendar's current week
 *    (`planProjectionWeeks` at the TimeProvider's now — the projection sync's
 *    own rule).
 *
 * Season points sum EVERY stored week of the season (a live week counts as
 * it stands — the platform convention). Ranks: every player with a stored
 * week this season, standard competition ranking (ties share). The pool is
 * read whole, paged past the 1000-row cap (pageAll, exact count). Nothing is
 * written. A failed read is a 500, never an empty success.
 */
import type { SupabaseClient } from '@supabase/supabase-js'

import { dbFailure } from '@/lib/leagues/api/db-failure'
import { assertLeagueMember } from '@/lib/leagues/api/inseason-reads'
import type { ServiceResult } from '@/lib/leagues/api/leagues-service'
import { computePlayerValue, seasonToDate } from '@/lib/leagues/scoring/player-values'
import { readOpenedWeekRules, readWeeklyLines } from '@/lib/leagues/scoring/player-values-job'
import type { ScoringRulesDoc } from '@/lib/leagues/scoring/rules-doc'
import {
  assertSnapshotScorable,
  normalizePosition,
  STAT_LINE_COLUMNS,
  type StatLineRow,
  weekScoringRules,
} from '@/lib/leagues/scoring/score-week-worker'
import { SCORING_TEMPLATES } from '@/lib/leagues/scoring/templates'
import type { TimeProvider } from '@/lib/leagues/time/time-provider'
import { valueWeekOf } from '@/lib/leagues/value-week'
import { type PageResponse, pageAll } from '@/lib/supabase/page-all'
import { planProjectionWeeks, readProjectionCalendar } from '@/lib/sync/weekly-projections'
import type { Database, Json } from '@/types/database'

import { avgPerGame, competitionRanks, type CoreStatsPayload, gamesPlayed, type ScoringBasis } from './core-stats-ops'

type Supabase = SupabaseClient<Database>

/** The page's season (the player stats route's CURRENT_SEASON). */
export const CORE_STATS_DEFAULT_SEASON = 2026
export const DEFAULT_TEMPLATE_NAME = 'Scout Standard'
const IN_CHUNK = 200

type Line = StatLineRow & { week: number }

async function readSeasonPool(supabase: Supabase, season: number): Promise<Map<string, Line[]>> {
  const select = ['id', 'player_id', 'week', 'updated_at', 'advanced', ...STAT_LINE_COLUMNS].join(', ')
  const rows = await pageAll<Line>(
    (from, to) =>
      supabase
        .from('player_stats')
        .select(select, { count: 'exact' })
        .eq('season', season)
        .gte('week', 1)
        .order('player_id')
        .order('week')
        .order('id')
        .range(from, to) as unknown as PageResponse<Line>,
  )
  const out = new Map<string, Line[]>()
  for (const r of rows) {
    const list = out.get(r.player_id) ?? []
    list.push(r)
    out.set(r.player_id, list)
  }
  return out
}

async function readPositions(supabase: Supabase, ids: readonly string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>()
  for (let i = 0; i < ids.length; i += IN_CHUNK) {
    const chunk = ids.slice(i, i + IN_CHUNK)
    const { data, error } = await supabase.from('players').select('id, position').in('id', chunk)
    if (error) throw new Error(`players: ${error.message}`)
    if ((data ?? []).length > chunk.length) throw new Error('players: more rows than ids asked for')
    for (const r of data ?? []) if (r.position) out.set(r.id, r.position)
  }
  return out
}

export async function readPlayerCoreStats(
  supabase: Supabase,
  playerId: string,
  leagueId: string | null,
  time: TimeProvider,
  /** Outside a league: the season read (tests use a synthetic one). */
  opts: { defaultSeason?: number } = {},
): Promise<ServiceResult> {
  const { data: player, error: playerError } = await supabase.from('players').select('id, position, bye_week').eq('id', playerId).maybeSingle()
  if (playerError) return dbFailure('players', playerError)
  if (!player) return { status: 404, body: { error: 'Player not found' } }

  let basis: ScoringBasis
  let season: number
  let week: number | null
  let snapshot: ScoringRulesDoc
  const pastWeekRules = new Map<number, ScoringRulesDoc>()

  if (leagueId) {
    const refused = await assertLeagueMember(supabase, leagueId)
    if (refused) return refused
    const { data: league, error } = await supabase
      .from('leagues')
      .select('id, name, season, scoring_rules_snapshot')
      .eq('id', leagueId)
      .is('deleted_at', null)
      .maybeSingle()
    if (error) return dbFailure('leagues', error)
    if (!league) return { status: 500, body: { error: 'leagues: the league row read empty after membership passed' } }
    const weeks = await supabase.from('league_weeks').select('week, status').eq('league_id', leagueId).eq('season', league.season)
    if (weeks.error) return dbFailure('league_weeks', weeks.error)
    basis = { kind: 'league', league_name: league.name }
    season = league.season
    week = valueWeekOf(weeks.data ?? []) ?? null
    try {
      assertSnapshotScorable(league.scoring_rules_snapshot)
      snapshot = league.scoring_rules_snapshot as unknown as ScoringRulesDoc
      const opened = await readOpenedWeekRules(supabase, season, [leagueId])
      for (const row of opened.get(leagueId) ?? []) pastWeekRules.set(row.week, weekScoringRules(row, null))
    } catch (err) {
      return { status: 500, body: { error: `scoring rules: ${err instanceof Error ? err.message : String(err)}` } }
    }
  } else {
    const template = SCORING_TEMPLATES.find((t) => t.name === DEFAULT_TEMPLATE_NAME)
    if (!template) return { status: 500, body: { error: `scoring: the ${DEFAULT_TEMPLATE_NAME} template is missing` } }
    basis = { kind: 'default' }
    season = opts.defaultSeason ?? CORE_STATS_DEFAULT_SEASON
    snapshot = template.rules as unknown as ScoringRulesDoc
    try {
      week = planProjectionWeeks(await readProjectionCalendar(supabase, season), time.now()).currentWeek
    } catch (err) {
      return { status: 500, body: { error: err instanceof Error ? err.message : String(err) } }
    }
  }

  let pool: Map<string, Line[]>
  let positions: Map<string, string>
  let lines: Awaited<ReturnType<typeof readWeeklyLines>>
  try {
    pool = await readSeasonPool(supabase, season)
    ;[positions, lines] = await Promise.all([
      readPositions(supabase, [...pool.keys()]),
      week === null ? Promise.resolve(new Map()) : readWeeklyLines(supabase, season, [week], [playerId]),
    ])
  } catch (err) {
    return { status: 500, body: { error: err instanceof Error ? err.message : String(err) } }
  }

  const ownPosition = normalizePosition(player.position)
  const own = pool.get(playerId) ?? []
  const value = computePlayerValue(
    snapshot,
    { league_id: leagueId ?? 'default', season, week: week ?? 0, now: time.now() },
    {
      player_id: playerId,
      position: ownPosition,
      weekly: week === null ? null : (lines.get(`${week}:${playerId}`) ?? null),
      seasonRows: own,
      preseason: null,
    },
    pastWeekRules,
  )

  // Ranks — the same scorer over the whole pool.
  const overall = new Map<string, number | null>()
  const atPosition = new Map<string, number | null>()
  for (const [id, rows] of pool) {
    const raw = positions.get(id)
    if (!raw) continue
    const pos = normalizePosition(raw)
    const pts = seasonToDate(snapshot, id, pos, rows, pastWeekRules).points
    overall.set(id, pts)
    if (pos === ownPosition) atPosition.set(id, pts)
  }

  const games = gamesPlayed(
    own.map((r) => r.week),
    player.bye_week,
  )
  const body: CoreStatsPayload = {
    basis,
    season,
    week,
    total_points: value.season_points,
    games,
    avg_points: avgPerGame(value.season_points, games),
    projected_points: week === null ? null : value.projected_points,
    pos_rank: competitionRanks(atPosition).get(playerId) ?? null,
    overall_rank: competitionRanks(overall).get(playerId) ?? null,
  }
  return { status: 200, body: body as unknown as Json }
}

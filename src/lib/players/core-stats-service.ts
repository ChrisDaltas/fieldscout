/**
 * GET /api/players/[id]/core-stats?scoring=|?league= — the player page's
 * core-stats row (D486(10), the scoring dropdown D486(11)): season points,
 * avg per game, this week's projection, and his positional + overall rank
 * by season points.
 *
 * ONE engine for every basis (D33): the league-player-values job's own code —
 * `computePlayerValue` for his projection and `seasonToDate` for every
 * player in the pool (totals, the completed-weeks average, the ranks) — fed
 * by the job's readers (`readOpenedWeekRules` / `readWeeklyLines`).
 *
 *  - A league: the league's frozen snapshot, each opened week under its own
 *    stored rules (144 / F397). The week is `valueWeekOf` over the league's
 *    schedule. Member-gated.
 *  - A preset (Chris 2026-10-04 — ESPN Standard default, Half PPR, Full PPR):
 *    the shipped ESPN templates (templates.ts; Half = ESPN Standard with
 *    receptions 0.5), and the NFL calendar's current week
 *    (`planProjectionWeeks` at the TimeProvider's now). The pool standings
 *    are viewer-independent, so the route caches them per
 *    (system, season, week) — `poolCache` (R1503).
 *
 * Season points sum EVERY stored week (a live week counts as it stands).
 * The average divides completed weeks only (R1506 — see core-stats-ops).
 * Ranks: every player with a stored week this season, standard competition
 * ranking (ties share). The pool is read whole, paged past the 1000-row cap
 * (pageAll, exact count). Nothing is written. A failed read is a 500.
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

import {
  avgPerGame,
  completedGames,
  competitionRanks,
  type CoreStatsPayload,
  type GameWeek,
  type ScoringBasis,
  type ScoringChoice,
  type ScoringSystemKey,
} from './core-stats-ops'

type Supabase = SupabaseClient<Database>

/** The page's season (the player stats route's CURRENT_SEASON). */
export const CORE_STATS_DEFAULT_SEASON = 2026
const IN_CHUNK = 200

type Line = StatLineRow & { week: number; is_live?: boolean | null }

async function readSeasonPool(supabase: Supabase, season: number): Promise<Map<string, Line[]>> {
  const select = ['id', 'player_id', 'week', 'is_live', 'updated_at', 'advanced', ...STAT_LINE_COLUMNS].join(', ')
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

/** The preset systems' rules — the shipped ESPN templates (no new rows). */
export function systemRules(system: ScoringSystemKey): ScoringRulesDoc {
  const std = SCORING_TEMPLATES.find((t) => t.name === 'ESPN Standard')
  const ppr = SCORING_TEMPLATES.find((t) => t.name === 'ESPN Full PPR')
  if (!std || !ppr) throw new Error('scoring: the ESPN templates are missing')
  const rules = system === 'espn_standard' ? std.rules : system === 'ppr' ? ppr.rules : { ...std.rules, receptions: 0.5 }
  return rules as unknown as ScoringRulesDoc
}

/** Any nonzero scoring stat on the line (R1506's appearance proxy). */
function appeared(row: Line): boolean {
  for (const col of STAT_LINE_COLUMNS) {
    const v = (row as unknown as Record<string, unknown>)[col]
    if (typeof v === 'number' && v !== 0) return true
  }
  for (const v of Object.values((row.advanced ?? {}) as Record<string, unknown>)) if (typeof v === 'number' && v !== 0) return true
  return false
}

export interface PoolEntry {
  total: number | null
  games: number
  avg: number | null
  pos_rank: number | null
  overall_rank: number | null
}
/** Player id → his standing. Plain object so it serializes into a cache. */
export type PoolStandings = Record<string, PoolEntry>

/**
 * Every player's total, completed-weeks average and both ranks, scored once.
 * `week` is the current (incomplete) week: weeks at or after it, and rows
 * still flagged live, are left out of the average.
 */
export async function computePoolStandings(
  supabase: Supabase,
  snapshot: ScoringRulesDoc,
  pastWeekRules: ReadonlyMap<number, ScoringRulesDoc>,
  season: number,
  week: number | null,
): Promise<PoolStandings> {
  const pool = await readSeasonPool(supabase, season)
  const positions = await readPositions(supabase, [...pool.keys()])
  const byes = await readByes(supabase, [...pool.keys()])
  const overall = new Map<string, number | null>()
  const byPos = new Map<string, Map<string, number | null>>()
  const partial = new Map<string, { total: number | null; games: number; avg: number | null }>()
  for (const [id, rows] of pool) {
    const raw = positions.get(id)
    if (!raw) continue
    const pos = normalizePosition(raw)
    const total = seasonToDate(snapshot, id, pos, rows, pastWeekRules).points
    const gw: GameWeek[] = rows.map((r) => ({
      week: r.week,
      appeared: appeared(r),
      live: r.is_live === true || (week !== null && r.week >= week),
    }))
    const done = new Set(completedGames(gw, byes.get(id) ?? null).map((g) => g.week))
    const doneRows = rows.filter((r) => done.has(r.week))
    const donePts = seasonToDate(snapshot, id, pos, doneRows, pastWeekRules).points
    partial.set(id, { total, games: doneRows.length, avg: avgPerGame(donePts, doneRows.length) })
    overall.set(id, total)
    const m = byPos.get(pos) ?? new Map<string, number | null>()
    m.set(id, total)
    byPos.set(pos, m)
  }
  const overallRanks = competitionRanks(overall)
  const posRanks = new Map<string, number>()
  for (const m of byPos.values()) for (const [id, r] of competitionRanks(m)) posRanks.set(id, r)
  const out: PoolStandings = {}
  for (const [id, p] of partial) {
    out[id] = { ...p, pos_rank: posRanks.get(id) ?? null, overall_rank: overallRanks.get(id) ?? null }
  }
  return out
}

async function readByes(supabase: Supabase, ids: readonly string[]): Promise<Map<string, number>> {
  const out = new Map<string, number>()
  for (let i = 0; i < ids.length; i += IN_CHUNK) {
    const chunk = ids.slice(i, i + IN_CHUNK)
    const { data, error } = await supabase.from('players').select('id, bye_week').in('id', chunk)
    if (error) throw new Error(`players: ${error.message}`)
    for (const r of data ?? []) if (r.bye_week != null) out.set(r.id, r.bye_week)
  }
  return out
}

/** The route's cache seam: (system, season, week) → the pool standings. */
export type PoolCache = (system: ScoringSystemKey, season: number, week: number | null) => Promise<PoolStandings>

export async function readPlayerCoreStats(
  supabase: Supabase,
  playerId: string,
  choice: ScoringChoice,
  time: TimeProvider,
  /** Preset mode: the season read (tests use a synthetic one) and the cache. */
  opts: { defaultSeason?: number; poolCache?: PoolCache } = {},
): Promise<ServiceResult> {
  const leagueId = choice.kind === 'league' ? choice.leagueId : null
  const { data: player, error: playerError } = await supabase.from('players').select('id, position').eq('id', playerId).maybeSingle()
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
    const system = (choice as { kind: 'system'; system: ScoringSystemKey }).system
    basis = { kind: 'system', system }
    season = opts.defaultSeason ?? CORE_STATS_DEFAULT_SEASON
    try {
      snapshot = systemRules(system)
      week = planProjectionWeeks(await readProjectionCalendar(supabase, season), time.now()).currentWeek
    } catch (err) {
      return { status: 500, body: { error: err instanceof Error ? err.message : String(err) } }
    }
  }

  let standings: PoolStandings
  let lines: Awaited<ReturnType<typeof readWeeklyLines>>
  try {
    ;[standings, lines] = await Promise.all([
      choice.kind === 'system' && opts.poolCache
        ? opts.poolCache(choice.system, season, week)
        : computePoolStandings(supabase, snapshot, pastWeekRules, season, week),
      week === null ? Promise.resolve(new Map()) : readWeeklyLines(supabase, season, [week], [playerId]),
    ])
  } catch (err) {
    return { status: 500, body: { error: err instanceof Error ? err.message : String(err) } }
  }

  const own = standings[playerId]
  const value = computePlayerValue(
    snapshot,
    { league_id: leagueId ?? 'default', season, week: week ?? 0, now: time.now() },
    {
      player_id: playerId,
      position: normalizePosition(player.position),
      weekly: week === null ? null : (lines.get(`${week}:${playerId}`) ?? null),
      seasonRows: [],
      preseason: null,
    },
    pastWeekRules,
  )

  const body: CoreStatsPayload = {
    basis,
    season,
    week,
    total_points: own?.total ?? null,
    games: own?.games ?? 0,
    avg_points: own?.avg ?? null,
    projected_points: week === null ? null : value.projected_points,
    pos_rank: own?.pos_rank ?? null,
    overall_rank: own?.overall_rank ?? null,
  }
  return { status: 200, body: body as unknown as Json }
}

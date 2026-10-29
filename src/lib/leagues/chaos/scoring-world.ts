/**
 * scoring-world — the in-season world the stats drills (provider faults,
 * worker crashes) run on: one NFL week of season 2072, eight test players
 * in two games, and N leagues of four teams that all start the same eight
 * players, so ONE queue drain spans every league (what "mid-batch" needs).
 *
 * THE GOLDENS ARE STORED LITERALS (the falsifiability floor, tasks-M* §4.3).
 * The final lines below score, under ESPN Standard (rush / rec yards 0.1,
 * rush / rec TD 6, receptions 0, fumble lost −2), to:
 *   RB1 100 rush yd + 1 rush TD = 16.00   WR1 50 rec yd (5 rec)      = 5.00
 *   RB2  80 rush yd             =  8.00   WR2 120 rec yd + 1 rec TD  = 18.00
 *   RB3  45 rush yd             =  4.50   WR3 33 rec yd              = 3.30
 *   RB4  12 rush yd + 1 fumble  = −0.80   WR4 77 rec yd              = 7.70
 *   Team 1 = 21.00 · Team 2 = 26.00 · Team 3 = 7.80 · Team 4 = 6.90
 * and the matchups are Team 1 v Team 2, Team 3 v Team 4 in every league.
 * The reconcile job recomputes the same cells independently from
 * `player_stats`; a drill passes only when both agree.
 *
 * Lines carry NO game id — production's Sleeper lines carry none (F468(a)),
 * so the week stands in for the game, exactly as on production.
 */
import { DegradationTracker } from '@/lib/leagues/stats/degradation'
import type { ProviderGame, ProviderPlayerWeekStats } from '@/lib/leagues/stats/stats-provider'
import { VirtualClock } from '@/lib/leagues/time/virtual-clock'
import { ingestWeek, type IngestReport } from '@/lib/sync/ingest-week'
import type { SyncClient } from '@/lib/sync/types'
import type { Json } from '@/types/database'

import { runScoreWeekBatch, type BatchReport } from '../scoring/score-week-worker'
import { CHAOS_PREFIX, CHAOS_SEASON, createChaosUser, must, mustRow, type ChaosUser, type Supabase } from './chaos-world'
import { ScriptedProvider, type FaultyProvider } from './faults'

export const WEEK = 1
const HOUR = 3_600_000

/** The calendar (season 2072, a copy of the opener's shape). */
export const CAL = {
  week1StartsAt: '2072-09-09T04:00:00.000Z',
  week2StartsAt: '2072-09-16T04:00:00.000Z',
  g1Kickoff: '2072-09-13T17:00:00.000Z',
  g2Kickoff: '2072-09-13T20:25:00.000Z',
  g3Kickoff: '2072-09-20T17:00:00.000Z',
  /** Week 1's stat-fix window ends at week 2's first kickoff (Yahoo's rule, §23.4). */
  week1WindowEndsAt: '2072-09-20T17:00:00.000Z',
} as const

export const T = {
  /** Game 1 live, game 2 not started. */
  live: new Date('2072-09-13T18:30:00.000Z'),
  /** Game 1 final, game 2 live. */
  half: new Date('2072-09-13T21:30:00.000Z'),
  /** Every game final — the week's last game is first seen final here. */
  final: new Date('2072-09-14T00:30:00.000Z'),
} as const
export const at = (base: Date, hours: number) => new Date(base.getTime() + hours * HOUR)

export function gameId(n: 1 | 2 | 3): string {
  return `${CHAOS_PREFIX}-g${n}`
}

export const PLAYERS = [
  { id: `${CHAOS_PREFIX}-rb1`, position: 'RB', team: 'CXA', opponent: 'CXB', game: 1 },
  { id: `${CHAOS_PREFIX}-wr1`, position: 'WR', team: 'CXA', opponent: 'CXB', game: 1 },
  { id: `${CHAOS_PREFIX}-rb2`, position: 'RB', team: 'CXB', opponent: 'CXA', game: 1 },
  { id: `${CHAOS_PREFIX}-wr2`, position: 'WR', team: 'CXB', opponent: 'CXA', game: 1 },
  { id: `${CHAOS_PREFIX}-rb3`, position: 'RB', team: 'CXC', opponent: 'CXD', game: 2 },
  { id: `${CHAOS_PREFIX}-wr3`, position: 'WR', team: 'CXC', opponent: 'CXD', game: 2 },
  { id: `${CHAOS_PREFIX}-rb4`, position: 'RB', team: 'CXD', opponent: 'CXC', game: 2 },
  { id: `${CHAOS_PREFIX}-wr4`, position: 'WR', team: 'CXD', opponent: 'CXC', game: 2 },
] as const
export type PlayerKey = 'rb1' | 'wr1' | 'rb2' | 'wr2' | 'rb3' | 'wr3' | 'rb4' | 'wr4'
export const pid = (k: PlayerKey) => `${CHAOS_PREFIX}-${k}`

/** The final lines (see the banner's goldens). */
export const FINAL_STATS: Record<PlayerKey, Partial<Record<string, number>>> = {
  rb1: { rush_yards: 100, rush_tds: 1 },
  wr1: { receiving_yards: 50, receptions: 5 },
  rb2: { rush_yards: 80 },
  wr2: { receiving_yards: 120, receiving_tds: 1 },
  rb3: { rush_yards: 45 },
  wr3: { receiving_yards: 33 },
  rb4: { rush_yards: 12, fumbles_lost: 1 },
  wr4: { receiving_yards: 77 },
}
/** Stored literals — never recomputed here. */
export const GOLDEN_TEAM = { t1: 21, t2: 26, t3: 7.8, t4: 6.9 } as const
export const GOLDEN_PLAYER: Record<PlayerKey, number> = { rb1: 16, wr1: 5, rb2: 8, wr2: 18, rb3: 4.5, wr3: 3.3, rb4: -0.8, wr4: 7.7 }

export function line(k: PlayerKey, stats: Partial<Record<string, number>>): ProviderPlayerWeekStats {
  const p = PLAYERS.find((x) => x.id === pid(k))!
  return { playerId: p.id, season: CHAOS_SEASON, week: WEEK, team: p.team, opponent: p.opponent, stats: { ...stats }, advanced: {} }
}

export function finalLines(only?: readonly PlayerKey[]): ProviderPlayerWeekStats[] {
  return (Object.keys(FINAL_STATS) as PlayerKey[]).filter((k) => only === undefined || only.includes(k)).map((k) => line(k, FINAL_STATS[k]))
}

export function schedule(g1: ProviderGame['status'], g2: ProviderGame['status']): ProviderGame[] {
  return [
    { gameId: gameId(1), season: CHAOS_SEASON, week: WEEK, homeTeam: 'CXA', awayTeam: 'CXB', kickoffAt: new Date(CAL.g1Kickoff), gameDate: '2072-09-13', status: g1 },
    { gameId: gameId(2), season: CHAOS_SEASON, week: WEEK, homeTeam: 'CXC', awayTeam: 'CXD', kickoffAt: new Date(CAL.g2Kickoff), gameDate: '2072-09-13', status: g2 },
    { gameId: gameId(3), season: CHAOS_SEASON, week: WEEK + 1, homeTeam: 'CXB', awayTeam: 'CXA', kickoffAt: new Date(CAL.g3Kickoff), gameDate: '2072-09-20', status: 'scheduled' },
  ]
}

export interface WorldLeague {
  id: string
  name: string
  /** team ids, index 0..3 = Team 1..4 */
  teams: string[]
}

export interface ScoringWorld {
  users: ChaosUser[]
  leagues: WorldLeague[]
  clock: VirtualClock
  provider: ScriptedProvider
  degradation: DegradationTracker
}

/** Build the calendar, the players and `leagueCount` leagues (sweep first). */
export async function buildScoringWorld(service: Supabase, tag: string, leagueCount: number): Promise<ScoringWorld> {
  await must(
    service.from('nfl_weeks').insert([
      { season: CHAOS_SEASON, week: 1, starts_at: CAL.week1StartsAt, first_kickoff_at: null, last_game_ends_at: null, correction_window_ends_at: CAL.week1WindowEndsAt },
      { season: CHAOS_SEASON, week: 2, starts_at: CAL.week2StartsAt, first_kickoff_at: null, last_game_ends_at: null, correction_window_ends_at: '2072-09-27T17:00:00.000Z' },
    ]),
    'nfl_weeks',
  )
  await must(
    service.from('players').insert(PLAYERS.map((p) => ({ id: p.id, full_name: `Chaos ${p.id.slice(CHAOS_PREFIX.length + 1).toUpperCase()}`, position: p.position, team: p.team, status: 'Active' }))),
    'players',
  )
  const users: ChaosUser[] = []
  for (let i = 1; i <= 4; i++) users.push(await createChaosUser(service, `${tag}_m${i}`))
  const template = await mustRow(service.from('scoring_systems').select('id, rules').eq('is_template', true).eq('name', 'ESPN Standard').single(), 'template')
  const leagues: WorldLeague[] = []
  for (let l = 1; l <= leagueCount; l++) {
    const name = `${CHAOS_PREFIX} ${tag} league ${l}`
    const league = await mustRow(
      service
        .from('leagues')
        .insert({
          owner_id: users[0].userId,
          name,
          season: CHAOS_SEASON,
          status: 'in_season',
          team_count: 8,
          scoring_system_id: template.id,
          scoring_rules_snapshot: template.rules,
          playoff_teams: 0,
          roster_settings: {
            starting_slots: [
              { key: 'rb', label: 'RB', eligible: ['RB'], count: 1 },
              { key: 'wr', label: 'WR', eligible: ['WR'], count: 1 },
            ],
            bench: 2,
            ir_slots: [],
            swap_spots: 0,
          } as unknown as Json,
        })
        .select('id')
        .single(),
      `league ${l}`,
    )
    const teams: string[] = []
    for (let t = 0; t < 4; t++) {
      const team = await mustRow(service.from('teams').insert({ owner_id: users[t].userId, name: `Team ${t + 1}`, league_id: league.id }).select('id').single(), 'team')
      teams.push(team.id)
      await must(service.from('league_members').insert({ league_id: league.id, user_id: users[t].userId, team_id: team.id, role: t === 0 ? 'commissioner' : 'manager' }), 'member')
    }
    await must(
      service.from('league_weeks').insert([
        { league_id: league.id, season: CHAOS_SEASON, week: 1, status: 'live' },
        { league_id: league.id, season: CHAOS_SEASON, week: 2, status: 'upcoming' },
      ]),
      'league_weeks',
    )
    await must(
      service.from('matchups').insert([
        { league_id: league.id, season: CHAOS_SEASON, week: 1, round_type: 'regular', home_team_id: teams[0], away_team_id: teams[1], status: 'live' },
        { league_id: league.id, season: CHAOS_SEASON, week: 1, round_type: 'regular', home_team_id: teams[2], away_team_id: teams[3], status: 'live' },
      ]),
      'matchups',
    )
    const starters: Array<[PlayerKey, PlayerKey]> = [
      ['rb1', 'wr1'],
      ['rb2', 'wr2'],
      ['rb3', 'wr3'],
      ['rb4', 'wr4'],
    ]
    await must(
      service.from('league_rosters').insert(starters.flatMap(([rb, wr], t) => [rb, wr].map((k) => ({ league_id: league.id, team_id: teams[t], player_id: pid(k as PlayerKey) })))),
      'rosters',
    )
    await must(
      service.from('team_lineups').insert(starters.map(([rb, wr], t) => ({ team_id: teams[t], season: CHAOS_SEASON, week: 1, starters: [], bench: [], slot_map: { 'rb:0': pid(rb), 'wr:0': pid(wr) } }))),
      'lineups',
    )
    leagues.push({ id: league.id, name, teams })
  }
  return { users, leagues, clock: new VirtualClock(T.live), provider: new ScriptedProvider(`synthetic:${CHAOS_PREFIX}`), degradation: new DegradationTracker() }
}

/** One ingestion poll through the REAL `ingestWeek` at `when`. */
export async function poll(world: ScoringWorld, provider: ScriptedProvider | FaultyProvider, db: SyncClient, when: Date): Promise<IngestReport> {
  world.clock.advanceTo(when)
  return ingestWeek(provider, world.clock, { db, degradation: world.degradation, season: CHAOS_SEASON, week: WEEK })
}

/** One drain of the REAL score worker, scoped to the drill's leagues (D313(2)). */
export function drain(world: ScoringWorld, db: Supabase, when: Date, opts: { leaseSeconds?: number } = {}): Promise<BatchReport> {
  world.clock.advanceTo(when)
  return runScoreWeekBatch({ time: world.clock, db }, { batchSize: 1000, leagueIds: world.leagues.map((l) => l.id), ...opts })
}

export interface LeagueCells {
  /** [home, away] per matchup, Team 1 v 2 first. */
  scores: Array<[number | null, number | null]>
  /** league_week_player_points rows (team, slot, player, points). */
  points: Array<{ team: number; slot: string; player: string; points: number }>
  /** The rows by (team, slot) seen more than once — "no double scoring". */
  duplicatePointRows: string[]
}

export async function cellsOf(service: Supabase, league: WorldLeague): Promise<LeagueCells> {
  const m = await must(
    service.from('matchups').select('home_team_id, home_score, away_score').eq('league_id', league.id).eq('season', CHAOS_SEASON).eq('week', WEEK),
    'matchups read',
  )
  const order = (teamId: string) => league.teams.indexOf(teamId)
  const scores = [...(m ?? [])]
    .sort((a, b) => order(a.home_team_id) - order(b.home_team_id))
    .map((r) => [r.home_score === null ? null : Number(r.home_score), r.away_score === null ? null : Number(r.away_score)] as [number | null, number | null])
  const rows = await must(
    service.from('league_week_player_points').select('team_id, slot, player_id, points').eq('league_id', league.id).eq('season', CHAOS_SEASON).eq('week', WEEK),
    'points read',
  )
  const points = (rows ?? [])
    .map((r) => ({ team: order(r.team_id) + 1, slot: r.slot, player: r.player_id, points: Number(r.points) }))
    .sort((a, b) => a.team - b.team || (a.slot < b.slot ? -1 : 1))
  const seen = new Map<string, number>()
  for (const p of points) seen.set(`${p.team}:${p.slot}`, (seen.get(`${p.team}:${p.slot}`) ?? 0) + 1)
  return { scores, points, duplicatePointRows: [...seen].filter(([, n]) => n > 1).map(([k]) => k) }
}

/** The goldens as `cellsOf(...).scores`. */
export const GOLDEN_SCORES: Array<[number, number]> = [
  [GOLDEN_TEAM.t1, GOLDEN_TEAM.t2],
  [GOLDEN_TEAM.t3, GOLDEN_TEAM.t4],
]

export async function queueRows(service: Supabase): Promise<Array<{ player_id: string; claim_token: string | null }>> {
  return (await must(service.from('score_fanout').select('player_id, claim_token').eq('season', CHAOS_SEASON).order('player_id'), 'queue read')) ?? []
}

export async function storedLine(service: Supabase, k: PlayerKey): Promise<Record<string, unknown> | null> {
  const row = await must(service.from('player_stats').select('*').eq('season', CHAOS_SEASON).eq('week', WEEK).eq('player_id', pid(k)).maybeSingle(), 'player_stats read')
  return (row as unknown as Record<string, unknown> | null) ?? null
}

export async function statRowCount(service: Supabase): Promise<number> {
  const { count, error } = await service.from('player_stats').select('id', { count: 'exact', head: true }).eq('season', CHAOS_SEASON)
  if (error) throw new Error(`player_stats count: ${error.message}`)
  return count ?? 0
}


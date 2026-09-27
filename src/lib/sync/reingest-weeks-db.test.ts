/**
 * reingest-weeks-db.test.ts — the past-week re-ingest tool (M6A L.E1.26 fix
 * round, R1149; PROGRESS F400 / D380(11)) over the REAL local stack, end to
 * end through the three readers F400 names: the box score, the nightly
 * reconcile and the score-week worker.
 *
 * THE STORY, as production lives it (2099 synthetic week 1 — F215/F226,
 * every instant a literal, the clock a VirtualClock):
 *   1. PRE-143: two D/STs' week-1 lines were stored with yards 0 (057's
 *      DEFAULT — never delivered) and a Scout Standard h2h league (the
 *      default template every new league starts on — R1151) scored them
 *      through the REAL door with the phantom "<100 yards" +5: T1 8.00
 *      (4 sacks + PA 31 → −1 + 5), T2 12.00 (2 sacks + 1 INT + PA 7 → 3 + 5).
 *      The week went final.
 *   2. 143's backfill: those zeros → NULL. BEFORE the re-ingest the box score
 *      reads both D/STs PENDING (team points null) and reconcile raises a
 *      `pending_vs_stored` ALERT per cell — F400's production state.
 *   3. `reingestWeeks` re-polls week 1 (a fake provider serving the real
 *      shape: BUF 2026 wk2's line, 355 yards; SEA 2026 wk2's, 151): yards
 *      filled, counted; the box score shows the REAL tiers (T1 2.00, T2
 *      10.00, nothing pending); reconcile raises NO `pending_vs_stored` —
 *      it reads the cells as `post_window_correction` WARNs naming Δ −6 / −2
 *      (the stored scores keep the +5: a final week is never re-scored —
 *      F397's question, F268's downgrade); the worker drains the two
 *      enqueued deltas as `week_final` and no stored score moves.
 *   4. IDEMPOTENT: a second run writes 0 and enqueues 0.
 *   5. REFUSED: a request naming a week that has not started polls NOTHING
 *      (the provider is never called) and writes nothing.
 *   6. LOUD: a completed week whose D/ST line comes back without yards is a
 *      FAILED run naming the id.
 *
 * Requires the local stack — D59(5); FAILS loudly when it is down. Fixture
 * hygiene (F199): players / games / stats / queue rows carry the
 * `vitest-ri` prefix, the league its name; cleanup-first and after; the
 * 2099 week-1 bounds are restored to NULL. Action-id prefix `3a1` (measured
 * free 2026-09-27).
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import type { Database, Json } from '@/types/database'

import { readBoxScore, type TeamBoxScore } from '@/lib/leagues/api/box-score-service'
import { type ReconcileReport, reconcileSeason } from '@/lib/leagues/scoring/reconcile'
import { runScoreWeekBatch } from '@/lib/leagues/scoring/score-week-worker'
import { defaultsForTeamCount, splitSettings } from '@/lib/leagues/settings/league-settings'
import { SYNTHETIC_SEASON, seedSyntheticSeason } from '@/lib/leagues/sim/synthetic-season'
import type { ProviderGame, ProviderPlayerWeekStats, StatsProvider } from '@/lib/leagues/stats/stats-provider'
import { VirtualClock } from '@/lib/leagues/time/virtual-clock'

import { reingestWeeks, type ReingestReport } from './reingest-weeks'
import type { SyncClient } from './types'

const LOCAL_URL = process.env.SUPABASE_LOCAL_URL ?? 'http://127.0.0.1:54321'
const LOCAL_ANON_KEY =
  process.env.SUPABASE_LOCAL_ANON_KEY ??
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0'
const LOCAL_SERVICE_ROLE_KEY =
  process.env.SUPABASE_LOCAL_SERVICE_ROLE_KEY ??
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU'

const PREFIX = 'vitest-ri'
const SEASON = SYNTHETIC_SEASON
const COMMISH = { email: 'reingest-commish@fieldscout.test', password: 'pgtap-ri-pass-1', username: 'ri_commish_one' }
const ACTION = '3a100000-0000-4000-8000-000000000001'

const KICKOFF = '2099-09-13T17:00:00.000Z'
/** In the week, before the window — when the phantom scores were written. */
const STAMP = '2099-09-13T21:00:00.000Z'
/** Stamped as the week's end (the Tuesday 00:00 Pacific floor, Q50). */
const WEEK_END = '2099-09-15T07:00:00.000Z'
/** 2099 week 1's correction window closes Thu 2099-09-17 10:00Z (synthetic-season.ts). */
const WINDOW_END = '2099-09-17T10:00:00.000Z'
/** The re-ingest runs a day after the window closed (production's weeks 1–2 today). */
const NOW = new Date('2099-09-18T12:00:00.000Z')

const GAME_ID = `${PREFIX}-g1`
const DST1 = `${PREFIX}-dst1`
const DST2 = `${PREFIX}-dst2`
const PLAYERS = [
  { id: DST1, full_name: 'RI Defense One', position: 'DEF', team: 'RIA', status: 'Active' },
  { id: DST2, full_name: 'RI Defense Two', position: 'DEF', team: 'RIB', status: 'Active' },
]

/** BUF / SEA 2026 week 2 through SLEEPER_STAT_KEY_MAP (the recorded fixture's values). */
const LINE1 = { def_sack: 4, def_points_allowed: 31, def_yards_allowed: 355 }
const LINE2 = { def_sack: 2, def_int: 1, def_points_allowed: 7, def_yards_allowed: 151 }

const service = createClient<Database>(LOCAL_URL, LOCAL_SERVICE_ROLE_KEY, { auth: { persistSession: false } })
const db = service as unknown as SyncClient
const clock = new VirtualClock(NOW)

async function must<T>(p: PromiseLike<{ data: T; error: { message: string } | null }>, what: string): Promise<T> {
  const { data, error } = await p
  if (error) throw new Error(`${what}: ${error.message}`)
  return data
}

/** A provider serving one final game and the given D/ST lines; counts its calls. */
function fakeProvider(lines: Array<{ playerId: string; stats: Record<string, number> }>): StatsProvider & { calls: number } {
  const game: ProviderGame = {
    gameId: GAME_ID,
    season: SEASON,
    week: 1,
    homeTeam: 'RIA',
    awayTeam: 'RIB',
    kickoffAt: new Date(KICKOFF),
    gameDate: '2099-09-13',
    status: 'final',
  }
  const provider = {
    name: 'sleeper+nflverse',
    capabilities: new Set(['core_box'] as const),
    calls: 0,
    async getSchedule() {
      provider.calls += 1
      return [game]
    },
    async getGameStates() {
      return []
    },
    async getWeekStats(season: number, week: number): Promise<ProviderPlayerWeekStats[]> {
      provider.calls += 1
      return lines.map((l) => ({ playerId: l.playerId, season, week, gameId: GAME_ID, stats: l.stats, advanced: {} }))
    },
    async getInjuries() {
      return []
    },
    async getInactives() {
      return []
    },
  }
  return provider
}

async function deleteUserByUsername(username: string): Promise<void> {
  const { data } = await service.from('profiles').select('id').eq('username', username)
  for (const row of data ?? []) await service.auth.admin.deleteUser(row.id)
}

async function cleanup(): Promise<void> {
  await must(service.from('score_fanout').delete().like('player_id', `${PREFIX}-%`), 'cleanup score_fanout')
  await must(service.from('player_stats').delete().like('player_id', `${PREFIX}-%`), 'cleanup player_stats')
  const { data: stale } = await service.from('leagues').select('id').like('name', `${PREFIX}-%`)
  const ids = (stale ?? []).map((row) => row.id)
  if (ids.length > 0) {
    const { data: teams } = await service.from('teams').select('id').in('league_id', ids)
    const teamIds = (teams ?? []).map((t) => t.id)
    if (teamIds.length > 0) await must(service.from('team_lineups').delete().in('team_id', teamIds), 'cleanup team_lineups')
    for (const table of ['transactions', 'team_week_results', 'matchups', 'league_weeks', 'league_player_pool', 'league_rosters', 'league_chat', 'league_members'] as const) {
      await must(service.from(table).delete().in('league_id', ids), `cleanup ${table}`)
    }
    await must(service.from('teams').delete().in('league_id', ids), 'cleanup teams')
    await must(service.from('leagues').delete().in('id', ids), 'cleanup leagues')
  }
  await must(service.from('nfl_games').delete().like('id', `${PREFIX}-%`), 'cleanup nfl_games')
  await must(service.from('nfl_weeks').update({ last_game_ends_at: null, first_kickoff_at: null }).eq('season', SEASON).eq('week', 1), 'restore nfl_weeks 2099 wk 1')
  await must(service.from('players').delete().like('id', `${PREFIX}-%`), 'cleanup players')
  await deleteUserByUsername(COMMISH.username)
}

let leagueId: string
let t1: string
let t2: string
let matchupId: string
let commishClient: SupabaseClient<Database>

async function box(team: string): Promise<TeamBoxScore> {
  const result = await readBoxScore(commishClient, leagueId, { week: '1', team })
  expect(result.status).toBe(200)
  return result.body as unknown as TeamBoxScore
}

function reconcile(): Promise<ReconcileReport> {
  return reconcileSeason({ time: clock, db: service }, { season: SEASON, leagueIds: [leagueId] })
}

async function yards(): Promise<Record<string, number | null>> {
  const rows = await must(service.from('player_stats').select('player_id, def_yards_allowed').like('player_id', `${PREFIX}-%`).eq('season', SEASON).eq('week', 1).order('player_id'), 'yards read')
  return Object.fromEntries((rows ?? []).map((r) => [r.player_id, r.def_yards_allowed]))
}

async function storedScores(): Promise<{ home: number | null; away: number | null }> {
  const row = await must(service.from('matchups').select('home_score, away_score').eq('id', matchupId).single(), 'matchup read')
  return { home: row!.home_score === null ? null : Number(row!.home_score), away: row!.away_score === null ? null : Number(row!.away_score) }
}

function run(provider: StatsProvider, weeks: number[] = [1]): Promise<ReingestReport> {
  return reingestWeeks({ db, provider, time: clock }, { season: SEASON, weeks })
}

beforeAll(async () => {
  await cleanup()
  await seedSyntheticSeason(service)
  const { data: created, error: userError } = await service.auth.admin.createUser({ email: COMMISH.email, password: COMMISH.password, email_confirm: true, user_metadata: { username: COMMISH.username } })
  if (userError) throw new Error(`createUser: ${userError.message}`)
  const commishId = created.user.id
  commishClient = createClient<Database>(LOCAL_URL, LOCAL_ANON_KEY, { auth: { persistSession: false } })
  const { error: signInError } = await commishClient.auth.signInWithPassword({ email: COMMISH.email, password: COMMISH.password })
  if (signInError) throw new Error(`sign-in: ${signInError.message}`)

  await must(service.from('players').upsert(PLAYERS).select('id'), 'players')
  await must(service.from('nfl_games').insert({ id: GAME_ID, season: SEASON, week: 1, home_team: 'RIA', away_team: 'RIB', kickoff_at: KICKOFF, status: 'final', game_type: 'regular' }), 'nfl_games')
  await must(service.from('nfl_weeks').update({ first_kickoff_at: KICKOFF, last_game_ends_at: WEEK_END }).eq('season', SEASON).eq('week', 1).select('week'), 'stamp 2099 wk1 bounds')

  // The league: Scout Standard — the default template (R1151), h2h, two seats.
  const { columns, blob } = splitSettings(defaultsForTeamCount(8))
  const columnArgs = Object.fromEntries(Object.entries(columns).map(([key, value]) => [`p_${key}`, value]))
  const { data: template } = await commishClient.from('scoring_systems').select('id, rules').eq('is_template', true).eq('name', 'Scout Standard').single()
  const { data: league, error } = await commishClient.rpc('create_league', {
    p_name: `${PREFIX}-scout`,
    p_season: SEASON,
    p_scoring_system_id: template?.id,
    p_team_name: 'RI One',
    p_action_id: ACTION,
    p_settings: blob,
    ...columnArgs,
  } as unknown as Database['public']['Functions']['create_league']['Args'])
  if (error) throw new Error(`create_league: ${error.message}`)
  leagueId = (league as { league_id: string }).league_id
  t1 = (await must(service.from('teams').select('id').eq('league_id', leagueId).single(), 'team one'))!.id
  t2 = (await must(service.from('teams').insert({ owner_id: commishId, name: 'RI Two', league_id: leagueId }).select('id').single(), 'team two'))!.id
  await must(service.from('leagues').update({ status: 'in_season', scoring_rules_snapshot: template!.rules as Json }).eq('id', leagueId), 'league → in_season')
  await must(service.from('league_weeks').insert({ league_id: leagueId, season: SEASON, week: 1 }), 'week 1')
  await must(service.from('league_weeks').update({ status: 'live' }).eq('league_id', leagueId).eq('week', 1), 'week 1 → live')
  matchupId = (await must(
    service.from('matchups').insert({ league_id: leagueId, season: SEASON, week: 1, round_type: 'regular', home_team_id: t1, away_team_id: t2, status: 'live' }).select('id').single(),
    'matchup',
  ))!.id
  await must(service.from('league_rosters').insert([{ league_id: leagueId, team_id: t1, player_id: DST1 }, { league_id: leagueId, team_id: t2, player_id: DST2 }]), 'rosters')
  await must(
    service.from('team_lineups').insert([
      { team_id: t1, season: SEASON, week: 1, starters: [], bench: [], slot_map: { 'dst:0': DST1 } },
      { team_id: t2, season: SEASON, week: 1, starters: [], bench: [], slot_map: { 'dst:0': DST2 } },
    ]),
    'lineups',
  )

  // (1) PRE-143: the lines as main stored them — yards 0 (the DEFAULT) — and
  // the phantom scores through the REAL door (hand-computed, Scout Standard).
  // (`player_stats` COLUMN names — def_sacks / def_interceptions.)
  const pre = [
    { player_id: DST1, def_sacks: 4, def_points_allowed: 31, def_yards_allowed: 0 },
    { player_id: DST2, def_sacks: 2, def_interceptions: 1, def_points_allowed: 7, def_yards_allowed: 0 },
  ]
  await must(
    service.from('player_stats').upsert(pre.map((l) => ({ ...l, season: SEASON, week: 1, stat_type: 'weekly', game_id: GAME_ID, is_live: false, source: 'sleeper+nflverse', updated_at: STAMP, advanced: {} })), { onConflict: 'player_id,season,week' }).select('player_id'),
    'pre-143 lines',
  )
  const door = await service.rpc('score_write_week_batch', { p_league_id: leagueId, p_week: 1, p_scores: [{ team_id: t1, points: 8 }, { team_id: t2, points: 12 }] as unknown as Json })
  if (door.error) throw new Error(`door: ${door.error.message}`)
  await must(service.from('league_weeks').update({ status: 'correction_window' }).eq('league_id', leagueId).eq('week', 1), 'week 1 → correction_window')
  await must(service.from('league_weeks').update({ status: 'final' }).eq('league_id', leagueId).eq('week', 1), 'week 1 → final')

  // (2) 143's backfill on these rows: 0 → NULL.
  await must(service.from('player_stats').update({ def_yards_allowed: null }).like('player_id', `${PREFIX}-%`).eq('season', SEASON).select('player_id'), '143 backfill')
}, 60_000)

afterAll(cleanup)

describe('R1149 — the past-week re-ingest over the real stack: box score, reconcile, worker (F400)', () => {
  it('RI0 premise: stored scores are the phantom +5 (8.00 / 12.00); yards are NULL; the league week is final', async () => {
    expect(await storedScores()).toEqual({ home: 8, away: 12 })
    expect(await yards()).toEqual({ [DST1]: null, [DST2]: null })
    const week = await must(service.from('league_weeks').select('status').eq('league_id', leagueId).eq('week', 1).single(), 'week')
    expect(week!.status).toBe('final')
    // The re-ingest instant is past the week's correction window (production's weeks 1–2).
    const cal = await must(service.from('nfl_weeks').select('correction_window_ends_at').eq('season', SEASON).eq('week', 1).single(), 'calendar')
    expect(new Date(cal!.correction_window_ends_at!).toISOString()).toBe(WINDOW_END)
    expect(NOW.getTime()).toBeGreaterThan(new Date(WINDOW_END).getTime())
  })

  it('RI1 BEFORE (F400 as production lives it): the box score reads both D/STs PENDING, team points null; reconcile ALERTS pending_vs_stored per cell', async () => {
    const b1 = await box(t1)
    expect(b1.points).toBeNull()
    expect(b1.starters.find((s) => s.slot === 'dst:0')!.pending.some((k) => k.startsWith('def_ya_'))).toBe(true)
    expect((await box(t2)).points).toBeNull()
    const report = await reconcile()
    const pending = report.findings.filter((f) => f.kind === 'pending_vs_stored')
    expect(pending.map((f) => [f.team_id, f.severity, f.stored])).toEqual(
      expect.arrayContaining([
        [t1, 'alert', 8],
        [t2, 'alert', 12],
      ]),
    )
    expect(pending).toHaveLength(2)
  })

  it('RI2 THE RE-INGEST: yards filled (355 / 151), counted loudly; 2 deltas enqueued; ok', async () => {
    const report = await run(fakeProvider([{ playerId: DST1, stats: LINE1 }, { playerId: DST2, stats: LINE2 }]))
    expect(report.ok).toBe(true)
    expect(report.refused).toBeUndefined()
    expect(report.weeks).toHaveLength(1)
    const w = report.weeks[0]
    expect(w).toMatchObject({ week: 1, completed: true, dstYardsChanged: 2, dstWithoutYards: [], problems: [] })
    expect(w.dstRows).toBe(w.dstWithYards)
    expect(w.ingest.stats).toMatchObject({ seen: 2, unknownPlayer: 0, inserted: 0, updated: 2, deltas: 2, enqueued: 2 })
    expect(await yards()).toEqual({ [DST1]: 355, [DST2]: 151 })
    const queued = await must(service.from('score_fanout').select('player_id').like('player_id', `${PREFIX}-%`).order('player_id'), 'queue')
    expect(queued!.map((q) => q.player_id)).toEqual([DST1, DST2])
  })

  it('RI3 AFTER — the box score shows the REAL tiers, nothing pending: T1 2.00 (4 − 1 − 1), T2 10.00 (2 + 2 + 3 + 3)', async () => {
    const b1 = await box(t1)
    expect(b1.pending).toEqual([])
    expect(b1.points).toBe(2)
    const b2 = await box(t2)
    expect(b2.pending).toEqual([])
    expect(b2.points).toBe(10)
  })

  it('RI4 AFTER — reconcile: NO pending_vs_stored; the cells read post_window_correction WARNs naming Δ −6 / −2 (the stored +5 stays — F397 / F268)', async () => {
    // Drain first (RI5 proves what the drain does), so the cells are not in_flight.
    const batch = await runScoreWeekBatch({ time: clock, db: service }, { batchSize: 1000, leagueIds: [leagueId] })
    // The worker NAMES the consumption (a final week is skipped, never re-scored).
    expect(batch.problems).toEqual([`[${leagueId} wk 1] league ${leagueId} week 1 skipped: week_final`])
    expect(batch.written).toBe(0)
    const report = await reconcile()
    expect(report.findings.filter((f) => f.kind === 'pending_vs_stored')).toEqual([])
    expect(report.findings.filter((f) => f.kind === 'drift')).toEqual([])
    const post = report.findings.filter((f) => f.kind === 'post_window_correction')
    expect(post.map((f) => [f.team_id, f.severity, f.stored, f.recomputed])).toEqual(
      expect.arrayContaining([
        [t1, 'warn', 8, 2],
        [t2, 'warn', 12, 10],
      ]),
    )
    expect(post).toHaveLength(2)
    expect(post.find((f) => f.team_id === t1)!.message).toContain('Δ -6.00')
  })

  it('RI5 the worker consumed the two deltas as week_final: queue empty, NO stored score moved (Q64 / D295(b))', async () => {
    const queued = await must(service.from('score_fanout').select('player_id').like('player_id', `${PREFIX}-%`), 'queue')
    expect(queued).toEqual([])
    expect(await storedScores()).toEqual({ home: 8, away: 12 })
  })

  it('RI6 IDEMPOTENT: a second run over the same week writes 0 rows and enqueues 0', async () => {
    const report = await run(fakeProvider([{ playerId: DST1, stats: LINE1 }, { playerId: DST2, stats: LINE2 }]))
    expect(report.ok).toBe(true)
    expect(report.weeks[0].ingest.stats).toMatchObject({ inserted: 0, updated: 0, metaOnly: 0, unchanged: 2, deltas: 0, enqueued: 0 })
    expect(report.weeks[0].dstYardsChanged).toBe(0)
    expect(await must(service.from('score_fanout').select('player_id').like('player_id', `${PREFIX}-%`), 'queue')).toEqual([])
  })

  it('RI7 REFUSED: a run naming a week that has not started (2099 wk 2 — no kickoff recorded) polls NOTHING and writes nothing, even for the started week beside it', async () => {
    const provider = fakeProvider([{ playerId: DST1, stats: { ...LINE1, def_yards_allowed: 999 } }])
    const report = await run(provider, [1, 2])
    expect(report.ok).toBe(false)
    expect(report.refused).toMatch(/week 2: no game has a recorded kickoff/)
    expect(report.weeks).toEqual([])
    expect(provider.calls).toBe(0)
    expect(await yards()).toEqual({ [DST1]: 355, [DST2]: 151 })
  })

  it('RI8 LOUD: a completed week whose D/ST line comes back WITHOUT yards is a FAILED run naming the id (then restored)', async () => {
    const { def_yards_allowed: _omit, ...noYards } = LINE1
    void _omit
    const report = await run(fakeProvider([{ playerId: DST1, stats: noYards }, { playerId: DST2, stats: LINE2 }]))
    expect(report.ok).toBe(false)
    expect(report.weeks[0].dstWithoutYards).toEqual([DST1])
    expect(report.weeks[0].problems.join(' ')).toContain(`NULL yards after the re-poll: ${DST1}`)
    const back = await run(fakeProvider([{ playerId: DST1, stats: LINE1 }, { playerId: DST2, stats: LINE2 }]))
    expect(back.ok).toBe(true)
    expect(await yards()).toEqual({ [DST1]: 355, [DST2]: 151 })
  })
})

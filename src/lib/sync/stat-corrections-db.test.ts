/**
 * stat-corrections-db.test.ts — M6 L.E2.1 END TO END over the REAL local
 * stack (migration 167; tasks-M6 TD2 / TD3 / TD4; spec §12.21 / §23.4;
 * PROGRESS F267 / F268 / D422 / D432). Chris (Q81, 2026-09-29): "if the stat
 * window has closed I think we have to forget it" — a late stat fix never
 * changes a league score; the player's real stats still update for research.
 *
 * ONE WEEK'S STORY (its own calendar, season 2092 weeks 1–2 — every instant a
 * literal; a VirtualClock; the REAL `ingestWeek` → the REAL door, the REAL
 * score-week worker, league_week_advance and finalize_matchups; one h2h
 * league, ESPN Standard, WR1 + WR3 v WR2):
 *   SC1  Sunday, the game LIVE: the first lines are ordinary deltas — written,
 *        queued, scored; NO event.
 *   SC2  the poll that first sees the game FINAL carries its last in-game
 *        change: NOT a correction (the stored state before it said live) — no
 *        event; the week moves to its correction window (the real advance).
 *   SC3  Wednesday, INSIDE the window: the provider moves WR1's receiving yards
 *        50 → 60. EXACTLY ONE event (receiving_yards, 50 → 60, week `open`),
 *        written in the same call as the line and its queue row (all three
 *        stamped the poll's instant), and the worker RE-SCORES the week
 *        (14.00 → 15.00) — "changed a league score".
 *   SC4  a replay of the identical poll records nothing twice.
 *   SC5  the real finalize_matchups at week 2's first kickoff: FINAL.
 *   SC6  Saturday, AFTER the lock: WR1 60 → 80. The event is RECORDED (week
 *        `final` — no league can re-score it: "recorded only"), player_stats
 *        moves (research: 80), the worker consumes the delta as `week_final`,
 *        and EVERY league cell of the week — matchups, team_week_results,
 *        league_week_player_points, league_weeks — is byte-identical.
 *   SC7  DEPLOY BEFORE PUSH on the same week: the door asked under a name the
 *        database lacks answers PostgREST's real PGRST202; the poll writes
 *        through the pre-167 two-call path, says so, records no event, and the
 *        worker still consumes it as `week_final` — nothing moves either.
 *
 * Requires the local stack — D59(5); FAILS loudly when it is down. Fixture
 * hygiene (F199): the `vitest-sce` prefix on players / stats / queue / games,
 * the league by name, the 2092 calendar rows (measured unused 2026-09-29),
 * events deleted by the prefix; cleanup first and after. Action-id prefix
 * `3e7` (measured free 2026-09-29).
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { defaultsForTeamCount, splitSettings } from '@/lib/leagues/settings/league-settings'
import { DegradationTracker } from '@/lib/leagues/stats/degradation'
import type { ProviderGame, ProviderPlayerWeekStats, StatsProvider } from '@/lib/leagues/stats/stats-provider'
import { runScoreWeekBatch } from '@/lib/leagues/scoring/score-week-worker'
import { VirtualClock } from '@/lib/leagues/time/virtual-clock'
import type { Database, Json } from '@/types/database'

import { ingestWeek, type IngestReport } from './ingest-week'
import type { SyncClient } from './types'

const LOCAL_URL = process.env.SUPABASE_LOCAL_URL ?? 'http://127.0.0.1:54321'
const LOCAL_ANON_KEY =
  process.env.SUPABASE_LOCAL_ANON_KEY ??
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0'
const LOCAL_SERVICE_ROLE_KEY =
  process.env.SUPABASE_LOCAL_SERVICE_ROLE_KEY ??
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU'

const PREFIX = 'vitest-sce'
const SEASON = 2092
const COMMISH = { email: 'stat-corrections-commish@fieldscout.test', password: 'pgtap-sce-pass-1', username: 'sce_commish_one' }
const ACTION = { league: '3e700000-0000-4000-8000-000000000001' } as const

const WR1 = `${PREFIX}-wr1`
const WR2 = `${PREFIX}-wr2`
const WR3 = `${PREFIX}-wr3`
const GAME = `${PREFIX}-g1`
const PLAYERS = [
  { id: WR1, full_name: 'SCE Receiver One', position: 'WR', team: 'SCA', status: 'Active' },
  { id: WR2, full_name: 'SCE Receiver Two', position: 'WR', team: 'SCB', status: 'Active' },
  { id: WR3, full_name: 'SCE Receiver Three', position: 'WR', team: 'SCA', status: 'Active' },
]

/** The calendar (literals): week 1's game Sunday 17:00Z; Q50's floor Tue 07:00Z; week 2's first kickoff (= week 1's lock) Fri 00:15Z. */
const WEEK1 = { starts: '2092-09-10T04:00:00.000Z', kickoff: '2092-09-14T17:00:00.000Z', floor: '2092-09-16T07:00:00.000Z', defaultClose: '2092-09-18T10:00:00.000Z' }
const WEEK2 = { starts: '2092-09-17T04:00:00.000Z', kickoff: '2092-09-19T00:15:00.000Z', defaultClose: '2092-09-25T10:00:00.000Z' }
const T_LIVE = '2092-09-14T18:00:00.000Z'
const T_FINAL_SEEN = '2092-09-14T20:30:00.000Z'
const T_ADVANCE = '2092-09-16T08:00:00.000Z'
const T_IN_WINDOW = '2092-09-17T12:00:00.000Z'
const T_LATE = '2092-09-20T12:00:00.000Z'
const T_LATE_PRE167 = '2092-09-20T13:00:00.000Z'

const service = createClient<Database>(LOCAL_URL, LOCAL_SERVICE_ROLE_KEY, { auth: { persistSession: false } })
const db = service as unknown as SyncClient
const clock = new VirtualClock(new Date(T_LIVE))

async function must<T>(p: PromiseLike<{ data: T; error: { message: string } | null }>, what: string): Promise<T> {
  const { data, error } = await p
  if (error) throw new Error(`${what}: ${error.message}`)
  return data
}

async function deleteUserByUsername(username: string): Promise<void> {
  const { data } = await service.from('profiles').select('id').eq('username', username)
  for (const row of data ?? []) await service.auth.admin.deleteUser(row.id)
}

async function cleanup(): Promise<void> {
  await must(service.from('stat_correction_events').delete().like('player_id', `${PREFIX}-%`), 'cleanup stat_correction_events')
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
  await must(service.from('nfl_weeks').delete().eq('season', SEASON), 'cleanup nfl_weeks')
  await must(service.from('players').delete().like('id', `${PREFIX}-%`), 'cleanup players')
  await deleteUserByUsername(COMMISH.username)
}

let leagueId: string
let t1: string

/** The provider: week 1's one game at `status`, and the three lines. */
const feed = { status: 'live' as ProviderGame['status'], lines: {} as Record<string, Record<string, number>> }
const provider: StatsProvider = {
  name: 'fixture:sce',
  capabilities: new Set(['core_box']),
  getSchedule: async () => [
    { gameId: GAME, season: SEASON, week: 1, homeTeam: 'SCA', awayTeam: 'SCB', kickoffAt: new Date(WEEK1.kickoff), gameDate: '2092-09-14', status: feed.status },
  ],
  getGameStates: async () => [],
  getWeekStats: async () =>
    Object.entries(feed.lines).map(([playerId, stats]): ProviderPlayerWeekStats => ({ playerId, season: SEASON, week: 1, gameId: GAME, stats, advanced: {} })),
  getInjuries: async () => [],
  getInactives: async () => [],
}

function poll(iso: string, door?: string): Promise<IngestReport> {
  clock.advanceTo(new Date(iso))
  return ingestWeek(provider, clock, { db, degradation: new DegradationTracker(), season: SEASON, week: 1, ...(door === undefined ? {} : { door }) })
}

function drain() {
  return runScoreWeekBatch({ time: clock, db: service }, { batchSize: 1000, leagueIds: [leagueId] })
}

async function events(): Promise<string[]> {
  const rows = await must(
    service
      .from('stat_correction_events')
      .select('player_id, stat_key, old_value, new_value, detected_at, week_state, source, game_id, applied_at')
      .like('player_id', `${PREFIX}-%`)
      .order('detected_at')
      .order('stat_key'),
    'events',
  )
  return (rows ?? []).map(
    (e) =>
      `${e.player_id}:${e.stat_key} ${e.old_value ?? 'null'}→${e.new_value ?? 'null'} @${new Date(e.detected_at).toISOString()} ${e.week_state} ${e.source} ${e.game_id} applied=${e.applied_at ?? 'null'}`,
  )
}

async function scores(): Promise<string> {
  const m = await must(service.from('matchups').select('home_score, away_score, status, result').eq('league_id', leagueId).eq('week', 1).single(), 'matchup')
  return `${Number(m!.home_score).toFixed(2)}/${Number(m!.away_score).toFixed(2)} ${m!.status} ${m!.result ?? '-'}`
}

/** Every league cell of week 1, as stored — the byte-identical digest. */
async function leagueCells(): Promise<string> {
  const matchups = await must(service.from('matchups').select('*').eq('league_id', leagueId).eq('week', 1).order('id'), 'matchups')
  const results = await must(service.from('team_week_results').select('*').eq('league_id', leagueId).eq('week', 1).order('team_id'), 'results')
  const points = await must(service.from('league_week_player_points').select('*').eq('league_id', leagueId).eq('week', 1).order('team_id').order('slot'), 'points')
  const weeks = await must(service.from('league_weeks').select('*').eq('league_id', leagueId).eq('week', 1), 'weeks')
  return JSON.stringify({ matchups, results, points, weeks })
}

async function weekStatus(): Promise<string> {
  return (await must(service.from('league_weeks').select('status').eq('league_id', leagueId).eq('week', 1).single(), 'week'))!.status
}

async function research(): Promise<number> {
  const row = await must(service.from('player_stats').select('receiving_yards').eq('player_id', WR1).eq('season', SEASON).eq('week', 1).single(), 'research')
  return Number(row!.receiving_yards)
}

beforeAll(async () => {
  await cleanup()
  await must(
    service.from('nfl_weeks').insert([
      { season: SEASON, week: 1, starts_at: WEEK1.starts, first_kickoff_at: null, last_game_ends_at: null, correction_window_ends_at: WEEK1.defaultClose },
      { season: SEASON, week: 2, starts_at: WEEK2.starts, first_kickoff_at: WEEK2.kickoff, last_game_ends_at: null, correction_window_ends_at: WEEK2.defaultClose },
    ]),
    'nfl_weeks',
  )
  const { data: created, error: userError } = await service.auth.admin.createUser({ email: COMMISH.email, password: COMMISH.password, email_confirm: true, user_metadata: { username: COMMISH.username } })
  if (userError) throw new Error(`createUser: ${userError.message}`)
  const commishId = created.user.id
  const commishClient: SupabaseClient<Database> = createClient<Database>(LOCAL_URL, LOCAL_ANON_KEY, { auth: { persistSession: false } })
  const { error: signInError } = await commishClient.auth.signInWithPassword({ email: COMMISH.email, password: COMMISH.password })
  if (signInError) throw new Error(`sign-in: ${signInError.message}`)
  await must(service.from('players').upsert(PLAYERS).select('id'), 'players')

  const { columns, blob } = splitSettings(defaultsForTeamCount(8))
  const columnArgs = Object.fromEntries(Object.entries(columns).map(([key, value]) => [`p_${key}`, value]))
  const { data: std } = await commishClient.from('scoring_systems').select('id, rules').eq('is_template', true).eq('name', 'ESPN Standard').single()
  const { data: league, error } = await commishClient.rpc('create_league', {
    p_name: `${PREFIX}-league`,
    p_season: SEASON,
    p_scoring_system_id: std?.id,
    p_team_name: 'SCE One',
    p_action_id: ACTION.league,
    p_settings: blob,
    ...columnArgs,
  } as unknown as Database['public']['Functions']['create_league']['Args'])
  if (error) throw new Error(`create_league: ${error.message}`)
  leagueId = (league as { league_id: string }).league_id
  t1 = (await must(service.from('teams').select('id').eq('league_id', leagueId).single(), 'team one'))!.id
  const t2 = (await must(service.from('teams').insert({ owner_id: commishId, name: 'SCE Two', league_id: leagueId }).select('id').single(), 'team two'))!.id
  // No bracket: this league's finalize runs 118's sync, and a bracket is not this suite's subject.
  await must(service.from('leagues').update({ status: 'in_season', scoring_rules_snapshot: std!.rules as Json, playoff_teams: 0 }).eq('id', leagueId), 'league → in_season')
  await must(service.from('league_weeks').insert([{ league_id: leagueId, season: SEASON, week: 1, status: 'live' }, { league_id: leagueId, season: SEASON, week: 2, status: 'upcoming' }]), 'weeks')
  await must(service.from('matchups').insert({ league_id: leagueId, season: SEASON, week: 1, round_type: 'regular', home_team_id: t1, away_team_id: t2, status: 'live' }).select('id'), 'matchup')
  await must(service.from('league_rosters').insert([
    { league_id: leagueId, team_id: t1, player_id: WR1 },
    { league_id: leagueId, team_id: t1, player_id: WR3 },
    { league_id: leagueId, team_id: t2, player_id: WR2 },
  ]), 'rosters')
  await must(
    service.from('team_lineups').insert([
      { team_id: t1, season: SEASON, week: 1, starters: [], bench: [], slot_map: { 'wr:0': WR1, 'wr:1': WR3 } },
      { team_id: t2, season: SEASON, week: 1, starters: [], bench: [], slot_map: { 'wr:0': WR2 } },
    ]),
    'lineups',
  )
}, 60_000)

afterAll(cleanup)

describe('L.E2.1 — stat-correction events through the REAL ingestWeek → door → worker, both sides of the lock', () => {
  it('SC1 the game LIVE: the first lines are ordinary deltas — written through the door, queued, scored; NO event', async () => {
    feed.status = 'live'
    feed.lines = { [WR1]: { receptions: 4, receiving_yards: 45, receiving_tds: 1 }, [WR3]: { receptions: 2, receiving_yards: 30 }, [WR2]: { receptions: 3, receiving_yards: 40 } }
    const report = await poll(T_LIVE)
    expect([report.write.path, report.stats.inserted, report.stats.enqueued, report.corrections.detected]).toEqual(['door', 3, 3, 0])
    expect(await events()).toEqual([])
    const batch = await drain()
    expect(batch.written).toBe(1)
    expect(await scores()).toBe('13.50/4.00 live -')
  })

  it('SC2 the poll that first sees the game FINAL carries its last in-game change — NOT a correction; the real advance opens the window', async () => {
    feed.status = 'final'
    feed.lines = { ...feed.lines, [WR1]: { receptions: 5, receiving_yards: 50, receiving_tds: 1 } }
    const report = await poll(T_FINAL_SEEN)
    expect([report.write.path, report.games.updated, report.stats.updated, report.corrections.detected]).toEqual(['door', 1, 1, 0])
    expect(report.corrections.reason).toBe('1 scoring delta(s), none to a line whose game was final before this poll — ordinary live deltas, no correction')
    expect(await events()).toEqual([])
    await drain()
    expect(await scores()).toBe('14.00/4.00 live -')
    clock.advanceTo(new Date(T_ADVANCE))
    expect((await service.rpc('league_week_advance', { p_now: T_ADVANCE, p_league_id: leagueId })).error).toBeNull()
    expect(await weekStatus()).toBe('correction_window')
  })

  it('SC3 INSIDE the window: WR1 50 → 60 writes EXACTLY ONE event (open) with the line and its queue row at one instant, and the week is RE-SCORED — it changed a league score', async () => {
    feed.lines = { ...feed.lines, [WR1]: { receptions: 5, receiving_yards: 60, receiving_tds: 1 } }
    const report = await poll(T_IN_WINDOW)
    expect(report.corrections).toMatchObject({ detected: 1, players: 1, recorded: 1, replayed: 0, unchangedAtWrite: 0, weekState: 'open', reason: '1 recorded' })
    expect(await events()).toEqual([`${WR1}:receiving_yards 50→60 @${T_IN_WINDOW} open fixture:sce ${GAME} applied=null`])
    // One instant, one transaction: the line, the queue row and the event carry the poll's stamp.
    const line = await must(service.from('player_stats').select('updated_at').eq('player_id', WR1).eq('season', SEASON).eq('week', 1).single(), 'line')
    const queued = await must(service.from('score_fanout').select('enqueued_at').eq('player_id', WR1).eq('season', SEASON).eq('week', 1).single(), 'queue')
    expect([new Date(line!.updated_at!).toISOString(), new Date(queued!.enqueued_at).toISOString()]).toEqual([T_IN_WINDOW, T_IN_WINDOW])
    const batch = await drain()
    expect(batch.written).toBe(1)
    expect(await scores()).toBe('15.00/4.00 live -')
  })

  it('SC4 a replay of the identical poll records nothing twice (and writes nothing: the diff is empty)', async () => {
    const report = await poll(T_IN_WINDOW)
    expect([report.write.path, report.corrections.detected]).toEqual(['none', 0])
    expect(await events()).toHaveLength(1)
  })

  it('SC5 the REAL finalize_matchups at week 2’s first kickoff: week 1 is FINAL', async () => {
    clock.advanceTo(new Date(WEEK2.kickoff))
    expect((await service.rpc('finalize_matchups', { p_now: WEEK2.kickoff, p_league_id: leagueId })).error).toBeNull()
    expect(await weekStatus()).toBe('final')
    expect(await scores()).toBe('15.00/4.00 final home')
  })

  it('SC6 AFTER the lock: WR1 60 → 80 is RECORDED (final — recorded only), research moves to 80, the worker consumes it as week_final, and every league cell is byte-identical', async () => {
    const before = await leagueCells()
    feed.lines = { ...feed.lines, [WR1]: { receptions: 6, receiving_yards: 80, receiving_tds: 1 } }
    const report = await poll(T_LATE)
    expect(report.corrections).toMatchObject({ detected: 2, recorded: 2, weekState: 'final' })
    expect(report.corrections.keys).toEqual([
      { player_id: WR1, stat_key: 'receptions', old: 5, new: 6 },
      { player_id: WR1, stat_key: 'receiving_yards', old: 60, new: 80 },
    ])
    expect((await events()).slice(1)).toEqual([
      `${WR1}:receiving_yards 60→80 @${T_LATE} final fixture:sce ${GAME} applied=null`,
      `${WR1}:receptions 5→6 @${T_LATE} final fixture:sce ${GAME} applied=null`,
    ])
    expect(await research()).toBe(80)
    const batch = await drain()
    expect(batch.written).toBe(0)
    expect(batch.problems).toContain(`[${leagueId} wk 1] league ${leagueId} week 1 skipped: week_final`)
    expect(await leagueCells()).toBe(before)
    expect(await scores()).toBe('15.00/4.00 final home')
  })

  it('SC7 DEPLOY BEFORE PUSH — the door under a name the database lacks answers PostgREST’s REAL PGRST202: the two-call path writes, says so, records nothing; the league still does not move', async () => {
    // PREMISE — the wire's answer for a missing door, measured here (and, for the real name, on the 166 stack).
    const probe = await service.rpc('ingest_write_batch_pre167' as never, { p_rows: [], p_now: T_LATE_PRE167 } as never)
    expect([probe.error?.code, probe.error?.message]).toEqual(['PGRST202', 'Could not find the function public.ingest_write_batch_pre167(p_now, p_rows) in the schema cache'])
    const before = await leagueCells()
    feed.lines = { ...feed.lines, [WR1]: { receptions: 6, receiving_yards: 79, receiving_tds: 1 } }
    const report = await poll(T_LATE_PRE167, 'ingest_write_batch_pre167')
    expect(report.write).toEqual({ path: 'two_call_fallback', door: 'ingest_write_batch_pre167' })
    expect(report.stats).toMatchObject({ updated: 1, deltas: 1, enqueued: 1 })
    expect(report.corrections).toMatchObject({ detected: 1, recorded: 0, reason: '1 detected, NOT recorded — the database predates migration 167' })
    expect(report.reasons).toContain(
      'ingest_write_batch_pre167 absent — the database predates migration 167 (PGRST202): the lines and the queue were written through the pre-167 two-call path (queue, then stats — R706); no stat_correction_events recorded',
    )
    expect(await events()).toHaveLength(3) // nothing new
    expect(await research()).toBe(79)
    const queued = await must(service.from('score_fanout').select('enqueued_at').eq('player_id', WR1).eq('season', SEASON).eq('week', 1).single(), 'queue')
    expect(new Date(queued!.enqueued_at).toISOString()).toBe(T_LATE_PRE167)
    const batch = await drain()
    expect(batch.problems).toContain(`[${leagueId} wk 1] league ${leagueId} week 1 skipped: week_final`)
    expect(await leagueCells()).toBe(before)
    // The score from SC6 stands — the week's t1 lineup never changed and neither did its stored points.
    expect(await scores()).toBe('15.00/4.00 final home')
    expect(t1).toBeTruthy()
  })
})

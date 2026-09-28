/**
 * finished-week-lineups-db.test.ts — PROGRESS F437 end to end on the REAL
 * stack (task L.D2.14, migration 152; spec §13.1 / §7.3.3 / §22.2 v2.16.62;
 * D410(5), D411). pgTAP 100 pins the lineup rows at fixed instants; this
 * suite proves what those rows are FOR — the points:
 *
 *   1. a week is scored through the real worker (queue → map → the WEEK's
 *      `team_lineups.slot_map` → the door): FW Alpha 25.00;
 *   2. the week's last game has ended but the next week has not begun (the
 *      "Tuesday" gap) and FW Alpha's manager DROPS the starter who played,
 *      through the public `roster_add_drop` door;
 *   3. a stat correction lands inside the correction window on a teammate
 *      and the week is RE-SCORED ⇒ FW Alpha keeps the dropped starter's
 *      points (28.00 — before 152 it was 8.00: his 20 points erased);
 *   4. another team picks the dropped starter up, then HIS OWN line is
 *      corrected ⇒ the correction lands on FW Alpha (the team whose week-1
 *      lineup started him), never on the team that holds him now.
 *
 * THE CLOCK. The manager's door evaluates at the database's `now()` (the
 * TimeProvider's production edge — §23.3), so this suite writes its own
 * calendar RELATIVE to the wall clock with hour-wide margins: week 1 of
 * season FIXTURE_SEASON (2098, owned by this suite — measured unused)
 * started six days ago and its last game ended an hour ago; week 2 starts
 * tomorrow. The WORKER takes an injected clock (a literal) and its stamps
 * are literals. Requires the local stack (D59(5)); FAILS loudly when it is
 * down. Fixture hygiene: every row carries the `vitest-fwl` prefix or hangs
 * off those leagues; cleanup-first and after, the season's calendar rows
 * included. Action-id prefix `f37` — this suite owns it (the D108(14)
 * registry; measured free 2026-09-28).
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import type { Database, Json } from '@/types/database'

import { type BatchReport, type ScoreWorkerClient, runScoreWeekBatch } from '../scoring/score-week-worker'
import { defaultsForTeamCount, splitSettings } from '../settings/league-settings'
import { systemTime } from '../time/time-provider'
import { VirtualClock } from '../time/virtual-clock'

const LOCAL_URL = process.env.SUPABASE_LOCAL_URL ?? 'http://127.0.0.1:54321'
const LOCAL_ANON_KEY =
  process.env.SUPABASE_LOCAL_ANON_KEY ??
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0'
const LOCAL_SERVICE_ROLE_KEY =
  process.env.SUPABASE_LOCAL_SERVICE_ROLE_KEY ??
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU'

const PREFIX = 'vitest-fwl'
const FIXTURE_SEASON = 2098

const COMMISH = { email: 'fwl-commish@fieldscout.test', password: 'pgtap-fwl-pass-1', username: 'fwl_commish' }
const MANAGER_A = { email: 'fwl-manager-a@fieldscout.test', password: 'pgtap-fwl-pass-2', username: 'fwl_manager_a' }
const MANAGER_B = { email: 'fwl-manager-b@fieldscout.test', password: 'pgtap-fwl-pass-3', username: 'fwl_manager_b' }

const ACTION = {
  league: 'f3700000-0000-4000-8000-000000000001',
  dropStarter: 'f3700000-0000-4000-8000-000000000011',
  pickUp: 'f3700000-0000-4000-8000-000000000012',
} as const

const P = {
  qb: `${PREFIX}-qb`, // FW Alpha's QB — played, then dropped on "Tuesday"
  wr: `${PREFIX}-wr`, // FW Alpha's WR — the teammate whose correction re-scores the week
  opp: `${PREFIX}-opp`, // FW Bravo's WR
} as const
const PLAYERS = [
  { id: P.qb, full_name: 'FWL QB', position: 'QB', team: 'FWA', status: 'Active' },
  { id: P.wr, full_name: 'FWL WR', position: 'WR', team: 'FWA', status: 'Active' },
  { id: P.opp, full_name: 'FWL OPP', position: 'WR', team: 'FWB', status: 'Active' },
]

/** Stat-poll stamps (literals; the worker's readiness compares them, never a clock). */
const STAMP_1 = '2098-09-10T20:00:00.000Z'
const STAMP_2 = '2098-09-11T20:00:00.000Z'
const STAMP_3 = '2098-09-12T20:00:00.000Z'

const HOUR = 3_600_000
const DAY = 24 * HOUR

const service = createClient<Database>(LOCAL_URL, LOCAL_SERVICE_ROLE_KEY, { auth: { persistSession: false } })
const clock = new VirtualClock(new Date('2098-09-12T20:00:05.000Z'))

let leagueId: string
let alpha: string
let bravo: string
let commishTeam: string
let managerA: SupabaseClient<Database>
let managerB: SupabaseClient<Database>

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
  await must(service.from('nfl_games').delete().eq('season', FIXTURE_SEASON), 'cleanup nfl_games')
  await must(service.from('nfl_weeks').delete().eq('season', FIXTURE_SEASON), 'cleanup nfl_weeks')
  await must(service.from('players').delete().like('id', `${PREFIX}-%`), 'cleanup players')
  for (const u of [COMMISH, MANAGER_A, MANAGER_B]) await deleteUserByUsername(u.username)
}

async function createUser(user: { email: string; password: string; username: string }): Promise<string> {
  const { data, error } = await service.auth.admin.createUser({
    email: user.email,
    password: user.password,
    email_confirm: true,
    user_metadata: { username: user.username },
  })
  if (error) throw new Error(`createUser failed for ${user.email}: ${error.message}`)
  return data.user.id
}

async function signIn(user: { email: string; password: string }): Promise<SupabaseClient<Database>> {
  const client = createClient<Database>(LOCAL_URL, LOCAL_ANON_KEY, { auth: { persistSession: false } })
  const { error } = await client.auth.signInWithPassword(user)
  if (error) throw new Error(`sign-in failed for ${user.email}: ${error.message}`)
  return client
}

async function plantLine(playerId: string, columns: Record<string, number>, stamp: string): Promise<void> {
  await must(
    service
      .from('player_stats')
      .upsert({ player_id: playerId, season: FIXTURE_SEASON, week: 1, stat_type: 'weekly', updated_at: stamp, advanced: {}, ...columns }, { onConflict: 'player_id,season,week' })
      .select('player_id'),
    `player_stats ${playerId}`,
  )
}

async function enqueue(playerIds: string[], stamp: string): Promise<void> {
  await must(
    service
      .from('score_fanout')
      .upsert(
        playerIds.map((player_id) => ({ season: FIXTURE_SEASON, week: 1, player_id, enqueued_at: stamp, deferred_until: null })),
        { onConflict: 'season,week,player_id', ignoreDuplicates: false },
      )
      .select('player_id'),
    'enqueue',
  )
}

function drain(): Promise<BatchReport> {
  return runScoreWeekBatch({ time: clock, db: service as unknown as ScoreWorkerClient }, { batchSize: 1000, leagueIds: [leagueId] })
}

async function weekOnePoints(): Promise<Record<string, number>> {
  const rows = await must(
    service.from('team_week_results').select('team_id, points').eq('league_id', leagueId).eq('season', FIXTURE_SEASON).eq('week', 1),
    'team_week_results read',
  )
  return Object.fromEntries((rows ?? []).map((r) => [r.team_id, Number(r.points)]))
}

async function slotMap(teamId: string, week: number): Promise<Record<string, string> | null> {
  const rows = await must(
    service.from('team_lineups').select('slot_map').eq('team_id', teamId).eq('season', FIXTURE_SEASON).eq('week', week),
    `team_lineups ${teamId} wk ${week}`,
  )
  return (rows?.[0]?.slot_map as Record<string, string> | undefined) ?? null
}

beforeAll(async () => {
  await cleanup()

  // THE CALENDAR — the "Tuesday" gap at the wall clock (see the header): the
  // door reads the database's now(), so the fixture reads the production
  // TimeProvider once, here, and never again.
  const now = systemTime.now().getTime()
  await must(
    service.from('nfl_weeks').insert([
      {
        season: FIXTURE_SEASON,
        week: 1,
        starts_at: new Date(now - 6 * DAY).toISOString(),
        last_game_ends_at: new Date(now - HOUR).toISOString(),
        correction_window_ends_at: new Date(now + 2 * DAY).toISOString(),
      },
      { season: FIXTURE_SEASON, week: 2, starts_at: new Date(now + DAY).toISOString(), last_game_ends_at: null, correction_window_ends_at: new Date(now + 9 * DAY).toISOString() },
      { season: FIXTURE_SEASON, week: 3, starts_at: new Date(now + 8 * DAY).toISOString(), last_game_ends_at: null, correction_window_ends_at: new Date(now + 16 * DAY).toISOString() },
    ]),
    'nfl_weeks',
  )
  await must(
    service.from('nfl_games').insert([
      { id: `${PREFIX}-g1`, season: FIXTURE_SEASON, week: 1, home_team: 'FWA', away_team: 'FWB', kickoff_at: new Date(now - 2 * DAY).toISOString(), status: 'final' },
      { id: `${PREFIX}-g2`, season: FIXTURE_SEASON, week: 2, home_team: 'FWA', away_team: 'FWB', kickoff_at: new Date(now + 3 * DAY).toISOString() },
    ]),
    'nfl_games',
  )
  await must(service.from('players').upsert(PLAYERS).select('id'), 'players')

  await createUser(COMMISH)
  const aId = await createUser(MANAGER_A)
  const bId = await createUser(MANAGER_B)
  const commishClient = await signIn(COMMISH)
  managerA = await signIn(MANAGER_A)
  managerB = await signIn(MANAGER_B)

  // THE LEAGUE — total_points, ESPN Standard, no waivers (a drop is a free
  // agent at once, so the pickup in cell 4 is the manager's own door).
  const base = defaultsForTeamCount(8)
  const { columns, blob } = splitSettings({ ...base, schedule_mode: 'total_points' as const, playoff_teams: 0 as const })
  const columnArgs = Object.fromEntries(Object.entries(columns).map(([key, value]) => [`p_${key}`, value]))
  const { data: template } = await commishClient.from('scoring_systems').select('id, rules').eq('is_template', true).eq('name', 'ESPN Standard').single()
  const { data: created, error } = await commishClient.rpc('create_league', {
    p_name: `${PREFIX}-league`,
    p_season: FIXTURE_SEASON,
    p_scoring_system_id: template?.id,
    p_team_name: 'FWL Commish',
    p_action_id: ACTION.league,
    p_settings: blob,
    ...columnArgs,
  } as unknown as Database['public']['Functions']['create_league']['Args'])
  if (error) throw new Error(`create_league failed: ${error.message}`)
  leagueId = (created as { league_id: string }).league_id
  commishTeam = (await must(service.from('teams').select('id').eq('league_id', leagueId).single(), 'commish team'))!.id
  const seats = await must(
    service
      .from('teams')
      .insert([
        { owner_id: aId, name: 'FWL Alpha', league_id: leagueId },
        { owner_id: bId, name: 'FWL Bravo', league_id: leagueId },
      ])
      .select('id, name'),
    'seats',
  )
  alpha = seats!.find((t) => t.name === 'FWL Alpha')!.id
  bravo = seats!.find((t) => t.name === 'FWL Bravo')!.id
  await must(
    service.from('league_members').insert([
      { league_id: leagueId, user_id: aId, team_id: alpha, role: 'manager' },
      { league_id: leagueId, user_id: bId, team_id: bravo, role: 'manager' },
    ]),
    'members',
  )
  await must(
    service
      .from('leagues')
      .update({ status: 'in_season', waiver_type: 'none_fcfs', scoring_rules_snapshot: template?.rules as Json })
      .eq('id', leagueId),
    'league → in_season',
  )

  // Week 1 walked to its correction window (one F4 step per UPDATE); week 2 ahead.
  await must(service.from('league_weeks').insert({ league_id: leagueId, season: FIXTURE_SEASON, week: 1 }), 'league_weeks 1')
  for (const step of ['live', 'correction_window'] as const) {
    await must(service.from('league_weeks').update({ status: step }).eq('league_id', leagueId).eq('week', 1), `week 1 → ${step}`)
  }
  await must(service.from('league_weeks').insert({ league_id: leagueId, season: FIXTURE_SEASON, week: 2 }), 'league_weeks 2')

  await must(
    service.from('league_rosters').insert([
      { league_id: leagueId, team_id: alpha, player_id: P.qb },
      { league_id: leagueId, team_id: alpha, player_id: P.wr },
      { league_id: leagueId, team_id: bravo, player_id: P.opp },
    ]),
    'rosters',
  )
  await must(
    service.from('team_lineups').insert([
      { team_id: alpha, season: FIXTURE_SEASON, week: 1, starters: [], bench: [], slot_map: { 'qb:0': P.qb, 'wr:0': P.wr } },
      { team_id: alpha, season: FIXTURE_SEASON, week: 2, starters: [], bench: [], slot_map: { 'qb:0': P.qb, 'wr:0': P.wr } },
      { team_id: bravo, season: FIXTURE_SEASON, week: 1, starters: [], bench: [], slot_map: { 'wr:0': P.opp } },
      { team_id: commishTeam, season: FIXTURE_SEASON, week: 1, starters: [], bench: [], slot_map: {} },
    ]),
    'lineups',
  )

  // ESPN Standard: QB 300 yds × 0.04 + 2 TD × 4 = 20.00; WR 50 × 0.1 = 5.00; OPP 30 × 0.1 = 3.00.
  await plantLine(P.qb, { pass_yards: 300, pass_tds: 2 }, STAMP_1)
  await plantLine(P.wr, { receiving_yards: 50 }, STAMP_1)
  await plantLine(P.opp, { receiving_yards: 30 }, STAMP_1)
  commishClient.realtime.disconnect()
}, 120_000)

afterAll(async () => {
  managerA?.realtime.disconnect()
  managerB?.realtime.disconnect()
  await cleanup()
})

describe('F437 — a Tuesday drop never erases a finished week’s points (migration 152)', () => {
  it('1. THE WEEK IS SCORED from its lineup: FWL Alpha 25.00 (QB 20 + WR 5), FWL Bravo 3.00', async () => {
    await enqueue([P.qb, P.wr, P.opp], STAMP_1)
    const report = await drain()
    expect(report.leagues.find((l) => l.league_id === leagueId && l.week === 1)?.outcome).toBe('written')
    const pts = await weekOnePoints()
    expect(pts[alpha]).toBe(25)
    expect(pts[bravo]).toBe(3)
  })

  it('2. THE TUESDAY DROP: the week’s last game has ended, the next week has not begun — the starter who played is droppable, and his FINISHED week-1 start is left alone', async () => {
    const { data, error } = await managerA.rpc('roster_add_drop', {
      p_league_id: leagueId,
      p_team_id: alpha,
      p_add: null as unknown as string,
      p_drop: P.qb,
      p_action_id: ACTION.dropStarter,
    })
    expect(error).toBeNull()
    const receipt = data as { week: number; drop: { lineups: Array<{ week: number; slot: string | null }>; to_state: string } }
    expect(receipt.week).toBe(1) // the current week is still 1 — the gap F437 lives in
    expect(receipt.drop.lineups).toEqual([{ week: 2, slot: 'qb:0' }]) // only the UNFINISHED week changed
    expect(receipt.drop.to_state).toBe('free_agent')
    expect(await slotMap(alpha, 1)).toEqual({ 'qb:0': P.qb, 'wr:0': P.wr })
    expect(await slotMap(alpha, 2)).toEqual({ 'wr:0': P.wr })
  })

  it('3. A CORRECTION IN THE WINDOW RE-SCORES THE WEEK — FWL Alpha keeps the dropped QB’s 20 points: 28.00 (before 152: 8.00)', async () => {
    // The teammate's line is corrected 50 → 80 yds (5.00 → 8.00); the drain
    // recomputes FWL Alpha from the WEEK's slot_map — every starter.
    await plantLine(P.wr, { receiving_yards: 80 }, STAMP_2)
    await enqueue([P.wr], STAMP_2)
    const report = await drain()
    const entry = report.leagues.find((l) => l.league_id === leagueId && l.week === 1)
    expect(entry?.outcome).toBe('written')
    expect(entry?.affected_team_ids).toEqual([alpha])
    const team = entry?.teams.find((t) => t.team_id === alpha)
    expect(team?.starters.map((s) => [s.player_id, s.points]).sort()).toEqual([
      [P.qb, 20],
      [P.wr, 8],
    ].sort())
    expect((await weekOnePoints())[alpha]).toBe(28)
  })

  it('4. HIS OWN CORRECTION FOLLOWS THE WEEK, NOT THE ROSTER: FWL Bravo picks him up, his line is corrected, and the new points land on FWL Alpha — FWL Bravo, which never started him in week 1, is untouched', async () => {
    const { error } = await managerB.rpc('roster_add_drop', {
      p_league_id: leagueId,
      p_team_id: bravo,
      p_add: P.qb,
      p_drop: null as unknown as string,
      p_action_id: ACTION.pickUp,
    })
    expect(error).toBeNull()
    // FWL Bravo's FINISHED week 1 does not gain him (the add, like the drop,
    // starts at the first unfinished week — no row there yet: 116's carry
    // benches him when week 2 opens).
    expect(await slotMap(bravo, 1)).toEqual({ 'wr:0': P.opp })
    const bravoWeek1 = await must(
      service.from('team_lineups').select('bench').eq('team_id', bravo).eq('season', FIXTURE_SEASON).eq('week', 1),
      'bravo week-1 bench',
    )
    expect(bravoWeek1?.[0]?.bench).toEqual([])

    // QB 300 → 350 yds: 14 + 8 = 22.00.
    await plantLine(P.qb, { pass_yards: 350, pass_tds: 2 }, STAMP_3)
    await enqueue([P.qb], STAMP_3)
    const report = await drain()
    const entry = report.leagues.find((l) => l.league_id === leagueId && l.week === 1)
    expect(entry?.outcome).toBe('written')
    expect(entry?.affected_team_ids).toEqual([alpha])
    const pts = await weekOnePoints()
    expect(pts[alpha]).toBe(30) // 22 + 8
    expect(pts[bravo]).toBe(3)
  })
})

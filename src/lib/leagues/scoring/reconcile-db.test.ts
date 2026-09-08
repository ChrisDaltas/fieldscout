/**
 * reconcile-db.test.ts — §23.2's reconciliation over the REAL stack (L.D2.3;
 * spec §23.2 / §23.4 / §24.1 / §7.3.3; PROGRESS D322, F238's assertion
 * half, F263(a) / F263(g), D294's mirror check — each a cell here).
 *
 * THE PLANTED DRIFT IS THE PROBE (tasks-M4 §6 L.D2.3 DoD): a stored score
 * is moved by hand (a service-role UPDATE — the only way a cell can be
 * wrong on this chain: the door refuses everything else), the job is run,
 * the alert NAMES the league, week, team, stored and recomputed values, and
 * the plant is reverted — the job then reads clean again. The job WRITES
 * NOTHING (measured: the wrong score is still stored after it ran).
 *
 * One h2h league + one total_points league on `SYNTHETIC_SEASON` (2099 —
 * F215/F226: every instant a literal; the clock is a VirtualClock). Two
 * `nfl_games` rows on 2099 week 1, both `final`, `last_game_ends_at`
 * NULL — the F238 shape (`all_final_unstamped`), stamped and restored
 * inside the cells that need it (pgTAP 003's NULL pin is over 2026; the
 * F199 census wants 2099 stamps 0 after).
 *
 * The stored scores are written through the REAL door
 * (`score_write_week_batch`) from the worker's own recompute so the clean
 * state is the production state, not a hand-typed one.
 *
 * Requires the local stack (001–122) — D59(5); FAILS loudly when the stack
 * is down, never skips. Fixture hygiene (F199): everything this suite
 * writes carries the `vitest-rc` prefix (leagues by name, players and
 * games by id) or hangs off those leagues; cleanup-first and after, by
 * prefix. Action-id prefix `aff` — measured free 2026-09-07 (the D108(14)
 * registry: af0–af4, af6–afe taken).
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import type { Database, Json } from '@/types/database'

import { defaultsForTeamCount, splitSettings } from '../settings/league-settings'
import { SYNTHETIC_SEASON, seedSyntheticSeason } from '../sim/synthetic-season'
import { VirtualClock } from '../time/virtual-clock'
import { type Finding, type ReconcileReport, reconcileSeason } from './reconcile'

const LOCAL_URL = process.env.SUPABASE_LOCAL_URL ?? 'http://127.0.0.1:54321'
const LOCAL_ANON_KEY =
  process.env.SUPABASE_LOCAL_ANON_KEY ??
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0'
const LOCAL_SERVICE_ROLE_KEY =
  process.env.SUPABASE_LOCAL_SERVICE_ROLE_KEY ??
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU'

const PREFIX = 'vitest-rc'
const SEASON = SYNTHETIC_SEASON
const COMMISH = { email: 'reconcile-commish@fieldscout.test', password: 'pgtap-rc-pass-1', username: 'rc_commish_one' }
const ACTION = { l1: 'aff00000-0000-4000-8000-000000000001', l2: 'aff00000-0000-4000-8000-000000000002' } as const

/** Monday of 2099 week 1 (week 1 starts Wed 2099-09-09 04:00Z; the games kicked off Sunday 2099-09-13). */
const NOW = new Date('2099-09-14T12:00:00.000Z')
const STAMP = '2099-09-13T20:00:00.000Z'
const KICKOFF = '2099-09-13T17:00:00.000Z'
/** 2099 week 1's correction window closes Thu 2099-09-17 10:00Z (synthetic-season.ts). */
const WINDOW_END = '2099-09-17T10:00:00.000Z'

const P = {
  qb1: `${PREFIX}-qb1`,
  rb1: `${PREFIX}-rb1`,
  wr1: `${PREFIX}-wr1`,
  wr2: `${PREFIX}-wr2`,
  fa1: `${PREFIX}-fa1`,
  q1: `${PREFIX}-q1`,
} as const

/** Each on its own made-up NFL team; RCA/RCB and RCC/RCD play the two week-1 games. */
const PLAYERS = [
  { id: P.qb1, full_name: 'RC QB1', position: 'QB', team: 'RCA', status: 'Active' },
  { id: P.rb1, full_name: 'RC RB1', position: 'RB', team: 'RCB', status: 'Active' },
  { id: P.wr1, full_name: 'RC WR1', position: 'WR', team: 'RCA', status: 'Active' },
  { id: P.wr2, full_name: 'RC WR2', position: 'WR', team: 'RCC', status: 'Active' }, // starts in a FINAL game with NO line (F263(g))
  { id: P.fa1, full_name: 'RC FA1', position: 'WR', team: 'RCD', status: 'Active' }, // dropped after his game — on NO roster (F263(a))
  { id: P.q1, full_name: 'RC Q1', position: 'RB', team: 'RCE', status: 'Active' }, // the total_points league's starter; RCE has no game (bye) — no F263(g)
]

/** Hand-computed on ESPN Standard (score-week-worker.test.ts' ALPHA lines):
 *  QB1 312 pass yds / 3 TD / 1 INT / 21 rush yds / 2 sacks = 24.58;
 *  RB1 87 rush / 1 TD / 4 rec / 33 rec yds / 1 FL = 16.00;
 *  WR1 7 rec / 115 yds / 1 TD / 1 two-pt = 19.50 ⇒ T1 = 60.08.
 *  FA1 50 rec yds = 5.00 ⇒ T3 = 5.00. Q1 50 rush yds = 5.00 (L2). */
const LINES: Array<{ player_id: string; columns: Record<string, number> }> = [
  { player_id: P.qb1, columns: { pass_yards: 312, pass_tds: 3, interceptions: 1, rush_yards: 21, sacks_taken: 2 } },
  { player_id: P.rb1, columns: { rush_yards: 87, rush_tds: 1, receptions: 4, receiving_yards: 33, fumbles_lost: 1 } },
  { player_id: P.wr1, columns: { receptions: 7, receiving_yards: 115, receiving_tds: 1, rec_2pt: 1 } },
  { player_id: P.fa1, columns: { receiving_yards: 50 } },
  { player_id: P.q1, columns: { rush_yards: 50 } },
]

const service = createClient<Database>(LOCAL_URL, LOCAL_SERVICE_ROLE_KEY, { auth: { persistSession: false } })
const clock = new VirtualClock(NOW)

interface Fixture {
  l1: string
  l2: string
  t1: string
  t2: string
  t3: string
  t4: string
  a: string
  b: string
  m12: string
  m34: string
}
let fx: Fixture
let commishId: string
let commishClient: SupabaseClient<Database>

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
  await must(service.from('nfl_games').delete().like('id', `${PREFIX}-%`), 'cleanup nfl_games')
  await must(service.from('nfl_weeks').update({ last_game_ends_at: null, first_kickoff_at: null }).eq('season', SEASON).eq('week', 1), 'restore nfl_weeks 2099 wk 1')
  await must(service.from('players').delete().like('id', `${PREFIX}-%`), 'cleanup players')
  await deleteUserByUsername(COMMISH.username)
}

async function createUser(user: { email: string; password: string; username: string }): Promise<string> {
  const { data, error } = await service.auth.admin.createUser({ email: user.email, password: user.password, email_confirm: true, user_metadata: { username: user.username } })
  if (error) throw new Error(`createUser failed for ${user.email}: ${error.message}`)
  return data.user.id
}

async function signIn(user: { email: string; password: string }): Promise<SupabaseClient<Database>> {
  const client = createClient<Database>(LOCAL_URL, LOCAL_ANON_KEY, { auth: { persistSession: false } })
  const { error } = await client.auth.signInWithPassword(user)
  if (error) throw new Error(`sign-in failed for ${user.email}: ${error.message}`)
  return client
}

async function createLeague(name: string, actionId: string, mode: 'h2h' | 'total_points', seats: number): Promise<{ id: string; teams: string[] }> {
  const base = defaultsForTeamCount(8)
  const settings = mode === 'total_points' ? { ...base, schedule_mode: 'total_points' as const, playoff_teams: 0 as const } : base
  const { columns, blob } = splitSettings(settings)
  const columnArgs = Object.fromEntries(Object.entries(columns).map(([key, value]) => [`p_${key}`, value]))
  const { data: template } = await commishClient.from('scoring_systems').select('id, rules').eq('is_template', true).eq('name', 'ESPN Standard').single()
  const { data: created, error } = await commishClient.rpc('create_league', {
    p_name: name,
    p_season: SEASON,
    p_scoring_system_id: template?.id,
    p_team_name: 'Commish Team',
    p_action_id: actionId,
    p_settings: blob,
    ...columnArgs,
  } as unknown as Database['public']['Functions']['create_league']['Args'])
  if (error) throw new Error(`create_league(${name}) failed: ${error.message}`)
  const id = (created as { league_id: string }).league_id
  const commishTeam = await must(service.from('teams').select('id').eq('league_id', id).single(), 'commish team')
  const extra =
    seats > 1
      ? await must(service.from('teams').insert(Array.from({ length: seats - 1 }, (_, i) => ({ owner_id: commishId, name: `Seat ${i + 2}`, league_id: id }))).select('id'), 'extra seats')
      : []
  await must(service.from('leagues').update({ status: 'in_season', scoring_rules_snapshot: template!.rules as Json }).eq('id', id), 'league → in_season')
  return { id, teams: [commishTeam!.id, ...(extra ?? []).map((t) => t.id)] }
}

/** One legal F4 step per UPDATE (110's guard). */
async function stepWeek(leagueId: string, week: number, to: 'live' | 'correction_window' | 'final'): Promise<void> {
  await must(service.from('league_weeks').update({ status: to }).eq('league_id', leagueId).eq('week', week), `league_weeks ${week} → ${to}`)
}

async function plantLine(playerId: string, columns: Record<string, number>, stamp: string): Promise<void> {
  await must(
    service.from('player_stats').upsert({ player_id: playerId, season: SEASON, week: 1, stat_type: 'weekly', updated_at: stamp, advanced: {}, ...columns }, { onConflict: 'player_id,season,week' }).select('player_id'),
    `player_stats ${playerId}`,
  )
}

function run(leagueIds?: string[], time: VirtualClock = clock): Promise<ReconcileReport> {
  return reconcileSeason({ time, db: service }, { season: SEASON, leagueIds: leagueIds ?? [fx.l1, fx.l2] })
}

function kinds(report: ReconcileReport, leagueId?: string): string[] {
  return report.findings.filter((f) => (leagueId ? f.league_id === leagueId : f.league_id === undefined)).map((f) => f.kind).sort()
}

function find(report: ReconcileReport, kind: Finding['kind']): Finding[] {
  return report.findings.filter((f) => f.kind === kind)
}

async function storedScore(matchupId: string): Promise<{ home: number | null; away: number | null }> {
  const row = await must(service.from('matchups').select('home_score, away_score').eq('id', matchupId).single(), 'matchup read')
  return { home: row!.home_score === null ? null : Number(row!.home_score), away: row!.away_score === null ? null : Number(row!.away_score) }
}

beforeAll(async () => {
  await cleanup()
  await seedSyntheticSeason(service)
  commishId = await createUser(COMMISH)
  commishClient = await signIn(COMMISH)
  await must(service.from('players').upsert(PLAYERS).select('id'), 'players')

  // Two FINAL week-1 games, the week unstamped (the F238 shape).
  await must(
    service.from('nfl_games').insert([
      { id: `${PREFIX}-g1`, season: SEASON, week: 1, home_team: 'RCA', away_team: 'RCB', kickoff_at: KICKOFF, status: 'final', game_type: 'regular' },
      { id: `${PREFIX}-g2`, season: SEASON, week: 1, home_team: 'RCC', away_team: 'RCD', kickoff_at: KICKOFF, status: 'final', game_type: 'regular' },
    ]),
    'nfl_games',
  )

  // ── L1: h2h, four seats, week 1 live ──
  const l1 = await createLeague(`${PREFIX}-h2h`, ACTION.l1, 'h2h', 4)
  const [t1, t2, t3, t4] = l1.teams
  await must(service.from('league_weeks').insert({ league_id: l1.id, season: SEASON, week: 1 }), 'L1 week 1')
  await stepWeek(l1.id, 1, 'live')
  const m = await must(
    service
      .from('matchups')
      .insert([
        { league_id: l1.id, season: SEASON, week: 1, round_type: 'regular', home_team_id: t1, away_team_id: t2, status: 'live' },
        { league_id: l1.id, season: SEASON, week: 1, round_type: 'regular', home_team_id: t3, away_team_id: t4, status: 'live' },
      ])
      .select('id, home_team_id'),
    'L1 matchups',
  )
  const m12 = m!.find((x) => x.home_team_id === t1)!.id
  const m34 = m!.find((x) => x.home_team_id === t3)!.id
  await must(service.from('league_rosters').insert([{ league_id: l1.id, team_id: t1, player_id: P.qb1 }, { league_id: l1.id, team_id: t1, player_id: P.rb1 }, { league_id: l1.id, team_id: t1, player_id: P.wr1 }, { league_id: l1.id, team_id: t2, player_id: P.wr2 }]), 'L1 rosters')
  await must(service.from('league_player_pool').insert([{ league_id: l1.id, player_id: P.qb1, state: 'rostered' }, { league_id: l1.id, player_id: P.rb1, state: 'rostered' }]), 'L1 pool (lazy rows for the rest)')
  await must(
    service.from('team_lineups').insert([
      { team_id: t1, season: SEASON, week: 1, starters: [], bench: [], slot_map: { 'qb:0': P.qb1, 'rb:0': P.rb1, 'wr:0': P.wr1 } },
      { team_id: t2, season: SEASON, week: 1, starters: [], bench: [], slot_map: { 'wr:0': P.wr2 } },
      { team_id: t3, season: SEASON, week: 1, starters: [], bench: [], slot_map: { 'wr:0': P.fa1 } }, // fa1 is on NO roster — dropped after his game (E34 keeps the slot)
      { team_id: t4, season: SEASON, week: 1, starters: [], bench: [], slot_map: {} },
    ]),
    'L1 lineups',
  )

  // ── L2: total_points, two seats, week 1 live, one provisional row ──
  const l2 = await createLeague(`${PREFIX}-tp`, ACTION.l2, 'total_points', 2)
  const [a, b] = l2.teams
  await must(service.from('league_weeks').insert({ league_id: l2.id, season: SEASON, week: 1 }), 'L2 week 1')
  await stepWeek(l2.id, 1, 'live')
  await must(service.from('league_rosters').insert([{ league_id: l2.id, team_id: a, player_id: P.q1 }]), 'L2 roster')
  await must(service.from('team_lineups').insert([{ team_id: a, season: SEASON, week: 1, starters: [], bench: [], slot_map: { 'rb:0': P.q1 } }]), 'L2 lineup')

  for (const line of LINES) await plantLine(line.player_id, line.columns, STAMP)

  // The stored scores, through the REAL door, from the hand-computed literals.
  const door1 = await service.rpc('score_write_week_batch', {
    p_league_id: l1.id,
    p_week: 1,
    p_scores: [{ team_id: t1, points: 60.08 }, { team_id: t2, points: 0 }, { team_id: t3, points: 5 }, { team_id: t4, points: 0 }] as unknown as Json,
  })
  if (door1.error) throw new Error(`door L1: ${door1.error.message}`)
  const door2 = await service.rpc('score_write_week_batch', { p_league_id: l2.id, p_week: 1, p_scores: [{ team_id: a, points: 5 }] as unknown as Json })
  if (door2.error) throw new Error(`door L2: ${door2.error.message}`)

  fx = { l1: l1.id, l2: l2.id, t1, t2, t3, t4, a, b, m12, m34 }
}, 60_000)

afterAll(cleanup)

describe('§23.2 reconciliation over the real stack (L.D2.3)', () => {
  it('CLEAN STATE: every cell agrees with the recompute — no drift; the findings are exactly the calendar’s F238 shape and F263(g) — and the job wrote nothing', async () => {
    const report = await run()
    expect(report.leagues).toBe(2)
    expect(report.league_weeks).toBe(2)
    expect(report.cells).toBe(5) // L1: T1, T2, T3, T4; L2: A
    expect(report.excluded_overridden).toBe(0)
    expect(find(report, 'drift')).toEqual([])
    // F263(g): WR2 starts for T2, RCC's game is FINAL, he has no line — alerted by name, never zero-filled.
    const g = find(report, 'starter_final_game_no_line')
    expect(g).toHaveLength(1)
    expect(g[0]).toMatchObject({ severity: 'alert', league_id: fx.l1, week: 1, team_id: fx.t2, player_id: P.wr2 })
    expect(g[0].message).toMatch(/is in a FINAL game and has NO player_stats row/)
    // F263(a): FA1 is on NO roster and STILL starts for T3 — the recompute reaches him (5.00 stored = 5.00 recomputed, no finding).
    expect(kinds(report, fx.l1)).toEqual(['starter_final_game_no_line'])
    expect(kinds(report, fx.l2)).toEqual([])
    // F238: 2099 week 1 is all-final and UNSTAMPED; week 2 (starts 2099-09-16, inside the 7-day lookahead) has no game rows (F228).
    expect(find(report, 'all_final_unstamped').map((f) => f.week)).toEqual([1])
    expect(find(report, 'no_game_rows').map((f) => f.week)).toEqual([2])
    expect(report.alerts).toBe(3)
    expect(report.reason).toBeNull()
    // The stored scores are exactly what the door wrote — the job wrote nothing.
    expect(await storedScore(fx.m12)).toEqual({ home: 60.08, away: 0 })
  })

  it('THE PROBE — a planted wrong stored score is ALERTED BY NAME (league, week, team, stored, recomputed, the starters), the store is NOT touched by the job, and the plant reverted reads clean', async () => {
    await must(service.from('matchups').update({ home_score: 61.08 }).eq('id', fx.m12), 'plant')
    const report = await run()
    const drift = find(report, 'drift')
    expect(drift).toHaveLength(1)
    expect(drift[0]).toMatchObject({ severity: 'alert', league_id: fx.l1, week: 1, team_id: fx.t1, stored: 61.08, recomputed: 60.08 })
    expect(drift[0].message).toContain(`league_id=${fx.l1} (${PREFIX}-h2h) week 1 team ${fx.t1} [matchup ${fx.m12} (regular) home]: stored 61.08 ≠ recomputed 60.08`)
    expect((drift[0].detail as { starters: Array<{ player_id: string; points: number }> }).starters.map((s) => [s.player_id, s.points])).toEqual([
      [P.qb1, 24.58],
      [P.rb1, 16],
      [P.wr1, 19.5],
    ])
    expect(await storedScore(fx.m12)).toEqual({ home: 61.08, away: 0 }) // never a silent fix
    await must(service.from('matchups').update({ home_score: 60.08 }).eq('id', fx.m12), 'revert')
    expect(find(await run(), 'drift')).toEqual([])
  })

  it('an OVERRIDDEN cell is excluded, never compared (§22.2/§23.2)', async () => {
    await must(service.from('matchups').update({ is_overridden: true, home_score: 55, away_score: 44 }).eq('id', fx.m34), 'override')
    const report = await run()
    expect(report.excluded_overridden).toBe(1)
    expect(report.cells).toBe(3)
    expect(find(report, 'drift')).toEqual([])
    await must(service.from('matchups').update({ is_overridden: false, home_score: 5, away_score: 0 }).eq('id', fx.m34), 'un-override')
    expect((await run()).cells).toBe(5)
  })

  it('IN FLIGHT: a queued delta explains a mismatch (info, no drift); a queue row older than an hour is a STUCK QUEUE alert ONCE, at the row — not per cell (R881); the cell stays in_flight', async () => {
    await must(service.from('matchups').update({ home_score: 61.08 }).eq('id', fx.m12), 'mismatch')
    const fresh = new Date(NOW.getTime() - 60_000).toISOString()
    await must(service.from('score_fanout').insert({ season: SEASON, week: 1, player_id: P.rb1, enqueued_at: fresh }).select('player_id'), 'queue')
    const inFlight = await run()
    expect(find(inFlight, 'drift')).toEqual([])
    expect(find(inFlight, 'stuck_queue')).toEqual([])
    expect(find(inFlight, 'in_flight')).toHaveLength(1)
    expect(find(inFlight, 'in_flight')[0]).toMatchObject({ severity: 'info', team_id: fx.t1 })
    const stale = new Date(NOW.getTime() - 2 * 3_600_000).toISOString()
    await must(service.from('score_fanout').update({ enqueued_at: stale }).eq('player_id', P.rb1).eq('week', 1).select('player_id'), 'age the row')
    const stuck = await run()
    expect(find(stuck, 'stuck_queue')).toHaveLength(1)
    expect(find(stuck, 'stuck_queue')[0]).toMatchObject({ severity: 'alert', week: 1, player_id: P.rb1 })
    expect(find(stuck, 'stuck_queue')[0].league_id).toBeUndefined() // the row's alert, season-wide — one line however many cells start him
    expect(find(stuck, 'stuck_queue')[0].team_id).toBeUndefined()
    expect(find(stuck, 'in_flight')).toHaveLength(1) // the mismatched cell still reads in flight
    await must(service.from('score_fanout').delete().eq('player_id', P.rb1), 'dequeue')
    await must(service.from('matchups').update({ home_score: 60.08 }).eq('id', fx.m12), 'revert')
  })

  it('F263(g) is TIME-BOUNDED (R877): WR2’s missing line alerts while the window is ahead and until 24 h after it closes; one millisecond past that it is no longer re-alerted', async () => {
    const graceEnd = new Date(new Date(WINDOW_END).getTime() + 24 * 3_600_000)
    // Exactly 24 h past the close — the Thursday run's last sight of it.
    expect(find(await run(undefined, new VirtualClock(graceEnd)), 'starter_final_game_no_line').map((f) => f.player_id)).toEqual([P.wr2])
    // One millisecond more — an older final week, not re-alerted every night for the season.
    const later = await run(undefined, new VirtualClock(new Date(graceEnd.getTime() + 1)))
    expect(find(later, 'starter_final_game_no_line')).toEqual([])
    expect(find(later, 'drift')).toEqual([]) // the cells still agree (WR2 is 0 by name either way)
    const back = find(await run(), 'starter_final_game_no_line')
    expect(back.map((f) => f.player_id)).toEqual([P.wr2])
    expect(back[0].message).toMatch(/players\.team, the player's CURRENT team/)
    const detail = back[0].detail as { current_team: string; window_ends_at: string }
    expect(detail.current_team).toBe('RCC')
    expect(new Date(detail.window_ends_at).toISOString()).toBe(WINDOW_END) // PostgREST prints +00:00; the instant is the pin
  })

  it('POOL MIRROR (D294): a `rostered` pool row with no roster row, and a rostered player whose pool row says free_agent, each ALERT; the mirror repaired reads clean', async () => {
    await must(service.from('league_player_pool').insert({ league_id: fx.l1, player_id: P.q1, state: 'rostered' }), 'ghost rostered')
    await must(service.from('league_player_pool').update({ state: 'free_agent' }).eq('league_id', fx.l1).eq('player_id', P.qb1), 'rostered as FA')
    const report = await run()
    const broken = find(report, 'pool_mirror_broken')
    expect(broken.map((f) => f.player_id).sort()).toEqual([P.q1, P.qb1].sort())
    expect(broken.every((f) => f.severity === 'alert' && f.league_id === fx.l1)).toBe(true)
    await must(service.from('league_player_pool').delete().eq('league_id', fx.l1).eq('player_id', P.q1), 'remove ghost')
    await must(service.from('league_player_pool').update({ state: 'rostered' }).eq('league_id', fx.l1).eq('player_id', P.qb1), 'repair')
    expect(find(await run(), 'pool_mirror_broken')).toEqual([])
  })

  it('total_points cells come from team_week_results: a planted wrong provisional row drifts by name; reverted reads clean', async () => {
    await must(service.from('team_week_results').update({ points: 6 }).eq('league_id', fx.l2).eq('team_id', fx.a).eq('week', 1), 'plant')
    const report = await run()
    const drift = find(report, 'drift')
    expect(drift).toHaveLength(1)
    expect(drift[0]).toMatchObject({ league_id: fx.l2, team_id: fx.a, stored: 6, recomputed: 5 })
    expect(drift[0].message).toContain('[team_week_results]')
    await must(service.from('team_week_results').update({ points: 5 }).eq('league_id', fx.l2).eq('team_id', fx.a).eq('week', 1), 'revert')
    expect(find(await run(), 'drift')).toEqual([])
  })

  it('F238’s assertion half: stamping last_game_ends_at clears `all_final_unstamped`; a game the provider never flipped is named `game_not_final_late`; restored', async () => {
    await must(service.from('nfl_weeks').update({ last_game_ends_at: '2099-09-14T04:00:00.000Z' }).eq('season', SEASON).eq('week', 1).select('week'), 'stamp')
    expect(find(await run(), 'all_final_unstamped')).toEqual([])
    await must(service.from('nfl_games').update({ status: 'live' }).eq('id', `${PREFIX}-g2`).select('id'), 'never flipped')
    const late = await run()
    expect(find(late, 'game_not_final_late')).toHaveLength(1)
    expect(find(late, 'game_not_final_late')[0].message).toMatch(/kicked off 19 h ago and is still 'live'/) // 17:00Z Sunday → 12:00Z Monday
    expect(find(late, 'starter_final_game_no_line')).toEqual([]) // RCC's game is no longer final — WR2's missing line is not (yet) a provider gap
    await must(service.from('nfl_games').update({ status: 'final' }).eq('id', `${PREFIX}-g2`).select('id'), 'restore')
    await must(service.from('nfl_weeks').update({ last_game_ends_at: null }).eq('season', SEASON).eq('week', 1).select('week'), 'unstamp')
    expect(find(await run(), 'all_final_unstamped').map((f) => f.week)).toEqual([1])
  })

  it('a FINAL week: a starter moved AFTER the correction window is a post-window correction (WARN naming the delta — §23.4/R876), the same delta INSIDE the window is drift; the derived results mirror is asserted (twr_mirror_drift)', async () => {
    await stepWeek(fx.l1, 1, 'correction_window')
    await stepWeek(fx.l1, 1, 'final')
    await must(
      service.from('team_week_results').insert([
        { league_id: fx.l1, team_id: fx.t1, season: SEASON, week: 1, points: 60.08, is_final: true },
        { league_id: fx.l1, team_id: fx.t2, season: SEASON, week: 1, points: 1, is_final: true }, // ≠ the matchup's 0
      ]),
      'results',
    )
    // RB1 moves 87 → 97 yds (+1.00) after the window closed: recomputed 61.08 vs stored 60.08.
    await plantLine(P.rb1, { rush_yards: 97, rush_tds: 1, receptions: 4, receiving_yards: 33, fumbles_lost: 1 }, '2099-09-17T10:00:00.001Z')
    const post = await run()
    expect(find(post, 'drift')).toEqual([])
    const pw = find(post, 'post_window_correction')
    expect(pw).toHaveLength(1)
    expect(pw[0]).toMatchObject({ severity: 'warn', team_id: fx.t1, stored: 60.08, recomputed: 61.08 })
    expect(pw[0].message).toContain(`${P.rb1} moved after the correction window closed (${WINDOW_END}): stored 60.08 ≠ recomputed 61.08, Δ 1.00`)
    expect(post.alerts).toBe(find(post, 'twr_mirror_drift').length + find(post, 'starter_final_game_no_line').length + find(post, 'all_final_unstamped').length + find(post, 'no_game_rows').length) // the warn is not on the exit-1 path
    const mirror = find(post, 'twr_mirror_drift')
    expect(mirror).toHaveLength(1)
    expect(mirror[0]).toMatchObject({ severity: 'alert', team_id: fx.t2, stored: 1, recomputed: 0 })
    // The same delta stamped INSIDE the window is drift on a final week.
    await plantLine(P.rb1, { rush_yards: 97, rush_tds: 1, receptions: 4, receiving_yards: 33, fumbles_lost: 1 }, WINDOW_END)
    const inside = await run()
    expect(find(inside, 'post_window_correction')).toEqual([])
    expect(find(inside, 'drift').map((f) => f.team_id)).toEqual([fx.t1])
  })
})

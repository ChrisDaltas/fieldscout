/**
 * lost-scores-db.test.ts — F863 over the REAL stack: the production worker, the
 * production door, the queue, migration 216's close pass and finalize (PROGRESS
 * F863 / Q105; F256(b), F273, F859, F860; Chris 2026-11-05: "A failed save gets
 * retried instead of thrown away." "Updates that were lost get scored again."
 * "A week can't close while it's still owed a score.").
 *
 *   FS  a failed save: the row is DEFERRED (not deleted), retried after its
 *       hold, and a row that never succeeds stays loud without spinning.
 *   CP  the close pass: the real 0 of a team no update reached, a starter with
 *       no line, a team with no lineup row, all named; never a hold.
 *   LO  F256(b) through the real worker: an update consumed as `no_matchup_row`
 *       comes back when the round exists.
 *   OW  F859: a queue behind the close, finalize waits, the pass scores it, the
 *       leftover row is consumed as `week_final` and changes nothing.
 *   SC  a corrected line scored by the close pass keeps its league record, once.
 *   RM  the refusals: no stat lines at all, an unreadable lineup, a line that
 *       moved under the pass (the stamp refuses, the next pass re-scores).
 *   RC  reconcile: a blank is never drift; a blank with points behind it is
 *       `blank_owed`; a week past its window is `week_held`.
 *
 * Requires the local stack (D59(5)); FAILS loudly when it is down, never skips.
 * Fixture hygiene (F199): everything carries the `vitest-ls` prefix.
 * Weeks 11–16 of the synthetic season; every instant a literal.
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import type { Database, Json } from '@/types/database'

import { defaultsForTeamCount, splitSettings } from '../settings/league-settings'
import { SYNTHETIC_SEASON, seedSyntheticSeason } from '../sim/synthetic-season'
import { VirtualClock } from '../time/virtual-clock'
import { reconcileSeason } from './reconcile'
import { classifyClose, classifyDrain } from './score-week-invoker'
import { runCloseScoring, runScoreWeekBatch, type ScoreWorkerClient } from './score-week-worker'

const LOCAL_URL = process.env.SUPABASE_LOCAL_URL ?? 'http://127.0.0.1:54321'
const LOCAL_ANON_KEY =
  process.env.SUPABASE_LOCAL_ANON_KEY ??
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0'
const LOCAL_SERVICE_ROLE_KEY =
  process.env.SUPABASE_LOCAL_SERVICE_ROLE_KEY ??
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU'

const PREFIX = 'vitest-ls'
const SEASON = SYNTHETIC_SEASON
const COMMISH = { email: 'lost-scores-commish@fieldscout.test', password: 'pgtap-ls-pass-1', username: 'ls_commish_one' }

const service = createClient<Database>(LOCAL_URL, LOCAL_SERVICE_ROLE_KEY, { auth: { persistSession: false } })
const db = service as unknown as ScoreWorkerClient
let commishClient: SupabaseClient<Database>
let commishId = ''
const WINDOW_BY_WEEK = new Map<number, string>()

async function must<T>(p: PromiseLike<{ data: T; error: { message: string } | null }>, what: string): Promise<T> {
  const { data, error } = await p
  if (error) throw new Error(`${what}: ${error.message}`)
  return data
}

async function cleanup(): Promise<void> {
  await must(service.from('score_fanout').delete().like('player_id', `${PREFIX}-%`), 'cleanup score_fanout')
  await must(service.from('stat_correction_events').delete().like('player_id', `${PREFIX}-%`), 'cleanup events')
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
    await must(service.from('teams').update({ league_id: null }).in('id', teamIds), 'cleanup teams detach')
    await must(service.from('leagues').delete().in('id', ids), 'cleanup leagues')
    if (teamIds.length > 0) await must(service.from('teams').delete().in('id', teamIds), 'cleanup teams')
  }
  await must(service.from('nfl_games').delete().like('id', `${PREFIX}-%`), 'cleanup games')
  await must(service.from('players').delete().like('id', `${PREFIX}-%`), 'cleanup players')
  await must(service.from('nfl_weeks').update({ last_game_ends_at: null }).eq('season', SEASON).gte('week', 11).lte('week', 16), 'cleanup nfl_weeks')
  const { data: users } = await service.from('profiles').select('id').eq('username', COMMISH.username)
  for (const u of users ?? []) await service.auth.admin.deleteUser(u.id)
}

interface World {
  id: string
  teams: string[]
}

async function league(name: string, seats: number, playoffTeams = 0): Promise<World> {
  const base = defaultsForTeamCount(8)
  const { columns, blob } = splitSettings(base)
  const columnArgs = Object.fromEntries(Object.entries(columns).map(([key, value]) => [`p_${key}`, value]))
  const { data: template } = await commishClient.from('scoring_systems').select('id, rules').eq('is_template', true).eq('name', 'ESPN Standard').single()
  const { data: created, error } = await commishClient.rpc('create_league', {
    p_name: `${PREFIX}-${name}`,
    p_season: SEASON,
    p_scoring_system_id: template?.id,
    p_team_name: 'T1',
    p_action_id: crypto.randomUUID(),
    p_settings: blob,
    ...columnArgs,
  } as unknown as Database['public']['Functions']['create_league']['Args'])
  if (error) throw new Error(`create_league(${name}): ${error.message}`)
  const id = (created as { league_id: string }).league_id
  const first = await must(service.from('teams').select('id').eq('league_id', id).single(), 'first team')
  const extra =
    seats > 1
      ? await must(
          service.from('teams').insert(Array.from({ length: seats - 1 }, (_, i) => ({ owner_id: commishId, name: `T${i + 2}`, league_id: id }))).select('id'),
          'extra teams',
        )
      : []
  await must(
    service.from('leagues').update({ status: 'in_season', regular_season_weeks: 14, playoff_teams: playoffTeams, scoring_rules_snapshot: template?.rules as Json }).eq('id', id),
    'in_season',
  )
  return { id, teams: [first!.id, ...(extra ?? []).map((t) => t.id)] }
}

async function setWeek(leagueId: string, week: number, status: 'live' | 'correction_window'): Promise<void> {
  await must(service.from('league_weeks').insert({ league_id: leagueId, season: SEASON, week }), `league_weeks ${week}`)
  await must(service.from('league_weeks').update({ status: 'live' }).eq('league_id', leagueId).eq('week', week), 'live')
  if (status === 'correction_window') await must(service.from('league_weeks').update({ status }).eq('league_id', leagueId).eq('week', week), 'window')
}

async function player(id: string): Promise<string> {
  const pid = `${PREFIX}-${id}`
  await must(service.from('players').upsert({ id: pid, full_name: pid, position: 'QB', team: 'SEA', status: 'Active' }).select('id'), 'player')
  return pid
}

async function lineup(teamId: string, week: number, slotMap: Json): Promise<void> {
  await must(service.from('team_lineups').insert({ team_id: teamId, season: SEASON, week, starters: [], bench: [], slot_map: slotMap }), 'lineup')
}

async function roster(leagueId: string, teamId: string, playerId: string): Promise<void> {
  await must(service.from('league_rosters').insert({ league_id: leagueId, team_id: teamId, player_id: playerId }), 'roster')
}

async function line(playerId: string, week: number, yards: number, stamp: string): Promise<void> {
  await must(
    service
      .from('player_stats')
      .upsert({ player_id: playerId, season: SEASON, week, stat_type: 'weekly', updated_at: stamp, advanced: {}, pass_yards: yards }, { onConflict: 'player_id,season,week' })
      .select('player_id'),
    'line',
  )
}

async function enqueue(playerId: string, week: number, stamp: string): Promise<void> {
  await must(
    service.from('score_fanout').upsert({ season: SEASON, week, player_id: playerId, enqueued_at: stamp, deferred_until: null }, { onConflict: 'season,week,player_id', ignoreDuplicates: false }).select('player_id'),
    'enqueue',
  )
}

async function pair(leagueId: string, week: number, home: string, away: string | null): Promise<void> {
  await must(service.from('matchups').insert({ league_id: leagueId, season: SEASON, week, round_type: 'regular', home_team_id: home, away_team_id: away, status: 'live' }), 'pair')
}

async function gamesOver(week: number, lastGame: string): Promise<void> {
  await must(
    service.from('nfl_games').upsert({ id: `${PREFIX}-g${week}`, season: SEASON, week, home_team: 'SEA', away_team: 'KC', kickoff_at: lastGame, status: 'final' }, { onConflict: 'id' }).select('id'),
    'game',
  )
  await must(service.from('nfl_weeks').update({ last_game_ends_at: lastGame }).eq('season', SEASON).eq('week', week).select('week'), 'week over')
  const row = await must(service.from('nfl_weeks').select('correction_window_ends_at').eq('season', SEASON).eq('week', week).single(), 'window')
  WINDOW_BY_WEEK.set(week, row!.correction_window_ends_at as string)
}

const pastWindow = (week: number) => new Date(Date.parse(WINDOW_BY_WEEK.get(week)!) + 65 * 60_000).toISOString()

async function finalize(leagueId: string, at: string): Promise<{ finalized: number; skipped: Array<{ week: number; reason: string; why?: string }> }> {
  const data = await must(service.rpc('finalize_matchups', { p_now: at, p_league_id: leagueId }), 'finalize')
  return data as unknown as { finalized: number; skipped: Array<{ week: number; reason: string; why?: string }> }
}

async function scoreOf(leagueId: string, week: number): Promise<Array<[number | null, number | null, string | null]>> {
  const rows = await must(
    service.from('matchups').select('home_score, away_score, result').eq('league_id', leagueId).eq('week', week).order('id'),
    'scores',
  )
  return (rows ?? []).map((r) => [r.home_score === null ? null : Number(r.home_score), r.away_score === null ? null : Number(r.away_score), r.result])
}

async function weekStatus(leagueId: string, week: number): Promise<string> {
  const row = await must(service.from('league_weeks').select('status').eq('league_id', leagueId).eq('week', week).single(), 'week status')
  return row!.status
}

async function queueRow(playerId: string, week: number): Promise<{ deferred_until: string | null } | null> {
  const { data } = await service.from('score_fanout').select('deferred_until').eq('season', SEASON).eq('week', week).eq('player_id', playerId).maybeSingle()
  return data
}

/** A service client whose scoring door fails while `failing()` holds (a real
 *  SQLSTATE-bearing answer, the shape a door error has), and which counts calls. */
function flakyDoor(failing: () => boolean): { client: ScoreWorkerClient; calls: () => number } {
  let calls = 0
  const client = new Proxy(service, {
    get(target, key, receiver) {
      if (key !== 'rpc') return Reflect.get(target, key, receiver)
      return (name: string, args: unknown) => {
        if (name === 'score_write_week_batch') {
          calls += 1
          if (failing()) return Promise.resolve({ data: null, error: { code: 'P0001', message: 'injected door failure' } })
        }
        return (target.rpc as (n: string, a: unknown) => unknown)(name, args)
      }
    },
  }) as unknown as ScoreWorkerClient
  return { client, calls: () => calls }
}

beforeAll(async () => {
  await cleanup()
  const { data, error } = await service.auth.admin.createUser({ email: COMMISH.email, password: COMMISH.password, email_confirm: true, user_metadata: { username: COMMISH.username } })
  if (error) throw new Error(`createUser: ${error.message}`)
  commishId = data.user.id
  commishClient = createClient<Database>(LOCAL_URL, LOCAL_ANON_KEY, { auth: { persistSession: false } })
  const signed = await commishClient.auth.signInWithPassword(COMMISH)
  if (signed.error) throw new Error(`sign-in: ${signed.error.message}`)
  await seedSyntheticSeason(service)
}, 60_000)

afterAll(async () => {
  await cleanup()
}, 60_000)

describe('FS — F860: a failed save is retried, not thrown away', () => {
  it('the row survives a door error, waits out its hold, and the retry scores it', async () => {
    const world = await league('fs', 2)
    const week = 11
    const qb = await player('fs-qb')
    await setWeek(world.id, week, 'live')
    await roster(world.id, world.teams[0], qb)
    await lineup(world.teams[0], week, { 'QB:0': qb })
    await pair(world.id, week, world.teams[0], world.teams[1])
    const stamp = '2099-11-20T18:00:00.000Z'
    await line(qb, week, 300, stamp)
    await enqueue(qb, week, stamp)

    const clock = new VirtualClock(new Date('2099-11-20T18:05:00.000Z'))
    let failing = true
    const door = flakyDoor(() => failing)
    const first = await runScoreWeekBatch({ time: clock, db: door.client }, { leagueIds: [world.id] })
    expect([first.failed, first.drained, first.failed_deferred]).toEqual([1, 0, 1])
    // Measured before the fix: failed 1, drained 1, queue 0 — the update was gone.
    expect(await queueRow(qb, week)).toEqual({ deferred_until: expect.stringContaining('2099-11-20T18:10:00') })
    expect(classifyDrain(first).alerts.join(' ')).toContain('QUARANTINED: door: P0001 injected door failure')
    expect(await scoreOf(world.id, week)).toEqual([[null, null, null]])

    // Inside the hold: no claim, no door call — it can't spin.
    clock.advanceTo(new Date('2099-11-20T18:09:59.000Z'))
    const held = await runScoreWeekBatch({ time: clock, db: door.client }, { leagueIds: [world.id] })
    expect(held.claimed).toBe(0)
    expect(door.calls()).toBe(1)

    // A row that keeps failing stays, and stays loud, one try per hold.
    clock.advanceTo(new Date('2099-11-20T18:10:00.000Z'))
    const second = await runScoreWeekBatch({ time: clock, db: door.client }, { leagueIds: [world.id] })
    expect([second.failed, second.drained, door.calls()]).toEqual([1, 0, 2])
    expect(classifyDrain(second).alerts.length).toBeGreaterThan(0)

    // The fault clears: the retry writes the real score and the row goes.
    failing = false
    clock.advanceTo(new Date('2099-11-20T18:15:00.000Z'))
    const healed = await runScoreWeekBatch({ time: clock, db: door.client }, { leagueIds: [world.id] })
    expect([healed.written, healed.drained, healed.failed]).toEqual([1, 1, 0])
    expect(await queueRow(qb, week)).toBeNull()
    expect(await scoreOf(world.id, week)).toEqual([[12, null, null]])
  }, 60_000)

  it("a newer stat update doesn't wait out the hold: its re-stamp clears it (mid-game it heals at once)", async () => {
    const world = await league('fs2', 2)
    const week = 12
    const qb = await player('fs2-qb')
    await setWeek(world.id, week, 'live')
    await roster(world.id, world.teams[0], qb)
    await lineup(world.teams[0], week, { 'QB:0': qb })
    await pair(world.id, week, world.teams[0], world.teams[1])
    await line(qb, week, 100, '2099-11-20T18:00:00.000Z')
    await enqueue(qb, week, '2099-11-20T18:00:00.000Z')
    const clock = new VirtualClock(new Date('2099-11-20T18:05:00.000Z'))
    let failing = true
    const door = flakyDoor(() => failing)
    await runScoreWeekBatch({ time: clock, db: door.client }, { leagueIds: [world.id] })
    failing = false
    await line(qb, week, 200, '2099-11-20T18:05:30.000Z')
    await enqueue(qb, week, '2099-11-20T18:05:30.000Z')
    clock.advanceTo(new Date('2099-11-20T18:06:00.000Z'))
    const next = await runScoreWeekBatch({ time: clock, db: door.client }, { leagueIds: [world.id] })
    expect([next.written, next.drained]).toEqual([1, 1])
    expect(await scoreOf(world.id, week)).toEqual([[8, null, null]])
  }, 60_000)
})

describe('CP — the close pass writes the real 0 of a team no update reached', () => {
  it('never reached, a starter with no line, an empty lineup, no lineup row: each a real 0, named; the week closes', async () => {
    const world = await league('cp', 4)
    const week = 13
    const qb = await player('cp-qb')
    const dnp = await player('cp-dnp')
    await setWeek(world.id, week, 'correction_window')
    await gamesOver(week, '2099-11-28T04:00:00.000Z')
    await lineup(world.teams[0], week, { 'QB:0': qb })
    await lineup(world.teams[1], week, {})
    await lineup(world.teams[2], week, { 'QB:0': dnp })
    await pair(world.id, week, world.teams[0], world.teams[1])
    await pair(world.id, week, world.teams[2], world.teams[3])
    await line(qb, week, 300, '2099-11-27T20:00:00.000Z')
    expect(await scoreOf(world.id, week)).toEqual([[null, null, null], [null, null, null]])

    const clock = new VirtualClock(new Date('2099-11-28T05:00:00.000Z'))
    const close = await runCloseScoring({ time: clock, db }, { leagueIds: [world.id] })
    expect(close.weeks.map((w) => [w.reason, w.outcome])).toEqual([['never_closed', 'closed']])
    expect(close.problems.join(' ')).toContain(`team ${world.teams[3]}: no team_lineups row`)
    const entry = close.weeks[0].entry!
    expect(entry.teams.find((t) => t.team_id === world.teams[2])?.starters[0]?.reason ?? 'no_stat_row').toBe('no_stat_row')
    const scores = await scoreOf(world.id, week)
    expect(scores.map((s) => [s[0], s[1]]).sort()).toEqual([[0, 0], [12, 0]])

    // Idempotent: the next pass finds nothing to do, and the door wrote no twice.
    const again = await runCloseScoring({ time: clock, db }, { leagueIds: [world.id] })
    expect(again.weeks).toEqual([])

    const done = await finalize(world.id, pastWindow(week))
    expect([done.finalized, done.skipped]).toEqual([1, []])
    expect(await weekStatus(world.id, week)).toBe('final')
  }, 60_000)
})

describe('LO — F256(b): an update consumed before its game existed is scored again', () => {
  it('the drain consumes it (no_matchup_row), the pairing is built blank, the close pass brings it back', async () => {
    const world = await league('lo', 2)
    const week = 14
    const qb = await player('lo-qb')
    await setWeek(world.id, week, 'live')
    await roster(world.id, world.teams[0], qb)
    await lineup(world.teams[0], week, { 'QB:0': qb })
    await line(qb, week, 300, '2099-12-04T20:00:00.000Z')
    await enqueue(qb, week, '2099-12-04T20:00:00.000Z')
    const clock = new VirtualClock(new Date('2099-12-04T20:01:00.000Z'))
    const drain = await runScoreWeekBatch({ time: clock, db }, { leagueIds: [world.id] })
    expect(drain.drained).toBe(1)
    expect(drain.problems.join(' ')).toContain('no_matchup_row')
    expect(await queueRow(qb, week)).toBeNull()

    await pair(world.id, week, world.teams[1], world.teams[0]) // built late, seed 1 at home
    await must(service.from('league_weeks').update({ status: 'correction_window' }).eq('league_id', world.id).eq('week', week), 'window')
    await gamesOver(week, '2099-12-05T04:00:00.000Z')
    expect(await scoreOf(world.id, week)).toEqual([[null, null, null]])
    // Before 216 this is where it closed 0–0 and the higher seed advanced.
    const held = await finalize(world.id, pastWindow(week))
    expect(held.skipped.map((s) => s.reason)).toEqual(['pending_scores'])

    clock.advanceTo(new Date('2099-12-05T05:00:00.000Z'))
    await runCloseScoring({ time: clock, db }, { leagueIds: [world.id] })
    expect(await scoreOf(world.id, week)).toEqual([[0, 12, null]])
    const done = await finalize(world.id, pastWindow(week))
    expect(done.finalized).toBe(1)
    expect(await scoreOf(world.id, week)).toEqual([[0, 12, 'away']])
  }, 60_000)
})

describe('OW — F859: the queue is behind when the window ends', () => {
  it('finalize waits, the pass scores the newer line, the leftover row changes nothing', async () => {
    const world = await league('ow', 2)
    const week = 15
    const qb = await player('ow-qb')
    await setWeek(world.id, week, 'correction_window')
    await gamesOver(week, '2099-12-12T04:00:00.000Z')
    await roster(world.id, world.teams[0], qb)
    await lineup(world.teams[0], week, { 'QB:0': qb })
    await lineup(world.teams[1], week, {})
    await pair(world.id, week, world.teams[0], world.teams[1])
    await line(qb, week, 300, '2099-12-11T20:00:00.000Z')
    const clock = new VirtualClock(new Date('2099-12-12T05:00:00.000Z'))
    await runCloseScoring({ time: clock, db }, { leagueIds: [world.id] })
    expect(await scoreOf(world.id, week)).toEqual([[12, 0, null]])

    // A correction lands and queues; the scoring job is down.
    await line(qb, week, 350, '2099-12-13T20:00:00.000Z')
    await enqueue(qb, week, '2099-12-13T20:00:00.000Z')
    const held = await finalize(world.id, pastWindow(week))
    expect(held.skipped.map((s) => [s.reason, s.why])).toEqual([['scores_owed', 'lines_moved']])
    expect(await weekStatus(world.id, week)).toBe('correction_window')

    clock.advanceTo(new Date(pastWindow(week)))
    const close = await runCloseScoring({ time: clock, db }, { leagueIds: [world.id] })
    expect(close.weeks.map((w) => [w.reason, w.outcome])).toEqual([['lines_moved', 'closed']])
    expect(await scoreOf(world.id, week)).toEqual([[14, 0, null]])
    const done = await finalize(world.id, pastWindow(week))
    expect(done.finalized).toBe(1)

    // The job comes back: the leftover row meets a final week.
    clock.advanceTo(new Date(Date.parse(pastWindow(week)) + 60_000))
    const drain = await runScoreWeekBatch({ time: clock, db }, { leagueIds: [world.id] })
    expect(drain.leagues.map((l) => l.skip_reason)).toEqual(['week_final'])
    expect(await queueRow(qb, week)).toBeNull()
    expect(await scoreOf(world.id, week)).toEqual([[14, 0, 'home']])
  }, 60_000)
})

describe('SC — a corrected line scored by the close pass keeps its record', () => {
  it('the league record is written once, by the pass; the later drain re-sends and records nothing', async () => {
    const world = await league('sc', 2)
    const week = 16
    const qb = await player('sc-qb')
    await setWeek(world.id, week, 'correction_window')
    await gamesOver(week, '2099-12-19T04:00:00.000Z')
    await roster(world.id, world.teams[0], qb)
    await lineup(world.teams[0], week, { 'QB:0': qb })
    await lineup(world.teams[1], week, {})
    await pair(world.id, week, world.teams[0], world.teams[1])
    await line(qb, week, 300, '2099-12-18T20:00:00.000Z')
    const clock = new VirtualClock(new Date('2099-12-19T05:00:00.000Z'))
    await runCloseScoring({ time: clock, db }, { leagueIds: [world.id] })

    await line(qb, week, 350, '2099-12-19T06:00:00.000Z')
    await enqueue(qb, week, '2099-12-19T06:00:00.000Z')
    await must(
      service.from('stat_correction_events').insert({ season: SEASON, week, player_id: qb, stat_key: 'pass_yards', old_value: 300, new_value: 350, detected_at: '2099-12-19T06:00:00.000Z', week_state: 'open', source: 'synthetic' }),
      'event',
    )
    clock.advanceTo(new Date(Date.parse(WINDOW_BY_WEEK.get(week)!) - 60_000)) // inside the last 15 minutes
    const close = await runCloseScoring({ time: clock, db }, { leagueIds: [world.id] })
    expect(close.weeks.map((w) => w.outcome)).toEqual(['closed'])
    const records = async () => must(service.from('league_stat_corrections').select('team_id, player_points_before, player_points_after').eq('league_id', world.id), 'records')
    const once = await records()
    expect(once!.map((r) => [Number(r.player_points_before), Number(r.player_points_after)])).toEqual([[12, 14]])
    const unapplied = await must(service.from('stat_correction_events').select('applied_at').eq('player_id', qb), 'events')
    expect(unapplied!.map((e) => e.applied_at)).toEqual([null]) // the row is not consumed yet

    const drain = await runScoreWeekBatch({ time: clock, db }, { leagueIds: [world.id] })
    expect(drain.drained).toBe(1)
    expect((await records())!.length).toBe(1) // already_recorded
    const applied = await must(service.from('stat_correction_events').select('applied_at').eq('player_id', qb), 'events')
    expect(applied![0].applied_at).not.toBeNull()
  }, 60_000)
})

describe('RM — what the close pass refuses', () => {
  it('an unreadable lineup is not a 0: the team stays blank, the week unclosed, an alert by name', async () => {
    const world = await league('rm', 2)
    const week = 11
    const qb = await player('rm-qb')
    await setWeek(world.id, week, 'correction_window')
    await gamesOver(week, '2099-11-14T04:00:00.000Z')
    await lineup(world.teams[0], week, { 'QB:0': qb })
    await lineup(world.teams[1], week, null)
    await pair(world.id, week, world.teams[0], world.teams[1])
    await line(qb, week, 300, '2099-11-13T20:00:00.000Z')
    const clock = new VirtualClock(new Date('2099-11-14T05:00:00.000Z'))
    const close = await runCloseScoring({ time: clock, db }, { leagueIds: [world.id] })
    expect(close.weeks.map((w) => w.outcome)).toEqual(['failed'])
    expect(classifyClose(close).alerts.join(' ')).toContain(`unreadable for ${world.teams[1]}`)
    expect(await scoreOf(world.id, week)).toEqual([[12, null, null]])
    const row = await must(service.from('league_weeks').select('scored_at').eq('league_id', world.id).eq('week', week).single(), 'stamp')
    expect(row!.scored_at).toBeNull()
  }, 60_000)

  it('a line that moves under the pass: the stamp refuses, nothing recorded, the next pass re-scores', async () => {
    const world = await league('rm2', 2)
    const week = 12
    const qb = await player('rm2-qb')
    await setWeek(world.id, week, 'correction_window')
    await gamesOver(week, '2099-11-21T04:00:00.000Z')
    await lineup(world.teams[0], week, { 'QB:0': qb })
    await lineup(world.teams[1], week, {})
    await pair(world.id, week, world.teams[0], world.teams[1])
    await line(qb, week, 300, '2099-11-20T20:00:00.000Z')
    const clock = new VirtualClock(new Date('2099-11-21T05:00:00.000Z'))
    let moved = false
    const racing = new Proxy(service, {
      get(target, key, receiver) {
        if (key !== 'rpc') return Reflect.get(target, key, receiver)
        return async (name: string, args: unknown) => {
          if (name === 'league_week_close_stamp' && !moved) {
            moved = true
            await line(qb, week, 400, '2099-11-21T05:00:01.000Z')
          }
          return (target.rpc as (n: string, a: unknown) => unknown)(name, args)
        }
      },
    }) as unknown as ScoreWorkerClient
    const first = await runCloseScoring({ time: clock, db: racing }, { leagueIds: [world.id] })
    expect(first.weeks.map((w) => w.outcome)).toEqual(['lines_moved'])
    expect(await scoreOf(world.id, week)).toEqual([[12, 0, null]]) // the old line's score, for now
    const second = await runCloseScoring({ time: clock, db }, { leagueIds: [world.id] })
    expect(second.weeks.map((w) => w.outcome)).toEqual(['closed'])
    expect(await scoreOf(world.id, week)).toEqual([[16, 0, null]])
  }, 60_000)
})

describe('RC — reconcile on a blank', () => {
  it('a blank with no points behind it is no finding; with points, blank_owed; past its window, week_held; never drift', async () => {
    const world = await league('rc', 2)
    const week = 13
    const qb = await player('rc-qb')
    await setWeek(world.id, week, 'correction_window')
    await gamesOver(week, '2099-11-28T04:00:00.000Z')
    await lineup(world.teams[0], week, { 'QB:0': qb })
    await lineup(world.teams[1], week, {})
    await pair(world.id, week, world.teams[0], world.teams[1])
    await line(qb, week, 300, '2099-11-27T20:00:00.000Z')
    const clock = new VirtualClock(new Date('2099-11-28T05:00:00.000Z'))
    const before = await reconcileSeason({ time: clock, db }, { season: SEASON, leagueIds: [world.id] })
    const mine = before.findings.filter((f) => f.league_id === world.id)
    expect(mine.map((f) => [f.kind, f.team_id])).toEqual([['blank_owed', world.teams[0]]])
    expect(mine.some((f) => f.kind === 'drift')).toBe(false)

    clock.advanceTo(new Date(Date.parse(WINDOW_BY_WEEK.get(week)!) + 2 * 60 * 60_000 + 1))
    const held = await reconcileSeason({ time: clock, db }, { season: SEASON, leagueIds: [world.id] })
    const heldLine = held.findings.find((f) => f.league_id === world.id && f.kind === 'week_held')
    expect(heldLine?.severity).toBe('alert')
    expect(heldLine?.message).toContain('1 matchup(s) hold a blank score')
  }, 60_000)
})

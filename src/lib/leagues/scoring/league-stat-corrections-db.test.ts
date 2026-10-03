/**
 * league-stat-corrections-db.test.ts — M6 L.E2.2 END TO END over the REAL
 * local stack (migration 172; spec §23.4 v2.16.83, §12.21, §11.4, §16.4;
 * tasks-M6 TD6 / TD7 / TD8 as ruled by Q81 — PROGRESS D438 / D439 / D440;
 * D453; F245 / F511). Chris (Q81, 2026-09-29): "if the stat window has
 * closed I think we have to forget it" — only a correction that changed a
 * league score is recorded; after the lock nothing moves.
 *
 * ONE WEEK'S STORY (its own calendar, season 2088 week 1 — every instant a
 * literal; a VirtualClock; the REAL `ingestWeek` → ingest door, the REAL
 * score-week worker → scoring door, league_week_advance, finalize_matchups
 * and rebuild_team_week_results; one h2h league, ESPN Standard, median game
 * ON, a second-opponent row):
 *   Team One (WR1) v Team Two (WR2); Team Three (WR3) v Team Four (WR4);
 *   second game Team One v Team Three. Team One benches WRB.
 *   LC1  Sunday LIVE → FINAL: ordinary scoring; no event, no record.
 *   LC2  an hour after the game is seen final WR2 settles 97 → 98 yards:
 *        re-scored SILENTLY (F511's settle grace) — no event, no record, no
 *        post.
 *   LC3  Wednesday, IN the window: WR1 100 → 94 yards. The worker sends the
 *        event, the door re-scores AND records in one transaction: ONE
 *        record (Team One — the only team that started him), ONE league post
 *        naming the correction, the score and every flipped result (Team Two
 *        now wins; Team Three now wins the second game; the median flips
 *        Team One and Team Three — the F373 knock-on, a correction not an
 *        override, so no commissioner_actions row and D345 untouched), a
 *        notification ONLY to the three managers whose result changed, and
 *        the event stamped applied at the drain's instant.
 *   LC4  a benched player's correction (WRB) writes no record.
 *   LC5  a stat the league does not score (WR3's receptions — standard
 *        scoring pays none) writes nothing and SAYS WHY.
 *   (LC5b, the pre-172 deploy-before-push arm, retired with it — F529.)
 *   LC6  the real finalize_matchups at week 2's first kickoff: final, the
 *        stored results are the ones the record derived, and the REAL
 *        rebuild finds no result_drift (F245 / TD8).
 *   LC7  AFTER the lock: WR1 94 → 80 is recorded as NFL data (week final),
 *        the worker consumes it as week_final, and every league cell, the
 *        records, the posts and the notifications are byte-identical.
 *
 * Requires the local stack — D59(5); FAILS loudly when it is down. Fixture
 * hygiene (F199): the `vitest-lsc` prefix on players / stats / queue / games
 * / events, the league by name, the 2088 calendar rows (measured unused
 * 2026-09-30); cleanup first and after (teams detached before the league —
 * F406's order is not needed: nothing here writes a receipt). Action-id
 * prefix `3e8` (measured free 2026-09-30).
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { defaultsForTeamCount, splitSettings } from '@/lib/leagues/settings/league-settings'
import { DegradationTracker } from '@/lib/leagues/stats/degradation'
import type { ProviderGame, ProviderPlayerWeekStats, StatsProvider } from '@/lib/leagues/stats/stats-provider'
import { VirtualClock } from '@/lib/leagues/time/virtual-clock'
import { ingestWeek, type IngestReport } from '@/lib/sync/ingest-week'
import type { SyncClient } from '@/lib/sync/types'
import type { Database, Json } from '@/types/database'

import { runScoreWeekBatch } from './score-week-worker'

const LOCAL_URL = process.env.SUPABASE_LOCAL_URL ?? 'http://127.0.0.1:54321'
const LOCAL_ANON_KEY =
  process.env.SUPABASE_LOCAL_ANON_KEY ??
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0'
const LOCAL_SERVICE_ROLE_KEY =
  process.env.SUPABASE_LOCAL_SERVICE_ROLE_KEY ??
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU'

const PREFIX = 'vitest-lsc'
const SEASON = 2088
const USERS = [
  { email: 'lsc-commish@fieldscout.test', password: 'pgtap-lsc-pass-1', username: 'lsc_commish_one' },
  { email: 'lsc-two@fieldscout.test', password: 'pgtap-lsc-pass-2', username: 'lsc_manager_two' },
  { email: 'lsc-three@fieldscout.test', password: 'pgtap-lsc-pass-3', username: 'lsc_manager_three' },
] as const
const ACTION = { league: '3e800000-0000-4000-8000-000000000001' } as const

const WR1 = `${PREFIX}-wr1`
const WR2 = `${PREFIX}-wr2`
const WR3 = `${PREFIX}-wr3`
const WR4 = `${PREFIX}-wr4`
const WRB = `${PREFIX}-wrb`
const GAME = `${PREFIX}-g1`
const PLAYERS = [
  { id: WR1, full_name: 'Lou Receiver', position: 'WR', team: 'LCA', status: 'Active' },
  { id: WR2, full_name: 'Moe Receiver', position: 'WR', team: 'LCB', status: 'Active' },
  { id: WR3, full_name: 'Ned Receiver', position: 'WR', team: 'LCA', status: 'Active' },
  { id: WR4, full_name: 'Oz Receiver', position: 'WR', team: 'LCB', status: 'Active' },
  { id: WRB, full_name: 'Pat Bench', position: 'WR', team: 'LCA', status: 'Active' },
]

/** The calendar (literals): week 1's game Sunday 17:00Z; week 2's first kickoff (= week 1's lock) Fri 00:15Z. */
const WEEK1 = { starts: '2088-09-08T04:00:00.000Z', kickoff: '2088-09-12T17:00:00.000Z', defaultClose: '2088-09-16T10:00:00.000Z' }
const WEEK2 = { starts: '2088-09-15T04:00:00.000Z', kickoff: '2088-09-17T00:15:00.000Z', defaultClose: '2088-09-23T10:00:00.000Z' }
const T_LIVE = '2088-09-12T18:00:00.000Z'
const T_FINAL_SEEN = '2088-09-12T20:30:00.000Z'
const T_SETTLE = '2088-09-12T21:30:00.000Z' // seen final + 1 h — inside the 6 h settle grace
const T_ADVANCE = '2088-09-14T08:00:00.000Z'
const T_IN_WINDOW = '2088-09-15T15:00:00.000Z'
const T_BENCH = '2088-09-15T16:00:00.000Z'
const T_UNSCORED = '2088-09-15T17:00:00.000Z'
const T_LATE = '2088-09-18T12:00:00.000Z'

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
    for (const table of ['league_stat_corrections', 'transactions', 'team_week_results', 'matchups', 'league_weeks', 'league_player_pool', 'league_rosters', 'league_chat', 'league_members'] as const) {
      await must(service.from(table).delete().in('league_id', ids), `cleanup ${table}`)
    }
    await must(service.from('teams').delete().in('league_id', ids), 'cleanup teams')
    await must(service.from('leagues').delete().in('id', ids), 'cleanup leagues')
  }
  await must(service.from('nfl_games').delete().like('id', `${PREFIX}-%`), 'cleanup nfl_games')
  await must(service.from('nfl_weeks').delete().eq('season', SEASON), 'cleanup nfl_weeks')
  await must(service.from('players').delete().like('id', `${PREFIX}-%`), 'cleanup players')
  for (const u of USERS) await deleteUserByUsername(u.username)
}

let leagueId: string
const team: Record<'one' | 'two' | 'three' | 'four', string> = { one: '', two: '', three: '', four: '' }
const userIds: string[] = []

const feed = { status: 'live' as ProviderGame['status'], lines: {} as Record<string, Record<string, number>> }
const provider: StatsProvider = {
  name: 'fixture:lsc',
  capabilities: new Set(['core_box']),
  getSchedule: async () => [
    { gameId: GAME, season: SEASON, week: 1, homeTeam: 'LCA', awayTeam: 'LCB', kickoffAt: new Date(WEEK1.kickoff), gameDate: '2088-09-12', status: feed.status },
  ],
  getGameStates: async () => [],
  getWeekStats: async () =>
    Object.entries(feed.lines).map(([playerId, stats]): ProviderPlayerWeekStats => ({ playerId, season: SEASON, week: 1, gameId: GAME, stats, advanced: {} })),
  getInjuries: async () => [],
  getInactives: async () => [],
}

function poll(iso: string): Promise<IngestReport> {
  clock.advanceTo(new Date(iso))
  return ingestWeek(provider, clock, { db, degradation: new DegradationTracker(), season: SEASON, week: 1 })
}

function drain() {
  return runScoreWeekBatch({ time: clock, db: service }, { batchSize: 1000, leagueIds: [leagueId] })
}

async function scores(): Promise<string> {
  const rows = await must(service.from('matchups').select('round_type, home_score, away_score, status, result').eq('league_id', leagueId).eq('week', 1).order('round_type').order('home_score', { ascending: false }), 'matchups')
  return (rows ?? []).map((m) => `${m.round_type} ${Number(m.home_score).toFixed(2)}-${Number(m.away_score).toFixed(2)} ${m.status} ${m.result ?? '-'}`).join(' | ')
}

async function records(): Promise<string[]> {
  const rows = await must(
    service.from('league_stat_corrections').select('team_id, player_id, slot, player_points_before, player_points_after, team_score_before, team_score_after, result_before, result_after, result_changed, stat_changes').eq('league_id', leagueId).order('recorded_at').order('player_id'),
    'records',
  )
  const name = (id: string) => Object.entries(team).find(([, v]) => v === id)?.[0] ?? id
  return (rows ?? []).map(
    (r) =>
      `${name(r.team_id)} ${r.player_id} ${r.slot} ${Number(r.player_points_before).toFixed(2)}→${Number(r.player_points_after).toFixed(2)} ${Number(r.team_score_before).toFixed(2)}→${Number(r.team_score_after).toFixed(2)} ${JSON.stringify(r.result_before)} → ${JSON.stringify(r.result_after)} changed=${r.result_changed} ${JSON.stringify(r.stat_changes).replace(/"event_id":"[^"]+",?/g, '')}`,
  )
}

async function posts(): Promise<string[]> {
  const rows = await must(service.from('league_chat').select('message').eq('league_id', leagueId).eq('is_system', true).order('created_at'), 'posts')
  return (rows ?? []).map((r) => r.message)
}

async function notes(): Promise<string[]> {
  const rows = await must(service.from('notifications').select('user_id, title, body').eq('type', 'stat_correction_result').in('user_id', userIds).order('body'), 'notifications')
  return (rows ?? []).map((n) => `${USERS[userIds.indexOf(n.user_id)].username}: ${n.body}`).sort()
}

async function eventsFor(playerId: string): Promise<string[]> {
  const rows = await must(service.from('stat_correction_events').select('stat_key, old_value, new_value, week_state, applied_at').eq('player_id', playerId).order('detected_at').order('stat_key'), 'events')
  return (rows ?? []).map((e) => `${e.stat_key} ${e.old_value}→${e.new_value} ${e.week_state} applied=${e.applied_at === null ? 'null' : new Date(e.applied_at).toISOString()}`)
}

async function leagueCells(): Promise<string> {
  const matchups = await must(service.from('matchups').select('*').eq('league_id', leagueId).eq('week', 1).order('id'), 'matchups')
  const results = await must(service.from('team_week_results').select('*').eq('league_id', leagueId).eq('week', 1).order('team_id'), 'results')
  const points = await must(service.from('league_week_player_points').select('*').eq('league_id', leagueId).eq('week', 1).order('team_id').order('slot'), 'points')
  const weeks = await must(service.from('league_weeks').select('*').eq('league_id', leagueId).eq('week', 1), 'weeks')
  return JSON.stringify({ matchups, results, points, weeks, records: await records(), posts: await posts(), notes: await notes() })
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
  for (const u of USERS) {
    const { data, error } = await service.auth.admin.createUser({ email: u.email, password: u.password, email_confirm: true, user_metadata: { username: u.username } })
    if (error) throw new Error(`createUser ${u.username}: ${error.message}`)
    userIds.push(data.user.id)
  }
  const commishClient: SupabaseClient<Database> = createClient<Database>(LOCAL_URL, LOCAL_ANON_KEY, { auth: { persistSession: false } })
  const { error: signInError } = await commishClient.auth.signInWithPassword({ email: USERS[0].email, password: USERS[0].password })
  if (signInError) throw new Error(`sign-in: ${signInError.message}`)
  await must(service.from('players').upsert(PLAYERS).select('id'), 'players')

  const { columns, blob } = splitSettings(defaultsForTeamCount(8))
  const columnArgs = Object.fromEntries(Object.entries(columns).map(([key, value]) => [`p_${key}`, value]))
  const { data: std } = await commishClient.from('scoring_systems').select('id, rules').eq('is_template', true).eq('name', 'ESPN Standard').single()
  const { data: league, error } = await commishClient.rpc('create_league', {
    p_name: `${PREFIX}-league`,
    p_season: SEASON,
    p_scoring_system_id: std?.id,
    p_team_name: 'Team One',
    p_action_id: ACTION.league,
    p_settings: blob,
    ...columnArgs,
  } as unknown as Database['public']['Functions']['create_league']['Args'])
  if (error) throw new Error(`create_league: ${error.message}`)
  leagueId = (league as { league_id: string }).league_id
  team.one = (await must(service.from('teams').select('id').eq('league_id', leagueId).single(), 'team one'))!.id
  for (const [key, name, owner] of [['two', 'Team Two', userIds[1]], ['three', 'Team Three', userIds[2]], ['four', 'Team Four', userIds[0]]] as const) {
    team[key] = (await must(service.from('teams').insert({ owner_id: owner, name, league_id: leagueId }).select('id').single(), name))!.id
  }
  await must(service.from('league_members').insert([
    { league_id: leagueId, user_id: userIds[1], team_id: team.two, role: 'manager' },
    { league_id: leagueId, user_id: userIds[2], team_id: team.three, role: 'manager' },
  ]), 'members')
  const { data: row } = await service.from('leagues').select('settings').eq('id', leagueId).single()
  await must(
    service.from('leagues').update({
      status: 'in_season',
      scoring_rules_snapshot: std!.rules as Json,
      playoff_teams: 0, // no bracket: F476 is pgTAP 120 §K's
      settings: { ...((row?.settings as Record<string, unknown>) ?? {}), median_game: true } as Json,
    }).eq('id', leagueId),
    'league → in_season, median game on',
  )
  await must(service.from('league_weeks').insert([{ league_id: leagueId, season: SEASON, week: 1, status: 'live' }, { league_id: leagueId, season: SEASON, week: 2, status: 'upcoming' }]), 'weeks')
  await must(
    service.from('matchups').insert([
      { league_id: leagueId, season: SEASON, week: 1, round_type: 'regular', home_team_id: team.one, away_team_id: team.two, status: 'live' },
      { league_id: leagueId, season: SEASON, week: 1, round_type: 'regular', home_team_id: team.three, away_team_id: team.four, status: 'live' },
      { league_id: leagueId, season: SEASON, week: 1, round_type: 'secondary', home_team_id: team.one, away_team_id: team.three, status: 'live' },
    ]).select('id'),
    'matchups',
  )
  await must(service.from('league_rosters').insert([
    { league_id: leagueId, team_id: team.one, player_id: WR1 },
    { league_id: leagueId, team_id: team.one, player_id: WRB },
    { league_id: leagueId, team_id: team.two, player_id: WR2 },
    { league_id: leagueId, team_id: team.three, player_id: WR3 },
    { league_id: leagueId, team_id: team.four, player_id: WR4 },
  ]), 'rosters')
  await must(
    service.from('team_lineups').insert([
      { team_id: team.one, season: SEASON, week: 1, starters: [], bench: [], slot_map: { 'wr:0': WR1 } },
      { team_id: team.two, season: SEASON, week: 1, starters: [], bench: [], slot_map: { 'wr:0': WR2 } },
      { team_id: team.three, season: SEASON, week: 1, starters: [], bench: [], slot_map: { 'wr:0': WR3 } },
      { team_id: team.four, season: SEASON, week: 1, starters: [], bench: [], slot_map: { 'wr:0': WR4 } },
    ]),
    'lineups',
  )
}, 90_000)

afterAll(cleanup, 60_000)

describe('L.E2.2 — each league’s record of a stat correction, through the REAL poll → worker → door', () => {
  it('LC1 Sunday LIVE → FINAL: ordinary scoring — no event, no record, no post', async () => {
    feed.status = 'live'
    feed.lines = { [WR1]: { receiving_yards: 90 }, [WR2]: { receiving_yards: 90 }, [WR3]: { receiving_yards: 90, receptions: 5 }, [WR4]: { receiving_yards: 80 }, [WRB]: { receiving_yards: 20 } }
    await poll(T_LIVE)
    await drain()
    feed.status = 'final'
    feed.lines = { ...feed.lines, [WR1]: { receiving_yards: 100 }, [WR2]: { receiving_yards: 97 }, [WR3]: { receiving_yards: 95, receptions: 5 } }
    const final = await poll(T_FINAL_SEEN)
    expect(final.corrections.detected).toBe(0)
    const batch = await drain()
    expect(batch.leagues.map((l) => l.corrections)).toEqual(['none_sent'])
    expect(await scores()).toBe('regular 10.00-9.70 live - | regular 9.50-8.00 live - | secondary 10.00-9.50 live -')
    expect([await records(), await posts()]).toEqual([[], []])
  })

  it('LC2 an hour after the game is seen final WR2 settles 97 → 98: re-scored SILENTLY (the settle grace — F511) — no event, no record, no post', async () => {
    feed.lines = { ...feed.lines, [WR2]: { receiving_yards: 98 } }
    const settle = await poll(T_SETTLE)
    expect([settle.corrections.detected, settle.corrections.settled]).toEqual([0, 1])
    expect(await eventsFor(WR2)).toEqual([])
    await drain()
    expect(await scores()).toBe('regular 10.00-9.80 live - | regular 9.50-8.00 live - | secondary 10.00-9.50 live -')
    expect([await records(), await posts()]).toEqual([[], []])
    clock.advanceTo(new Date(T_ADVANCE))
    expect((await service.rpc('league_week_advance', { p_now: T_ADVANCE, p_league_id: leagueId })).error).toBeNull()
    expect((await must(service.from('league_weeks').select('status').eq('league_id', leagueId).eq('week', 1).single(), 'week'))!.status).toBe('correction_window')
  })

  it('LC3 IN the window WR1 100 → 94: re-scored and RECORDED in one transaction — one record, one post naming every flipped result (second game + median), a notification only where a result changed, the event applied', async () => {
    const commishBefore = (await must(service.from('commissioner_actions').select('id').eq('league_id', leagueId), 'receipts'))!.length
    feed.lines = { ...feed.lines, [WR1]: { receiving_yards: 94 } }
    const report = await poll(T_IN_WINDOW)
    expect(report.corrections).toMatchObject({ detected: 1, recorded: 1, weekState: 'open', settled: 0 })
    const batch = await drain()
    // The score cell first: the re-score itself (the probe that skips the element leaves THIS green).
    expect(await scores()).toBe('regular 9.50-8.00 live - | regular 9.40-9.80 live - | secondary 9.40-9.50 live -')
    const entry = batch.leagues[0]
    expect([entry.corrections, entry.corrections_sent?.[team.one]?.length, entry.door?.corrections?.recorded]).toEqual(['recorded', 1, 1])
    expect(await records()).toEqual([
      `one ${WR1} wr:0 10.00→9.40 10.00→9.40 {"h2h":"win","median":"win","second":"win"} → {"h2h":"loss","median":"loss","second":"loss"} changed=true [{"new":94,"old":100,"label":"receiving yards","stat_key":"receiving_yards"}]`,
    ])
    expect(await posts()).toEqual([
      'Stat correction (Week 1): Lou Receiver\'s receiving yards 100 → 94 — Team One 10.00 → 9.40. Result changed: Team Two now beats Team One 9.80–9.40; Team Three now beats Team One 9.50–9.40 (second game). Median game: Team One now loses the median game (it was winning); Team Three now wins the median game (it was losing).',
    ])
    expect(await notes()).toEqual([
      'lsc_manager_three: Stat correction (Week 1): Lou Receiver\'s receiving yards 100 → 94 — Team One 10.00 → 9.40. In your second game you now beat Team One (you were losing). You now win the median game (you were losing).',
      'lsc_manager_two: Stat correction (Week 1): Lou Receiver\'s receiving yards 100 → 94 — Team One 10.00 → 9.40. You now beat Team One 9.80–9.40 (you were losing).',
      'lsc_commish_one: Stat correction (Week 1): Lou Receiver\'s receiving yards 100 → 94 — Team One 10.00 → 9.40. Team Two now beats you 9.80–9.40 (you were winning). In your second game Team Three now beats you (you were winning). You now lose the median game (you were winning).',
    ].sort())
    // A correction is not an override: no receipt, nothing overridden (D345 untouched).
    expect((await must(service.from('commissioner_actions').select('id').eq('league_id', leagueId), 'receipts'))!.length).toBe(commishBefore)
    // §12.21 applied_at: the drain consumed WR1's row, so the event is applied at the drain's instant.
    expect(await eventsFor(WR1)).toEqual([`receiving_yards 100→94 open applied=${T_IN_WINDOW}`])
    expect(batch.corrections_applied).toMatchObject({ read: 1, sent: 1, stamped: 1, already_applied: 0 })
    expect(entry.corrections_note).toBe(`stat corrections: 1 record(s) written for league ${leagueId} week 1 (1 event(s) sent), the league post made, 3 manager(s) notified`)
  })

  it('LC4 a BENCHED player’s correction (WRB, 20 → 40) writes no record — the starter filter', async () => {
    feed.lines = { ...feed.lines, [WRB]: { receiving_yards: 40 } }
    const report = await poll(T_BENCH)
    expect(report.corrections.recorded).toBe(1)
    const batch = await drain()
    expect(batch.leagues[0].bench_player_ids).toEqual([WRB])
    expect(await records()).toHaveLength(1)
    expect(await posts()).toHaveLength(1)
    expect(await eventsFor(WRB)).toEqual([`receiving_yards 20→40 open applied=${T_BENCH}`])
  })

  it('LC5 a stat the league does not score (WR3 receptions 5 → 6, standard scoring) writes NOTHING and says why', async () => {
    feed.lines = { ...feed.lines, [WR3]: { receiving_yards: 95, receptions: 6 } }
    await poll(T_UNSCORED)
    const batch = await drain()
    expect(batch.leagues[0].corrections).toBe('nothing_recorded')
    expect(batch.leagues[0].corrections_note).toBe(
      `stat corrections recorded nothing for league ${leagueId} week 1 (1 event(s) sent): ${team.three}/${WR3}: no_points_moved`,
    )
    // Information, never a problem: an ordinary correction that moves no score raises no alarm.
    expect(batch.problems.filter((p) => p.includes('stat corrections'))).toEqual([])
    expect([await records(), await posts()].map((x) => x.length)).toEqual([1, 1])
  })

  it('LC6 the REAL finalize_matchups at week 2’s first kickoff: the stored results are the record’s, and the REAL rebuild finds no result_drift (F245 / TD8)', async () => {
    clock.advanceTo(new Date(WEEK2.kickoff))
    expect((await service.rpc('finalize_matchups', { p_now: WEEK2.kickoff, p_league_id: leagueId })).error).toBeNull()
    expect(await scores()).toBe('regular 9.50-9.00 final home | regular 9.40-9.80 final away | secondary 9.40-9.50 final away')
    const results = await must(service.from('team_week_results').select('team_id, h2h_result, second_result, median_result').eq('league_id', leagueId).eq('week', 1), 'results')
    const byTeam = Object.fromEntries((results ?? []).map((r) => [Object.entries(team).find(([, v]) => v === r.team_id)![0], `${r.h2h_result}/${r.second_result ?? '-'}/${r.median_result}`]))
    expect(byTeam).toEqual({ one: 'loss/loss/loss', two: 'win/-/win', three: 'win/win/win', four: 'loss/-/loss' })
    const rebuild = await service.rpc('rebuild_team_week_results', { p_league_id: leagueId, p_week: 1 })
    expect(rebuild.error).toBeNull()
    expect((rebuild.data as { reason: string }).reason).toBe('already_consistent')
  })

  it('LC7 AFTER the lock WR1 94 → 80: the event is NFL data (final), the worker consumes it as week_final, and every league cell, record, post and notification is byte-identical', async () => {
    const before = await leagueCells()
    feed.lines = { ...feed.lines, [WR1]: { receiving_yards: 80 } }
    const report = await poll(T_LATE)
    expect(report.corrections).toMatchObject({ detected: 1, recorded: 1, weekState: 'final' })
    const batch = await drain()
    expect(batch.problems).toContain(`[${leagueId} wk 1] league ${leagueId} week 1 skipped: week_final`)
    expect(await leagueCells()).toBe(before)
    expect((await eventsFor(WR1)).at(-1)).toBe(`receiving_yards 94→80 final applied=${T_LATE}`)
  })
})

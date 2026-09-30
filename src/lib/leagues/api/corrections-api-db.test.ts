/**
 * corrections-api-db.test.ts — M6 L.E2.3 over the REAL local stack: the
 * league's stat-corrections read (`GET …/corrections?week=` →
 * `readStatCorrections`) and the correction posts in the activity feed
 * (spec §15.3 / §23.4 v2.16.83; tasks-M6 §6 L.E2.3 read through Q81;
 * PROGRESS D453 / D454).
 *
 * THE RECORDS ARE THE REAL DOOR'S. One h2h league (ESPN Standard, 0.1 per
 * receiving yard; season 2087 — its own calendar, every instant a literal, a
 * VirtualClock): Team One (WR1) v Team Two (WR2). The REAL `ingestWeek` →
 * ingest door, the REAL score-week worker → scoring door (172) write each
 * record and its league post; nothing here inserts a record by hand.
 *   - Sunday: LIVE → FINAL, ordinary scoring (One 10.00 – Two 9.70).
 *   - IN the window: WR1 100 → 94 (One 9.40 — Team Two now wins), then
 *     WR2 97 → 90 (Two 9.00 — Team One wins again): two records, two posts.
 *   CA1  a member reads Week 1: both, newest first, every field in words —
 *        and each item's `summary` is its league post's own sentence.
 *   CA2  paged: limit 1 ⇒ page 1 + a cursor; the cursor ⇒ page 2, done.
 *   CA3  a week with none SAYS SO (Week 2: 200, no items, the note).
 *   CA4  a non-member is the family's no-leak 403 (R807 / D387(3) — the
 *        task text's "non-member 404"), and the premise: his RLS read of the
 *        table is EMPTY, which is exactly what the gate refuses to serve.
 *   CA5  the pre-push shape (TD15): PostgREST's answer for an absent table,
 *        MEASURED here on a GET, renamed to this table ⇒ the named 503 —
 *        never a 500, never an empty list.
 *   CA6  the activity feed carries both correction posts tagged
 *        `stat_correction` with their week; an ordinary system post is not,
 *        nor a commissioner post that opens with the prefix (R1349 — a team
 *        named like a correction; the door's post has no actor).
 *
 * Requires the local stack — D59(5); FAILS loudly when it is down. Fixture
 * hygiene (F199): the `vitest-capi` prefix on players / stats / queue /
 * games / events, the league by name, the 2087 calendar rows (measured
 * unused 2026-09-30); cleanup first and after. Action-id prefix `3ea`
 * (measured free 2026-09-30).
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { runScoreWeekBatch } from '@/lib/leagues/scoring/score-week-worker'
import { defaultsForTeamCount, splitSettings } from '@/lib/leagues/settings/league-settings'
import { DegradationTracker } from '@/lib/leagues/stats/degradation'
import type { ProviderGame, ProviderPlayerWeekStats, StatsProvider } from '@/lib/leagues/stats/stats-provider'
import { VirtualClock } from '@/lib/leagues/time/virtual-clock'
import { ingestWeek } from '@/lib/sync/ingest-week'
import type { SyncClient } from '@/lib/sync/types'
import type { Database, Json } from '@/types/database'

import { readActivity, type ActivityFeed } from './activity-service'
import {
  CORRECTIONS_UNAVAILABLE_MESSAGE,
  readStatCorrections,
  type StatCorrectionsPage,
} from './corrections-service'
import { INSEASON_READ_FORBIDDEN_MESSAGE } from './inseason-reads'

const LOCAL_URL = process.env.SUPABASE_LOCAL_URL ?? 'http://127.0.0.1:54321'
const LOCAL_ANON_KEY =
  process.env.SUPABASE_LOCAL_ANON_KEY ??
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0'
const LOCAL_SERVICE_ROLE_KEY =
  process.env.SUPABASE_LOCAL_SERVICE_ROLE_KEY ??
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU'

const PREFIX = 'vitest-capi'
const SEASON = 2087
const USERS = [
  { email: 'capi-commish@fieldscout.test', password: 'pgtap-capi-pass-1', username: 'capi_commish_one' },
  { email: 'capi-two@fieldscout.test', password: 'pgtap-capi-pass-2', username: 'capi_manager_two' },
  { email: 'capi-outsider@fieldscout.test', password: 'pgtap-capi-pass-3', username: 'capi_outsider' },
] as const
const ACTION = { league: '3ea00000-0000-4000-8000-000000000001' } as const

const WR1 = `${PREFIX}-wr1`
const WR2 = `${PREFIX}-wr2`
const GAME = `${PREFIX}-g1`
const PLAYERS = [
  { id: WR1, full_name: 'Cal Catcher', position: 'WR', team: 'CXA', status: 'Active' },
  { id: WR2, full_name: 'Dee Catcher', position: 'WR', team: 'CXB', status: 'Active' },
]

/** The calendar (literals): week 1's game Sunday 17:00Z; week 2's first kickoff (= week 1's lock). */
const WEEK1 = { starts: '2087-09-09T04:00:00.000Z', kickoff: '2087-09-13T17:00:00.000Z', defaultClose: '2087-09-17T10:00:00.000Z' }
const WEEK2 = { starts: '2087-09-16T04:00:00.000Z', kickoff: '2087-09-18T00:15:00.000Z', defaultClose: '2087-09-24T10:00:00.000Z' }
const T_LIVE = '2087-09-13T18:00:00.000Z'
const T_FINAL_SEEN = '2087-09-13T20:30:00.000Z'
const T_ADVANCE = '2087-09-15T08:00:00.000Z'
const T_FIX_1 = '2087-09-16T15:00:00.000Z' // days after the game is seen final — past the 6 h settle grace (F511)
const T_FIX_2 = '2087-09-16T16:00:00.000Z'

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
const team = { one: '', two: '' }
const userIds: string[] = []
let commishClient: SupabaseClient<Database>
let memberClient: SupabaseClient<Database>
let outsiderClient: SupabaseClient<Database>

const feed = { status: 'live' as ProviderGame['status'], lines: {} as Record<string, Record<string, number>> }
const provider: StatsProvider = {
  name: 'fixture:capi',
  capabilities: new Set(['core_box']),
  getSchedule: async () => [
    { gameId: GAME, season: SEASON, week: 1, homeTeam: 'CXA', awayTeam: 'CXB', kickoffAt: new Date(WEEK1.kickoff), gameDate: '2087-09-13', status: feed.status },
  ],
  getGameStates: async () => [],
  getWeekStats: async () =>
    Object.entries(feed.lines).map(([playerId, stats]): ProviderPlayerWeekStats => ({ playerId, season: SEASON, week: 1, gameId: GAME, stats, advanced: {} })),
  getInjuries: async () => [],
  getInactives: async () => [],
}

async function pollAndDrain(iso: string): Promise<void> {
  clock.advanceTo(new Date(iso))
  await ingestWeek(provider, clock, { db, degradation: new DegradationTracker(), season: SEASON, week: 1 })
  await runScoreWeekBatch({ time: clock, db: service }, { batchSize: 1000, leagueIds: [leagueId] })
}

async function signIn(u: (typeof USERS)[number]): Promise<SupabaseClient<Database>> {
  const client = createClient<Database>(LOCAL_URL, LOCAL_ANON_KEY, { auth: { persistSession: false } })
  const { error } = await client.auth.signInWithPassword({ email: u.email, password: u.password })
  if (error) throw new Error(`sign-in ${u.username}: ${error.message}`)
  return client
}

async function correctionPosts(): Promise<string[]> {
  const rows = await must(
    service.from('league_chat').select('message').eq('league_id', leagueId).eq('is_system', true).is('user_id', null).like('message', 'Stat correction (Week %').order('created_at', { ascending: false }),
    'posts',
  )
  return (rows ?? []).map((r) => r.message)
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
  commishClient = await signIn(USERS[0])
  memberClient = await signIn(USERS[1])
  outsiderClient = await signIn(USERS[2])
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
  team.two = (await must(service.from('teams').insert({ owner_id: userIds[1], name: 'Team Two', league_id: leagueId }).select('id').single(), 'team two'))!.id
  await must(service.from('league_members').insert([{ league_id: leagueId, user_id: userIds[1], team_id: team.two, role: 'manager' }]), 'members')
  await must(
    service.from('leagues').update({ status: 'in_season', scoring_rules_snapshot: std!.rules as Json, playoff_teams: 0 }).eq('id', leagueId),
    'league → in_season',
  )
  await must(service.from('league_weeks').insert([{ league_id: leagueId, season: SEASON, week: 1, status: 'live' }, { league_id: leagueId, season: SEASON, week: 2, status: 'upcoming' }]), 'weeks')
  await must(
    service.from('matchups').insert([{ league_id: leagueId, season: SEASON, week: 1, round_type: 'regular', home_team_id: team.one, away_team_id: team.two, status: 'live' }]).select('id'),
    'matchups',
  )
  await must(service.from('league_rosters').insert([
    { league_id: leagueId, team_id: team.one, player_id: WR1 },
    { league_id: leagueId, team_id: team.two, player_id: WR2 },
  ]), 'rosters')
  await must(
    service.from('team_lineups').insert([
      { team_id: team.one, season: SEASON, week: 1, starters: [], bench: [], slot_map: { 'wr:0': WR1 } },
      { team_id: team.two, season: SEASON, week: 1, starters: [], bench: [], slot_map: { 'wr:0': WR2 } },
    ]),
    'lineups',
  )

  // The week's story, through the REAL poll → worker → door (172).
  feed.status = 'live'
  feed.lines = { [WR1]: { receiving_yards: 90 }, [WR2]: { receiving_yards: 90 } }
  await pollAndDrain(T_LIVE)
  feed.status = 'final'
  feed.lines = { [WR1]: { receiving_yards: 100 }, [WR2]: { receiving_yards: 97 } }
  await pollAndDrain(T_FINAL_SEEN)
  clock.advanceTo(new Date(T_ADVANCE))
  await must(service.rpc('league_week_advance', { p_now: T_ADVANCE, p_league_id: leagueId }), 'league_week_advance')
  feed.lines = { ...feed.lines, [WR1]: { receiving_yards: 94 } }
  await pollAndDrain(T_FIX_1)
  feed.lines = { ...feed.lines, [WR2]: { receiving_yards: 90 } }
  await pollAndDrain(T_FIX_2)
  // An ordinary league post beside them (CA6's negative)…
  await must(service.from('league_chat').insert({ league_id: leagueId, user_id: null, message: 'Schedule remixed by the commissioner.', context: 'league', is_system: true }), 'plain post')
  // …and R1349's spoof: a commissioner post (it carries its actor) that opens with a team named like a correction.
  await must(
    service.from('league_chat').insert({ league_id: leagueId, user_id: userIds[0], message: "Stat correction (Week 3): Team Two 99.00 → 120.00's FAAB balance is now $5 (was $100) — set by capi_commish_one (commissioner override)", context: 'league', is_system: true }),
    'spoof post',
  )
}, 120_000)

afterAll(cleanup, 60_000)

describe('L.E2.3 — the league’s stat corrections read, over records the REAL door wrote', () => {
  it('PREMISE — the door wrote exactly two records and two posts, in the window (the week is correction_window)', async () => {
    const week = await must(service.from('league_weeks').select('status').eq('league_id', leagueId).eq('week', 1).single(), 'week')
    expect(week!.status).toBe('correction_window')
    expect(await correctionPosts()).toEqual([
      "Stat correction (Week 1): Dee Catcher's receiving yards 97 → 90 — Team Two 9.70 → 9.00. Result changed: Team One now beats Team Two 9.40–9.00.",
      "Stat correction (Week 1): Cal Catcher's receiving yards 100 → 94 — Team One 10.00 → 9.40. Result changed: Team Two now beats Team One 9.70–9.40.",
    ])
  })

  it('CA1 a member reads Week 1: both corrections, newest first, every field in words — and each summary is its post\'s own sentence', async () => {
    const result = await readStatCorrections(memberClient, leagueId, { week: '1' })
    expect(result.status).toBe(200)
    const page = result.body as unknown as StatCorrectionsPage
    expect([page.week, page.has_more, page.next_cursor, page.note]).toEqual([1, false, null, null])
    expect(page.items.map((i) => ({ ...i, id: '-', recorded_at: '-', matchup_id: i.matchup_id === null ? null : '-' }))).toEqual([
      {
        id: '-',
        week: 1,
        recorded_at: '-',
        player: { id: WR2, name: 'Dee Catcher', position: 'WR', nfl_team: 'CXB' },
        team: { id: team.two, name: 'Team Two' },
        matchup_id: '-',
        slot: 'wr:0',
        stat_changes: [{ stat_key: 'receiving_yards', stat: 'receiving yards', old: 97, new: 90, words: 'receiving yards 97 → 90' }],
        player_points: { before: 9.7, after: 9 },
        team_score: { before: 9.7, after: 9 },
        result: { known: true, changed: true, changes: [{ game: 'matchup', before: 'win', after: 'loss', words: 'Matchup: win → loss' }] },
        summary: "Dee Catcher's receiving yards 97 → 90 — Team Two 9.70 → 9.00",
      },
      {
        id: '-',
        week: 1,
        recorded_at: '-',
        player: { id: WR1, name: 'Cal Catcher', position: 'WR', nfl_team: 'CXA' },
        team: { id: team.one, name: 'Team One' },
        matchup_id: '-',
        slot: 'wr:0',
        stat_changes: [{ stat_key: 'receiving_yards', stat: 'receiving yards', old: 100, new: 94, words: 'receiving yards 100 → 94' }],
        player_points: { before: 10, after: 9.4 },
        team_score: { before: 10, after: 9.4 },
        result: { known: true, changed: true, changes: [{ game: 'matchup', before: 'win', after: 'loss', words: 'Matchup: win → loss' }] },
        summary: "Cal Catcher's receiving yards 100 → 94 — Team One 10.00 → 9.40",
      },
    ])
    // The view and the post say the same words (the door's post opens with the record's sentence).
    const posts = await correctionPosts()
    expect(posts.map((p, n) => p.startsWith(`Stat correction (Week 1): ${page.items[n].summary}.`))).toEqual([true, true])
    // The commissioner reads the same list; no-week reads every week (here, the same two).
    const commish = await readStatCorrections(commishClient, leagueId, {})
    expect((commish.body as unknown as StatCorrectionsPage).items.map((i) => i.summary)).toEqual(page.items.map((i) => i.summary))
  })

  it('CA2 paged: limit 1 hands back page 1 and a cursor; the cursor hands back page 2, and the list is done', async () => {
    const first = (await readStatCorrections(memberClient, leagueId, { week: '1', limit: '1' })).body as unknown as StatCorrectionsPage
    expect([first.items.map((i) => i.player.name), first.has_more, typeof first.next_cursor, first.note]).toEqual([['Dee Catcher'], true, 'string', null])
    const second = await readStatCorrections(memberClient, leagueId, { week: '1', limit: '1', cursor: first.next_cursor! })
    const page2 = second.body as unknown as StatCorrectionsPage
    expect([second.status, page2.items.map((i) => i.player.name), page2.has_more, page2.next_cursor, page2.note]).toEqual([200, ['Cal Catcher'], false, null, null])
  })

  it('CA3 a week with none SAYS SO — Week 2: 200, no items, the note in words', async () => {
    expect(await readStatCorrections(memberClient, leagueId, { week: '2' })).toStrictEqual({
      status: 200,
      body: { week: 2, items: [], limit: 50, has_more: false, next_cursor: null, note: 'No stat correction changed a score in this league in Week 2.' },
    })
  })

  it('CA4 a non-member is the family’s no-leak 403 (R807; the task’s “non-member 404” — D387(3)) — and his RLS read is EMPTY, the answer the gate refuses to serve', async () => {
    expect(await readStatCorrections(outsiderClient, leagueId, { week: '1' })).toStrictEqual({ status: 403, body: { error: INSEASON_READ_FORBIDDEN_MESSAGE } })
    const direct = await outsiderClient.from('league_stat_corrections').select('id').eq('league_id', leagueId)
    expect([direct.error, direct.data]).toEqual([null, []])
  })

  it('CA5 the pre-push shape (TD15): PostgREST’s GET answer for an absent table, MEASURED, renamed to this table ⇒ the named 503', async () => {
    // PREMISE — the wire's answer for a table this database does not have (a GET; a HEAD says nothing — R1257).
    const probe = await memberClient.from('capi_table_not_in_this_database' as never).select('id')
    expect([probe.error?.code, probe.error?.message]).toEqual(['PGRST205', "Could not find the table 'public.capi_table_not_in_this_database' in the schema cache"])
    const absent = { ...probe.error!, message: probe.error!.message.replace('capi_table_not_in_this_database', 'league_stat_corrections') }
    // A 171 database: membership and the league row answer for real; the records table is not there.
    const pre172 = new Proxy(memberClient, {
      get(target, prop, receiver) {
        if (prop !== 'from') return Reflect.get(target, prop, receiver)
        return (table: string) => {
          if (table !== 'league_stat_corrections') return target.from(table as never)
          const chain: Record<string, unknown> = {}
          for (const m of ['select', 'eq', 'order', 'limit', 'or']) chain[m] = () => chain
          chain.then = (resolve: (v: unknown) => unknown) => resolve({ data: null, error: absent, count: null, status: 404, statusText: 'Not Found' })
          return chain
        }
      },
    }) as SupabaseClient<Database>
    expect(await readStatCorrections(pre172, leagueId, { week: '1' })).toStrictEqual({ status: 503, body: { error: CORRECTIONS_UNAVAILABLE_MESSAGE } })
  })

  it('CA6 the activity feed carries both correction posts, tagged stat_correction with their week — an ordinary post, and a commissioner post opening with the prefix (R1349), are untagged', async () => {
    const result = await readActivity(memberClient, leagueId, { kind: 'system' })
    expect(result.status).toBe(200)
    const items = (result.body as unknown as ActivityFeed).items
    const tagged = items.map((i) => (i.kind === 'system' ? [i.topic, i.week, i.message] : null))
    const [fix2, fix1] = await correctionPosts()
    expect(tagged).toEqual([
      [null, null, "Stat correction (Week 3): Team Two 99.00 → 120.00's FAAB balance is now $5 (was $100) — set by capi_commish_one (commissioner override)"],
      [null, null, 'Schedule remixed by the commissioner.'],
      ['stat_correction', 1, fix2],
      ['stat_correction', 1, fix1],
    ])
  })
})

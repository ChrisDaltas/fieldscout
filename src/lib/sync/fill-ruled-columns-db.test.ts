/**
 * fill-ruled-columns-db.test.ts — the quiet fill (PROGRESS F890, D832) over the
 * REAL ingest door (migration 167). What the unit suite's fake can only claim,
 * this reads off the database: `enqueue: false` with `corrections: []` is legal,
 * the door sets exactly the columns sent, no event and no queue row come of it,
 * and the service role can read `week_games_state_internal`.
 *
 * Its own calendar (season 2095: no other test names it, by a repo grep) and no
 * score: a final week's line moves here, no league table does. The league exists
 * only to hold the week open, then to stop holding it.
 *
 * 222 (PROGRESS D839) re-cut, deliberately: the fill now also RECORDS its fix —
 * every move, before → after, through the real `record_stat_fix` BEFORE its
 * first write, marked written (`mark_stat_fix_written`) once its checks pass —
 * so the score-week pass re-scores every final league-week it touched. Those
 * are platform tables (`stat_fixes`, `stat_fix_lines`), still no league table:
 * the fill itself never scores. FR5 reads the fix off the database; FR6 records
 * none (nothing to write). Round 6: FR7 — once FR5's written fix holds week 1,
 * the week is FILLED, and a block and a new line the provider adds since are
 * listed as the provider's, never written, recorded or paid. Cleanup withdraws
 * the 2095 fixes (applied nowhere).
 *
 * Requires the local stack — D59(5); FAILS loudly when it is down. Fixture
 * hygiene (F199): the `vitest-frc` prefix on players / stats / games, the league
 * by name, the 2095 calendar rows; cleanup first and after. Action-id prefix
 * `3fc` (free by a repo grep).
 */
import { createClient } from '@supabase/supabase-js'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { defaultsForTeamCount, splitSettings } from '@/lib/leagues/settings/league-settings'
import type { ProviderPlayerWeekStats, StatsProvider } from '@/lib/leagues/stats/stats-provider'
import { VirtualClock } from '@/lib/leagues/time/virtual-clock'
import type { Database, Json } from '@/types/database'

import { fillRuledColumns, type FillReport } from './fill-ruled-columns'
import type { SyncClient } from './types'

const LOCAL_URL = process.env.SUPABASE_LOCAL_URL ?? 'http://127.0.0.1:54321'
const LOCAL_ANON_KEY =
  process.env.SUPABASE_LOCAL_ANON_KEY ??
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0'
const LOCAL_SERVICE_ROLE_KEY =
  process.env.SUPABASE_LOCAL_SERVICE_ROLE_KEY ??
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU'

const PREFIX = 'vitest-frc'
const SEASON = 2095
const COMMISH = { email: 'fill-ruled-commish@fieldscout.test', password: 'pgtap-frc-pass-1', username: 'frc_commish_one' }
const ACTION = '3fc00000-0000-4000-8000-000000000001'

const GAME = `${PREFIX}-g1`
const K = `${PREFIX}-k`
const DST = `${PREFIX}-dst`
const WR = `${PREFIX}-wr`
const RETURNER = `${PREFIX}-ret`
/** Round 6: no line in FEED; FR7's feed adds one (the provider's, after our fill). */
const LATE_RETURNER = `${PREFIX}-ret2`
const PLAYERS = [
  { id: K, full_name: 'FRC Kicker', position: 'K', team: 'FRA', status: 'Active' },
  { id: DST, full_name: 'FRC Defense', position: 'DEF', team: 'FRA', status: 'Active' },
  { id: WR, full_name: 'FRC Receiver', position: 'WR', team: 'FRA', status: 'Active' },
  { id: RETURNER, full_name: 'FRC Returner', position: 'WR', team: 'FRB', status: 'Active' },
  { id: LATE_RETURNER, full_name: 'FRC Late Returner', position: 'WR', team: 'FRA', status: 'Active' },
]

const KICKOFF = '2095-09-13T17:00:00.000Z'
const WEEK_END = '2095-09-15T07:00:00.000Z'
const WINDOW_END = '2095-09-17T10:00:00.000Z'
const STAMP = '2095-09-14T00:00:00.000Z'
const NOW = new Date('2095-09-18T12:00:00.000Z')
const SOURCE = 'sleeper+nflverse'

const service = createClient<Database>(LOCAL_URL, LOCAL_SERVICE_ROLE_KEY, { auth: { persistSession: false } })
const db = service as unknown as SyncClient

async function must<T>(p: PromiseLike<{ data: T; error: { message: string } | null }>, what: string): Promise<T> {
  const { data, error } = await p
  if (error) throw new Error(`${what}: ${error.message}`)
  return data
}

function feedLine(playerId: string, stats: Record<string, number>, advanced: Record<string, number> = {}): ProviderPlayerWeekStats {
  return { playerId, season: SEASON, week: 1, team: 'FRA', opponent: 'FRB', stats, advanced }
}

/** The feed once the map is in: the kicker's short makes and a miss, the D/ST's block, a receiver's late fix, a line with no row yet. */
const FEED: ProviderPlayerWeekStats[] = [
  feedLine(K, { fg_made: 3, fg_attempted: 4, fg_0_39: 2, fg_40_49: 1, fg_missed: 1, pat_made: 2, pat_attempted: 2 }, { fg_long: 46 }),
  feedLine(DST, { def_sack: 2, def_points_allowed: 17, def_yards_allowed: 300, def_block: 1 }),
  feedLine(WR, { receptions: 5, receiving_yards: 94 }, { off_snaps: 41 }),
  feedLine(RETURNER, { return_td: 1 }, { off_snaps: 4 }),
]

const provider: StatsProvider & { calls: number; week1: ProviderPlayerWeekStats[] } = {
  name: SOURCE,
  capabilities: new Set(['core_box']),
  calls: 0,
  week1: FEED,
  getSchedule: async () => [],
  getGameStates: async () => [],
  async getWeekStats(_season, week) {
    provider.calls += 1
    return week === 1 ? provider.week1 : []
  },
  getInjuries: async () => [],
  getInactives: async () => [],
}

function fill(apply: boolean, weeks: number[] = [1]): Promise<FillReport> {
  return fillRuledColumns({ db, provider, time: new VirtualClock(NOW) }, { season: SEASON, weeks, apply })
}

async function line(playerId: string) {
  return must(service.from('player_stats').select('*').eq('player_id', playerId).eq('season', SEASON).eq('week', 1).maybeSingle(), `line ${playerId}`)
}

async function queueAndEvents(): Promise<{ queue: unknown[] | null; events: unknown[] | null }> {
  return {
    queue: await must(service.from('score_fanout').select('player_id').like('player_id', `${PREFIX}-%`), 'queue'),
    events: await must(service.from('stat_correction_events').select('player_id').like('player_id', `${PREFIX}-%`), 'events'),
  }
}

async function cleanup(): Promise<void> {
  // 222: the fixes this suite's fills recorded — applied nowhere, so they may be withdrawn (their lines go with them).
  await must(service.from('stat_fixes').delete().eq('season', SEASON), 'cleanup stat_fixes')
  await must(service.from('stat_correction_events').delete().like('player_id', `${PREFIX}-%`), 'cleanup stat_correction_events')
  await must(service.from('score_fanout').delete().like('player_id', `${PREFIX}-%`), 'cleanup score_fanout')
  await must(service.from('player_stats').delete().like('player_id', `${PREFIX}-%`), 'cleanup player_stats')
  const { data: stale } = await service.from('leagues').select('id').like('name', `${PREFIX}-%`)
  const ids = (stale ?? []).map((row) => row.id)
  if (ids.length > 0) {
    for (const table of ['league_weeks', 'league_player_pool', 'league_rosters', 'league_chat', 'league_members'] as const) {
      await must(service.from(table).delete().in('league_id', ids), `cleanup ${table}`)
    }
    await must(service.from('teams').delete().in('league_id', ids), 'cleanup teams')
    await must(service.from('leagues').delete().in('id', ids), 'cleanup leagues')
  }
  await must(service.from('nfl_games').delete().like('id', `${PREFIX}-%`), 'cleanup nfl_games')
  await must(service.from('nfl_weeks').delete().eq('season', SEASON), 'cleanup nfl_weeks')
  await must(service.from('players').delete().like('id', `${PREFIX}-%`), 'cleanup players')
  const { data: users } = await service.from('profiles').select('id').eq('username', COMMISH.username)
  for (const row of users ?? []) await service.auth.admin.deleteUser(row.id)
}

let leagueId: string
let templateRules: Json

beforeAll(async () => {
  await cleanup()
  await must(
    service.from('nfl_weeks').insert([
      { season: SEASON, week: 1, starts_at: '2095-09-09T04:00:00.000Z', first_kickoff_at: KICKOFF, last_game_ends_at: WEEK_END, correction_window_ends_at: WINDOW_END },
      { season: SEASON, week: 2, starts_at: '2095-09-16T04:00:00.000Z', first_kickoff_at: null, last_game_ends_at: null, correction_window_ends_at: '2095-09-24T10:00:00.000Z' },
    ]),
    'nfl_weeks',
  )
  await must(service.from('players').upsert(PLAYERS).select('id'), 'players')
  await must(service.from('nfl_games').insert({ id: GAME, season: SEASON, week: 1, home_team: 'FRA', away_team: 'FRB', kickoff_at: KICKOFF, status: 'final', game_type: 'regular' }), 'nfl_games')
  const stored = [
    { player_id: K, team: 'FRA', fg_made: 3, fg_attempted: 4, fg_made_40_plus: 1, xp_made: 2, xp_attempted: 2, advanced: { fg_long: 46 } },
    { player_id: DST, team: 'FRA', def_sacks: 2, def_points_allowed: 17, def_yards_allowed: 300, advanced: {} },
    // Stored 61; the feed now says 94: a late provider fix this tool must not land.
    { player_id: WR, team: 'FRA', receptions: 5, receiving_yards: 61, advanced: { off_snaps: 40 } },
  ]
  await must(
    service
      .from('player_stats')
      .upsert(stored.map((row) => ({ ...row, season: SEASON, week: 1, stat_type: 'weekly', game_id: GAME, is_live: false, source: 'sleeper', updated_at: STAMP })), { onConflict: 'player_id,season,week' })
      .select('player_id'),
    'stored lines',
  )

  const { error: userError } = await service.auth.admin.createUser({ email: COMMISH.email, password: COMMISH.password, email_confirm: true, user_metadata: { username: COMMISH.username } })
  if (userError) throw new Error(`createUser: ${userError.message}`)
  const commish = createClient<Database>(LOCAL_URL, LOCAL_ANON_KEY, { auth: { persistSession: false } })
  const { error: signInError } = await commish.auth.signInWithPassword({ email: COMMISH.email, password: COMMISH.password })
  if (signInError) throw new Error(`sign-in: ${signInError.message}`)
  const { columns, blob } = splitSettings(defaultsForTeamCount(8))
  const columnArgs = Object.fromEntries(Object.entries(columns).map(([key, value]) => [`p_${key}`, value]))
  const { data: template } = await commish.from('scoring_systems').select('id, rules').eq('is_template', true).eq('name', 'ESPN Standard').single()
  templateRules = template!.rules as Json
  const { data: league, error } = await commish.rpc('create_league', {
    p_name: `${PREFIX}-league`,
    p_season: SEASON,
    p_scoring_system_id: template?.id,
    p_team_name: 'FRC One',
    p_action_id: ACTION,
    p_settings: blob,
    ...columnArgs,
  } as unknown as Database['public']['Functions']['create_league']['Args'])
  if (error) throw new Error(`create_league: ${error.message}`)
  leagueId = (league as { league_id: string }).league_id
}, 60_000)

afterAll(cleanup)

describe('the quiet fill over the real door (167)', () => {
  it('FR1 a pre-draft league with an open week row does not hold the gate shut', async () => {
    await must(service.from('league_weeks').insert({ league_id: leagueId, season: SEASON, week: 1 }), 'league week')
    const report = await fill(false)
    expect(report.refused).toBeUndefined()
    expect(report.ok).toBe(true)
  })

  it('FR2 the same league in season holds it: refused by name, the feed not read', async () => {
    await must(service.from('leagues').update({ status: 'in_season', scoring_rules_snapshot: templateRules }).eq('id', leagueId), 'league → in_season')
    const before = provider.calls
    const report = await fill(true)
    expect(report.ok).toBe(false)
    expect(report.refused).toContain(`week 1: league ${leagueId} (in_season) holds it upcoming`)
    expect(provider.calls).toBe(before)
    expect((await line(K))?.fg_0_39).toBe(0)
  })

  it('FR3 a week the door reads as not final: every cause named, through the real game-state read', async () => {
    const report = await fill(false, [2])
    expect(report.ok).toBe(false)
    expect(report.refused).toContain('week 2: no game has a recorded kickoff')
    expect(report.refused).toContain('week 2: its correction window closes')
    expect(report.refused).toContain('week 2: not every game still in the week is final (0 open of 0)')
  })

  it('FR4 the plan: counts and names, writes nothing', async () => {
    await must(service.from('league_weeks').delete().eq('league_id', leagueId), 'league week gone')
    const report = await fill(false)
    expect(report.ok).toBe(true)
    expect(report.weeks[0].updates.map((row) => row.player_id).sort()).toEqual([DST, K].sort())
    expect(report.weeks[0].newRows.map((row) => row.player_id)).toEqual([RETURNER])
    expect(report.weeks[0].otherDifferences).toEqual([{ player_id: WR, key: 'receiving_yards', column: 'receiving_yards', stored: 61, feed: 94 }])
    expect(await line(RETURNER)).toBeNull()
    expect((await line(K))?.fg_0_39).toBe(0)
    expect(new Date((await line(K))!.updated_at!).toISOString()).toBe(STAMP)
  })

  it('FR5 --apply: the ruled columns land, nothing else moves, no event, no queue row', async () => {
    const report = await fill(true)
    expect(report.afterProblems).toEqual([])
    expect(report.ok).toBe(true)
    expect(report.linesWritten).toBe(3)
    expect(report.door.stats).toEqual({ enqueued: 0, restamped: 0 })
    expect(report.door.corrections).toMatchObject({ recorded: 0, replayed: 0, unchangedAtWrite: 0, weekState: null })

    expect(await line(K)).toMatchObject({ fg_0_39: 2, fg_missed: 1, fg_made: 3, fg_attempted: 4, fg_made_40_plus: 1, team: 'FRA', game_id: GAME, is_live: false, source: 'sleeper', advanced: { fg_long: 46 } })
    expect(new Date((await line(K))!.updated_at!).toISOString()).toBe(NOW.toISOString())
    expect(await line(DST)).toMatchObject({ def_block: 1, def_sacks: 2, source: 'sleeper', team: 'FRA' })
    // Untouched: not even its stamp moved.
    const wr = await line(WR)
    expect(wr).toMatchObject({ receiving_yards: 61, source: 'sleeper', advanced: { off_snaps: 40 } })
    expect(new Date(wr!.updated_at!).toISOString()).toBe(STAMP)
    // The new line takes the full surface.
    expect(await line(RETURNER)).toMatchObject({ return_td: 1, source: SOURCE, is_live: false, team: 'FRA', def_yards_allowed: null, advanced: { off_snaps: 4 }, receiving_yards: 0 })

    expect(await queueAndEvents()).toEqual({ queue: [], events: [] })

    // 222 (D839): the fix, recorded before the write and written after the checks — the moves, before → after (a new line from 0).
    const fixes = await must(service.from('stat_fixes').select('id, season, landed_at, written_at').eq('season', SEASON), 'fixes')
    expect(fixes).toHaveLength(1)
    expect(report.fix).toEqual({ id: fixes![0].id, lines: 4, written: true })
    expect(fixes![0].written_at).not.toBeNull()
    expect(new Date(fixes![0].landed_at).toISOString()).toBe(NOW.toISOString())
    const lines = await must(service.from('stat_fix_lines').select('week, player_id, stat_key, before_value, after_value').eq('fix_id', fixes![0].id), 'fix lines')
    expect(lines!.map((l) => `${l.week}:${l.player_id}:${l.stat_key}:${l.before_value}→${l.after_value}`).sort()).toEqual(
      [`1:${DST}:def_block:0→1`, `1:${K}:fg_0_39:0→2`, `1:${K}:fg_missed:0→1`, `1:${RETURNER}:return_td:0→1`].sort(),
    )
  })

  it('FR6 a second run writes nothing', async () => {
    const report = await fill(true)
    expect(report.ok).toBe(true)
    expect(report.wrote).toBe(false)
    expect(report.weeks[0].updates).toEqual([])
    expect(report.weeks[0].newRows).toEqual([])
    expect(await queueAndEvents()).toEqual({ queue: [], events: [] })
    // 222: nothing moved, so no fix is recorded (FR5's stays the only one).
    expect(report.fix).toBeUndefined()
    expect(await must(service.from('stat_fixes').select('id').eq('season', SEASON), 'fixes')).toHaveLength(1)
  })

  it('FR7 round 6: FR5\'s written fix holds week 1, so it is FILLED — a second block and a new line the provider adds since are listed as its own, never written, recorded or paid', async () => {
    provider.week1 = FEED.map((l) => (l.playerId === DST ? { ...l, stats: { ...l.stats, def_block: 2 } } : l)).concat(feedLine(LATE_RETURNER, { return_td: 1 }, { off_snaps: 3 }))
    try {
      const report = await fill(true)
      expect(report.ok).toBe(true)
      expect(report.wrote).toBe(false)
      expect(report.fix).toBeUndefined()
      expect(report.weeks[0].filled).toBe(true)
      expect(report.weeks[0].providerMoves).toEqual([
        { player_id: DST, column: 'def_block', stored: 1, feed: 2, newLine: false },
        { player_id: LATE_RETURNER, column: 'return_td', stored: 0, feed: 1, newLine: true },
      ])
      expect(await line(DST)).toMatchObject({ def_block: 1 })
      expect(await line(LATE_RETURNER)).toBeNull()
      expect(await must(service.from('stat_fixes').select('id').eq('season', SEASON), 'fixes')).toHaveLength(1)
      expect(await queueAndEvents()).toEqual({ queue: [], events: [] })
    } finally {
      provider.week1 = FEED
    }
  })
})

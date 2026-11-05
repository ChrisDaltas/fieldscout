/**
 * fill-ruled-columns.test.ts — the quiet fill (PROGRESS F890, D832), over a fake
 * PostgREST and a fake of migration 167's door. No database, no network, no env.
 *
 * THE FAKE'S TEETH, so a green here means something:
 *   - every response is capped at 1000 rows, as PostgREST's is; a read that
 *     doesn't page plans wrong and the pagination tests go red;
 *   - a read returns only the columns it selected;
 *   - the door refuses what 167 refuses (element shape, mixed key sets, an unknown
 *     column, corrections without enqueue), sets exactly the columns it is sent,
 *     and records queue rows and events when asked, so "none" is measured;
 *   - every table write outside the door is recorded.
 *
 * Fixture lines are real 2026 Sleeper lines in canonical keys, as the adapter
 * hands them once F870's map is in. The provider here hands them directly, so
 * these tests don't depend on that map. The real door runs in
 * `fill-ruled-columns-db.test.ts`.
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

import type { ProviderPlayerWeekStats, StatsProvider } from '@/lib/leagues/stats/stats-provider'
import { VirtualClock } from '@/lib/leagues/time/virtual-clock'

import {
  afterWriteProblems,
  fillRefusalCauses,
  fillRuledColumns,
  kIdentityFailures,
  leagueHoldsWeek,
  mappingRefusals,
  metadataWontRoundTrip,
  parseFillArgs,
  planFillWeek,
  renderFill,
  RULED_COLUMNS,
  runFillCli,
  type FillOptions,
  type FillReport,
  type FillWeekPlan,
} from './fill-ruled-columns'
import { INGEST_DOOR, STAT_COLUMN_SURFACE, toStatRow, type DbStatRow, type StatRow, type ToStatRowContext } from './ingest-week'
import type { SyncClient } from './types'

type Row = Record<string, unknown>

const SEASON = 2026
const NOW = new Date('2026-11-06T03:00:00.000Z')
const PAST = '2026-09-01T00:00:00.000Z'
const META = ['advanced', 'game_id', 'is_live', 'player_id', 'season', 'source', 'stat_type', 'week']
const REAL_COLUMNS = new Set([...META, ...STAT_COLUMN_SURFACE, 'team'])

interface DoorElement {
  stat: Row
  enqueue: boolean
  corrections: Array<{ stat_key: string; column?: string; advanced?: true }>
}

class World {
  weeks: Row[] = []
  games: Row[] = []
  leagueWeeks: Row[] = []
  leagues: Row[] = []
  players: Row[] = []
  stats: Row[] = []
  queue: Row[] = []
  events: Row[] = []
  doorCalls: Array<{ p_rows: DoorElement[]; p_now: string }> = []
  stateCalls: number[] = []
  tableWrites: string[] = []
  teamColumn = true
  /** Week → the door's game state; default is all final. */
  gameStates = new Map<number, { total_games: number; open_games: number; all_final: boolean }>()
  doorError: { callNumber: number; message: string } | null = null
  /** Runs after each door call: a door that misbehaves. */
  afterDoor: ((world: World) => void) | null = null
  /** Laid over the door's report: a door that misreports. */
  doorReport: Row = {}

  client(): SyncClient {
    return {
      from: (table: string) => this.query(table),
      rpc: async (fn: string, args: Row) => {
        if (fn === 'week_games_state_internal') {
          const week = Number(args.p_week)
          this.stateCalls.push(week)
          return { data: [this.gameStates.get(week) ?? { total_games: 2, open_games: 0, all_final: true }], error: null }
        }
        if (fn === INGEST_DOOR) return this.door(args.p_rows as DoorElement[], String(args.p_now))
        throw new Error(`world: unexpected rpc ${fn}`)
      },
    } as unknown as SyncClient
  }

  private table(name: string): Row[] {
    const tables: Record<string, Row[]> = {
      nfl_weeks: this.weeks,
      nfl_games: this.games,
      league_weeks: this.leagueWeeks,
      leagues: this.leagues,
      players: this.players,
      player_stats: this.stats,
    }
    const rows = tables[name]
    if (rows === undefined) throw new Error(`world: unexpected table ${name}`)
    return rows
  }

  private query(name: string) {
    const filters: Array<(row: Row) => boolean> = []
    let selected = '*'
    let wantsCount = false
    let lo = 0
    let hi = Number.POSITIVE_INFINITY
    let wrote = false
    const builder = {
      select: (columns: string, opts?: { count?: string }) => {
        selected = columns
        wantsCount = opts?.count === 'exact'
        return builder
      },
      eq: (column: string, value: unknown) => (filters.push((row) => row[column] === value), builder),
      neq: (column: string, value: unknown) => (filters.push((row) => row[column] !== value), builder),
      in: (column: string, values: unknown[]) => (filters.push((row) => values.includes(row[column])), builder),
      order: () => builder,
      range: (from: number, to: number) => ((lo = from), (hi = to), builder),
      upsert: () => ((wrote = true), builder),
      insert: () => ((wrote = true), builder),
      update: () => ((wrote = true), builder),
      delete: () => ((wrote = true), builder),
      then: (resolveThen: (value: unknown) => unknown, rejectThen?: (reason: unknown) => unknown) => {
        const answer = () => {
          if (wrote) {
            this.tableWrites.push(name)
            return { data: [], error: null }
          }
          const columns = selected === '*' ? null : selected.split(',').map((c) => c.trim())
          if (name === 'player_stats' && !this.teamColumn && columns?.includes('team')) {
            return { data: null, error: { code: '42703', message: 'column player_stats.team does not exist' } }
          }
          const matched = this.table(name).filter((row) => filters.every((f) => f(row)))
          // PostgREST's cap: never more than 1000 rows in one response.
          const page = matched.slice(lo, Math.min(hi + 1, lo + 1000))
          const projected = columns === null ? page : page.map((row) => Object.fromEntries(columns.map((c) => [c, row[c]])))
          return { data: projected, error: null, count: wantsCount ? matched.length : null }
        }
        return Promise.resolve().then(answer).then(resolveThen, rejectThen)
      },
    }
    return builder
  }

  /** 167's checks, then its write: exactly the columns sent. */
  private door(p_rows: DoorElement[], p_now: string) {
    this.doorCalls.push({ p_rows, p_now })
    if (this.doorError?.callNumber === this.doorCalls.length) return { data: null, error: { message: this.doorError.message } }
    if (!Array.isArray(p_rows) || p_rows.length === 0) throw new Error('door: p_rows must be a non-empty array')
    const first = Object.keys(p_rows[0].stat).sort()
    for (const key of first) if (!REAL_COLUMNS.has(key)) throw new Error(`door: element 1 carries key ${key} the door does not write`)
    for (const key of META) if (!first.includes(key)) throw new Error(`door: element 1 lacks the ingest metadata: ${key}`)
    const seen = new Set<string>()
    for (const element of p_rows) {
      if (typeof element.enqueue !== 'boolean' || !Array.isArray(element.corrections)) throw new Error('door: element shape')
      if (Object.keys(element.stat).sort().join() !== first.join()) throw new Error('door: a different key set from element 1')
      if (!element.enqueue && element.corrections.length > 0) throw new Error('door: corrections but not enqueued')
      if (element.stat.stat_type !== 'weekly') throw new Error('door: stat_type must be weekly')
      const id = String(element.stat.player_id)
      if (seen.has(id)) throw new Error(`door: player ${id} appears twice in the batch`)
      seen.add(id)
    }
    let enqueued = 0
    let written = 0
    for (const element of p_rows) {
      const { stat } = element
      const at = this.stats.findIndex((row) => row.player_id === stat.player_id && row.season === stat.season && row.week === stat.week)
      if (at === -1) this.stats.push({ ...stat, updated_at: p_now })
      else this.stats[at] = { ...this.stats[at], ...stat, updated_at: p_now }
      if (element.enqueue) {
        this.queue.push({ player_id: stat.player_id })
        enqueued += 1
      }
      for (const correction of element.corrections) {
        this.events.push({ player_id: stat.player_id, stat_key: correction.stat_key })
        written += 1
      }
    }
    this.afterDoor?.(this)
    return {
      data: { stats_written: p_rows.length, enqueued, restamped: 0, events_written: written, events_replayed: 0, events_unchanged: 0, week_state: written > 0 ? 'final' : null, ...this.doorReport },
      error: null,
    }
  }

  stored(playerId: string, week: number): Row {
    const row = this.stats.find((r) => r.player_id === playerId && r.week === week)
    if (row === undefined) throw new Error(`no stored line ${playerId} week ${week}`)
    return row
  }
}

// ── Real lines (2026, Sleeper's feed), in the keys F870's map gives them ──

function line(playerId: string, week: number, stats: Record<string, number>, advanced: Record<string, number> = {}, team?: string, opponent?: string): ProviderPlayerWeekStats {
  return { playerId, season: SEASON, week, stats, advanced, ...(team ? { team } : {}), ...(opponent ? { opponent } : {}) }
}

/** Tyler Bass, week 1: two short makes the old map dropped. ESPN 13, the league read 7. */
const BASS = line('7042', 1, { fg_made: 3, fg_attempted: 3, fg_0_39: 2, fg_40_49: 1, pat_made: 3, pat_attempted: 3 }, { fg_long: 46 }, 'BUF', 'HOU')
/** Chris Boswell, week 8: two short makes and a miss. */
const BOSWELL = line('1945', 8, { fg_made: 2, fg_attempted: 3, fg_0_39: 2, fg_missed: 1, pat_made: 3, pat_attempted: 3 }, { fg_long: 37 }, 'PIT', 'CLE')
/** Tennessee, week 6: a block, a D/ST return TD. */
const TEN = line('TEN', 6, { def_sack: 6, def_int: 2, def_fumble_rec: 1, def_points_allowed: 20, def_yards_allowed: 399, def_block: 1, def_return_td: 1 }, {}, 'TEN', 'IND')
/** Chicago, week 6: two special-teams recoveries on top of one. */
const CHI = line('CHI', 6, { def_sack: 5, def_fumble_rec: 3, def_points_allowed: 23, def_yards_allowed: 257 }, {}, 'CHI', 'ATL')
/** Minnesota, week 3: a D/ST return TD. */
const MIN = line('MIN', 3, { def_sack: 6, def_int: 2, def_points_allowed: 16, def_yards_allowed: 243, def_return_td: 1 }, {}, 'MIN', 'TB')
/** The three lines that have no row today: nothing but the play the old map dropped. */
const PRICE = line('13075', 3, { return_td: 1 }, { off_snaps: 4 }, 'MIN', 'TB')
const LAUBE = line('11574', 8, { return_td: 1 }, { off_snaps: 1 }, 'LV', 'NYJ')
const MITCHELL = line('8170', 8, { fumble_recovery_td: 1 }, { off_snaps: 31 }, 'DAL', 'ARI')
/** A plain receiver whose ruled columns don't move. */
const WR = line('wr-1', 1, { targets: 7, receptions: 5, receiving_yards: 61 }, { off_snaps: 40 }, 'BUF', 'HOU')

const POSITIONS: Record<string, string> = { '7042': 'K', '1945': 'K', TEN: 'DEF', CHI: 'DEF', MIN: 'DEF', '13075': 'WR', '11574': 'RB', '8170': 'TE', 'wr-1': 'WR' }

const CTX: ToStatRowContext = { providerName: 'sleeper+nflverse', gameStatus: new Map(), anyGameOpen: false }

/** A stored line the way main stores it today: the same feed line, with the ruled columns empty. */
function storedToday(feed: ProviderPlayerWeekStats, over: Row = {}): Row {
  const ruledKeys = new Set(['fg_0_39', 'fg_missed', 'def_block', 'def_return_td', 'return_td', 'fumble_recovery_td'])
  const stats = Object.fromEntries(Object.entries(feed.stats).filter(([key]) => !ruledKeys.has(key)))
  if (feed.playerId === 'CHI') stats.def_fumble_rec = 1
  const { row } = toStatRow({ ...feed, stats }, CTX)
  return { player_id: feed.playerId, season: SEASON, week: feed.week, stat_type: 'weekly', game_id: null, team: feed.team ?? null, is_live: false, source: 'sleeper+nflverse', advanced: feed.advanced, updated_at: PAST, ...row?.columns, ...over }
}

function calendarRow(week: number): Row {
  return {
    season: SEASON,
    week,
    first_kickoff_at: `2026-09-${String(week + 9).padStart(2, '0')}T00:00:00.000Z`,
    last_game_ends_at: `2026-09-${String(week + 13).padStart(2, '0')}T00:00:00.000Z`,
    correction_window_ends_at: `2026-10-${String(week + 1).padStart(2, '0')}T00:00:00.000Z`,
  }
}

function worldWith(lines: readonly ProviderPlayerWeekStats[], stored: readonly Row[] = lines.filter((l) => ![PRICE, LAUBE, MITCHELL].includes(l)).map((l) => storedToday(l))): World {
  const world = new World()
  world.weeks = Array.from({ length: 8 }, (_, i) => calendarRow(i + 1))
  world.games = [
    { id: 'g1', season: SEASON, week: 1, home_team: 'HOU', away_team: 'BUF', kickoff_at: PAST, status: 'final', updated_at: PAST },
    { id: 'g3', season: SEASON, week: 3, home_team: 'TB', away_team: 'MIN', kickoff_at: PAST, status: 'final', updated_at: PAST },
    { id: 'g8', season: SEASON, week: 8, home_team: 'NYJ', away_team: 'LV', kickoff_at: PAST, status: 'final', updated_at: PAST },
  ]
  world.players = Object.entries(POSITIONS).map(([id, position]) => ({ id, position }))
  world.stats = stored.map((row) => ({ ...row }))
  return world
}

function feed(lines: readonly ProviderPlayerWeekStats[]): StatsProvider & { weekCalls: number[]; scheduleCalls: number } {
  const provider = {
    name: 'sleeper+nflverse',
    capabilities: new Set(['core_box'] as const),
    weekCalls: [] as number[],
    scheduleCalls: 0,
    async getSchedule() {
      provider.scheduleCalls += 1
      return []
    },
    getGameStates: async () => [],
    async getWeekStats(_season: number, week: number) {
      provider.weekCalls.push(week)
      return lines.filter((l) => l.week === week)
    },
    getInjuries: async () => [],
    getInactives: async () => [],
  }
  return provider
}

function run(world: World, lines: readonly ProviderPlayerWeekStats[], opts: Partial<FillOptions> = {}): Promise<FillReport> {
  return fillRuledColumns(
    { db: world.client(), provider: feed(lines), time: new VirtualClock(NOW) },
    { season: SEASON, weeks: [1, 3, 6, 8], apply: false, ...opts },
  )
}

const ALL_LINES = [BASS, WR, MIN, PRICE, TEN, CHI, BOSWELL, LAUBE, MITCHELL]

function snapshot(world: World): string {
  return JSON.stringify(world.stats)
}

function expectNothingWritten(world: World, before: string): void {
  expect(world.doorCalls).toEqual([])
  expect(world.tableWrites).toEqual([])
  expect(world.queue).toEqual([])
  expect(world.events).toEqual([])
  expect(snapshot(world)).toBe(before)
}

describe('RULED_COLUMNS — the only columns written on a stored line', () => {
  it('is exactly the seven the ruling covers, each a real stored column', () => {
    expect([...RULED_COLUMNS]).toEqual(['fg_0_39', 'fg_missed', 'def_block', 'def_return_td', 'def_fumble_recoveries', 'return_td', 'fumble_recovery_td'])
    for (const column of RULED_COLUMNS) expect(STAT_COLUMN_SURFACE).toContain(column)
  })
})

describe('the plan writes nothing', () => {
  it('reads the feed and the tables, counts week by week and key by key, and calls no door', async () => {
    const world = worldWith(ALL_LINES)
    const before = snapshot(world)
    const report = await run(world, ALL_LINES)
    expect(report.refused).toBeUndefined()
    expect(report.ok).toBe(true)
    expect(report.mode).toBe('plan')
    expect(report.wrote).toBe(false)
    expectNothingWritten(world, before)

    const byWeek = Object.fromEntries(report.weeks.map((w) => [w.week, { updates: w.updates.length, newRows: w.newRows.length, moves: Object.fromEntries(Object.entries(w.moves).filter(([, n]) => n > 0)), unchanged: w.unchanged }]))
    expect(byWeek).toEqual({
      1: { updates: 1, newRows: 0, moves: { fg_0_39: 1 }, unchanged: 1 },
      3: { updates: 1, newRows: 1, moves: { def_return_td: 1, return_td: 1 }, unchanged: 0 },
      6: { updates: 2, newRows: 0, moves: { def_block: 1, def_return_td: 1, def_fumble_recoveries: 1 }, unchanged: 0 },
      8: { updates: 1, newRows: 2, moves: { fg_0_39: 1, fg_missed: 1, return_td: 1, fumble_recovery_td: 1 }, unchanged: 0 },
    })
  })

  it('never asks the provider for a schedule and never touches a table beyond the reads', async () => {
    const world = worldWith(ALL_LINES)
    const provider = feed(ALL_LINES)
    await fillRuledColumns({ db: world.client(), provider, time: new VirtualClock(NOW) }, { season: SEASON, weeks: [1, 3, 6, 8], apply: false })
    expect(provider.weekCalls).toEqual([1, 3, 6, 8])
    expect(provider.scheduleCalls).toBe(0)
    expect(world.tableWrites).toEqual([])
  })
})

describe('--apply sends only the ruled columns, with enqueue false and no corrections', () => {
  it('updates carry the door metadata plus the seven columns; new lines come as a second batch, full surface; no queue row, no event', async () => {
    const world = worldWith(ALL_LINES)
    const report = await run(world, ALL_LINES, { apply: true })
    expect(report.afterProblems).toEqual([])
    expect(report.ok).toBe(true)
    expect(report.wrote).toBe(true)
    expect(report.linesWritten).toBe(8)
    expect(world.tableWrites).toEqual([])
    expect(world.queue).toEqual([])
    expect(world.events).toEqual([])

    const updateKeys = [...META, ...RULED_COLUMNS].sort()
    const fullKeys = [...META, ...STAT_COLUMN_SURFACE, 'team'].sort()
    const shape = world.doorCalls.map((call) => ({
      week: call.p_rows[0].stat.week,
      players: call.p_rows.map((e) => e.stat.player_id),
      kind: Object.keys(call.p_rows[0].stat).sort().join() === updateKeys.join() ? 'update' : Object.keys(call.p_rows[0].stat).sort().join() === fullKeys.join() ? 'new' : 'WRONG KEYS',
    }))
    expect(shape).toEqual([
      { week: 1, players: ['7042'], kind: 'update' },
      { week: 3, players: ['MIN'], kind: 'update' },
      { week: 3, players: ['13075'], kind: 'new' },
      { week: 6, players: ['TEN', 'CHI'], kind: 'update' },
      { week: 8, players: ['1945'], kind: 'update' },
      { week: 8, players: ['11574', '8170'], kind: 'new' },
    ])
    for (const call of world.doorCalls) {
      expect(call.p_now).toBe(NOW.toISOString())
      for (const element of call.p_rows) {
        expect(element.enqueue).toBe(false)
        expect(element.corrections).toEqual([])
      }
    }
    expect(report.door).toEqual({ stats: { enqueued: 0, restamped: 0 }, corrections: { recorded: 0, replayed: 0, unchangedAtWrite: 0, weekState: null } })
  })

  it('fills the plays: the kicker identities hold and the new lines exist', async () => {
    const world = worldWith(ALL_LINES)
    await run(world, ALL_LINES, { apply: true })
    expect(world.stored('7042', 1)).toMatchObject({ fg_0_39: 2, fg_made: 3, fg_made_40_plus: 1, fg_missed: 0 })
    expect(world.stored('1945', 8)).toMatchObject({ fg_0_39: 2, fg_made: 2, fg_attempted: 3, fg_missed: 1 })
    expect(world.stored('TEN', 6)).toMatchObject({ def_block: 1, def_return_td: 1 })
    expect(world.stored('CHI', 6)).toMatchObject({ def_fumble_recoveries: 3 })
    expect(world.stored('13075', 3)).toMatchObject({ return_td: 1, source: 'sleeper+nflverse', is_live: false, advanced: { off_snaps: 4 } })
    expect(world.stored('11574', 8)).toMatchObject({ return_td: 1 })
    expect(world.stored('8170', 8)).toMatchObject({ fumble_recovery_td: 1, def_yards_allowed: null })
    expect(world.stored('wr-1', 1).updated_at).toBe(PAST)
  })

  it('a stored line keeps every other column and its metadata, even where the feed says otherwise', async () => {
    const stored = storedToday(BOSWELL, { source: 'sleeper', is_live: true, game_id: 'g8', team: 'PIT', advanced: { fg_long: 50 }, pat_made: 2, fumbles_lost: 1 })
    const world = worldWith([BOSWELL, TEN], [stored, storedToday(TEN)])
    const report = await run(world, [BOSWELL, TEN], { weeks: [6, 8], apply: true })
    expect(report.ok).toBe(true)
    expect(world.stored('1945', 8)).toMatchObject({ source: 'sleeper', is_live: true, game_id: 'g8', team: 'PIT', advanced: { fg_long: 50 }, pat_made: 2, fumbles_lost: 1, fg_0_39: 2, fg_missed: 1 })
  })

  it('a second run finds nothing to write and calls no door', async () => {
    const world = worldWith(ALL_LINES)
    await run(world, ALL_LINES, { apply: true })
    const calls = world.doorCalls.length
    const report = await run(world, ALL_LINES, { apply: true })
    expect(report.ok).toBe(true)
    expect(report.wrote).toBe(false)
    expect(report.weeks.map((w) => w.updates.length + w.newRows.length)).toEqual([0, 0, 0, 0])
    expect(world.doorCalls).toHaveLength(calls)
  })

  it('a database with no team column: nothing sends team (F589)', async () => {
    const world = worldWith(ALL_LINES)
    world.teamColumn = false
    const report = await run(world, ALL_LINES, { apply: true })
    expect(report.ok).toBe(true)
    for (const call of world.doorCalls) expect(Object.keys(call.p_rows[0].stat)).not.toContain('team')
  })
})

describe('other-column differences are reported by player and key, and never written', () => {
  it('names each one; the stored value stands after --apply', async () => {
    const feedLine = line('7042', 1, { fg_made: 3, fg_attempted: 3, fg_0_39: 2, fg_40_49: 1, pat_made: 3, pat_attempted: 3 }, { fg_long: 46 })
    const receiver = line('wr-1', 1, { targets: 8, receptions: 5, receiving_yards: 94, pass_2pt: 1 }, { off_snaps: 41 })
    const world = worldWith([feedLine, receiver, TEN], [storedToday(feedLine), storedToday(WR), storedToday(TEN)])
    const report = await run(world, [feedLine, receiver, TEN], { weeks: [1, 6], apply: true })
    expect(report.ok).toBe(true)
    expect(report.weeks[0].otherDifferences).toEqual(
      expect.arrayContaining([
        { player_id: 'wr-1', key: 'targets', column: 'targets', stored: 7, feed: 8 },
        { player_id: 'wr-1', key: 'receiving_yards', column: 'receiving_yards', stored: 61, feed: 94 },
        { player_id: 'wr-1', key: 'pass_2pt', column: 'pass_2pt', stored: 0, feed: 1 },
        { player_id: 'wr-1', key: 'two_point_conversions', column: 'two_point_conversions', stored: 0, feed: 1 },
      ]),
    )
    expect(report.weeks[0].otherDifferences).toHaveLength(4)
    expect(report.weeks[0].contextDifferences).toEqual({ off_snaps: 1 })
    // Unwritten: only ruled movers reach the door, and the receiver isn't one.
    expect(world.stored('wr-1', 1)).toMatchObject({ targets: 7, receiving_yards: 61, pass_2pt: 0, two_point_conversions: 0, advanced: { off_snaps: 40 }, updated_at: PAST })
    const written = world.doorCalls.flatMap((call) => call.p_rows.map((e) => e.stat.player_id))
    expect(written).not.toContain('wr-1')
  })

  it('a line moving on both: the ruled columns land, the other column stays stored and named', async () => {
    const moved = line('1945', 8, { fg_made: 2, fg_attempted: 3, fg_0_39: 2, fg_missed: 1, pat_made: 3, pat_attempted: 4 })
    const world = worldWith([moved, TEN], [storedToday(BOSWELL), storedToday(TEN)])
    const report = await run(world, [moved, TEN], { weeks: [6, 8], apply: true })
    expect(report.ok).toBe(true)
    expect(report.weeks[1].otherDifferences).toEqual([{ player_id: '1945', key: 'pat_attempted', column: 'xp_attempted', stored: 3, feed: 4 }])
    expect(world.stored('1945', 8)).toMatchObject({ fg_0_39: 2, fg_missed: 1, xp_attempted: 3 })
  })

  it('stored yards NULL vs a delivered value is named, not filled', async () => {
    const world = worldWith([TEN, BASS], [storedToday(TEN, { def_yards_allowed: null }), storedToday(BASS)])
    const report = await run(world, [TEN, BASS], { weeks: [1, 6], apply: true })
    expect(report.ok).toBe(true)
    expect(report.weeks[1].otherDifferences).toEqual([{ player_id: 'TEN', key: 'def_yards_allowed', column: 'def_yards_allowed', stored: null, feed: 399 }])
    expect(world.stored('TEN', 6).def_yards_allowed).toBeNull()
  })
})

describe('the refusals: the door’s own final test, plus the window, plus unstarted weeks', () => {
  const started = { week: 1, first_kickoff_at: PAST, last_game_ends_at: PAST, correction_window_ends_at: '2026-10-01T00:00:00.000Z' }
  const finalState = { total_games: 16, open_games: 0, all_final: true }
  const cleared = (over: Partial<typeof started> = {}) => new Map([[1, { ...started, ...over }]])
  const allFinal = new Map([[1, finalState]])

  it('167:330-332’s third arm, cell by cell', () => {
    const cases: Array<[string, { status: string; deleted_at: string | null }, boolean, string]> = [
      ['correction_window', { status: 'in_season', deleted_at: null }, true, 'in-season, week open'],
      ['live', { status: 'playoffs', deleted_at: null }, true, 'playoffs, week open'],
      ['upcoming', { status: 'in_season', deleted_at: null }, true, 'in-season, week upcoming'],
      ['final', { status: 'in_season', deleted_at: null }, false, 'in-season, week final'],
      ['upcoming', { status: 'setup', deleted_at: null }, false, 'leftover pre-draft league'],
      ['upcoming', { status: 'scheduled', deleted_at: null }, false, 'scheduled league'],
      ['live', { status: 'drafting', deleted_at: null }, false, 'drafting league'],
      ['correction_window', { status: 'complete', deleted_at: null }, false, 'complete league'],
      ['correction_window', { status: 'in_season', deleted_at: '2026-10-01T00:00:00Z' }, false, 'archived league (deleted_at)'],
    ]
    for (const [weekStatus, league, want, name] of cases) expect(leagueHoldsWeek(weekStatus, league), name).toBe(want)
  })

  it('the window closes AT its instant: one millisecond before is refused, as the door reads it', () => {
    const ends = '2026-10-01T00:00:00.000Z'
    expect(fillRefusalCauses([1], cleared({ correction_window_ends_at: ends }), allFinal, [], new Date(ends))).toEqual([])
    expect(fillRefusalCauses([1], cleared({ correction_window_ends_at: ends }), allFinal, [], new Date(Date.parse(ends) - 1))).toEqual([`week 1: its correction window closes ${ends}, after now`])
  })

  it('a week with no recorded window end is not closed', () => {
    expect(fillRefusalCauses([1], new Map([[1, { week: 1, first_kickoff_at: PAST, last_game_ends_at: PAST, correction_window_ends_at: null }]]), allFinal, [], NOW)).toEqual(['week 1: no correction window end is recorded — its window has not closed'])
  })

  it('every cause is named, for every week', () => {
    const causes = fillRefusalCauses(
      [1, 2, 3],
      new Map([
        [1, { week: 1, first_kickoff_at: '2027-01-01T00:00:00.000Z', last_game_ends_at: null, correction_window_ends_at: '2027-02-01T00:00:00.000Z' }],
        [2, { week: 2, first_kickoff_at: null, last_game_ends_at: null, correction_window_ends_at: null }],
      ]),
      new Map([[1, { total_games: 16, open_games: 3, all_final: false }]]),
      [{ league_id: 'L1', week: 1, week_status: 'correction_window', league_status: 'in_season' }],
      NOW,
    )
    expect(causes.join('\n')).toMatch(/week 1: first kickoff .* is after now/)
    expect(causes.join('\n')).toMatch(/week 2: no game has a recorded kickoff/)
    expect(causes.join('\n')).toMatch(/week 3: no nfl_weeks row/)
    expect(causes.join('\n')).toMatch(/week 1: its correction window closes/)
    expect(causes.join('\n')).toMatch(/week 1: not every game still in the week is final \(3 open of 16\)/)
    expect(causes.join('\n')).toMatch(/week 1: league L1 \(in_season\) holds it correction_window/)
  })

  const refused = async (arrange: (world: World) => void, opts: Partial<FillOptions> = {}) => {
    const world = worldWith(ALL_LINES)
    arrange(world)
    const before = snapshot(world)
    const provider = feed(ALL_LINES)
    const report = await fillRuledColumns({ db: world.client(), provider, time: new VirtualClock(NOW) }, { season: SEASON, weeks: [1, 3, 6, 8], apply: true, ...opts })
    expect(report.ok).toBe(false)
    expect(report.weeks).toEqual([])
    expect(provider.weekCalls).toEqual([])
    expectNothingWritten(world, before)
    return report.refused
  }

  it('through a full --apply run: a held week, a window still open, an unfinished game, an unstarted week; nothing read, nothing written', async () => {
    expect(
      await refused((w) => {
        w.leagues = [{ id: 'L1', status: 'in_season', deleted_at: null }]
        w.leagueWeeks = [{ id: 'lw1', league_id: 'L1', season: SEASON, week: 8, status: 'correction_window' }]
      }),
    ).toMatch(/week 8: league L1 \(in_season\) holds it correction_window/)
    expect(await refused((w) => (w.weeks[7].correction_window_ends_at = '2026-11-13T00:00:00.000Z'))).toMatch(/week 8: its correction window closes/)
    expect(await refused((w) => w.gameStates.set(8, { total_games: 14, open_games: 1, all_final: false }))).toMatch(/week 8: not every game still in the week is final \(1 open of 14\)/)
    expect(await refused((w) => (w.weeks[7].first_kickoff_at = '2026-12-01T00:00:00.000Z'))).toMatch(/week 8: first kickoff .* is after now — not started/)
    expect(await refused((w) => w.weeks.splice(7, 1))).toMatch(/week 8: no nfl_weeks row/)
  })

  it('a leftover pre-draft league, a complete league and an archived league do not hold the gate shut', async () => {
    const world = worldWith(ALL_LINES)
    world.leagues = [
      { id: 'pre', status: 'setup', deleted_at: null },
      { id: 'done', status: 'complete', deleted_at: null },
      { id: 'gone', status: 'in_season', deleted_at: '2026-10-01T00:00:00.000Z' },
      { id: 'fin', status: 'in_season', deleted_at: null },
    ]
    world.leagueWeeks = [
      { id: 'a', league_id: 'pre', season: SEASON, week: 8, status: 'upcoming' },
      { id: 'b', league_id: 'done', season: SEASON, week: 8, status: 'correction_window' },
      { id: 'c', league_id: 'gone', season: SEASON, week: 8, status: 'live' },
      { id: 'd', league_id: 'fin', season: SEASON, week: 8, status: 'final' },
    ]
    const report = await run(world, ALL_LINES)
    expect(report.refused).toBeUndefined()
    expect(report.ok).toBe(true)
  })

  it('another season’s open league week does not hold this season', async () => {
    const world = worldWith(ALL_LINES)
    world.leagues = [{ id: 'L', status: 'in_season', deleted_at: null }]
    world.leagueWeeks = [{ id: 'a', league_id: 'L', season: 2025, week: 8, status: 'live' }]
    expect((await run(world, ALL_LINES)).ok).toBe(true)
  })

  it('a failing feed is a refusal, not a partial plan', async () => {
    const world = worldWith(ALL_LINES)
    const before = snapshot(world)
    const provider = { ...feed(ALL_LINES), getWeekStats: async () => Promise.reject(new Error('sleeper 503')) }
    const report = await fillRuledColumns({ db: world.client(), provider, time: new VirtualClock(NOW) }, { season: SEASON, weeks: [1, 3, 6, 8], apply: true })
    expect(report.ok).toBe(false)
    expect(report.refused).toMatch(/the feed failed on week 1: sleeper 503/)
    expectNothingWritten(world, before)
  })

  it('a database failure on a gate read throws by name; nothing is taken for an all-clear', async () => {
    const world = worldWith(ALL_LINES)
    const db = world.client()
    const broken = { ...db, rpc: async () => ({ data: null, error: { message: 'permission denied' } }) } as unknown as SyncClient
    await expect(fillRuledColumns({ db: broken, provider: feed(ALL_LINES), time: new VirtualClock(NOW) }, { season: SEASON, weeks: [8], apply: true })).rejects.toThrow('week_games_state_internal(2026, 8) failed: permission denied')
    const shapeless = { ...db, rpc: async () => ({ data: [], error: null }) } as unknown as SyncClient
    await expect(fillRuledColumns({ db: shapeless, provider: feed(ALL_LINES), time: new VirtualClock(NOW) }, { season: SEASON, weeks: [8], apply: true })).rejects.toThrow(/unexpected shape/)
  })
})

describe('the map check: a checkout without the mapping fails loudly, never "nothing to do"', () => {
  /** What a map without these plays reads: none of them, so stored equals feed. */
  const STALE = [BASS, BOSWELL, TEN, CHI].map((l) => {
    const stats = Object.fromEntries(Object.entries(l.stats).filter(([key]) => !['fg_0_39', 'fg_missed', 'def_block', 'def_return_td'].includes(key)))
    return { ...l, stats }
  })

  it('a stale feed refuses by name, even though the diff would have been empty', async () => {
    const world = worldWith(STALE, STALE.map((l) => storedToday(l)))
    const before = snapshot(world)
    const report = await run(world, STALE, { weeks: [1, 6, 8], apply: true })
    expect(report.ok).toBe(false)
    expect(report.weeks).toEqual([])
    expect(report.refused).toMatch(/this checkout has no field-goal mapping: the feed for weeks 1, 6, 8 read no fg_0_39 on any of its 2 K lines/)
    expect(report.refused).toMatch(/this checkout has no blocked-kick mapping: the feed for weeks 1, 6, 8 read no def_block on any of its 2 D\/ST lines/)
    expectNothingWritten(world, before)
  })

  it('the plan refuses the same way (no --apply)', async () => {
    const world = worldWith(STALE, STALE.map((l) => storedToday(l)))
    const report = await run(world, STALE, { weeks: [1, 6, 8] })
    expect(report.ok).toBe(false)
    expect(report.refused).toMatch(/no field-goal mapping/)
  })

  it('each proof stands alone', async () => {
    const noBlock = [BASS, CHI]
    const reportA = await run(worldWith(noBlock), noBlock, { weeks: [1, 6] })
    expect(reportA.refused).toMatch(/no blocked-kick mapping/)
    expect(reportA.refused).not.toMatch(/no field-goal mapping/)
    const noFg = [TEN, line('7042', 6, { fg_made: 1, fg_attempted: 1, fg_40_49: 1 })]
    const reportB = await run(worldWith(noFg), noFg, { weeks: [6] })
    expect(reportB.refused).toMatch(/no field-goal mapping/)
    expect(reportB.refused).not.toMatch(/no blocked-kick mapping/)
  })

  it('it reads K lines and D/ST lines only: the same value on another position proves nothing', async () => {
    const wrongPositions = [line('wr-1', 1, { fg_0_39: 1, def_block: 1 }), line('7042', 1, { fg_made: 0 }), line('TEN', 1, { def_sack: 1 })]
    const report = await run(worldWith(wrongPositions), wrongPositions, { weeks: [1] })
    expect(report.refused).toMatch(/no field-goal mapping/)
    expect(report.refused).toMatch(/no blocked-kick mapping/)
  })

  it('it reads across the requested weeks: one week with a block is enough', async () => {
    const report = await run(worldWith([BASS, CHI, TEN]), [BASS, TEN, CHI], { weeks: [1, 6] })
    expect(report.refused).toBeUndefined()
    expect(report.ok).toBe(true)
  })

  it('mappingRefusals counts what the plans carry', () => {
    const plan = { week: 3, kLines: 30, kLinesWithShortFg: 0, dstLines: 32, dstLinesWithBlock: 0 } as FillWeekPlan
    expect(mappingRefusals([plan])).toHaveLength(2)
    expect(mappingRefusals([{ ...plan, kLinesWithShortFg: 1, dstLinesWithBlock: 1 }])).toEqual([])
  })
})

describe('unknown players', () => {
  it('a routine unknown is counted, not fatal', async () => {
    const lines = [...ALL_LINES, line('nobody', 1, { rush_yards: 4 }), line('nobody-2', 8, { receptions: 1, def_sack: 0 })]
    const report = await run(worldWith(ALL_LINES), lines, { apply: true })
    expect(report.ok).toBe(true)
    expect(report.weeks.map((w) => w.unknownPlayers)).toEqual([1, 0, 0, 1])
  })

  it('an unknown carrying a non-zero ruled value is a named problem and blocks --apply', async () => {
    const lines = [...ALL_LINES, line('nobody', 1, { rush_yards: 4, return_td: 1 })]
    const world = worldWith(ALL_LINES)
    const before = snapshot(world)
    const report = await run(world, lines, { apply: true })
    expect(report.ok).toBe(false)
    expect(report.weeks[0].problems).toEqual(['week 1: player nobody is not in players, and its line carries return_td=1'])
    expectNothingWritten(world, before)
  })

  it('an unknown carrying a ruled column at zero stays routine', async () => {
    const report = await run(worldWith(ALL_LINES), [...ALL_LINES, line('nobody', 1, { rush_yards: 4, return_td: 0 })])
    expect(report.ok).toBe(true)
    expect(report.weeks[0].unknownPlayers).toBe(1)
  })
})

describe('new rows: every non-ruled stat column must be empty', () => {
  it('today’s three pass: Price wk3, Laube wk8, Mitchell wk8', async () => {
    const report = await run(worldWith(ALL_LINES), ALL_LINES)
    expect(report.ok).toBe(true)
    expect(report.weeks.flatMap((w) => w.newRows.map((r) => r.player_id))).toEqual(['13075', '11574', '8170'])
    expect(report.weeks.flatMap((w) => w.problems)).toEqual([])
  })

  it('a new line carrying a non-ruled stat is a named problem, is not written, and blocks the whole --apply', async () => {
    const late = line('wr-1', 8, { return_td: 1, receiving_yards: 22 })
    const lines = [...ALL_LINES, late]
    const world = worldWith(ALL_LINES)
    const before = snapshot(world)
    const report = await run(world, lines, { apply: true })
    expect(report.ok).toBe(false)
    expect(report.weeks[3].problems).toEqual(['week 8: new line for wr-1 also carries receiving_yards=22 — a late provider line, not written'])
    expect(report.weeks[3].newRows.map((r) => r.player_id)).not.toContain('wr-1')
    expectNothingWritten(world, before)
  })

  it('so is one with no ruled value at all, a delivered yards zero, a scoring advanced key, or a two-point sum', async () => {
    const cases: Array<[ProviderPlayerWeekStats, RegExp]> = [
      [line('wr-1', 8, { receptions: 1 }), /receptions=1/],
      [line('wr-1', 8, { return_td: 1, def_yards_allowed: 0 }), /def_yards_allowed=0/],
      [line('wr-1', 8, { return_td: 1 }, { example_tracking_yards: 3 }), /example_tracking_yards=3/],
      [line('wr-1', 8, { return_td: 1, rec_2pt: 1 }), /two_point_conversions=1/],
    ]
    for (const [late, why] of cases) {
      const world = worldWith(ALL_LINES)
      const report = await run(world, [...ALL_LINES, late])
      expect(report.ok, String(why)).toBe(false)
      expect(report.weeks[3].problems.join(), String(why)).toMatch(why)
    }
  })

  it('a display-only advanced key rides along: it can’t score (Price’s snaps)', async () => {
    const world = worldWith(ALL_LINES)
    await run(world, ALL_LINES, { apply: true })
    expect(world.stored('13075', 3).advanced).toEqual({ off_snaps: 4 })
  })

  it('a new line with every column empty is counted and not inserted', async () => {
    const world = worldWith(ALL_LINES)
    const report = await run(world, [...ALL_LINES, line('wr-1', 8, { receptions: 0 })], { apply: true })
    expect(report.ok).toBe(true)
    expect(report.weeks[3].zeroNewLines).toBe(1)
    expect(world.stats.find((r) => r.player_id === 'wr-1' && r.week === 8)).toBeUndefined()
  })
})

describe('every read pages past PostgREST’s 1000-row cap', () => {
  function bigWorld(): { world: World; lines: ProviderPlayerWeekStats[] } {
    const lines: ProviderPlayerWeekStats[] = [BOSWELL, TEN]
    for (let i = 0; i < 1500; i++) lines.push(line(`wr-${String(i).padStart(4, '0')}`, 8, { receiving_yards: i, return_td: 1 }))
    const world = worldWith(lines, [
      storedToday(BOSWELL),
      storedToday({ ...TEN, week: 8 }),
      ...lines.slice(2).map((l) => storedToday(l)),
    ])
    world.players.push(...lines.slice(2).map((l) => ({ id: l.playerId, position: 'WR' })))
    return { world, lines }
  }

  it('over 1000 stored lines and 1000 players: the plan sees every one, none reads as new or unknown', async () => {
    const { world, lines } = bigWorld()
    const report = await run(world, lines.map((l) => (l === TEN ? { ...TEN, week: 8 } : l)), { weeks: [8] })
    expect(report.ok).toBe(true)
    expect(report.weeks[0].unknownPlayers).toBe(0)
    expect(report.weeks[0].newRows).toEqual([])
    expect(report.weeks[0].updates).toHaveLength(1502)
    expect(report.weeks[0].moves.return_td).toBe(1500)
  })

  it('--apply goes in the door’s batches and the after-check re-reads every line', async () => {
    const { world, lines } = bigWorld()
    const report = await run(world, lines.map((l) => (l === TEN ? { ...TEN, week: 8 } : l)), { weeks: [8], apply: true })
    expect(report.afterProblems).toEqual([])
    expect(report.ok).toBe(true)
    expect(report.linesWritten).toBe(1502)
    expect(world.doorCalls.map((c) => c.p_rows.length)).toEqual([500, 500, 500, 2])
    expect(world.stored('wr-1499', 8).return_td).toBe(1)
  })

  it('a hold past the first 1000 league weeks is still found', async () => {
    const world = worldWith(ALL_LINES)
    world.leagues = [
      { id: 'pre', status: 'setup', deleted_at: null },
      { id: 'live', status: 'in_season', deleted_at: null },
    ]
    world.leagueWeeks = Array.from({ length: 1200 }, (_, i) => ({ id: `lw-${String(i).padStart(4, '0')}`, league_id: 'pre', season: SEASON, week: 8, status: 'upcoming' }))
    world.leagueWeeks.push({ id: 'lw-zzzz', league_id: 'live', season: SEASON, week: 8, status: 'correction_window' })
    const report = await run(world, ALL_LINES)
    expect(report.refused).toMatch(/week 8: league live \(in_season\) holds it correction_window/)
  })
})

describe('the K identities', () => {
  it('both directions, by name', () => {
    expect(kIdentityFailures('k', { fg_0_39: 2, fg_made_40_plus: 1, fg_made_50_plus: 0, fg_made: 3, fg_attempted: 3, fg_missed: 0 })).toEqual([])
    expect(kIdentityFailures('k', { fg_0_39: 1, fg_made_40_plus: 1, fg_made_50_plus: 0, fg_made: 3, fg_attempted: 3, fg_missed: 0 })).toEqual(['K k: fg_0_39 1 + fg_made_40_plus 1 + fg_made_50_plus 0 does not equal fg_made 3'])
    expect(kIdentityFailures('k', { fg_0_39: 3, fg_made_40_plus: 0, fg_made_50_plus: 0, fg_made: 3, fg_attempted: 4, fg_missed: 0 })).toEqual(['K k: fg_attempted 4 - fg_made 3 does not equal fg_missed 0'])
  })

  it('a stored fg_made the feed has since changed fails the plan before anything is written (it would fail after)', async () => {
    const stale = storedToday(BOSWELL, { fg_made: 1 })
    const world = worldWith([BOSWELL, TEN], [stale, storedToday(TEN)])
    const before = snapshot(world)
    const report = await run(world, [BOSWELL, TEN], { weeks: [6, 8], apply: true })
    expect(report.ok).toBe(false)
    expect(report.weeks[1].problems.join()).toContain('K 1945: fg_0_39 2 + fg_made_40_plus 0 + fg_made_50_plus 0 does not equal fg_made 1')
    expect(report.weeks[1].otherDifferences).toEqual([{ player_id: '1945', key: 'fg_made', column: 'fg_made', stored: 1, feed: 2 }])
    expectNothingWritten(world, before)
  })

  it('a stored K line the feed no longer carries is checked too', async () => {
    const ghost = line('kicker-gone', 8, { fg_made: 2, fg_attempted: 2 })
    const world = worldWith([BOSWELL, TEN], [storedToday(BOSWELL), storedToday(TEN), storedToday(ghost)])
    world.players.push({ id: 'kicker-gone', position: 'K' })
    const report = await run(world, [BOSWELL, TEN], { weeks: [6, 8] })
    expect(report.ok).toBe(false)
    expect(report.weeks[1].storedOnly).toBe(1)
    expect(report.weeks[1].problems.join()).toContain('K kicker-gone: fg_0_39 0')
  })
})

describe('after writing, every assertion is loud', () => {
  const failing = async (sabotage: (world: World) => void, why: RegExp) => {
    const world = worldWith(ALL_LINES)
    world.afterDoor = sabotage
    const report = await run(world, ALL_LINES, { apply: true })
    expect(report.wrote).toBe(true)
    expect(report.ok).toBe(false)
    expect(report.afterProblems.join('\n')).toMatch(why)
    return report
  }

  it('a door that lost a ruled value', async () => {
    await failing((w) => (w.stored('7042', 1).fg_0_39 = 0), /week 1: 7042 fg_0_39 reads 0 after the fill, the plan wrote 2/)
  })
  it('a K identity that no longer holds', async () => {
    await failing((w) => (w.stored('7042', 1).fg_made = 9), /week 1: K 7042: fg_0_39 2 \+ fg_made_40_plus 1 \+ fg_made_50_plus 0 does not equal fg_made 9/)
  })
  it('a row count off the plan', async () => {
    await failing((w) => {
      if (!w.stats.some((r) => r.player_id === 'extra')) w.stats.push(storedToday(line('extra', 8, { receptions: 1 })))
    }, /week 8: 4 stored lines after the fill, the plan says 3/)
  })
  it('a lost line', async () => {
    await failing((w) => {
      w.stats = w.stats.filter((r) => r.player_id !== 'wr-1')
    }, /week 1: wr-1 lost its stored line during the fill/)
  })
  it('a column outside the ruled set that moved', async () => {
    await failing((w) => (w.stored('wr-1', 1).receiving_yards = 62), /week 1: wr-1 moved outside the ruled columns/)
  })
  it('metadata that moved', async () => {
    await failing((w) => (w.stored('TEN', 6).source = 'other'), /week 6: TEN moved outside the ruled columns/)
  })
  it('a ruled column the plan never named', async () => {
    await failing((w) => (w.stored('wr-1', 1).return_td = 6), /week 1: wr-1 moved on a ruled column but is not in the plan/)
  })

  it('afterWriteProblems: a clean run says nothing', () => {
    const stored = new Map<string, StatRow>([['7042', toStatRow(line('7042', 1, { fg_made: 1, fg_attempted: 1 }), CTX).row!]])
    const plan = { week: 1, updates: [], newRows: [] } as unknown as FillWeekPlan
    expect(afterWriteProblems(plan, stored, stored, new Map([['7042', 'K']]))).toEqual(['week 1: K 7042: fg_0_39 0 + fg_made_40_plus 0 + fg_made_50_plus 0 does not equal fg_made 1'])
    const fine = new Map<string, StatRow>([['7042', toStatRow(line('7042', 1, { fg_made: 1, fg_attempted: 1, fg_0_39: 1 }), CTX).row!]])
    expect(afterWriteProblems(plan, fine, fine, new Map([['7042', 'K']]))).toEqual([])
  })

  it('a door failing partway stops the run and says what landed', async () => {
    const world = worldWith(ALL_LINES)
    world.doorError = { callNumber: 3, message: 'door says no' }
    const report = await run(world, ALL_LINES, { apply: true })
    expect(report.ok).toBe(false)
    expect(report.writeFailure).toMatch(/door says no/)
    expect(report.writeFailure).toMatch(/2 lines were written before it; re-running is safe/)
    expect(world.doorCalls).toHaveLength(3)
    expect(world.stored('TEN', 6).def_block).toBe(0)
    // The re-run picks up exactly what didn't land.
    world.doorError = null
    const second = await run(world, ALL_LINES, { apply: true })
    expect(second.ok).toBe(true)
    expect(second.linesWritten).toBe(6)
  })

  it('a door that enqueues or records anyway fails by name, on the count it reports', async () => {
    const world = worldWith(ALL_LINES)
    world.doorReport = { enqueued: 1 }
    const report = await run(world, ALL_LINES, { apply: true })
    expect(report.ok).toBe(false)
    expect(report.writeFailure).toMatch(/enqueued 1 of 0 deltas/)
  })
})

describe('other plan edges', () => {
  it('a stored line that can’t take its own metadata back blocks --apply, only if it is being written', async () => {
    const world = worldWith([BOSWELL, TEN], [storedToday(BOSWELL, { source: null }), storedToday(TEN)])
    const before = snapshot(world)
    const report = await run(world, [BOSWELL, TEN], { weeks: [6, 8], apply: true })
    expect(report.ok).toBe(false)
    expect(report.weeks[1].problems).toEqual(["week 8: 1945 can't be rewritten — its stored source is NULL"])
    expectNothingWritten(world, before)

    const unmoved = worldWith([WR, BASS, TEN], [storedToday(WR, { source: null }), storedToday(BASS), storedToday(TEN)])
    expect((await run(unmoved, [WR, BASS, TEN], { weeks: [1, 6] })).ok).toBe(true)
  })

  it('metadataWontRoundTrip names each shape', () => {
    const raw = (over: Partial<DbStatRow>) => ({ player_id: 'p', game_id: null, is_live: false, source: 's', advanced: {}, ...over }) as DbStatRow
    expect(metadataWontRoundTrip(raw({}))).toBeNull()
    expect(metadataWontRoundTrip(raw({ advanced: { off_snaps: 3 } }))).toBeNull()
    expect(metadataWontRoundTrip(raw({ source: null }))).toMatch(/source is NULL/)
    expect(metadataWontRoundTrip(raw({ is_live: null }))).toMatch(/is_live is NULL/)
    expect(metadataWontRoundTrip(raw({ advanced: { note: 'x' } }))).toMatch(/non-numbers: note/)
  })

  it('a repeated line collapses; two different lines for one player block the week (F831)', async () => {
    const repeated = await run(worldWith(ALL_LINES), [...ALL_LINES, BASS])
    expect(repeated.ok).toBe(true)
    expect(repeated.weeks[0].duplicates).toBe(1)
    const conflict = await run(worldWith(ALL_LINES), [...ALL_LINES, { ...BASS, stats: { ...BASS.stats, fg_0_39: 1 } }])
    expect(conflict.ok).toBe(false)
    expect(conflict.weeks[0].problems.join()).toMatch(/two different lines for 7042/)
  })

  it('a requested week whose feed comes back empty is a problem, not zero work', async () => {
    const report = await run(worldWith(ALL_LINES), ALL_LINES, { weeks: [1, 2, 6] })
    expect(report.ok).toBe(false)
    expect(report.weeks[1].problems).toEqual(['week 2: the feed returned zero lines'])
  })

  it('planFillWeek counts stored lines the feed doesn’t carry and leaves them alone', () => {
    const stored = new Map<string, StatRow>([['wr-1', toStatRow(WR, CTX).row!]])
    const plan = planFillWeek({ week: 1, lines: [], stored, positions: new Map([['wr-1', 'WR']]), ctx: CTX })
    expect(plan.storedOnly).toBe(1)
    expect(plan.updates).toEqual([])
  })

  it('a new line keeps its own team only when the pair is a game of the week (F589)', async () => {
    const world = worldWith(ALL_LINES)
    await run(world, ALL_LINES, { apply: true })
    expect(world.stored('13075', 3).team).toBe('MIN') // MIN at TB is in nfl_games
    expect(world.stored('8170', 8).team).toBeNull() // DAL at ARI isn't, in this fixture
  })
})

describe('the printed output', () => {
  it('names the weeks, the keys, each new line, each other-column difference, each problem', async () => {
    const receiver = line('wr-1', 1, { targets: 8, receptions: 5, receiving_yards: 61 }, { off_snaps: 41 })
    const lines = [BASS, receiver, MIN, PRICE, TEN, CHI, BOSWELL, LAUBE, MITCHELL, line('nobody', 8, { return_td: 1 })]
    const report = await run(worldWith(ALL_LINES), lines)
    expect(renderFill(report)).toEqual([
      '  week 1: 1 lines to write (1 updated, 0 new), 1 moves: fg_0_39=1 | feed lines=2 unchanged=1 unknownPlayers=0 empty=0 repeats=0 zeroNewLines=0 storedOnly=0',
      '      other (not written) wr-1 targets: stored 7 → feed 8',
      '      display-only (not written) off_snaps: 1 lines differ',
      '  week 3: 2 lines to write (1 updated, 1 new), 2 moves: def_return_td=1 return_td=1 | feed lines=2 unchanged=0 unknownPlayers=0 empty=0 repeats=0 zeroNewLines=0 storedOnly=0',
      '      new line 13075: return_td=1',
      '  week 6: 2 lines to write (2 updated, 0 new), 3 moves: def_block=1 def_return_td=1 def_fumble_recoveries=1 | feed lines=2 unchanged=0 unknownPlayers=0 empty=0 repeats=0 zeroNewLines=0 storedOnly=0',
      '  week 8: 3 lines to write (1 updated, 2 new), 4 moves: fg_0_39=1 fg_missed=1 return_td=1 fumble_recovery_td=1 | feed lines=4 unchanged=0 unknownPlayers=1 empty=0 repeats=0 zeroNewLines=0 storedOnly=0',
      '      new line 11574: return_td=1',
      '      new line 8170: fumble_recovery_td=1',
      '      PROBLEM: week 8: player nobody is not in players, and its line carries return_td=1',
      '  all weeks: 8 lines (5 updated, 3 new), 10 moves: fg_0_39=2 fg_missed=1 def_block=1 def_return_td=2 def_fumble_recoveries=1 return_td=2 fumble_recovery_td=1; 1 other-column differences',
    ])
  })

  it('a refusal prints the refusal', async () => {
    const world = worldWith(ALL_LINES)
    world.weeks[7].correction_window_ends_at = '2027-01-01T00:00:00.000Z'
    const lines = renderFill(await run(world, ALL_LINES))
    expect(lines).toHaveLength(1)
    expect(lines[0]).toMatch(/^REFUSED \[2026\]: refused — week 8: its correction window closes/)
  })
})

describe('the CLI', () => {
  const HOST = 'abc.supabase.co'
  const URL_ = `https://${HOST}`

  async function cli(argv: string[], world = worldWith(ALL_LINES), lines: readonly ProviderPlayerWeekStats[] = ALL_LINES, supabaseUrl: string | undefined = URL_) {
    const out: string[] = []
    const err: string[] = []
    let connected = 0
    const code = await runFillCli(argv, {
      supabaseUrl,
      connect: () => {
        connected += 1
        return { db: world.client(), provider: feed(lines), time: new VirtualClock(NOW) }
      },
      log: (line) => out.push(line),
      error: (line) => err.push(line),
    })
    return { code, out, err, connected, world }
  }
  const SPEC = ['--season', '2026', '--weeks', '1,3,6,8']

  it('refuses any flag it doesn’t know: exit 2, named, nothing connected', async () => {
    for (const bad of ['--only-ruled-columns', '--bogus', '--dry-run', '--season=2026', '--Apply', '-a', 'stray']) {
      const { code, err, connected } = await cli([...SPEC, bad])
      expect(code, bad).toBe(2)
      expect(err.join(), bad).toContain(`unknown argument ${bad}`)
      expect(connected, bad).toBe(0)
    }
  })

  it('bad values and missing flags: exit 2, nothing connected', async () => {
    const cases: Array<[string[], RegExp]> = [
      [[], /usage: npm run sync:fill-ruled/],
      [['--season', '2026'], /usage/],
      [['--weeks', '1-8'], /usage/],
      [['--season', '20x6', '--weeks', '1-8'], /Invalid --season: 20x6/],
      [['--season', '1999', '--weeks', '1-8'], /Invalid --season: 1999/],
      [['--season', '2026', '--weeks', '0-8'], /Invalid --weeks/],
      [['--season', '--weeks', '1-8'], /--season needs a value/],
      [['--season', '2026', '--weeks', '1-8', '--confirm-target'], /--confirm-target needs a value/],
      [['--season', '2026', '--season', '2025', '--weeks', '1-8'], /--season was given twice/],
    ]
    for (const [argv, why] of cases) {
      const { code, err, connected } = await cli(argv)
      expect(code, argv.join(' ')).toBe(2)
      expect(err.join(), argv.join(' ')).toMatch(why)
      expect(connected, argv.join(' ')).toBe(0)
    }
  })

  it('plans by default, with no --confirm-target needed: the first line is the target, exit 0, nothing written', async () => {
    const world = worldWith(ALL_LINES)
    const before = snapshot(world)
    const { code, out, err } = await cli(SPEC, world)
    expect(code).toBe(0)
    expect(err).toEqual([])
    expect(out[0]).toBe(`target: ${HOST}`)
    expect(out[1]).toBe(`Plan [2026] weeks 1,3,6,8 → ${HOST}`)
    expect(out.at(-1)).toBe(`Plan only — nothing written. To write it: npm run sync:fill-ruled -- --season 2026 --weeks 1,3,6,8 --apply --confirm-target ${HOST}`)
    expectNothingWritten(world, before)
  })

  it('--apply needs --confirm-target naming the host: exit 2, printed, nothing connected', async () => {
    const missing = await cli([...SPEC, '--apply'])
    expect(missing.code).toBe(2)
    expect(missing.err.join()).toContain(`target is ${HOST} — re-run with --confirm-target ${HOST}`)
    expect(missing.connected).toBe(0)
    const wrong = await cli([...SPEC, '--apply', '--confirm-target', '127.0.0.1:54321'])
    expect(wrong.code).toBe(2)
    expect(wrong.err.join()).toContain(`does not match the target ${HOST}`)
    expect(wrong.connected).toBe(0)
  })

  it('a --confirm-target that names the wrong host refuses even for a plan', async () => {
    const { code, connected } = await cli([...SPEC, '--confirm-target', 'other.example'])
    expect(code).toBe(2)
    expect(connected).toBe(0)
  })

  it('no target URL: exit 2 by name', async () => {
    const { code, err, connected } = await cli(SPEC, worldWith(ALL_LINES), ALL_LINES, '')
    expect(code).toBe(2)
    expect(err.join()).toContain('NEXT_PUBLIC_SUPABASE_URL is not a URL')
    expect(connected).toBe(0)
  })

  it('--apply with the host writes, exit 0', async () => {
    const world = worldWith(ALL_LINES)
    const { code, out } = await cli([...SPEC, '--apply', '--confirm-target', HOST], world)
    expect(code).toBe(0)
    expect(world.doorCalls.length).toBeGreaterThan(0)
    expect(out).toContain('  written: 8 lines; queue rows 0; events 0')
    expect(out.at(-1)).toBe('Done — ruled columns only; no queue row, no event; K identities and row counts hold.')
  })

  it('a refused run exits 1', async () => {
    const world = worldWith(ALL_LINES)
    world.weeks[7].correction_window_ends_at = '2027-01-01T00:00:00.000Z'
    const before = snapshot(world)
    const { code, err } = await cli([...SPEC, '--apply', '--confirm-target', HOST], world)
    expect(code).toBe(1)
    expect(err.join()).toMatch(/REFUSED/)
    expectNothingWritten(world, before)
  })

  it('a stale checkout exits 1, never "nothing to do"', async () => {
    const stale = [BASS, TEN].map((l) => ({ ...l, stats: Object.fromEntries(Object.entries(l.stats).filter(([k]) => !['fg_0_39', 'def_block', 'def_return_td'].includes(k))) }))
    const { code, out } = await cli(['--season', '2026', '--weeks', '1,6'], worldWith(stale, stale.map((l) => storedToday(l))), stale)
    expect(code).toBe(1)
    expect(out.join('\n')).toContain('this checkout has no field-goal mapping')
    expect(out.join('\n')).not.toContain('Plan only')
  })

  it('a problem exits 1 with or without --apply, and --apply writes nothing', async () => {
    const lines = [...ALL_LINES, line('nobody', 1, { return_td: 1 })]
    const planned = await cli(SPEC, worldWith(ALL_LINES), lines)
    expect(planned.code).toBe(1)
    expect(planned.err.join()).toContain('--apply would write nothing')
    const world = worldWith(ALL_LINES)
    const before = snapshot(world)
    const applied = await cli([...SPEC, '--apply', '--confirm-target', HOST], world, lines)
    expect(applied.code).toBe(1)
    expect(applied.err.join()).toContain('nothing written')
    expectNothingWritten(world, before)
  })

  it('a failed assertion after writing exits 1 and says what is wrong', async () => {
    const world = worldWith(ALL_LINES)
    world.afterDoor = (w) => (w.stored('7042', 1).fg_0_39 = 0)
    const { code, out, err } = await cli([...SPEC, '--apply', '--confirm-target', HOST], world)
    expect(code).toBe(1)
    expect(err.join()).toContain('FAILED')
    expect(out.join('\n')).toContain('FAILED AFTER WRITING: week 1: 7042 fg_0_39 reads 0 after the fill, the plan wrote 2')
  })

  it('a failing door exits 1', async () => {
    const world = worldWith(ALL_LINES)
    world.doorError = { callNumber: 1, message: 'door says no' }
    const { code, out } = await cli([...SPEC, '--apply', '--confirm-target', HOST], world)
    expect(code).toBe(1)
    expect(out.join('\n')).toContain('WRITE FAILED')
  })

  it('parseFillArgs reads the happy path', () => {
    expect(parseFillArgs(['--weeks', '1-3', '--season', '2026'])).toEqual({ season: 2026, weeks: [1, 2, 3], apply: false, confirmTarget: undefined })
    expect(parseFillArgs(['--season', '2026', '--weeks', '8', '--apply', '--confirm-target', 'h'])).toEqual({ season: 2026, weeks: [8], apply: true, confirmTarget: 'h' })
  })
})

describe('the script name', () => {
  const repo = resolve(__dirname, '../../..')
  const pkg = JSON.parse(readFileSync(resolve(repo, 'package.json'), 'utf8')) as { scripts: Record<string, string> }

  it('is a new one, so a stale checkout answers "Missing script" instead of running a whole-line write', () => {
    expect(pkg.scripts['sync:fill-ruled']).toBe('npx tsx scripts/fill-ruled-columns.ts')
    expect(pkg.scripts['sync:reingest']).toBe('npx tsx scripts/reingest-weeks.ts')
  })

  it('the wrapper only binds: it hands the CLI its arguments and exits with its code', () => {
    const script = readFileSync(resolve(repo, 'scripts/fill-ruled-columns.ts'), 'utf8')
    expect(script).toContain('runFillCli(process.argv.slice(2), {')
    expect(script).toContain('.then((code) => process.exit(code))')
    expect(script).not.toMatch(/ingest_write_batch|\.rpc\(|\.from\(/)
  })
})

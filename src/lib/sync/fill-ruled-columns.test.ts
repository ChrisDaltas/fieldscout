/**
 * fill-ruled-columns.test.ts — the quiet fill (PROGRESS F890, D832), over a fake
 * PostgREST and a fake of migration 167's door. No database, no network, no env.
 *
 * THE FAKE'S TEETH, so a green here means something:
 *   - every response is capped at 1000 rows, as PostgREST's is; a read that
 *     doesn't page plans wrong and the pagination tests go red;
 *   - a read returns only the columns it selected;
 *   - the door refuses what 167 refuses (element shape, mixed key sets, an unknown
 *     column, corrections without enqueue, a batch across two (season, week)s,
 *     an `advanced` that isn't a JSON object), sets exactly the columns it is
 *     sent, and records queue rows and events when asked, so "none" is measured;
 *   - the game-state read answers by (season, week), so a read of the wrong
 *     season can't borrow this season's answer;
 *   - every table write outside the door is recorded.
 *
 * Fixture lines are real 2026 Sleeper lines in canonical keys, as the adapter
 * hands them once F870's map is in. The provider here hands them directly, so
 * these tests don't depend on that map. The real door runs in
 * `fill-ruled-columns-db.test.ts`.
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it, vi } from 'vitest'

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
  SUMMED_RULED_COLUMNS,
  who,
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
  stateCalls: Array<[number, number]> = []
  tableWrites: string[] = []
  teamColumn = true
  /**
   * `${season}:${week}` → the door's game state. Unset: all final for SEASON;
   * for any other season what 184's function answers for a week with no
   * games (0 of 0, never all final).
   */
  gameStates = new Map<string, { total_games: number; open_games: number; all_final: boolean }>()
  doorError: { callNumber: number; message: string } | null = null
  /** The door is called and never answers: a run that dies writing. */
  doorHangs = false
  /** Runs after each door call: a door that misbehaves. */
  afterDoor: ((world: World) => void) | null = null
  /** Laid over the door's report: a door that misreports. */
  doorReport: Row = {}
  /** Once the door has been called, every player_stats read answers this error: the re-read after a write fails. */
  statReadErrorAfterDoor: string | null = null
  /** Once the door has been called, every player_stats read rejects (a dropped connection, not an error answer). */
  statReadThrowAfterDoor: string | null = null

  client(): SyncClient {
    return {
      from: (table: string) => this.query(table),
      rpc: async (fn: string, args: Row) => {
        if (fn === 'week_games_state_internal') {
          const season = Number(args.p_season)
          const week = Number(args.p_week)
          this.stateCalls.push([season, week])
          const none = season === SEASON ? { total_games: 2, open_games: 0, all_final: true } : { total_games: 0, open_games: 0, all_final: false }
          return { data: [this.gameStates.get(`${season}:${week}`) ?? none], error: null }
        }
        if (fn === INGEST_DOOR && this.doorHangs) {
          this.doorCalls.push({ p_rows: args.p_rows as DoorElement[], p_now: String(args.p_now) })
          return new Promise(() => {})
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
          if (name === 'player_stats' && this.statReadErrorAfterDoor !== null && this.doorCalls.length > 0) {
            return { data: null, error: { message: this.statReadErrorAfterDoor }, count: null }
          }
          if (name === 'player_stats' && this.statReadThrowAfterDoor !== null && this.doorCalls.length > 0) {
            throw new Error(this.statReadThrowAfterDoor)
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
    const [season, week] = [String(p_rows[0].stat.season), String(p_rows[0].stat.week)]
    for (const [at, element] of p_rows.entries()) {
      const i = at + 1
      if (typeof element.enqueue !== 'boolean' || !Array.isArray(element.corrections)) throw new Error('door: element shape')
      if (Object.keys(element.stat).sort().join() !== first.join()) throw new Error('door: a different key set from element 1')
      // 167:270-279, worded as 167 raises them.
      if (String(element.stat.season) !== season || String(element.stat.week) !== week) {
        throw new Error(`ingest_write_batch: element ${i} is not season ${season} week ${week} — a batch is one (season, week)`)
      }
      const advanced = element.stat.advanced
      if (typeof advanced !== 'object' || advanced === null || Array.isArray(advanced)) throw new Error(`ingest_write_batch: element ${i} advanced must be a JSON object`)
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
/** Arizona and the Chargers, week 1 (real): Arizona's blocked kick, and a D/ST line with nothing to fill. */
const ARI = line('ARI', 1, { def_sack: 3, def_int: 1, def_fumble_rec: 1, def_points_allowed: 14, def_yards_allowed: 268, def_block: 1 }, {}, 'ARI', 'LAC')
const LAC = line('LAC', 1, { def_sack: 1, def_points_allowed: 26, def_yards_allowed: 393 }, {}, 'LAC', 'ARI')
/** Chicago and the Jets, week 1 (real): each recovered a fumble on special teams. Chicago's sits on one main stored; the Jets' is their only one, so main stored 0. */
const CHI1 = line('CHI', 1, { def_sack: 2, def_int: 1, def_fumble_rec: 2, def_points_allowed: 37, def_yards_allowed: 478, def_block: 1 }, {}, 'CHI', 'CAR')
const NYJ1 = line('NYJ', 1, { def_sack: 3, def_fumble_rec: 1, def_points_allowed: 10, def_yards_allowed: 195 }, {}, 'NYJ', 'TEN')
/** Plain offense lines, so weeks 6 and 8 hold every position a partial read can drop. */
const WR6 = line('wr-6', 6, { targets: 4, receptions: 3, receiving_yards: 41 }, { off_snaps: 35 }, 'TEN', 'IND')
const QB8 = line('qb-8', 8, { pass_attempts: 31, pass_completions: 20, pass_yards: 228, pass_tds: 1 }, { off_snaps: 60 })
const RB8 = line('rb-8', 8, { rush_yards: 48, receptions: 2, receiving_yards: 11 }, { off_snaps: 30 })
const WR8 = line('wr-8', 8, { targets: 6, receptions: 4, receiving_yards: 52 }, { off_snaps: 44 })
const TE8 = line('te-8', 8, { targets: 3, receptions: 2, receiving_yards: 19 }, { off_snaps: 38 })

const POSITIONS: Record<string, string> = {
  '7042': 'K',
  '1945': 'K',
  TEN: 'DEF',
  CHI: 'DEF',
  MIN: 'DEF',
  ARI: 'DEF',
  LAC: 'DEF',
  NYJ: 'DEF',
  '13075': 'WR',
  '11574': 'RB',
  '8170': 'TE',
  'wr-1': 'WR',
  'wr-6': 'WR',
  'qb-8': 'QB',
  'rb-8': 'RB',
  'wr-8': 'WR',
  'te-8': 'TE',
}

const CTX: ToStatRowContext = { providerName: 'sleeper+nflverse', gameStatus: new Map(), anyGameOpen: false }

/** Where the feed's `def_fumble_rec` adds a special-teams recovery, what main stored: `fum_rec` alone (real, 2026). */
const STORED_FUM_REC: Readonly<Record<string, number>> = { 'CHI-1': 1, 'NYJ-1': 0, 'CHI-6': 1 }

/** A stored line the way main stores it today: the same feed line, with the ruled columns empty. */
function storedToday(feed: ProviderPlayerWeekStats, over: Row = {}): Row {
  const ruledKeys = new Set(['fg_0_39', 'fg_missed', 'def_block', 'def_return_td', 'return_td', 'fumble_recovery_td'])
  const stats = Object.fromEntries(Object.entries(feed.stats).filter(([key]) => !ruledKeys.has(key)))
  const fumRec = STORED_FUM_REC[`${feed.playerId}-${feed.week}`]
  if (fumRec !== undefined) stats.def_fumble_rec = fumRec
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

const HOST = 'abc.supabase.co'
const URL_ = `https://${HOST}`
const SPEC = ['--season', '2026', '--weeks', '1,3,6,8']

/** The real CLI over the fake world and feed. */
async function cli(argv: string[], world = worldWith(ALL_LINES), lines: readonly ProviderPlayerWeekStats[] = ALL_LINES, supabaseUrl: string | undefined = URL_) {
  const out: string[] = []
  /** How many door calls had been made when each `out` line printed. */
  const doorCallsAt: number[] = []
  const err: string[] = []
  let connected = 0
  const code = await runFillCli(argv, {
    supabaseUrl,
    connect: () => {
      connected += 1
      return { db: world.client(), provider: feed(lines), time: new VirtualClock(NOW) }
    },
    log: (line) => {
      out.push(line)
      doorCallsAt.push(world.doorCalls.length)
    },
    error: (line) => err.push(line),
  })
  return { code, out, doorCallsAt, err, connected, world }
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
    expect(await refused((w) => w.gameStates.set(`${SEASON}:8`, { total_games: 14, open_games: 1, all_final: false }))).toMatch(/week 8: not every game still in the week is final \(1 open of 14\)/)
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
    // Each arm names only the weeks that read its kind of line (review round 1, finding 4).
    expect(report.refused).toMatch(/this checkout has no field-goal mapping: the feed for weeks 1, 8 read no fg_0_39 on any of its 2 K lines/)
    expect(report.refused).toMatch(/this checkout has no blocked-kick mapping: the feed for weeks 6 read no def_block on any of its 2 D\/ST lines/)
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
    const plan = { week: 3, kLines: 30, kLinesWithShortFg: 0, dstLines: 32, dstLinesWithBlock: 0, problems: [] as string[] } as FillWeekPlan
    expect(mappingRefusals([plan])).toHaveLength(2)
    expect(mappingRefusals([{ ...plan, kLinesWithShortFg: 1, dstLinesWithBlock: 1 }])).toEqual([])
  })

  it('mappingRefusals reads only the weeks that planned lines of each kind', () => {
    const read = { week: 3, kLines: 30, kLinesWithShortFg: 2, dstLines: 32, dstLinesWithBlock: 1, problems: [] as string[] } as FillWeekPlan
    const unread = { week: 4, kLines: 0, kLinesWithShortFg: 0, dstLines: 0, dstLinesWithBlock: 0, problems: ['week 4: the feed returned zero lines'] } as FillWeekPlan
    expect(mappingRefusals([read, unread])).toEqual([])
    // No week read a line of either kind, and a plan names why: that problem is the reason, not the checkout.
    expect(mappingRefusals([unread])).toEqual([])
    // No week read one, and nothing else is wrong: the map can't be proved, which still refuses.
    expect(mappingRefusals([{ ...unread, problems: [] }])).toEqual([
      "this checkout's field-goal mapping can't be proved: the feed for weeks 4 planned no K line to read fg_0_39 on",
      "this checkout's blocked-kick mapping can't be proved: the feed for weeks 4 planned no D/ST line to read def_block on",
    ])
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

/** Week 8 with 1502 stored lines and 1500 more players: past every 1000-row cap, and four door batches (500, 500, 500, 2). */
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

describe('every read pages past PostgREST’s 1000-row cap', () => {
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
    expect(report.writeFailure).toMatch(/at least 2 lines were written before it; re-running is safe/)
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

// ── Review round 1 (2026-11-05) ──────────────────────────────────────────

/** Every position a week stores, on weeks 1, 6 and 8: a read that drops one is visible. */
const FULL = [...ALL_LINES, ARI, LAC, WR6, QB8, RB8, WR8, TE8]
const without = (drop: (l: ProviderPlayerWeekStats) => boolean) => FULL.filter((l) => !drop(l))
const weekOf = (report: FillReport, week: number) => {
  const plan = report.weeks.find((w) => w.week === week)
  if (plan === undefined) throw new Error(`no plan for week ${week}`)
  return plan
}
const missing = (week: number, position: string, stored: number) => `week ${week}: the feed carried no ${position} lines, against ${stored} stored — a partial read, not a week with nothing to fill`
const lowered = (week: number, id: string, column: string, from: number, to: number) =>
  `week ${week}: ${id} ${column} would go down from ${from} to ${to} — lowering a stored value is not a fill (a late provider fix, or a map that reads less)`
const omit = (stats: ProviderPlayerWeekStats['stats'], key: string) => Object.fromEntries(Object.entries(stats).filter(([k]) => k !== key))

describe('a partial feed read is a problem, never a quiet success (round 1, findings 1 and 3)', () => {
  it('the complete feed names no partial read and nothing stored-only', async () => {
    const report = await run(worldWith(FULL), FULL)
    expect(report.ok).toBe(true)
    expect(report.weeks.flatMap((w) => w.problems)).toEqual([])
    expect(report.weeks.map((w) => w.storedOnly)).toEqual([0, 0, 0, 0])
  })

  it('Sleeper answers [] for DEF in week 6 only: named, --apply blocked, Tennessee left unfilled', async () => {
    const world = worldWith(FULL)
    const before = snapshot(world)
    const report = await run(world, without((l) => l.week === 6 && POSITIONS[l.playerId] === 'DEF'), { apply: true })
    expect(report.refused).toBeUndefined()
    expect(report.ok).toBe(false)
    expect(weekOf(report, 6).problems).toEqual([missing(6, 'DEF', 2)])
    expect(weekOf(report, 6).storedOnlyByPosition).toEqual({ DEF: 2 })
    expectNothingWritten(world, before)
    expect(world.stored('TEN', 6)).toMatchObject({ def_block: 0, def_return_td: 0 })
  })

  it('RB, WR and TE answer [] in week 8: each named; Laube and Mitchell are not inserted', async () => {
    const world = worldWith(FULL)
    const before = snapshot(world)
    const report = await run(world, without((l) => l.week === 8 && ['RB', 'WR', 'TE'].includes(POSITIONS[l.playerId])), { apply: true })
    expect(report.ok).toBe(false)
    expect(weekOf(report, 8).problems).toEqual([missing(8, 'RB', 1), missing(8, 'WR', 1), missing(8, 'TE', 1)])
    expect(weekOf(report, 8).newRows).toEqual([])
    expectNothingWritten(world, before)
  })

  it('each of the six positions, dropped alone from a week that stores it, is named and blocks', async () => {
    const cases: Array<[string, number, number]> = [
      ['QB', 8, 1],
      ['RB', 8, 1],
      ['WR', 8, 1],
      ['TE', 8, 1],
      ['K', 8, 1],
      ['DEF', 1, 2],
    ]
    for (const [position, week, stored] of cases) {
      const world = worldWith(FULL)
      const before = snapshot(world)
      const report = await run(world, without((l) => l.week === week && POSITIONS[l.playerId] === position), { apply: true })
      expect(report.ok, position).toBe(false)
      expect(weekOf(report, week).problems, position).toContain(missing(week, position, stored))
      expectNothingWritten(world, before)
    }
  })

  it('Arizona alone missing from week 1: named; a re-run once the feed carries it fills the block', async () => {
    const world = worldWith(FULL)
    const before = snapshot(world)
    const report = await run(world, without((l) => l === ARI), { apply: true })
    expect(report.ok).toBe(false)
    expect(weekOf(report, 1).problems).toEqual(["week 1: the feed doesn't carry D/ST ARI, which has a stored line — a partial read"])
    expect(weekOf(report, 1).storedOnlyByPosition).toEqual({ DEF: 1 })
    expectNothingWritten(world, before)
    expect(world.stored('ARI', 1).def_block).toBe(0)
    const again = await run(world, FULL, { apply: true })
    expect(again.ok).toBe(true)
    expect(world.stored('ARI', 1).def_block).toBe(1)
  })

  it('one offense line missing, while the feed still carries its position, is counted by position and printed, not blocked', async () => {
    // A second week-8 receiver, so dropping one leaves the position read.
    const other = line('wr-8b', 8, { targets: 2, receptions: 1, receiving_yards: 9 })
    const world = worldWith([...FULL, other])
    world.players.push({ id: 'wr-8b', position: 'WR' })
    const report = await run(world, [...FULL, other].filter((l) => l !== WR8))
    expect(report.weeks.flatMap((w) => w.problems)).toEqual([])
    expect(report.ok).toBe(true)
    expect(weekOf(report, 8).storedOnly).toBe(1)
    expect(weekOf(report, 8).storedOnlyByPosition).toEqual({ WR: 1 })
    expect(renderFill(report).find((l) => l.startsWith('  week 8:'))).toMatch(/ storedOnly=1 \(WR 1\)$/)
  })

  it('through the CLI, each of the three exits 1 under --apply, prints its problem, and never says Done', async () => {
    const cases: Array<[ProviderPlayerWeekStats[], string]> = [
      [without((l) => l.week === 6 && POSITIONS[l.playerId] === 'DEF'), `      PROBLEM: ${missing(6, 'DEF', 2)}`],
      [without((l) => l.week === 8 && ['RB', 'WR', 'TE'].includes(POSITIONS[l.playerId])), `      PROBLEM: ${missing(8, 'RB', 1)}`],
      [without((l) => l === ARI), "      PROBLEM: week 1: the feed doesn't carry D/ST ARI, which has a stored line — a partial read"],
    ]
    for (const [lines, printed] of cases) {
      const world = worldWith(FULL)
      const { code, out, err } = await cli([...SPEC, '--apply', '--confirm-target', HOST], world, lines)
      expect(code, printed).toBe(1)
      expect(out, printed).toContain(printed)
      expect(out.join('\n'), printed).not.toContain('Done')
      expect(err, printed).toEqual(['REFUSED — problems above; nothing written'])
      expect(world.doorCalls, printed).toEqual([])
    }
  })
})

describe('a fill only raises: a stored value the feed reads lower is a named problem (round 1, finding 2)', () => {
  it('the first fill lists each move off a non-zero stored value by player, and goes ahead', async () => {
    const report = await run(worldWith(ALL_LINES), ALL_LINES)
    expect(report.ok).toBe(true)
    expect(report.weeks.flatMap((w) => w.fromStoredValue)).toEqual([{ player_id: 'CHI', column: 'def_fumble_recoveries', stored: 1, feed: 3 }])
  })

  it('after a clean fill, a feed that omits Arizona’s block: named by player, column and values; exit 1, nothing written', async () => {
    const world = worldWith(FULL)
    expect((await run(world, FULL, { apply: true })).ok).toBe(true)
    const calls = world.doorCalls.length
    const before = snapshot(world)
    const next = FULL.map((l) => (l === ARI ? { ...ARI, stats: omit(ARI.stats, 'def_block') } : l))
    const { code, out } = await cli([...SPEC, '--apply', '--confirm-target', HOST], world, next)
    expect(code).toBe(1)
    expect(out).toContain(`      PROBLEM: ${lowered(1, 'ARI', 'def_block', 1, 0)}`)
    expect(out).toContain('      from a stored value ARI def_block: stored 1 → feed 0')
    expect(out.join('\n')).not.toContain('Done')
    expect(world.doorCalls).toHaveLength(calls)
    expect(snapshot(world)).toBe(before)
  })

  it('a re-run from a checkout whose map reads less (plain fum_rec, no D/ST return TD): every lowered value named', async () => {
    const world = worldWith(ALL_LINES)
    expect((await run(world, ALL_LINES, { apply: true })).ok).toBe(true)
    const calls = world.doorCalls.length
    const before = snapshot(world)
    const narrower = ALL_LINES.map((l) => (l === CHI ? { ...CHI, stats: { ...CHI.stats, def_fumble_rec: 1 } } : l === MIN ? { ...MIN, stats: omit(MIN.stats, 'def_return_td') } : l))
    const report = await run(world, narrower, { apply: true })
    expect(report.refused).toBeUndefined()
    expect(report.ok).toBe(false)
    expect(report.weeks.flatMap((w) => w.problems)).toEqual([lowered(3, 'MIN', 'def_return_td', 1, 0), lowered(6, 'CHI', 'def_fumble_recoveries', 3, 1)])
    expect(world.doorCalls).toHaveLength(calls)
    expect(snapshot(world)).toBe(before)
  })

  it('a raise off a non-zero stored value is listed, never a problem', async () => {
    const world = worldWith([CHI, BASS, TEN], [storedToday(CHI, { def_fumble_recoveries: 2 }), storedToday(BASS), storedToday(TEN)])
    const report = await run(world, [CHI, BASS, TEN], { weeks: [1, 6], apply: true })
    expect(report.ok).toBe(true)
    expect(report.weeks.flatMap((w) => w.fromStoredValue)).toEqual([{ player_id: 'CHI', column: 'def_fumble_recoveries', stored: 2, feed: 3 }])
    expect(world.stored('CHI', 6).def_fumble_recoveries).toBe(3)
  })
})

describe('def_fumble_recoveries: every move is listed by player, 0 → n included (round 2)', () => {
  // The Jets ahead of Chicago, as the feed doesn't promise an order: the printed line sorts.
  const LINES = [NYJ1, CHI1, BASS, WR, MIN, PRICE, TEN, CHI, BOSWELL, LAUBE, MITCHELL]
  const ROLL_UP = '  all weeks def_fumble_recoveries by player, stored → feed: '
  const move = (player_id: string, stored: number, feed: number) => ({ player_id, column: 'def_fumble_recoveries', stored, feed })

  it('is the one ruled column the feed sums with a part main already stores', () => {
    expect([...SUMMED_RULED_COLUMNS]).toEqual(['def_fumble_recoveries'])
    for (const column of SUMMED_RULED_COLUMNS) expect(RULED_COLUMNS).toContain(column)
  })

  it('the Jets 0 → 1 is listed beside Chicago’s two; the list holds every move the count holds', async () => {
    const report = await run(worldWith(LINES), LINES)
    expect(report.ok).toBe(true)
    expect(report.weeks.map((w) => [w.week, w.summedMoves])).toEqual([
      [1, [move('CHI', 1, 2), move('NYJ', 0, 1)]],
      [3, []],
      [6, [move('CHI', 1, 3)]],
      [8, []],
    ])
    for (const w of report.weeks) expect(w.summedMoves, `week ${w.week}`).toHaveLength(w.moves.def_fumble_recoveries)
    // The non-zero list is unchanged by this: the Jets aren't on it.
    expect(report.weeks.flatMap((w) => w.fromStoredValue)).toEqual([move('CHI', 1, 2), move('CHI', 1, 3)])
  })

  it('the CLI prints the Jets by name on the one line F890 is compared with', async () => {
    const { code, out } = await cli(SPEC, worldWith(LINES), LINES)
    expect(code).toBe(0)
    expect(out).toContain(`${ROLL_UP}wk1 CHI 1→2, NYJ 0→1; wk6 CHI 1→3`)
  })

  it('a late fix to the stored part (the Jets’ fum_rec 0 → 1): every count reads as before, only the by-player lines show it', async () => {
    const late = LINES.map((l) => (l === NYJ1 ? { ...NYJ1, stats: { ...NYJ1.stats, def_fumble_rec: 2 } } : l))
    const clean = renderFill(await run(worldWith(LINES), LINES))
    const fixed = renderFill(await run(worldWith(LINES), late))
    expect(fixed).toHaveLength(clean.length)
    expect(fixed.filter((l, i) => l !== clean[i])).toEqual(['      summed def_fumble_recoveries NYJ: stored 0 → feed 2', `${ROLL_UP}wk1 CHI 1→2, NYJ 0→2; wk6 CHI 1→3`])
  })

  it('the same on a non-zero stored part (Chicago week 6, fum_rec 1 → 2): the line reads 1→4, not 1→3', async () => {
    const late = LINES.map((l) => (l === CHI ? { ...CHI, stats: { ...CHI.stats, def_fumble_rec: 4 } } : l))
    const lines = renderFill(await run(worldWith(LINES), late))
    expect(lines).toContain(`${ROLL_UP}wk1 CHI 1→2, NYJ 0→1; wk6 CHI 1→4`)
  })

  it('a new line on the column is listed from 0', () => {
    const plan = planFillWeek({ week: 1, lines: [line('NYJ', 1, { def_fumble_rec: 1 })], stored: new Map(), positions: new Map([['NYJ', 'DEF']]), ctx: CTX })
    expect(plan.problems).toEqual([])
    expect(plan.newRows.map((row) => row.player_id)).toEqual(['NYJ'])
    expect(plan.summedMoves).toEqual([move('NYJ', 0, 1)])
  })

  it('nothing moved on the column prints "none", never no line', async () => {
    const lines = [BASS, WR, ARI, LAC]
    const report = await run(worldWith(lines), lines, { weeks: [1] })
    expect(report.ok).toBe(true)
    expect(renderFill(report)).toContain(`${ROLL_UP}none`)
  })
})

describe('a one-week run with an empty or conflicting feed names the feed, not the checkout (round 1, finding 4)', () => {
  const ONE_WEEK = ['--season', '2026', '--weeks', '3', '--apply', '--confirm-target', HOST]

  it('two different lines for Minnesota: the F831 problem prints and blocks; no mapping text', async () => {
    const world = worldWith(ALL_LINES)
    const { code, out, err } = await cli(ONE_WEEK, world, [...ALL_LINES, { ...MIN, stats: { ...MIN.stats, def_sack: 1 } }])
    expect(code).toBe(1)
    expect(out).toContain('      PROBLEM: week 3: the feed carries two different lines for MIN — this week is not planned (F831)')
    expect(out.join('\n')).not.toMatch(/mapping/)
    expect(err).toEqual(['REFUSED — problems above; nothing written'])
    expect(world.doorCalls).toEqual([])
  })

  it('an empty feed: "the feed returned zero lines" prints and blocks; no mapping text', async () => {
    const world = worldWith(ALL_LINES)
    const { code, out, err } = await cli(ONE_WEEK, world, [])
    expect(code).toBe(1)
    expect(out).toContain('      PROBLEM: week 3: the feed returned zero lines')
    expect(out.join('\n')).not.toMatch(/mapping/)
    expect(err).toEqual(['REFUSED — problems above; nothing written'])
    expect(world.doorCalls).toEqual([])
  })

  it('the report keeps the plan: not refused, the week and its one problem', async () => {
    const report = await run(worldWith(ALL_LINES), [], { weeks: [3] })
    expect(report.refused).toBeUndefined()
    expect(report.ok).toBe(false)
    expect(report.weeks.map((w) => [w.week, w.problems])).toEqual([[3, ['week 3: the feed returned zero lines']]])
  })
})

describe('a re-read that fails after writing still prints what landed (round 1, finding 5)', () => {
  it('exit 1; the plan, the written count and the failure all print; never Done', async () => {
    const world = worldWith(ALL_LINES)
    world.statReadErrorAfterDoor = 'upstream 502'
    const { code, out, err } = await cli([...SPEC, '--apply', '--confirm-target', HOST], world)
    expect(code).toBe(1)
    expect(world.doorCalls.length).toBeGreaterThan(0)
    expect(out.some((l) => l.startsWith('  week 8: 3 lines to write'))).toBe(true)
    expect(out).toContain('  written: 8 lines; queue rows 0; events 0')
    expect(out).toContain('  FAILED AFTER WRITING: could not re-read week 1: upstream 502; 8 lines were written in this run; nothing after this was checked — re-run (it plans against what landed) to re-check')
    expect(out.join('\n')).not.toContain('Done')
    expect(err).toEqual(['FAILED — see the lines above'])
  })

  it('the report says it, ok false', async () => {
    const world = worldWith(ALL_LINES)
    world.statReadErrorAfterDoor = 'upstream 502'
    const report = await run(world, ALL_LINES, { apply: true })
    expect(report.ok).toBe(false)
    expect(report.wrote).toBe(true)
    expect(report.afterProblems).toHaveLength(1)
    expect(report.afterProblems[0]).toMatch(/^could not re-read week 1: upstream 502; 8 lines were written in this run/)
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
      '      from a stored value CHI def_fumble_recoveries: stored 1 → feed 3',
      '      summed def_fumble_recoveries CHI: stored 1 → feed 3',
      '  week 8: 3 lines to write (1 updated, 2 new), 4 moves: fg_0_39=1 fg_missed=1 return_td=1 fumble_recovery_td=1 | feed lines=4 unchanged=0 unknownPlayers=1 empty=0 repeats=0 zeroNewLines=0 storedOnly=0',
      '      new line 11574: return_td=1',
      '      new line 8170: fumble_recovery_td=1',
      '      PROBLEM: week 8: player nobody is not in players, and its line carries return_td=1',
      '  all weeks: 8 lines (5 updated, 3 new), 10 moves: fg_0_39=2 fg_missed=1 def_block=1 def_return_td=2 def_fumble_recoveries=1 return_td=2 fumble_recovery_td=1; 1 from a non-zero stored value; 1 other-column differences',
      '  all weeks def_fumble_recoveries by player, stored → feed: wk6 CHI 1→3',
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

  it('refuses any season but 2026 by name while the arguments parse: exit 2, no target line, nothing connected (round 3)', async () => {
    for (const season of ['2025', '2027', '2024']) {
      const { code, out, err, connected } = await cli(['--season', season, '--weeks', '1-8', '--apply', '--confirm-target', HOST])
      expect(code, season).toBe(2)
      expect(err, season).toEqual([`--season ${season} refused: this tool fills 2026 only (2025 is F872, not ruled). Nothing read or written.`])
      expect(out, season).toEqual([])
      expect(connected, season).toBe(0)
    }
    expect(() => parseFillArgs(['--season', '2025', '--weeks', '1'])).toThrow('2025 is F872, not ruled')
  })

  it('parseFillArgs reads the happy path', () => {
    expect(parseFillArgs(['--weeks', '1-3', '--season', '2026'])).toEqual({ season: 2026, weeks: [1, 2, 3], apply: false, confirmTarget: undefined })
    expect(parseFillArgs(['--season', '2026', '--weeks', '8', '--apply', '--confirm-target', 'h'])).toEqual({ season: 2026, weeks: [8], apply: true, confirmTarget: 'h' })
  })
})

// ── Review round 3 (2026-11-05) ──────────────────────────────────────────

describe('an --apply prints its plan before the first door call (round 3, item 2)', () => {
  it('the whole plan, once, before any door call; then what it wrote', async () => {
    const { code, out, doorCallsAt, world } = await cli([...SPEC, '--apply', '--confirm-target', HOST])
    expect(code).toBe(0)
    expect(world.doorCalls).toHaveLength(6)
    expect(out.slice(0, 2)).toEqual([`target: ${HOST}`, `Fill [2026] weeks 1,3,6,8 → ${HOST}`])
    const rollUp = out.findIndex((l) => l.startsWith('  all weeks def_fumble_recoveries by player'))
    expect(rollUp).toBeGreaterThan(2)
    expect(doorCallsAt.slice(0, rollUp + 1).every((n) => n === 0)).toBe(true)
    expect(out[rollUp + 1]).toBe('  written: 8 lines; queue rows 0; events 0')
    expect(doorCallsAt[rollUp + 1]).toBe(6)
    expect(out.filter((l) => l.startsWith('Fill [2026]'))).toHaveLength(1)
    expect(out.filter((l) => l.startsWith('  week '))).toHaveLength(4)
  })

  it('a run that dies writing has already printed its plan', async () => {
    const world = worldWith(ALL_LINES)
    world.doorHangs = true
    const out: string[] = []
    void runFillCli([...SPEC, '--apply', '--confirm-target', HOST], {
      supabaseUrl: URL_,
      connect: () => ({ db: world.client(), provider: feed(ALL_LINES), time: new VirtualClock(NOW) }),
      log: (l) => out.push(l),
      error: () => {},
    })
    await vi.waitFor(() => expect(world.doorCalls).toHaveLength(1))
    expect(out.some((l) => l.startsWith('  week 8: 3 lines to write'))).toBe(true)
    expect(out.at(-1)).toBe('  all weeks def_fumble_recoveries by player, stored → feed: wk6 CHI 1→3')
  })

  it('a re-read that throws after writing (a dropped connection): the plan, "8 lines" and the failure print; exit 1; never Done', async () => {
    const world = worldWith(ALL_LINES)
    world.statReadThrowAfterDoor = 'socket hang up'
    const { code, out, err } = await cli([...SPEC, '--apply', '--confirm-target', HOST], world)
    expect(code).toBe(1)
    expect(world.doorCalls).toHaveLength(6)
    expect(out.some((l) => l.startsWith('  week 8: 3 lines to write'))).toBe(true)
    expect(out).toContain('  written: 8 lines; queue rows 0; events 0')
    expect(out).toContain(
      '  FAILED AFTER WRITING: could not re-read week 1: socket hang up; 8 lines were written in this run; nothing after this was checked — re-run (it plans against what landed) to re-check',
    )
    expect(out.join('\n')).not.toContain('Done')
    expect(err).toEqual(['FAILED — see the lines above'])
  })
})

describe('a door failing inside one call says "at least" (round 3, item 3)', () => {
  it('batch 2 of a 1502-line call fails: 500 landed, the report says at least 0, a re-run writes the rest', async () => {
    const { world, lines } = bigWorld()
    const feedLines = lines.map((l) => (l === TEN ? { ...TEN, week: 8 } : l))
    world.doorError = { callNumber: 2, message: 'statement timeout' }
    const report = await run(world, feedLines, { weeks: [8], apply: true })
    expect(report.ok).toBe(false)
    expect(report.linesWritten).toBe(0)
    expect(report.writeFailure).toBe(
      `${INGEST_DOOR} failed (2026 week 8, lines 501–1000): statement timeout — at least 0 lines were written before it; re-running is safe, it diffs against what landed`,
    )
    expect(world.stats.filter((r) => r.week === 8 && r.updated_at === NOW.toISOString())).toHaveLength(500)
    expect(renderFill(report)).toContain('  written: at least 0 lines; queue rows 0; events 0')
    world.doorError = null
    const again = await run(world, feedLines, { weeks: [8], apply: true })
    expect(again.ok).toBe(true)
    expect(again.linesWritten).toBe(1002)
  })
})

describe('names: full_name (id) on every other-column, problem and summed-move line (round 3, item 5)', () => {
  // Made up: real names never go in a repo file. Only the tool's terminal output carries them.
  const NAMES: Readonly<Record<string, string>> = {
    '7042': 'Kicker Tango',
    '1945': 'Kicker Bravo',
    CHI: 'Defense Charlie',
    NYJ: 'Defense Juliet',
    ARI: 'Defense Alpha',
    'wr-1': 'Receiver Whiskey',
  }
  const named = (world: World): World => {
    for (const player of world.players) {
      const name = NAMES[String(player.id)]
      if (name !== undefined) player.full_name = name
    }
    return world
  }

  it('who: the name and the id; the bare id for a player players does not know', () => {
    const names = new Map([['7042', 'Kicker Tango']])
    expect(who(names, '7042')).toBe('Kicker Tango (7042)')
    expect(who(names, 'nobody')).toBe('nobody')
  })

  it('an other-column difference and each summed move print the name; the roll-up F890 compares stays ids only', async () => {
    const receiver = line('wr-1', 1, { targets: 8, receptions: 5, receiving_yards: 61 }, { off_snaps: 40 }, 'BUF', 'HOU')
    const lines = [NYJ1, CHI1, BASS, receiver, MIN, PRICE, TEN, CHI, BOSWELL, LAUBE, MITCHELL]
    const world = named(worldWith(lines, [NYJ1, CHI1, BASS, WR, MIN, TEN, CHI, BOSWELL].map((l) => storedToday(l))))
    const { code, out } = await cli(SPEC, world, lines)
    expect(code).toBe(0)
    expect(out).toContain('      other (not written) Receiver Whiskey (wr-1) targets: stored 7 → feed 8')
    expect(out).toContain('      summed def_fumble_recoveries Defense Charlie (CHI): stored 1 → feed 2')
    expect(out).toContain('      summed def_fumble_recoveries Defense Juliet (NYJ): stored 0 → feed 1')
    expect(out).toContain('      summed def_fumble_recoveries Defense Charlie (CHI): stored 1 → feed 3')
    expect(out).toContain('  all weeks def_fumble_recoveries by player, stored → feed: wk1 CHI 1→2, NYJ 0→1; wk6 CHI 1→3')
  })

  it('each problem names the player: a missing D/ST, a lowered value, a K identity, a late new line, two lines for one player', async () => {
    const missingDst = await cli(SPEC, named(worldWith(FULL)), without((l) => l === ARI))
    expect(missingDst.out).toContain("      PROBLEM: week 1: the feed doesn't carry D/ST Defense Alpha (ARI), which has a stored line — a partial read")

    const filled = named(worldWith(FULL))
    expect((await run(filled, FULL, { apply: true })).ok).toBe(true)
    const lowerRead = await cli(SPEC, filled, FULL.map((l) => (l === ARI ? { ...ARI, stats: omit(ARI.stats, 'def_block') } : l)))
    expect(lowerRead.out).toContain(`      PROBLEM: ${lowered(1, 'Defense Alpha (ARI)', 'def_block', 1, 0)}`)

    const stale = named(worldWith([BOSWELL, TEN], [storedToday(BOSWELL, { fg_made: 1 }), storedToday(TEN)]))
    const identity = await cli(['--season', '2026', '--weeks', '6,8'], stale, [BOSWELL, TEN])
    expect(identity.out).toContain('      PROBLEM: week 8: K Kicker Bravo (1945): fg_0_39 2 + fg_made_40_plus 0 + fg_made_50_plus 0 does not equal fg_made 1')
    expect(identity.out).toContain('      other (not written) Kicker Bravo (1945) fg_made: stored 1 → feed 2')

    const late = await cli(SPEC, named(worldWith(ALL_LINES)), [...ALL_LINES, line('wr-1', 8, { return_td: 1, receiving_yards: 22 })])
    expect(late.out).toContain('      PROBLEM: week 8: new line for Receiver Whiskey (wr-1) also carries receiving_yards=22 — a late provider line, not written')

    const twice = await cli(SPEC, named(worldWith(ALL_LINES)), [...ALL_LINES, { ...BASS, stats: { ...BASS.stats, fg_0_39: 1 } }])
    expect(twice.out).toContain('      PROBLEM: week 1: the feed carries two different lines for Kicker Tango (7042) — this week is not planned (F831)')
  })

  it('a failed check after writing names the player too', async () => {
    const world = named(worldWith(ALL_LINES))
    world.afterDoor = (w) => (w.stored('7042', 1).fg_0_39 = 0)
    const { code, out } = await cli([...SPEC, '--apply', '--confirm-target', HOST], world)
    expect(code).toBe(1)
    expect(out).toContain('  FAILED AFTER WRITING: week 1: Kicker Tango (7042) fg_0_39 reads 0 after the fill, the plan wrote 2')
  })

  it('names are read past the 1000-row cap: the last of 1500 more players prints by name', async () => {
    const { world, lines } = bigWorld()
    const last = world.players.find((p) => p.id === 'wr-1499')
    if (last === undefined) throw new Error('fixture: no wr-1499')
    last.full_name = 'Receiver Zulu'
    const feedLines = lines.map((l) => (l === TEN ? { ...TEN, week: 8 } : l.playerId === 'wr-1499' ? { ...l, stats: { ...l.stats, receiving_yards: 1500 } } : l))
    const report = await run(world, feedLines, { weeks: [8] })
    expect(renderFill(report)).toContain('      other (not written) Receiver Zulu (wr-1499) receiving_yards: stored 1499 → feed 1500')
  })
})

describe('the mutants that survived round 2, one test each (round 3, item 7)', () => {
  it('a new line stored differently outside the ruled columns fails after writing (the new-line fingerprint)', async () => {
    const world = worldWith(ALL_LINES)
    world.afterDoor = (w) => {
      const row = w.stats.find((r) => r.player_id === '13075' && r.week === 3)
      if (row !== undefined) row.receiving_yards = 5
    }
    const report = await run(world, ALL_LINES, { apply: true })
    expect(report.wrote).toBe(true)
    expect(report.ok).toBe(false)
    expect(report.afterProblems).toEqual(['week 3: new line 13075 was stored differently outside the ruled columns'])
  })

  it('a league week naming a league the read did not return throws by name, before the feed is read', async () => {
    const world = worldWith(ALL_LINES)
    world.leagueWeeks = [{ id: 'lw-ghost', league_id: 'ghost', season: SEASON, week: 8, status: 'correction_window' }]
    world.leagues = []
    const provider = feed(ALL_LINES)
    await expect(fillRuledColumns({ db: world.client(), provider, time: new VirtualClock(NOW) }, { season: SEASON, weeks: [1, 3, 6, 8], apply: true })).rejects.toThrow(
      'league_weeks lw-ghost names league ghost, which the read did not return — refusing to read that as no hold',
    )
    expect(provider.weekCalls).toEqual([])
    expect(world.doorCalls).toEqual([])
  })

  it('a new K line carrying only fg_0_39 fails its identity in the plan, before any write', async () => {
    const world = worldWith(ALL_LINES)
    world.players.push({ id: 'k-new', position: 'K' })
    const before = snapshot(world)
    const report = await run(world, [...ALL_LINES, line('k-new', 8, { fg_0_39: 1 })], { apply: true })
    expect(report.ok).toBe(false)
    expect(weekOf(report, 8).newRows.map((r) => r.player_id)).toContain('k-new')
    expect(weekOf(report, 8).problems).toEqual(['week 8: K k-new: fg_0_39 1 + fg_made_40_plus 0 + fg_made_50_plus 0 does not equal fg_made 0'])
    expectNothingWritten(world, before)
  })

  it('an empty players table throws by name, before the feed is read', async () => {
    const world = worldWith(ALL_LINES)
    world.players = []
    const provider = feed(ALL_LINES)
    await expect(fillRuledColumns({ db: world.client(), provider, time: new VirtualClock(NOW) }, { season: SEASON, weeks: [1, 3, 6, 8], apply: true })).rejects.toThrow(
      'players is empty — every line would read as unknown (refusing to call that success)',
    )
    expect(provider.weekCalls).toEqual([])
    expect(world.doorCalls).toEqual([])
  })

  it('a line carrying nothing storable is counted as empty, and printed', async () => {
    const report = await run(worldWith(ALL_LINES), [...ALL_LINES, line('wr-x', 1, {}), line('wr-y', 1, { not_a_box_key: 2 })])
    expect(report.ok).toBe(true)
    expect(report.weeks.map((w) => [w.week, w.empty, w.unknownPlayers])).toEqual([
      [1, 2, 0],
      [3, 0, 0],
      [6, 0, 0],
      [8, 0, 0],
    ])
    expect(renderFill(report)[0]).toMatch(/ feed lines=4 .* empty=2 /)
  })

  it('the game-state read asks for this season: last season’s all-final week 8 does not clear this one', async () => {
    const world = worldWith(ALL_LINES)
    world.gameStates.set(`${SEASON}:8`, { total_games: 14, open_games: 1, all_final: false })
    world.gameStates.set(`${SEASON - 1}:8`, { total_games: 16, open_games: 0, all_final: true })
    const report = await run(world, ALL_LINES, { apply: true })
    expect(report.refused).toBe('refused — week 8: not every game still in the week is final (1 open of 14). Nothing was read from the provider or written.')
    expect(world.stateCalls).toEqual([
      [SEASON, 1],
      [SEASON, 3],
      [SEASON, 6],
      [SEASON, 8],
    ])
  })

  it('the fake door refuses what 167:270-279 refuses, in its words: a batch across two weeks, an advanced that is not an object', async () => {
    const { rpc } = new World().client() as unknown as { rpc: (fn: string, args: Row) => Promise<unknown> }
    const stat = (week: number, advanced: unknown) => ({ player_id: `p${week}`, season: SEASON, week, stat_type: 'weekly', game_id: null, is_live: false, source: 's', advanced })
    const element = (week: number, advanced: unknown = {}) => ({ stat: stat(week, advanced), enqueue: false, corrections: [] })
    await expect(rpc(INGEST_DOOR, { p_rows: [element(1), element(2)], p_now: PAST })).rejects.toThrow('ingest_write_batch: element 2 is not season 2026 week 1 — a batch is one (season, week)')
    await expect(rpc(INGEST_DOOR, { p_rows: [element(1, [])], p_now: PAST })).rejects.toThrow('ingest_write_batch: element 1 advanced must be a JSON object')
    await expect(rpc(INGEST_DOOR, { p_rows: [element(1, null)], p_now: PAST })).rejects.toThrow('ingest_write_batch: element 1 advanced must be a JSON object')
    await expect(rpc(INGEST_DOOR, { p_rows: [element(1)], p_now: PAST })).resolves.toMatchObject({ data: { stats_written: 1 } })
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

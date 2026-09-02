/**
 * ingest-week.test.ts — the pure half of L.D2.1 (spec §22.2/§23.2/§23.3,
 * E42/E43; PROGRESS D300/D303): the diff functions, the week-bounds rule
 * and the row builders, pinned as stored literals with the D146 one-unit
 * siblings. The stack half (real tables, the synthetic provider, the
 * outage flag) is ingest-week-db.test.ts.
 */
import { describe, expect, it } from 'vitest'

import { DegradationTracker } from '@/lib/leagues/stats/degradation'
import type { ProviderGame, ProviderPlayerWeekStats, StatsProvider } from '@/lib/leagues/stats/stats-provider'
import { VirtualClock } from '@/lib/leagues/time/virtual-clock'

import {
  ADVANCED_KEYS,
  diffGames,
  diffStats,
  ingestWeek,
  sameBounds,
  STAT_COLUMN_SURFACE,
  toGameRow,
  toStatRow,
  weekBounds,
  type GameRow,
  type StatRow,
  type ToStatRowContext,
} from './ingest-week'
import type { SyncClient } from './types'

const G1: ProviderGame = {
  gameId: '2026-wk02-DAL@PHI',
  season: 2026,
  week: 2,
  homeTeam: 'PHI',
  awayTeam: 'DAL',
  kickoffAt: new Date('2026-09-20T17:00:00Z'),
  gameDate: '2026-09-20',
  status: 'scheduled',
}
const G1_ROW: GameRow = {
  id: '2026-wk02-DAL@PHI',
  season: 2026,
  week: 2,
  home_team: 'PHI',
  away_team: 'DAL',
  kickoff_at: '2026-09-20T17:00:00.000Z',
  status: 'scheduled',
}
const G3_ROW: GameRow = {
  id: '2026-wk02-SEA@SF',
  season: 2026,
  week: 2,
  home_team: 'SF',
  away_team: 'SEA',
  kickoff_at: '2026-09-21T00:20:00.000Z',
  status: 'scheduled',
}

describe('column surfaces (derived from the registry — D33 one namespace)', () => {
  it('STAT_COLUMN_SURFACE is the 38-column box surface live-stats already pins (27 pre-seam + 11 from 057)', () => {
    expect(STAT_COLUMN_SURFACE).toHaveLength(38)
    expect(STAT_COLUMN_SURFACE).toContain('two_point_conversions')
    expect(STAT_COLUMN_SURFACE).toContain('def_yards_allowed')
    // Sorted and unique — the row shape is deterministic.
    expect([...STAT_COLUMN_SURFACE]).toEqual([...new Set(STAT_COLUMN_SURFACE)].sort())
  })

  it('ADVANCED_KEYS is exactly the D15 placeholder pair today (§23.5 storage rule; C59)', () => {
    expect([...ADVANCED_KEYS].sort()).toEqual(['example_charted_yards', 'example_tracking_yards'])
  })
})

describe('toGameRow', () => {
  it('maps a provider game to the nfl_games row with a normalized ISO kickoff', () => {
    expect(toGameRow(G1)).toEqual(G1_ROW)
  })

  it('returns null for a tier without kickoff timestamps (the sleeper tier, Q1) — kickoff_at is NOT NULL', () => {
    expect(toGameRow({ ...G1, kickoffAt: null })).toBeNull()
  })
})

describe('diffGames (§23.2 diff-aware)', () => {
  it('classifies new / changed / unchanged — a moved kickoff is a change (E42), a same row is not', () => {
    const existing = new Map<string, GameRow>([[G1_ROW.id, G1_ROW]])
    const moved: GameRow = { ...G3_ROW, kickoff_at: '2026-09-20T21:05:00.000Z' }
    expect(diffGames([G1_ROW, moved], existing)).toEqual({
      inserts: [moved],
      updates: [],
      unchanged: 1,
    })
    const existing2 = new Map<string, GameRow>([
      [G1_ROW.id, G1_ROW],
      [G3_ROW.id, G3_ROW],
    ])
    expect(diffGames([G1_ROW, moved], existing2)).toEqual({
      inserts: [],
      updates: [moved],
      unchanged: 1,
    })
  })

  it('a status flip alone is a change (scheduled → live → final are real row changes)', () => {
    const existing = new Map<string, GameRow>([[G1_ROW.id, G1_ROW]])
    const live: GameRow = { ...G1_ROW, status: 'live' }
    expect(diffGames([live], existing).updates).toEqual([live])
  })

  it('one unit of kickoff (1 second) is a change — the diff compares the full instant', () => {
    const existing = new Map<string, GameRow>([[G1_ROW.id, G1_ROW]])
    const oneSecond: GameRow = { ...G1_ROW, kickoff_at: '2026-09-20T17:00:01.000Z' }
    expect(diffGames([oneSecond], existing).updates).toHaveLength(1)
    expect(diffGames([G1_ROW], existing).unchanged).toBe(1)
  })
})

describe('weekBounds (§12.20 first_kickoff_at / last_game_ends_at; E43)', () => {
  const now = new Date('2026-09-21T04:00:00Z')
  const g1Final: GameRow = { ...G1_ROW, status: 'final' }
  const g3Final: GameRow = { ...G3_ROW, status: 'final' }

  it('first_kickoff_at is the earliest in-week kickoff; last_game_ends_at stays NULL while any game is ahead or live', () => {
    expect(weekBounds([G3_ROW, G1_ROW], null, now)).toEqual({
      first_kickoff_at: '2026-09-20T17:00:00.000Z',
      last_game_ends_at: null,
    })
    expect(weekBounds([g1Final, { ...G3_ROW, status: 'live' }], null, now)).toEqual({
      first_kickoff_at: '2026-09-20T17:00:00.000Z',
      last_game_ends_at: null,
    })
  })

  it('last_game_ends_at = the injected poll instant on the first all-final observation, then kept', () => {
    const first = weekBounds([g1Final, g3Final], null, now)
    expect(first).toEqual({
      first_kickoff_at: '2026-09-20T17:00:00.000Z',
      last_game_ends_at: '2026-09-21T04:00:00.000Z',
    })
    const later = weekBounds([g1Final, g3Final], first, new Date('2026-09-21T04:20:00Z'))
    expect(later.last_game_ends_at).toBe('2026-09-21T04:00:00.000Z') // kept, not re-stamped
    expect(sameBounds(first, later)).toBe(true)
  })

  it('a postponed-out game never bounds the week (E43): it neither sets first_kickoff_at nor holds last_game_ends_at open', () => {
    const postponedEarly: GameRow = {
      ...G1_ROW,
      status: 'postponed',
      kickoff_at: '2026-09-20T10:00:00.000Z', // earlier than every in-week game — must be ignored
    }
    expect(weekBounds([postponedEarly, g3Final], null, now)).toEqual({
      first_kickoff_at: '2026-09-21T00:20:00.000Z',
      last_game_ends_at: '2026-09-21T04:00:00.000Z',
    })
    // The one-unit sibling: the same game NOT postponed bounds both.
    const early: GameRow = { ...postponedEarly, status: 'scheduled' }
    expect(weekBounds([early, g3Final], null, now)).toEqual({
      first_kickoff_at: '2026-09-20T10:00:00.000Z',
      last_game_ends_at: null,
    })
  })

  it('the stamp is derived, not sticky (R709): a later non-final in-week game re-opens the week, and the next all-final observation re-stamps at ITS instant', () => {
    const ended = weekBounds([g1Final, g3Final], null, now)
    expect(ended.last_game_ends_at).toBe('2026-09-21T04:00:00.000Z')
    // A game moved INTO the week (or a provider status regression) while the
    // stored stamp exists: the week is genuinely playing again → NULL.
    const movedIn: GameRow = { ...G1_ROW, id: '2026-wk02-NYG@WAS', home_team: 'WAS', away_team: 'NYG', status: 'live' }
    const reopened = weekBounds([g1Final, g3Final, movedIn], ended, new Date('2026-09-22T01:00:00Z'))
    expect(reopened).toEqual({ first_kickoff_at: '2026-09-20T17:00:00.000Z', last_game_ends_at: null })
    // Then all final again: re-stamped at the NEW observation, not the old one.
    const reclosed = weekBounds([g1Final, g3Final, { ...movedIn, status: 'final' }], reopened, new Date('2026-09-22T04:00:00Z'))
    expect(reclosed.last_game_ends_at).toBe('2026-09-22T04:00:00.000Z')
    // The one-unit sibling: the same set STILL all-final keeps the stamp.
    expect(weekBounds([g1Final, g3Final], ended, new Date('2026-09-22T01:00:00Z')).last_game_ends_at).toBe('2026-09-21T04:00:00.000Z')
  })

  it('a week with no in-week games bounds nothing', () => {
    expect(weekBounds([], null, now)).toEqual({ first_kickoff_at: null, last_game_ends_at: null })
    expect(weekBounds([{ ...G1_ROW, status: 'postponed' }], null, now)).toEqual({
      first_kickoff_at: null,
      last_game_ends_at: null,
    })
  })
})

const CTX: ToStatRowContext = {
  providerName: 'synthetic',
  gameStatus: new Map([
    ['2026-wk02-DAL@PHI', 'live'],
    ['2026-wk02-BUF@KC', 'final'],
  ]),
  anyGameOpen: true,
}

const QB_LINE: ProviderPlayerWeekStats = {
  playerId: 'syn-g1-qb',
  season: 2026,
  week: 2,
  gameId: '2026-wk02-DAL@PHI',
  stats: { pass_yards: 304, pass_tds: 3, qb_sack_taken: 2, pass_2pt: 1 },
  advanced: { example_tracking_yards: 120 },
}

describe('toStatRow (§23.5 advanced; F13 provenance; the whole column surface)', () => {
  it('writes every surface column (absent keys → 0, the DEFAULT), the canonical advanced keys, source = provider.name, is_live from the game', () => {
    const { row, droppedAdvancedKeys } = toStatRow(QB_LINE, CTX)
    expect(droppedAdvancedKeys).toBe(0)
    expect(row).not.toBeNull()
    expect(Object.keys(row!.columns).sort()).toEqual([...STAT_COLUMN_SURFACE])
    expect(row!.columns.pass_yards).toBe(304)
    expect(row!.columns.pass_tds).toBe(3)
    expect(row!.columns.sacks_taken).toBe(2) // registry column mapping
    expect(row!.columns.pass_2pt).toBe(1)
    expect(row!.columns.two_point_conversions).toBe(1) // the summed derivation rides (D24)
    expect(row!.columns.rush_yards).toBe(0) // absent → 0
    expect(row!.advanced).toEqual({ example_tracking_yards: 120 })
    expect(row!.source).toBe('synthetic')
    expect(row!.game_id).toBe('2026-wk02-DAL@PHI')
    expect(row!.is_live).toBe(true)
  })

  it('is_live is false once the player’s game is final; falls back to the week when the tier has no game id', () => {
    expect(toStatRow({ ...QB_LINE, gameId: '2026-wk02-BUF@KC' }, CTX).row!.is_live).toBe(false)
    // R710: a POSTPONED game has left the week — its players are never live,
    // even when a real provider emits a line for them. The open siblings:
    // `scheduled` and `live` both read true.
    const ctx: ToStatRowContext = {
      ...CTX,
      gameStatus: new Map([
        ['g-postponed', 'postponed'],
        ['g-scheduled', 'scheduled'],
        ['g-live', 'live'],
      ]),
    }
    expect(toStatRow({ ...QB_LINE, gameId: 'g-postponed' }, ctx).row!.is_live).toBe(false)
    expect(toStatRow({ ...QB_LINE, gameId: 'g-scheduled' }, ctx).row!.is_live).toBe(true)
    expect(toStatRow({ ...QB_LINE, gameId: 'g-live' }, ctx).row!.is_live).toBe(true)
    expect(toStatRow({ ...QB_LINE, gameId: undefined }, CTX).row!.is_live).toBe(true)
    expect(toStatRow({ ...QB_LINE, gameId: undefined }, { ...CTX, anyGameOpen: false }).row!.is_live).toBe(false)
    expect(toStatRow({ ...QB_LINE, gameId: undefined }, CTX).row!.game_id).toBeNull()
  })

  it('drops a non-canonical advanced key and COUNTS it (D33 — never invents a namespace); a charted key ABSENT stays absent (pending, never 0)', () => {
    const { row, droppedAdvancedKeys } = toStatRow(
      { ...QB_LINE, advanced: { example_tracking_yards: 5, not_a_registry_key: 9 } },
      CTX,
    )
    expect(droppedAdvancedKeys).toBe(1)
    expect(row!.advanced).toEqual({ example_tracking_yards: 5 })
    expect('example_charted_yards' in row!.advanced).toBe(false)
  })

  it('a line with nothing storable is a null row (counted as empty upstream); one storable advanced key alone is enough', () => {
    expect(toStatRow({ ...QB_LINE, stats: { def_pa_1_6: 1 }, advanced: {} }, CTX).row).toBeNull()
    expect(toStatRow({ ...QB_LINE, stats: {}, advanced: { example_charted_yards: 12 } }, CTX).row).not.toBeNull()
  })
})

function statRow(overrides: Partial<StatRow> = {}): StatRow {
  const columns: Record<string, number> = {}
  for (const c of STAT_COLUMN_SURFACE) columns[c] = 0
  columns.pass_yards = 100
  return {
    player_id: 'syn-g1-qb',
    game_id: '2026-wk02-DAL@PHI',
    is_live: true,
    source: 'synthetic',
    columns,
    advanced: { example_tracking_yards: 40 },
    ...overrides,
  }
}

describe('diffStats (§23.2: only real deltas enqueue)', () => {
  it('unchanged rows are unchanged — the zero-delta pin (the DoD break probe turns this red)', () => {
    const row = statRow()
    const existing = new Map([[row.player_id, statRow()]])
    expect(diffStats([row], existing)).toEqual({ inserts: [], updates: [], metaOnly: [], unchanged: 1 })
  })

  it('a new player is an insert; a moved box column by ONE unit is an update', () => {
    expect(diffStats([statRow()], new Map()).inserts).toHaveLength(1)
    const existing = new Map([['syn-g1-qb', statRow()]])
    const moved = statRow({ columns: { ...statRow().columns, pass_yards: 101 } })
    expect(diffStats([moved], existing).updates).toEqual([moved])
  })

  it('a moved advanced value is an update; a charted key ARRIVING (absent → present) is an update even at 0 (§23.5 pending ≠ 0)', () => {
    const existing = new Map([['syn-g1-qb', statRow()]])
    expect(diffStats([statRow({ advanced: { example_tracking_yards: 41 } })], existing).updates).toHaveLength(1)
    expect(
      diffStats(
        [statRow({ advanced: { example_tracking_yards: 40, example_charted_yards: 0 } })],
        existing,
      ).updates,
    ).toHaveLength(1)
  })

  it('a stored NULL column and an absent/0 incoming value are the same number (DEFAULT 0 semantics) — not a phantom delta', () => {
    const prior = statRow()
    delete prior.columns.rush_yards // simulates a NULL read (readStats maps NULL → 0 too)
    const existing = new Map([['syn-g1-qb', prior]])
    expect(diffStats([statRow()], existing).unchanged).toBe(1)
  })

  it('is_live / game_id / source changes alone are metadata-only: written, never enqueued', () => {
    const existing = new Map([['syn-g1-qb', statRow()]])
    const final = statRow({ is_live: false })
    const resourced = statRow({ source: 'fixture:synthetic' })
    const regamed = statRow({ game_id: null })
    const diff = diffStats([final], existing)
    expect(diff).toEqual({ inserts: [], updates: [], metaOnly: [final], unchanged: 0 })
    expect(diffStats([resourced], existing).metaOnly).toEqual([resourced])
    expect(diffStats([regamed], existing).metaOnly).toEqual([regamed])
  })

  it('a scoring delta that also flips metadata is ONE update (never double-counted)', () => {
    const existing = new Map([['syn-g1-qb', statRow()]])
    const both = statRow({ is_live: false, columns: { ...statRow().columns, pass_tds: 1 } })
    expect(diffStats([both], existing)).toEqual({ inserts: [], updates: [both], metaOnly: [], unchanged: 0 })
  })
})

/**
 * A chainable in-memory stand-in for the service client: every table read
 * resolves to its canned rows (with `count` = their length, so pageAll
 * finishes in one page). Enough to drive `ingestWeek` through its reads
 * against an empty provider — the R712 cap pin needs nothing more.
 */
function fakeDb(rowsByTable: Record<string, Array<Record<string, unknown>>>): SyncClient {
  return {
    from(table: string) {
      const rows = rowsByTable[table] ?? []
      const builder: Record<string, unknown> = {}
      for (const method of ['select', 'eq', 'in', 'like', 'order', 'range', 'update', 'upsert']) {
        builder[method] = () => builder
      }
      builder.then = (
        resolve: (v: { data: unknown[]; error: null; count: number }) => unknown,
        reject: (e: unknown) => unknown,
      ) => Promise.resolve({ data: rows, error: null, count: rows.length }).then(resolve, reject)
      return builder
    },
  } as unknown as SyncClient
}

const EMPTY_PROVIDER: StatsProvider = {
  name: 'stub',
  capabilities: new Set(),
  getSchedule: async () => [],
  getGameStates: async () => [],
  getWeekStats: async () => [],
  getInjuries: async () => [],
  getInactives: async () => [],
}

function weekRows(n: number): Array<Record<string, unknown>> {
  return Array.from({ length: n }, (_, i) => ({ season: 2026, week: i + 1, first_kickoff_at: null, last_game_ends_at: null }))
}

describe('readWeeks refuses a result set AT the PostgREST cap (rule 10, R712)', () => {
  const clock = new VirtualClock(new Date('2026-09-20T18:00:00Z'))
  const deps = (db: SyncClient) => ({ db, degradation: new DegradationTracker(), season: 2026, week: 2 })

  it('1000 nfl_weeks rows (the cap) → throws; 999 (one under) → the poll completes', async () => {
    await expect(ingestWeek(EMPTY_PROVIDER, clock, deps(fakeDb({ nfl_weeks: weekRows(1000) })))).rejects.toThrow(
      'nfl_weeks read for 2026 returned 1000 rows — at the PostgREST cap, refusing to trust it',
    )
    const report = await ingestWeek(EMPTY_PROVIDER, clock, deps(fakeDb({ nfl_weeks: weekRows(999) })))
    expect(report.ok).toBe(true)
    expect(report.reasons).toEqual([
      'provider returned zero games for 2026',
      'provider returned zero stat rows for 2026 week 2',
      'score_fanout: no scoring delta — nothing enqueued',
    ])
  })
})

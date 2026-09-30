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
import { weekReleaseFloor } from '@/lib/leagues/time/release-floor'
import { VirtualClock } from '@/lib/leagues/time/virtual-clock'

import {
  ADVANCED_KEYS,
  diffGames,
  diffStats,
  ingestWeek,
  NULL_IS_PENDING_COLUMNS,
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

describe('weekBounds (§12.20 first_kickoff_at / last_game_ends_at; E43; Q50 the release floor)', () => {
  // 2026 week 2's calendar row (039:66) — Wednesday 00:00 ET. Every floor
  // below is DERIVED from this and from nothing else.
  const WEEK2_STARTS_AT = '2026-09-16T04:00:00.000Z'
  /** Q50(a): the first Tuesday 00:00 America/Los_Angeles after WEEK2_STARTS_AT. */
  const WEEK2_FLOOR = '2026-09-22T07:00:00.000Z'
  const now = new Date('2026-09-21T04:00:00Z')
  const g1Final: GameRow = { ...G1_ROW, status: 'final' }
  const g3Final: GameRow = { ...G3_ROW, status: 'final' }

  it('CASE 4 — not all final: first_kickoff_at is the earliest in-week kickoff and last_game_ends_at stays NULL while any game is ahead or live', () => {
    expect(weekBounds([G3_ROW, G1_ROW], null, now, WEEK2_STARTS_AT)).toEqual({
      first_kickoff_at: '2026-09-20T17:00:00.000Z',
      last_game_ends_at: null,
    })
    expect(weekBounds([g1Final, { ...G3_ROW, status: 'live' }], null, now, WEEK2_STARTS_AT)).toEqual({
      first_kickoff_at: '2026-09-20T17:00:00.000Z',
      last_game_ends_at: null,
    })
  })

  it('CASE 1 — the ordinary week: MNF ends ~21:30 PT Monday and the poll observes all-final at 21:31 PT, so the stamp is TUESDAY 00:00 PT, not the observation', () => {
    // Per-minute polling (124) observes all-final within a minute of the last
    // whistle. Q50: "never before Tuesday 00:00 Pacific".
    const observed = new Date('2026-09-22T04:31:00Z') // Mon 2026-09-21, 21:31 PDT
    const bounds = weekBounds([g1Final, g3Final], null, observed, WEEK2_STARTS_AT)
    expect(bounds).toEqual({
      first_kickoff_at: '2026-09-20T17:00:00.000Z',
      last_game_ends_at: WEEK2_FLOOR, // 2026-09-22T07:00Z = Tue 00:00 PDT
    })
    // ...and the stamp is ~2h29m LATER than the instant that was observed —
    // the whole behaviour change Q50(b) predicted.
    expect(new Date(bounds.last_game_ends_at!).getTime() - observed.getTime()).toBe(2 * 3600_000 + 29 * 60_000)
    // The one-unit sibling: a poll ONE MILLISECOND past the floor stamps
    // itself, so the floor is a floor and not a rounding rule.
    const pastByOneMs = new Date(Date.parse(WEEK2_FLOOR) + 1)
    expect(weekBounds([g1Final, g3Final], null, pastByOneMs, WEEK2_STARTS_AT).last_game_ends_at).toBe(
      '2026-09-22T07:00:00.001Z',
    )
  })

  it('CASE 2 — past the floor (THE TRAP): a game postponed into Tuesday and finishing 14:00 PT stamps THAT Tuesday, never the FOLLOWING one', () => {
    // Chris, 2026-09-09: "in the scenario where there's a weather delay on a
    // monday night game it might not play until Tuesday… we would basically
    // want it to be as soon as the game has ended since we are past the
    // normal unlock time." The floor is a constant of the WEEK
    // (`starts_at`), so a late kickoff cannot push it forward a week.
    const movedToTuesday: GameRow = { ...G3_ROW, kickoff_at: '2026-09-22T17:05:00.000Z', status: 'final' }
    const observed = new Date('2026-09-22T21:00:00Z') // Tue 2026-09-22, 14:00 PDT
    const bounds = weekBounds([g1Final, movedToTuesday], null, observed, WEEK2_STARTS_AT)
    expect(bounds.last_game_ends_at).toBe('2026-09-22T21:00:00.000Z') // immediate
    expect(bounds.last_game_ends_at).not.toBe('2026-09-29T07:00:00.000Z') // NOT the following Tuesday
    // The proof it is anchored on the week and not on the last kickoff: the
    // floor computed from that Tuesday kickoff WOULD be the following week.
    expect(weekReleaseFloor(movedToTuesday.kickoff_at).toISOString()).toBe('2026-09-29T07:00:00.000Z')
    expect(weekReleaseFloor(WEEK2_STARTS_AT).toISOString()).toBe(WEEK2_FLOOR)
  })

  it('CASE 3 — DST: the identical Monday-night scenario in a week after the 2026-11-01 fall-back floors exactly 3600 s later in UTC', () => {
    // 2026 week 9 (039:73) — Wednesday 00:00 EST. Its slate is entirely PST.
    const WEEK9_STARTS_AT = '2026-11-04T05:00:00.000Z'
    const wk9Sun: GameRow = { ...G1_ROW, id: '2026-wk09-DAL@PHI', week: 9, kickoff_at: '2026-11-08T18:00:00.000Z', status: 'final' }
    const wk9Mnf: GameRow = { ...G3_ROW, id: '2026-wk09-SEA@SF', week: 9, kickoff_at: '2026-11-10T01:15:00.000Z', status: 'final' }
    // Monday 21:31 PACIFIC in each week — the same wall clock, one before the
    // fall-back and one after.
    const sepStamp = weekBounds([g1Final, g3Final], null, new Date('2026-09-22T04:31:00Z'), WEEK2_STARTS_AT)
      .last_game_ends_at!
    const novStamp = weekBounds([wk9Sun, wk9Mnf], null, new Date('2026-11-10T05:31:00Z'), WEEK9_STARTS_AT)
      .last_game_ends_at!
    expect(sepStamp).toBe('2026-09-22T07:00:00.000Z') // PDT, UTC−7
    expect(novStamp).toBe('2026-11-10T08:00:00.000Z') // PST, UTC−8
    // The absolute instants are whole weeks apart PLUS exactly one hour: the
    // UTC time-of-day moved 3600 s while the Pacific wall clock did not.
    const DAY_MS = 24 * 3600_000
    const utcTimeOfDay = (iso: string): number => ((Date.parse(iso) % DAY_MS) + DAY_MS) % DAY_MS
    expect(utcTimeOfDay(sepStamp)).toBe(7 * 3600_000)
    expect(utcTimeOfDay(novStamp)).toBe(8 * 3600_000)
    expect(utcTimeOfDay(novStamp) - utcTimeOfDay(sepStamp)).toBe(3600_000)
    // A hard-coded 07:00Z would red here; a hard-coded 08:00Z would red the
    // September line above. Only zone data satisfies both.
  })

  it('CASE 5 — idempotence: a prior stamp wins outright and the instant never moves, floor-valued or not (R709/D303(4))', () => {
    const first = weekBounds([g1Final, g3Final], null, now, WEEK2_STARTS_AT)
    expect(first).toEqual({
      first_kickoff_at: '2026-09-20T17:00:00.000Z',
      last_game_ends_at: WEEK2_FLOOR,
    })
    // A later poll, still before the floor: kept, not re-stamped.
    const later = weekBounds([g1Final, g3Final], first, new Date('2026-09-21T04:20:00Z'), WEEK2_STARTS_AT)
    expect(later.last_game_ends_at).toBe(WEEK2_FLOOR)
    expect(sameBounds(first, later)).toBe(true)
    // A poll well PAST the floor: still kept — the floor shapes the FIRST
    // stamp only, so the release instant a league already saw never moves.
    const wellAfter = weekBounds([g1Final, g3Final], first, new Date('2026-09-24T00:00:00Z'), WEEK2_STARTS_AT)
    expect(wellAfter.last_game_ends_at).toBe(WEEK2_FLOOR)
    // The one-unit sibling: with NO prior, that same late poll stamps itself.
    expect(
      weekBounds([g1Final, g3Final], null, new Date('2026-09-24T00:00:00Z'), WEEK2_STARTS_AT).last_game_ends_at,
    ).toBe('2026-09-24T00:00:00.000Z')
  })

  it('a postponed-out game never bounds the week (E43): it neither sets first_kickoff_at nor holds last_game_ends_at open', () => {
    const postponedEarly: GameRow = {
      ...G1_ROW,
      status: 'postponed',
      kickoff_at: '2026-09-20T10:00:00.000Z', // earlier than every in-week game — must be ignored
    }
    expect(weekBounds([postponedEarly, g3Final], null, now, WEEK2_STARTS_AT)).toEqual({
      first_kickoff_at: '2026-09-21T00:20:00.000Z',
      last_game_ends_at: WEEK2_FLOOR,
    })
    // The one-unit sibling: the same game NOT postponed bounds both.
    const early: GameRow = { ...postponedEarly, status: 'scheduled' }
    expect(weekBounds([early, g3Final], null, now, WEEK2_STARTS_AT)).toEqual({
      first_kickoff_at: '2026-09-20T10:00:00.000Z',
      last_game_ends_at: null,
    })
  })

  it('the stamp is derived, not sticky (R709): a later non-final in-week game re-opens the week, and the next all-final observation re-stamps at ITS instant', () => {
    const ended = weekBounds([g1Final, g3Final], null, now, WEEK2_STARTS_AT)
    expect(ended.last_game_ends_at).toBe(WEEK2_FLOOR)
    // A game moved INTO the week (or a provider status regression) while the
    // stored stamp exists: the week is genuinely playing again → NULL.
    const movedIn: GameRow = { ...G1_ROW, id: '2026-wk02-NYG@WAS', home_team: 'WAS', away_team: 'NYG', status: 'live' }
    const reopened = weekBounds([g1Final, g3Final, movedIn], ended, new Date('2026-09-22T01:00:00Z'), WEEK2_STARTS_AT)
    expect(reopened).toEqual({ first_kickoff_at: '2026-09-20T17:00:00.000Z', last_game_ends_at: null })
    // Then all final again: re-stamped at the NEW observation (past the floor
    // by then, so the observation wins), not the old one.
    const reclosed = weekBounds(
      [g1Final, g3Final, { ...movedIn, status: 'final' }],
      reopened,
      new Date('2026-09-23T04:00:00Z'),
      WEEK2_STARTS_AT,
    )
    expect(reclosed.last_game_ends_at).toBe('2026-09-23T04:00:00.000Z')
    // The one-unit sibling: the same set STILL all-final keeps the stamp.
    expect(
      weekBounds([g1Final, g3Final], ended, new Date('2026-09-22T01:00:00Z'), WEEK2_STARTS_AT).last_game_ends_at,
    ).toBe(WEEK2_FLOOR)
  })

  it('a week with no in-week games bounds nothing (and never computes a floor)', () => {
    expect(weekBounds([], null, now, WEEK2_STARTS_AT)).toEqual({ first_kickoff_at: null, last_game_ends_at: null })
    expect(weekBounds([{ ...G1_ROW, status: 'postponed' }], null, now, WEEK2_STARTS_AT)).toEqual({
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
 * L.E1.26 / F390 — yards allowed is the ONE surface column whose absence is
 * written as NULL ("not delivered"), never 0, and whose NULL the diff tells
 * apart from a delivered 0. Every other column keeps D303(5)'s rule.
 * Lines: the recorded real week-2 BUF D/ST line (355 yards) through the
 * production map, and the live ARI row that carried no `yds_allow`.
 */
describe('L.E1.26 — def_yards_allowed: absent is NULL, never 0 (F390)', () => {
  const DST_LINE: ProviderPlayerWeekStats = {
    playerId: 'BUF',
    season: 2026,
    week: 2,
    gameId: '2026-wk02-DAL@PHI',
    // BUF 2026 wk2 through SLEEPER_STAT_KEY_MAP (the recorded fixture's values).
    stats: { def_sack: 4, def_points_allowed: 31, def_yards_allowed: 355 },
    advanced: {},
  }
  const { def_yards_allowed: _omit, ...withoutYards } = DST_LINE.stats
  void _omit
  const DST_NO_YARDS: ProviderPlayerWeekStats = { ...DST_LINE, stats: withoutYards }

  it('Y1 the NULL-is-pending column set is exactly def_yards_allowed (derived from the registry flag)', () => {
    expect([...NULL_IS_PENDING_COLUMNS]).toEqual(['def_yards_allowed'])
  })

  it('Y2 a delivered yards-allowed value is written as delivered: 355', () => {
    expect(toStatRow(DST_LINE, CTX).row!.columns.def_yards_allowed).toBe(355)
  })

  it('Y3 a D/ST line WITHOUT yards allowed writes NULL — not 0 — and every other absent column still writes 0', () => {
    const row = toStatRow(DST_NO_YARDS, CTX).row!
    expect(row.columns.def_yards_allowed).toBeNull()
    expect(row.columns.def_points_allowed).toBe(31)
    expect(row.columns.def_interceptions).toBe(0) // absent → 0, unchanged (D303(5))
    expect(Object.keys(row.columns).sort()).toEqual([...STAT_COLUMN_SURFACE]) // still the whole surface
    // A QB line never carries yards allowed: NULL there too (a QB never reads it — deliveredLine scopes it out).
    expect(toStatRow(QB_LINE, CTX).row!.columns.def_yards_allowed).toBeNull()
  })

  it('Y4 a delivered ZERO stays 0 (distinct from not delivered)', () => {
    expect(toStatRow({ ...DST_LINE, stats: { ...DST_LINE.stats, def_yards_allowed: 0 } }, CTX).row!.columns.def_yards_allowed).toBe(0)
  })

  it('Y5 diff: stored NULL vs incoming NULL is unchanged — no phantom delta on every poll', () => {
    const noYards = toStatRow(DST_NO_YARDS, CTX).row!
    expect(diffStats([noYards], new Map([['BUF', toStatRow(DST_NO_YARDS, CTX).row!]])).unchanged).toBe(1)
  })

  it('Y6 diff: stored NULL → incoming 355 is a SCORING delta (the value arrived — enqueue)', () => {
    const prior = toStatRow(DST_NO_YARDS, CTX).row!
    const now = toStatRow(DST_LINE, CTX).row!
    expect(diffStats([now], new Map([['BUF', prior]])).updates).toEqual([now])
  })

  it('Y7 diff: stored 0 (a pre-143 DEFAULT row) → incoming NULL is a SCORING delta — the phantom +5 must be rescored away', () => {
    const prior = toStatRow({ ...DST_LINE, stats: { ...DST_LINE.stats, def_yards_allowed: 0 } }, CTX).row!
    const now = toStatRow(DST_NO_YARDS, CTX).row!
    expect(diffStats([now], new Map([['BUF', prior]])).updates).toEqual([now])
    // …and the reverse (a withdrawn NULL → a delivered 0) too.
    expect(diffStats([prior], new Map([['BUF', now]])).updates).toEqual([prior])
  })

  it('Y8 every OTHER column keeps NULL ≡ 0: a stored NULL def_points_allowed vs an incoming 0 is no delta', () => {
    const now = toStatRow({ ...DST_NO_YARDS, stats: { def_sack: 4, def_points_allowed: 0 } }, CTX).row!
    const prior: StatRow = { ...now, columns: { ...now.columns } }
    delete prior.columns.def_points_allowed // a NULL read
    expect(diffStats([now], new Map([['BUF', prior]])).unchanged).toBe(1)
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
  // `starts_at` is NOT NULL in 039 and is Q50's floor anchor, so the fixture
  // carries it (week 1's Wednesday 00:00 ET, plus a week per row).
  const WEEK1_STARTS_MS = Date.parse('2026-09-09T04:00:00.000Z')
  return Array.from({ length: n }, (_, i) => ({
    season: 2026,
    week: i + 1,
    starts_at: new Date(WEEK1_STARTS_MS + i * 7 * 24 * 3600_000).toISOString(),
    first_kickoff_at: null,
    last_game_ends_at: null,
  }))
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

// ── M6 L.E2.1 — TD2's classification, driven through ingestWeek ───────────
//
// A STATEFUL in-memory world (the tables ingestWeek reads and writes, plus
// migration 167's door, which applies what it is sent and records it), so the
// table below runs the REAL poll — its reads, its diff, its call — poll after
// poll. What is pinned is what ingestWeek SENDS the door: each line's
// `enqueue` flag and the correction keys it names (the door's own arithmetic
// — old from the stored line, the natural key, the transaction — is pgTAP
// 115's). The break probe (rule 14): classify against the NEW game state
// (`merged`) instead of the stored one — the live → final cells (C2, W3) red.

/** The PGRST202 PostgREST answers for the door on a database at 166 — MEASURED on the local stack 2026-09-29 (curl, service role). */
const PRE_167_ANSWER = {
  code: 'PGRST202',
  details:
    'Searched for the function public.ingest_write_batch with parameters p_now, p_rows or with a single unnamed json/jsonb parameter, but no matches were found in the schema cache.',
  hint: null,
  message: 'Could not find the function public.ingest_write_batch(p_now, p_rows) in the schema cache',
}
/** …and for a DRIFTED call to the door that exists (measured on 167, the same day): the hint offers the real signature. */
const DRIFT_ANSWER = {
  code: 'PGRST202',
  details:
    'Searched for the function public.ingest_write_batch with parameter p_rows or with a single unnamed json/jsonb parameter, but no matches were found in the schema cache.',
  hint: 'Perhaps you meant to call the function public.ingest_write_batch(p_now, p_rows)',
  message: 'Could not find the function public.ingest_write_batch(p_rows) in the schema cache',
}

interface DoorElement {
  stat: Record<string, unknown>
  enqueue: boolean
  corrections: Array<{ stat_key: string; column?: string; advanced?: true }>
}
type Row = Record<string, unknown>
type Op = { kind: 'select' } | { kind: 'upsert'; rows: Row[] } | { kind: 'update'; patch: Row }

class World {
  games = new Map<string, Row>()
  weeks: Row[] = weekRows(18)
  players: Row[]
  stats = new Map<string, Row>()
  queue = new Map<string, Row>()
  doorCalls: Array<{ fn: string; p_rows: DoorElement[]; p_now: string }> = []
  /** The error the door answers with (null = 167 is pushed). */
  doorError: Row | null = null
  /** The two-call path's writes, in order (the pre-167 fallback). */
  twoCall: string[] = []

  constructor(playerIds: string[]) {
    this.players = playerIds.map((id) => ({ id }))
  }

  client(): SyncClient {
    return { from: (table: string) => this.query(table), rpc: (fn: string, args: Row) => this.rpc(fn, args) } as unknown as SyncClient
  }

  private rows(table: string): Row[] {
    if (table === 'nfl_games') return [...this.games.values()]
    if (table === 'nfl_weeks') return this.weeks
    if (table === 'players') return this.players
    if (table === 'player_stats') return [...this.stats.values()]
    if (table === 'score_fanout') return [...this.queue.values()]
    throw new Error(`world: unexpected table ${table}`)
  }

  private query(table: string) {
    const filters: Array<[string, unknown]> = []
    let op: Op = { kind: 'select' }
    const builder: Record<string, unknown> = {}
    builder.select = () => builder
    builder.order = () => builder
    builder.range = () => builder
    builder.eq = (col: string, val: unknown) => {
      filters.push([col, val])
      return builder
    }
    builder.upsert = (rows: Row[]) => {
      op = { kind: 'upsert', rows }
      return builder
    }
    builder.update = (patch: Row) => {
      op = { kind: 'update', patch }
      return builder
    }
    builder.then = (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) =>
      new Promise((res) => res(this.run(table, op, filters))).then(resolve, reject)
    return builder
  }

  private run(table: string, op: Op, filters: Array<[string, unknown]>) {
    if (op.kind === 'upsert') {
      for (const row of op.rows) {
        if (table === 'nfl_games') this.games.set(String(row.id), { ...row })
        else if (table === 'player_stats') this.stats.set(String(row.player_id), { ...this.stats.get(String(row.player_id)), ...row })
        else if (table === 'score_fanout') this.queue.set(String(row.player_id), { ...row })
        else throw new Error(`world: unexpected upsert into ${table}`)
      }
      if (table !== 'nfl_games') this.twoCall.push(table)
      return { data: op.rows, error: null }
    }
    const matched = this.rows(table).filter((r) => filters.every(([c, v]) => r[c] === v))
    if (op.kind === 'update') {
      for (const r of matched) Object.assign(r, op.patch)
      return { data: matched, error: null }
    }
    return { data: matched, error: null, count: matched.length }
  }

  private async rpc(fn: string, args: Row) {
    const p_rows = args.p_rows as DoorElement[]
    const p_now = String(args.p_now)
    this.doorCalls.push({ fn, p_rows, p_now })
    if (this.doorError !== null) return { data: null, error: this.doorError }
    let enqueued = 0
    let restamped = 0
    let named = 0
    for (const e of p_rows) {
      const pid = String(e.stat.player_id)
      this.stats.set(pid, { ...e.stat, updated_at: p_now })
      if (e.enqueue) {
        if (this.queue.has(pid)) restamped += 1
        else enqueued += 1
        this.queue.set(pid, { season: e.stat.season, week: e.stat.week, player_id: pid, enqueued_at: p_now, deferred_until: null })
      }
      named += e.corrections.length
    }
    const report = { stats_written: p_rows.length, enqueued, restamped, events_written: named, events_replayed: 0, events_unchanged: 0, week_state: named > 0 ? 'final' : null }
    return { data: report, error: null }
  }
}

const WK2_G1 = '2026-wk02-DAL@PHI'
const WK2_G3 = '2026-wk02-SEA@SF'

function wk2Game(id: string, status: ProviderGame['status']): ProviderGame {
  const g1 = id === WK2_G1
  return {
    gameId: id,
    season: 2026,
    week: 2,
    homeTeam: g1 ? 'PHI' : 'SF',
    awayTeam: g1 ? 'DAL' : 'SEA',
    kickoffAt: new Date(g1 ? '2026-09-20T17:00:00Z' : '2026-09-21T00:20:00Z'),
    gameDate: '2026-09-20',
    status,
  }
}

/** A provider whose schedule and lines the table sets before each poll. */
function scripted(name = 'fixture') {
  const state = { name, games: [] as ProviderGame[], lines: [] as ProviderPlayerWeekStats[] }
  const provider: StatsProvider = {
    get name() {
      return state.name
    },
    capabilities: new Set(['core_box']),
    getSchedule: async () => state.games,
    getGameStates: async () => [],
    getWeekStats: async () => state.lines,
    getInjuries: async () => [],
    getInactives: async () => [],
  }
  return { state, provider }
}

function wk2Line(playerId: string, gameId: string | undefined, stats: Record<string, number>): ProviderPlayerWeekStats {
  return { playerId, season: 2026, week: 2, ...(gameId === undefined ? {} : { gameId }), stats, advanced: {} }
}

/** What the door was sent on the LAST call: per player, its enqueue flag and the keys it names. */
function lastSent(world: World): Record<string, { enqueue: boolean; corrections: DoorElement['corrections'] }> {
  const call = world.doorCalls.at(-1)!
  return Object.fromEntries(call.p_rows.map((e) => [String(e.stat.player_id), { enqueue: e.enqueue, corrections: e.corrections }]))
}

function storedGame(id: string): Row {
  const g = toGameRow(wk2Game(id, 'final'))!
  return { ...g }
}

describe('L.E2.1 — TD2: what a correction is, poll after poll through the real ingestWeek (the classification table)', () => {
  it('C1–C8 — a line WITH its game id: live → final → corrected → corrected again; metaOnly; a gap filled late; an identical re-poll', async () => {
    const world = new World(['p-wr', 'p-te', 'p-k'])
    const { state, provider } = scripted()
    const clock = new VirtualClock(new Date('2026-09-20T18:00:00Z'))
    const deps = { db: world.client(), degradation: new DegradationTracker(), season: 2026, week: 2 }
    const poll = async (iso: string) => {
      clock.advanceTo(new Date(iso))
      return ingestWeek(provider, clock, deps)
    }

    // C1 — Sunday, G1 LIVE: a first line of a live game is an ordinary delta.
    state.games = [wk2Game(WK2_G1, 'live'), wk2Game(WK2_G3, 'scheduled')]
    state.lines = [wk2Line('p-wr', WK2_G1, { receptions: 3, receiving_yards: 40 })]
    const c1 = await poll('2026-09-20T18:00:00Z')
    expect(lastSent(world)).toEqual({ 'p-wr': { enqueue: true, corrections: [] } })
    expect([c1.write.path, c1.corrections.detected, c1.corrections.reason]).toEqual([
      'door',
      0,
      '1 scoring delta(s), none to a line whose game was final before this poll — ordinary live deltas, no correction',
    ])

    // C2 — THE PROBE'S CELL: this poll is the one that first sees G1 FINAL, and it carries the last in-game
    // change. The stored state BEFORE this poll says live, so it is NOT a correction (against `merged` it would be).
    state.games = [wk2Game(WK2_G1, 'final'), wk2Game(WK2_G3, 'live')]
    state.lines = [wk2Line('p-wr', WK2_G1, { receptions: 3, receiving_yards: 52 })]
    const c2 = await poll('2026-09-20T20:30:00Z')
    expect(lastSent(world)).toEqual({ 'p-wr': { enqueue: true, corrections: [] } })
    expect(c2.corrections.detected).toBe(0)

    // C3 — G1 final (stored); G3 still live: a live game's first line is no correction; the final game's unchanged line is not re-sent.
    state.lines = [wk2Line('p-wr', WK2_G1, { receptions: 3, receiving_yards: 52 }), wk2Line('p-te', WK2_G3, { receptions: 1, receiving_yards: 9 })]
    const c3 = await poll('2026-09-21T01:00:00Z')
    expect(lastSent(world)).toEqual({ 'p-te': { enqueue: true, corrections: [] } })
    expect(c3.corrections.detected).toBe(0)

    // C4 — Tuesday, every game final: the provider takes 2 yards off p-wr. ONE key, old → new.
    state.games = [wk2Game(WK2_G1, 'final'), wk2Game(WK2_G3, 'final')]
    state.lines = [wk2Line('p-wr', WK2_G1, { receptions: 3, receiving_yards: 50 }), wk2Line('p-te', WK2_G3, { receptions: 1, receiving_yards: 9 })]
    const c4 = await poll('2026-09-22T16:00:00Z')
    expect(lastSent(world)).toEqual({
      'p-wr': { enqueue: true, corrections: [{ stat_key: 'receiving_yards', column: 'receiving_yards' }] },
      // G3 flipped final since C3: p-te's `is_live` moved and nothing else — metaOnly, never a correction.
      'p-te': { enqueue: false, corrections: [] },
    })
    expect(c4.corrections).toEqual({
      detected: 1,
      players: 1,
      recorded: 1,
      replayed: 0,
      unchangedAtWrite: 0,
      weekState: 'final',
      keys: [{ player_id: 'p-wr', stat_key: 'receiving_yards', old: 52, new: 50 }],
      reason: '1 recorded',
    })
    expect(c4.reasons).toContain('stat_correction_events: 1 recorded for 1 player(s) (week final)')

    // C5 — corrected AGAIN (Wednesday): two keys move; old is the CORRECTED value, in registry order.
    state.lines = [wk2Line('p-wr', WK2_G1, { receptions: 4, receiving_yards: 49 }), wk2Line('p-te', WK2_G3, { receptions: 1, receiving_yards: 9 })]
    const c5 = await poll('2026-09-23T16:00:00Z')
    expect(lastSent(world)).toEqual({
      'p-wr': {
        enqueue: true,
        corrections: [
          { stat_key: 'receptions', column: 'receptions' },
          { stat_key: 'receiving_yards', column: 'receiving_yards' },
        ],
      },
    })
    expect(c5.corrections.keys).toEqual([
      { player_id: 'p-wr', stat_key: 'receptions', old: 3, new: 4 },
      { player_id: 'p-wr', stat_key: 'receiving_yards', old: 50, new: 49 },
    ])

    // C6 — metaOnly: the provider's NAME changes (F13) and nothing else — written, not enqueued, never a correction.
    state.name = 'fixture:renamed'
    const c6 = await poll('2026-09-23T17:00:00Z')
    expect(lastSent(world)).toEqual({ 'p-wr': { enqueue: false, corrections: [] }, 'p-te': { enqueue: false, corrections: [] } })
    expect([c6.stats.metaOnly, c6.corrections.detected, c6.corrections.reason]).toEqual([2, 0, 'no scoring delta — a metadata-only rewrite is never a correction'])

    // C7 — a gap filled late (F269(a)): a FIRST line for a player of a game final before this poll. Every
    // delivered key is a correction from NOTHING (old null), under the registry key — not the column (D33: pat_made ↔ xp_made).
    state.lines = [...state.lines, wk2Line('p-k', WK2_G1, { fg_made: 1, fg_attempted: 1, fg_0_39: 1, pat_made: 2, pat_attempted: 2 })]
    const c7 = await poll('2026-09-23T18:00:00Z')
    expect(lastSent(world)).toEqual({
      'p-k': {
        enqueue: true,
        corrections: [
          { stat_key: 'fg_0_39', column: 'fg_0_39' },
          { stat_key: 'pat_made', column: 'xp_made' },
          { stat_key: 'fg_made', column: 'fg_made' },
          { stat_key: 'fg_attempted', column: 'fg_attempted' },
          { stat_key: 'pat_attempted', column: 'xp_attempted' },
        ],
      },
    })
    expect(c7.corrections.keys.map((k) => [k.stat_key, k.old, k.new])).toEqual([
      ['fg_0_39', null, 1],
      ['pat_made', null, 2],
      ['fg_made', null, 1],
      ['fg_attempted', null, 1],
      ['pat_attempted', null, 2],
    ])

    // C8 — an identical re-poll: nothing to write, the door is not even called.
    const calls = world.doorCalls.length
    const c8 = await poll('2026-09-23T19:00:00Z')
    expect(world.doorCalls.length).toBe(calls)
    expect([c8.write.path, c8.corrections.detected, c8.corrections.reason]).toEqual(['none', 0, 'nothing written — no line to classify'])
    expect(world.twoCall).toEqual([]) // the door path never used the two-call writes
  })

  it('W1–W4 — production’s shape, a line WITHOUT a game id (F468(a)): the WEEK stands in — no correction until every game was final before the poll', async () => {
    const world = new World(['p-rb'])
    const { state, provider } = scripted('sleeper+nflverse')
    const clock = new VirtualClock(new Date('2026-09-20T18:00:00Z'))
    const deps = { db: world.client(), degradation: new DegradationTracker(), season: 2026, week: 2 }
    const poll = async (iso: string) => {
      clock.advanceTo(new Date(iso))
      return ingestWeek(provider, clock, deps)
    }
    // W1 — G1 live.
    state.games = [wk2Game(WK2_G1, 'live'), wk2Game(WK2_G3, 'scheduled')]
    state.lines = [wk2Line('p-rb', undefined, { rush_yards: 30 })]
    await poll('2026-09-20T18:00:00Z')
    expect(lastSent(world)).toEqual({ 'p-rb': { enqueue: true, corrections: [] } })
    // W2 — G1 final, G3 live: his (early) game is over, but the week is not — no correction yet.
    state.games = [wk2Game(WK2_G1, 'final'), wk2Game(WK2_G3, 'live')]
    state.lines = [wk2Line('p-rb', undefined, { rush_yards: 34 })]
    await poll('2026-09-21T01:00:00Z')
    expect(lastSent(world)).toEqual({ 'p-rb': { enqueue: true, corrections: [] } })
    // W3 — THE PROBE'S SECOND CELL: this poll first sees G3 final; the week was NOT all final before it.
    state.games = [wk2Game(WK2_G1, 'final'), wk2Game(WK2_G3, 'final')]
    state.lines = [wk2Line('p-rb', undefined, { rush_yards: 33 })]
    const w3 = await poll('2026-09-21T03:45:00Z')
    expect(lastSent(world)).toEqual({ 'p-rb': { enqueue: true, corrections: [] } })
    expect(w3.corrections.detected).toBe(0)
    // W4 — Tuesday: the week was all final before this poll — a correction.
    state.lines = [wk2Line('p-rb', undefined, { rush_yards: 31, rush_tds: 1 })]
    const w4 = await poll('2026-09-22T16:00:00Z')
    expect(w4.corrections.keys).toEqual([
      { player_id: 'p-rb', stat_key: 'rush_yards', old: 33, new: 31 },
      { player_id: 'p-rb', stat_key: 'rush_tds', old: 0, new: 1 },
    ])
  })

  it('F1 DEPLOY BEFORE PUSH — the measured pre-167 PGRST202: the pre-167 two-call path writes the lines and the queue (queue FIRST, R706), says so, records nothing', async () => {
    const world = new World(['p-wr'])
    world.doorError = PRE_167_ANSWER
    const { state, provider } = scripted()
    world.games.set(WK2_G1, storedGame(WK2_G1))
    world.games.set(WK2_G3, storedGame(WK2_G3))
    const blank = Object.fromEntries(STAT_COLUMN_SURFACE.map((c) => [c, NULL_IS_PENDING_COLUMNS.has(c) ? null : 0]))
    world.stats.set('p-wr', { player_id: 'p-wr', season: 2026, week: 2, game_id: WK2_G1, is_live: false, source: 'fixture', advanced: {}, ...blank, receptions: 3, receiving_yards: 52 })
    state.games = [wk2Game(WK2_G1, 'final'), wk2Game(WK2_G3, 'final')]
    state.lines = [wk2Line('p-wr', WK2_G1, { receptions: 3, receiving_yards: 50 })]
    const report = await ingestWeek(provider, new VirtualClock(new Date('2026-09-22T16:00:00Z')), { db: world.client(), degradation: new DegradationTracker(), season: 2026, week: 2 })
    expect(world.doorCalls.map((c) => c.fn)).toEqual(['ingest_write_batch']) // asked once, answered "no such function"
    expect(world.twoCall).toEqual(['score_fanout', 'player_stats']) // R706's order, unchanged
    expect(world.stats.get('p-wr')!.receiving_yards).toBe(50)
    expect(world.stats.get('p-wr')!.updated_at).toBe('2026-09-22T16:00:00.000Z')
    expect(world.queue.get('p-wr')!.enqueued_at).toBe('2026-09-22T16:00:00.000Z')
    expect(report.write).toEqual({ path: 'two_call_fallback', door: 'ingest_write_batch' })
    expect(report.stats).toMatchObject({ updated: 1, deltas: 1, enqueued: 1, restamped: 0 })
    expect([report.corrections.detected, report.corrections.recorded, report.corrections.reason]).toEqual([1, 0, '1 detected, NOT recorded — the database predates migration 167'])
    expect(report.reasons).toEqual([
      'nfl_games unchanged: 2 games identical to stored',
      'ingest_write_batch absent — the database predates migration 167 (PGRST202): the lines and the queue were written through the pre-167 two-call path (queue, then stats — R706); no stat_correction_events recorded',
      'stat_correction_events: 1 correction key(s) for 1 player(s) detected and NOT recorded — the table arrives with migration 167',
    ])
  })

  it('F2 a same-name DRIFT answer (the hint offers the real signature) is NOT "not pushed" — the poll throws and the two-call path writes nothing', async () => {
    const world = new World(['p-wr'])
    world.doorError = DRIFT_ANSWER
    const { state, provider } = scripted()
    state.games = [wk2Game(WK2_G1, 'live')]
    state.lines = [wk2Line('p-wr', WK2_G1, { receptions: 1 })]
    await expect(
      ingestWeek(provider, new VirtualClock(new Date('2026-09-20T18:00:00Z')), { db: world.client(), degradation: new DegradationTracker(), season: 2026, week: 2 }),
    ).rejects.toThrow('ingest_write_batch failed (2026 week 2, lines 1–1): Could not find the function public.ingest_write_batch(p_rows) in the schema cache')
    expect(world.twoCall).toEqual([])
    expect(world.stats.size).toBe(0)
  })

  it('F3 any other door refusal throws by name — never the quiet fallback', async () => {
    const world = new World(['p-wr'])
    world.doorError = { code: '22023', details: null, hint: null, message: 'ingest_write_batch: element 1 carries key(s) the door does not write: bogus' }
    const { state, provider } = scripted()
    state.games = [wk2Game(WK2_G1, 'live')]
    state.lines = [wk2Line('p-wr', WK2_G1, { receptions: 1 })]
    await expect(
      ingestWeek(provider, new VirtualClock(new Date('2026-09-20T18:00:00Z')), { db: world.client(), degradation: new DegradationTracker(), season: 2026, week: 2 }),
    ).rejects.toThrow('ingest_write_batch failed (2026 week 2, lines 1–1): ingest_write_batch: element 1 carries key(s) the door does not write: bogus')
    expect(world.twoCall).toEqual([])
  })
})

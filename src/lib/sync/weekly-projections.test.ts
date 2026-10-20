/**
 * weekly-projections — the pure layer + the run over a fake client, all
 * against the RECORDED Sleeper response (src/lib/sync/fixtures/
 * sleeper-weekly-projections-2026.json — its `_note` carries the measurement). ZERO
 * external calls (M0 rule): every fetch is the fixture.
 *
 * M6A L.E1.19; PROGRESS F379 / D373; tasks-M1 §4.3 floor — golden lines are
 * STORED LITERALS (not re-derived through the mapper they test), the plan's
 * boundaries are one-millisecond pairs (D146), and the zero-projection cell
 * is the task's named break probe (make it return success ⇒ it reds).
 *
 * Fix round (PR #314 review): R1104 — the fixture carries a FRACTIONAL
 * points-allowed DEF (PIT 17.5) and the stored line keeps it verbatim;
 * R1105 — the sharp-drop guard (sharp ⇒ nothing written or deleted, mild ⇒
 * only the stale deleted, first sync ⇒ unaffected, the half and floor
 * boundaries as pairs); R1106 — a short upsert / short delete count fails the
 * week by name (and a short upsert issues no delete); R1109 — a hung fetch
 * ends as a named per-position failure.
 *
 * D592 (live bug, SuperLeague v0.1 week 6): the hourly run also keeps
 * `players`' injury tags fresh — a tag is written, no tag clears ONLY an
 * injury tag back to Active, an unreported player is left, every change is
 * counted and named, a short update fails by name, a feed with no injury
 * field (or no tag at all while several are stored) refuses by name.
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import { STAT_KEYS } from '@/lib/leagues/stats/stat-keys'
import type { TimeProvider } from '@/lib/leagues/time/time-provider'

import type { SyncClient } from './types'
import {
  CLEARABLE_INJURY_TAGS,
  DROP_GUARD_MIN_STORED,
  FETCH_TIMEOUT_MS,
  INJURY_CLEAR_GUARD_MIN,
  injuryReportsOf,
  isClearableInjuryTag,
  isProjectedRow,
  makeSleeperWeeklyFetch,
  parseWeeklyProjections,
  planInjuryChanges,
  planProjectionWeeks,
  sharpDrops,
  sleeperWeeklyProjectionsUrl,
  syncWeeklyProjections,
  WEEKLY_PROJECTION_POSITIONS,
  type FetchWeeklyProjections,
  type InjuryFields,
  type InjuryReport,
  type PositionCounts,
  type ProjectionCalendarWeek,
  type StoredLine,
  type WeeklyProjectionPosition,
} from './weekly-projections'

type Row = { player_id: string; week: number; stats: Record<string, number>; updated_at?: number; player: Record<string, unknown> }
const FIXTURE = JSON.parse(
  readFileSync(fileURLToPath(new URL('./fixtures/sleeper-weekly-projections-2026.json', import.meta.url)), 'utf8'),
) as { season: number; weeks: Record<string, Partial<Record<WeeklyProjectionPosition, Row[]>>> }
const WEEK4 = FIXTURE.weeks['4'] as Record<WeeklyProjectionPosition, Row[]>
const WEEK19_QB = FIXTURE.weeks['19'].QB as Row[]

const FETCHED_AT = '2026-09-27T12:40:00.000Z'
const ALL_IDS = new Set(WEEKLY_PROJECTION_POSITIONS.flatMap((p) => WEEK4[p].map((r) => r.player_id)))

function week4Responses(): Record<WeeklyProjectionPosition, unknown> {
  return structuredClone(WEEK4)
}

// The 2026 calendar as 039 seeds it (weeks 3, 4, 17, 18 — enough for every boundary).
const CAL: ProjectionCalendarWeek[] = [
  { season: 2026, week: 1, starts_at: '2026-09-09T04:00:00+00:00', correction_window_ends_at: '2026-09-17T10:00:00+00:00' },
  { season: 2026, week: 2, starts_at: '2026-09-16T04:00:00+00:00', correction_window_ends_at: '2026-09-24T10:00:00+00:00' },
  { season: 2026, week: 3, starts_at: '2026-09-23T04:00:00+00:00', correction_window_ends_at: '2026-10-01T10:00:00+00:00' },
  { season: 2026, week: 4, starts_at: '2026-09-30T04:00:00+00:00', correction_window_ends_at: '2026-10-08T10:00:00+00:00' },
  { season: 2026, week: 17, starts_at: '2026-12-30T05:00:00+00:00', correction_window_ends_at: '2027-01-07T11:00:00+00:00' },
  { season: 2026, week: 18, starts_at: '2027-01-06T05:00:00+00:00', correction_window_ends_at: '2027-01-14T11:00:00+00:00' },
]
const at = (iso: string) => new Date(iso)
const ms = (iso: string, delta: number) => new Date(Date.parse(iso) + delta)

// ---------------------------------------------------------------------------
// 0. The recorded fixture's premise, BY VALUE (§4 rule 14(c))
// ---------------------------------------------------------------------------
describe('the recorded fixture (premise)', () => {
  it('holds, per position, the projected rows and FILLER rows the real endpoint returns', () => {
    const shape = Object.fromEntries(
      WEEKLY_PROJECTION_POSITIONS.map((p) => [p, [WEEK4[p].length, WEEK4[p].filter((r) => isProjectedRow(r.stats)).length]]),
    )
    expect(shape).toEqual({ QB: [5, 3], RB: [5, 4], WR: [4, 3], TE: [3, 2], K: [3, 2], DEF: [3, 3] })
    // a filler row is exactly the measured shape — Sleeper's "not projected" placeholder
    expect(WEEK4.QB[3].stats).toEqual({ adp_dd_ppr: 1000 })
    expect(WEEK19_QB.map((r) => r.stats)).toEqual([{ adp_dd_ppr: 1000 }, { adp_dd_ppr: 1000 }])
    expect(WEEK19_QB.every((r) => r.week === 19)).toBe(true)
  })

  it('R1104 premise: Sleeper projects FRACTIONAL points allowed — the recorded DEFs include one (PIT 17.5) beside two integers', () => {
    expect(WEEK4.DEF.map((r) => [r.player_id, r.stats.pts_allow])).toEqual([['MIN', 16], ['BAL', 17], ['PIT', 17.5]])
    expect(WEEK4.DEF.filter((r) => !Number.isInteger(r.stats.pts_allow)).map((r) => r.player_id)).toEqual(['PIT'])
  })

  it('the endpoint is the season URL plus /{week} (verified 2026-09-27)', () => {
    expect(sleeperWeeklyProjectionsUrl(2026, 4, 'DEF')).toBe(
      'https://api.sleeper.com/projections/nfl/2026/4?season_type=regular&position[]=DEF',
    )
  })
})

// ---------------------------------------------------------------------------
// 1. Parse — the canonical line (D33), verbatim raw, the real zero
// ---------------------------------------------------------------------------
describe('parseWeeklyProjections — the recorded week 4', () => {
  const parsed = parseWeeklyProjections({ season: 2026, week: 4, responses: week4Responses(), known: ALL_IDS, fetchedAt: FETCHED_AT })

  it('stores exactly the 17 PROJECTED rows; the 6 filler rows are counted, never stored', () => {
    expect(parsed.failures).toEqual([])
    expect(parsed.rows.map((r) => r.player_id)).toEqual([
      '4984', '4881', '5849', '9221', '6813', '9509', '13300', '9488', '9493', '7547', '8130', '11604', '12185', '3451', 'MIN', 'BAL', 'PIT',
    ])
    expect(parsed.perPosition).toEqual({
      QB: { rows: 5, projected: 3, filler: 2 },
      RB: { rows: 5, projected: 4, filler: 1 },
      WR: { rows: 4, projected: 3, filler: 1 },
      TE: { rows: 3, projected: 2, filler: 1 },
      K: { rows: 3, projected: 2, filler: 1 },
      DEF: { rows: 3, projected: 3, filler: 0 },
    })
    expect(parsed.unknown).toEqual([])
    expect(parsed.duplicates).toEqual([])
  })

  it('GOLDEN — Josh Allen, Spencer Shrader (K) and the Vikings (DEF), canonical lines as stored literals', () => {
    const by = new Map(parsed.rows.map((r) => [r.player_id, r]))
    expect(by.get('4984')).toEqual({
      season: 2026,
      week: 4,
      player_id: '4984',
      stats: {
        pass_attempts: 31.94, pass_completions: 20.34, pass_yards: 241.87, pass_tds: 1.59, interceptions: 0.48,
        qb_sack_taken: 2.77, pass_2pt: 0.1, rush_attempts: 7.87, rush_yards: 37.34, rush_tds: 0.68, rush_2pt: 0.05,
        fumbles_lost: 0.2,
      },
      raw_stats: WEEK4.QB[0].stats,
      source: 'sleeper',
      source_updated_at: '2026-09-24T23:45:51.844Z',
      fetched_at: FETCHED_AT,
    })
    expect(by.get('12185')?.stats).toEqual({
      fg_made: 1.9, fg_attempted: 2.29, fg_40_49: 0.59, fg_50_plus: 0.39, pat_made: 2.62, pat_attempted: 2.69, pat_missed: 0.07,
    })
    // L.E1.26 (F390): the one map gained `yds_allow` → def_yards_allowed, so
    // the projected line now carries Sleeper's projected yards allowed
    // verbatim (fractional — floored for the tier by player-values, D374(4)).
    expect(by.get('MIN')?.stats).toEqual({ def_sack: 3.17, def_int: 0.94, def_fumble_rec: 0.72, def_td: 0.14, def_points_allowed: 16, def_yards_allowed: 300.39 })
  })

  it('R1104 GOLDEN — a FRACTIONAL points allowed is stored VERBATIM (PIT 17.5 — never rounded to 17 or 18)', () => {
    const pit = parsed.rows.find((r) => r.player_id === 'PIT')
    expect(pit?.stats).toEqual({ def_sack: 2.84, def_int: 0.88, def_fumble_rec: 0.61, def_td: 0.14, def_points_allowed: 17.5, def_yards_allowed: 296.73 }) // yards: L.E1.26
    expect(pit?.raw_stats.pts_allow).toBe(17.5)
  })

  it('a REAL projected zero is a row (Le\'Veon Moss, pts 0) — delivered zero, not absence', () => {
    const moss = parsed.rows.find((r) => r.player_id === '13300')
    expect(moss?.stats).toEqual({ receiving_tds: 0 })
    expect(moss?.raw_stats.pts_ppr).toBe(0)
  })

  it('ONE namespace (D33): every stored key is a canonical STAT_KEYS key; no legacy research key, no source points', () => {
    const canonical = new Set(STAT_KEYS.map((k) => k.key))
    const keys = new Set(parsed.rows.flatMap((r) => Object.keys(r.stats)))
    expect([...keys].filter((k) => !canonical.has(k))).toEqual([])
    for (const legacy of ['xp_made', 'two_point_conversions', 'def_sacks', 'def_interceptions', 'fg_made_40_plus', 'pts_ppr', 'pts_std', 'pts_half_ppr']) {
      expect(keys.has(legacy), legacy).toBe(false)
    }
  })

  it('raw_stats is the source object VERBATIM (every row)', () => {
    const rawById = new Map(WEEKLY_PROJECTION_POSITIONS.flatMap((p) => WEEK4[p].map((r) => [r.player_id, r.stats] as const)))
    for (const row of parsed.rows) expect(row.raw_stats).toEqual(rawById.get(row.player_id))
  })
})

// ---------------------------------------------------------------------------
// 2. Loud emptiness — THE task's cells
// ---------------------------------------------------------------------------
describe('zero projections is an ERROR, never a success', () => {
  it('ZERO-ROWS CELL: a week of nothing but filler (the recorded week-19 shape) fails EVERY position and stores nothing', () => {
    const filler = Object.fromEntries(WEEKLY_PROJECTION_POSITIONS.map((p) => [p, structuredClone(WEEK19_QB).map((r) => ({ ...r, week: 4 }))])) as Record<WeeklyProjectionPosition, unknown>
    const parsed = parseWeeklyProjections({ season: 2026, week: 4, responses: filler, known: ALL_IDS, fetchedAt: FETCHED_AT })
    expect(parsed.rows).toEqual([])
    expect(parsed.failures).toHaveLength(6)
    expect(parsed.failures[0]).toBe(
      'week 4 QB: ZERO projected rows (2 row(s), 2 filler) — every real week projects every position, so this is a partial or empty response; nothing written for the week',
    )
  })

  it('…an empty ARRAY is the same failure (0 rows, 0 filler)', () => {
    const empty = Object.fromEntries(WEEKLY_PROJECTION_POSITIONS.map((p) => [p, []])) as Record<WeeklyProjectionPosition, unknown>
    const parsed = parseWeeklyProjections({ season: 2026, week: 4, responses: empty, known: ALL_IDS, fetchedAt: FETCHED_AT })
    expect(parsed.failures.map((f) => f.slice(0, 32))).toEqual(WEEKLY_PROJECTION_POSITIONS.map((p) => `week 4 ${p}: ZERO projected rows (0`.slice(0, 32)))
  })

  it('PARTIAL: one position empty (DEF) fails the WEEK by name — the other five do not get written either', () => {
    const r = week4Responses()
    r.DEF = []
    const parsed = parseWeeklyProjections({ season: 2026, week: 4, responses: r, known: ALL_IDS, fetchedAt: FETCHED_AT })
    expect(parsed.failures).toEqual([
      'week 4 DEF: ZERO projected rows (0 row(s), 0 filler) — every real week projects every position, so this is a partial or empty response; nothing written for the week',
    ])
    expect(parsed.rows).toHaveLength(14) // parsed, but the run writes nothing when failures is non-empty (§3 below)
  })

  it('a non-array body and a misrouted week are failures by name', () => {
    const r = week4Responses()
    r.K = { error: 'rate limited' }
    ;(r.QB as Row[])[0] = { ...(r.QB as Row[])[0], week: 3 }
    const parsed = parseWeeklyProjections({ season: 2026, week: 4, responses: r, known: ALL_IDS, fetchedAt: FETCHED_AT })
    expect(parsed.failures).toEqual([
      'week 4 QB: player 4984 came back labelled week 3 — a misrouted response, nothing written for the week',
      'week 4 K: the response is not an array (object) — nothing written for the week',
    ])
  })
})

describe('unknown Sleeper ids are COUNTED and NAMED, never silently dropped', () => {
  it('two projected players missing from `players` are excluded from the write and named with who they are', () => {
    const known = new Set([...ALL_IDS].filter((id) => id !== '9488' && id !== 'BAL'))
    const parsed = parseWeeklyProjections({ season: 2026, week: 4, responses: week4Responses(), known, fetchedAt: FETCHED_AT })
    expect(parsed.failures).toEqual([])
    expect(parsed.unknown).toEqual([
      { player_id: '9488', label: '9488 (Jaxon Smith-Njigba WR SEA)' },
      { player_id: 'BAL', label: 'BAL (Baltimore Ravens DEF BAL)' },
    ])
    expect(parsed.rows.map((r) => r.player_id)).not.toContain('9488')
    expect(parsed.rows).toHaveLength(15)
  })

  it('a filler row for an unknown id is NOT an unknown projection (nothing was projected)', () => {
    const known = new Set([...ALL_IDS].filter((id) => id !== '3957'))
    const parsed = parseWeeklyProjections({ season: 2026, week: 4, responses: week4Responses(), known, fetchedAt: FETCHED_AT })
    expect(parsed.unknown).toEqual([])
  })

  it('a player projected twice in a week is counted as a duplicate (first kept)', () => {
    const r = week4Responses()
    ;(r.TE as Row[]).push(structuredClone(WEEK4.TE[0]))
    const parsed = parseWeeklyProjections({ season: 2026, week: 4, responses: r, known: ALL_IDS, fetchedAt: FETCHED_AT })
    expect(parsed.duplicates).toEqual(['8130'])
    expect(parsed.rows.filter((x) => x.player_id === '8130')).toHaveLength(1)
  })
})

// ---------------------------------------------------------------------------
// 3. The plan — from nfl_weeks at the injected instant (§23.3), D146 pairs
// ---------------------------------------------------------------------------
describe('planProjectionWeeks', () => {
  it('one millisecond before week 4 opens it is week 3 (+ next 4); AT the instant it is week 4 (+ next 17 in this trimmed calendar)', () => {
    expect(planProjectionWeeks(CAL, ms('2026-09-30T04:00:00+00:00', -1)).weeks).toEqual([3, 4])
    expect(planProjectionWeeks(CAL, at('2026-09-30T04:00:00+00:00')).weeks).toEqual([4, 17])
  })

  it('before the season: week 1 (clamped) and week 2, said so', () => {
    const plan = planProjectionWeeks(CAL, at('2026-08-01T00:00:00Z'))
    expect(plan).toEqual({ weeks: [1, 2], currentWeek: 1, reason: 'before the season — week 1 (clamped) and the next, week 2', seasonComplete: false })
  })

  it('the last week projects alone; one ms before its correction window closes it still does, AT the close the season is complete (named, empty)', () => {
    expect(planProjectionWeeks(CAL, at('2027-01-10T18:00:00Z')).weeks).toEqual([18])
    expect(planProjectionWeeks(CAL, ms('2027-01-14T11:00:00+00:00', -1)).weeks).toEqual([18])
    const done = planProjectionWeeks(CAL, at('2027-01-14T11:00:00+00:00'))
    expect(done.weeks).toEqual([])
    expect(done.seasonComplete).toBe(true)
    expect(done.reason).toBe("season complete: past week 18's correction window (2027-01-14T11:00:00+00:00) — no week left to project")
  })

  it('an empty calendar plans nothing and says why (NOT season-complete)', () => {
    expect(planProjectionWeeks([], at('2026-09-27T00:00:00Z'))).toEqual({
      weeks: [],
      currentWeek: null,
      reason: 'no nfl_weeks rows for the season — nothing to plan (the calendar is empty)',
      seasonComplete: false,
    })
  })
})

// ---------------------------------------------------------------------------
// 4. The run over a fake client — a failed week WRITES NOTHING
// ---------------------------------------------------------------------------
interface Call { table: string; op: string; args: unknown[] }

/** Stored lines as the sync reads them: `player_id` + the embedded `players.position`. */
const st = (position: string, ...ids: string[]): StoredLine[] => ids.map((player_id) => ({ player_id, position }))

/** A stored `players` row's injury fields, as the D592 read returns them. */
type StoredInjury = InjuryFields & { id: string }
/** One `players` UPDATE as the fake saw it: the value set and the ids it named. */
interface PlayerUpdate { fields: Record<string, unknown>; opts: unknown; ids: string[] }

/** A fake client. `short` lets a cell make the upsert / delete / players update
 *  report fewer rows than it was sent (R1106; D592). `players` is the stored
 *  injury state the D592 read sees (filtered by its `in.(…)` ids). */
function fakeDb(
  calendar: ProjectionCalendarWeek[],
  stored: StoredLine[] = [],
  short: { upsert?: (sent: number) => number; delete?: (named: number) => number; update?: (named: number) => number } = {},
  players: StoredInjury[] = [],
): { db: SyncClient; calls: Call[]; updates: PlayerUpdate[] } {
  const calls: Call[] = []
  const updates: PlayerUpdate[] = []
  const db = {
    from(table: string) {
      let op = 'select'
      let payload: unknown[] = []
      let fields: Record<string, unknown> = {}
      let opts: unknown
      const b = {
        select: (...args: unknown[]) => { calls.push({ table, op: 'select', args }); return b },
        eq: () => b,
        order: () => b,
        range: () => b,
        in: (_c: string, ids: unknown[]) => {
          payload = ids
          calls.push({ table, op: 'in', args: [ids] })
          if (op === 'update') updates.push({ fields, opts, ids: ids as string[] })
          return b
        },
        upsert: (rows: unknown[], ...args: unknown[]) => { op = 'upsert'; payload = rows; calls.push({ table, op, args: [rows, ...args] }); return b },
        delete: (...args: unknown[]) => { op = 'delete'; calls.push({ table, op, args }); return b },
        update: (f: Record<string, unknown>, o: unknown) => { op = 'update'; fields = f; opts = o; calls.push({ table, op, args: [f, o] }); return b },
        then(resolve: (v: unknown) => void) {
          if (table === 'nfl_weeks') return resolve({ data: calendar, error: null })
          if (op === 'upsert') return resolve({ data: null, error: null, count: (short.upsert ?? ((n) => n))(payload.length) })
          if (op === 'delete') return resolve({ data: null, error: null, count: (short.delete ?? ((n) => n))(payload.length) })
          if (op === 'update') return resolve({ data: null, error: null, count: (short.update ?? ((n) => n))(payload.length) })
          if (table === 'players') return resolve({ data: players.filter((p) => payload.includes(p.id)), error: null })
          return resolve({ data: stored.map((s) => ({ player_id: s.player_id, players: { position: s.position } })), error: null, count: stored.length })
        },
      }
      return b
    },
  }
  return { db: db as unknown as SyncClient, calls, updates }
}

const T: TimeProvider = { now: () => at('2026-09-27T12:40:00Z') }
const writes = (calls: Call[]) => calls.filter((c) => c.table === 'player_weekly_projections' && (c.op === 'upsert' || c.op === 'delete'))

describe('syncWeeklyProjections — the run', () => {
  it('ZERO-ROWS CELL (the run): an all-filler week is a FAILED run (ok false), named, and NOTHING is written', async () => {
    const { db, calls } = fakeDb(CAL)
    const report = await syncWeeklyProjections(
      { db, time: T, knownPlayerIds: async () => new Set(ALL_IDS), fetchWeek: async (_s, w) => structuredClone(WEEK19_QB).map((r) => ({ ...r, week: w })) },
      { season: 2026 },
    )
    expect(report.plan.weeks).toEqual([3, 4])
    expect(report.ok).toBe(false)
    expect(report.counts).toEqual({
      weeks: 2, projected: 0, stored: 0, removed: 0, unknownPlayer: 0, duplicates: 0, failedWeeks: 2,
      injuryChecked: 0, injuryTagged: 0, injuryCleared: 0, injuryDetail: 0,
    })
    expect(report.failures).toHaveLength(12)
    expect(writes(calls)).toEqual([])
  })

  it('a clean week lands: 17 stored in ONE upsert, the stale row removed, counts by value', async () => {
    const { db, calls } = fakeDb(CAL, st('QB', '4984', 'ghost-1'))
    const report = await syncWeeklyProjections(
      { db, time: T, knownPlayerIds: async () => new Set(ALL_IDS), fetchWeek: async (_s, w, p) => (WEEK4[p] as Row[]).map((r) => ({ ...structuredClone(r), week: w })) },
      { season: 2026, weeks: [4] },
    )
    expect(report.failures).toEqual([])
    expect(report.ok).toBe(true)
    expect(report.counts).toEqual({
      weeks: 1, projected: 17, stored: 17, removed: 1, unknownPlayer: 0, duplicates: 0, failedWeeks: 0,
      injuryChecked: 0, injuryTagged: 0, injuryCleared: 0, injuryDetail: 0,
    })
    const w = writes(calls)
    expect(w.map((c) => c.op)).toEqual(['upsert', 'delete'])
    expect(w[0].args[1]).toEqual({ onConflict: 'season,week,player_id', count: 'exact' })
  })

  it('a fetch failure on ONE position fails that week by name and writes nothing for it', async () => {
    const { db, calls } = fakeDb(CAL)
    const report = await syncWeeklyProjections(
      {
        db,
        time: T,
        knownPlayerIds: async () => new Set(ALL_IDS),
        fetchWeek: async (_s, w, p) => {
          if (p === 'WR') throw new Error('HTTP 503 Service Unavailable')
          return (WEEK4[p] as Row[]).map((r) => ({ ...structuredClone(r), week: w }))
        },
      },
      { season: 2026, weeks: [4] },
    )
    expect(report.ok).toBe(false)
    expect(report.failures).toEqual(['week 4 WR: fetch failed — HTTP 503 Service Unavailable; nothing written for the week'])
    expect(writes(calls)).toEqual([])
  })

  it('a week not in nfl_weeks is refused by name, never fetched', async () => {
    const { db } = fakeDb(CAL)
    let fetched = 0
    const report = await syncWeeklyProjections(
      { db, time: T, knownPlayerIds: async () => new Set(ALL_IDS), fetchWeek: async () => { fetched++; return [] } },
      { season: 2026, weeks: [19] },
    )
    expect(fetched).toBe(0)
    expect(report.ok).toBe(false)
    expect(report.failures).toEqual(['week 19: not in nfl_weeks for season 2026 — the calendar decides which weeks exist (§23.3); nothing fetched'])
  })

  it('an EMPTY players table fails loudly instead of reporting every projection as unknown', async () => {
    const { db, calls } = fakeDb(CAL)
    const report = await syncWeeklyProjections(
      { db, time: T, knownPlayerIds: async () => new Set(), fetchWeek: async () => [] },
      { season: 2026 },
    )
    expect(report.ok).toBe(false)
    expect(report.failures).toEqual(['players is EMPTY — every projection would be an unknown id; run sync:players first (nothing fetched, nothing written)'])
    expect(writes(calls)).toEqual([])
  })

  it('past the season is a NAMED idle (ok, nothing fetched) — the one empty plan that is not a failure', async () => {
    const { db } = fakeDb(CAL)
    let fetched = 0
    const report = await syncWeeklyProjections(
      { db, time: { now: () => at('2027-02-01T00:00:00Z') }, knownPlayerIds: async () => new Set(ALL_IDS), fetchWeek: async () => { fetched++; return [] } },
      { season: 2026 },
    )
    expect(fetched).toBe(0)
    expect(report.ok).toBe(true)
    expect(report.plan.seasonComplete).toBe(true)
    expect(report.weeks).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// 5. R1105 — a degraded 200 that keeps ≥1 projected row per position must not
//    let the stale delete wipe the rest
// ---------------------------------------------------------------------------
const recordedWeek4: FetchWeeklyProjections = async (_s, w, p) => (WEEK4[p] as Row[]).map((r) => ({ ...structuredClone(r), week: w }))
const ghosts = (n: number) => Array.from({ length: n }, (_, i) => `ghost-${i + 1}`)
const QB_FRESH = ['4984', '4881', '5849'] // week 4's three projected QBs

describe('the sharp-drop guard (R1105) — pure', () => {
  const per = (projected: Partial<Record<WeeklyProjectionPosition, number>>) =>
    Object.fromEntries(
      WEEKLY_PROJECTION_POSITIONS.map((p) => [p, { rows: projected[p] ?? 30, projected: projected[p] ?? 30, filler: 0 }]),
    ) as Record<WeeklyProjectionPosition, PositionCounts>

  it('the floor is the measured-justified 5', () => {
    expect(DROP_GUARD_MIN_STORED).toBe(5)
  })

  it('HALF boundary pair: 3 fresh vs 6 stored (exactly half) proceeds; 3 fresh vs 7 stored (below half) fails by name', () => {
    expect(sharpDrops(4, per({ QB: 3 }), st('QB', ...ghosts(6)))).toEqual([])
    expect(sharpDrops(4, per({ QB: 3 }), st('QB', ...ghosts(7)))).toEqual([
      'week 4 QB: the fresh response projects 3 player(s) where 7 are stored — a drop below half reads as a degraded response, not the news; nothing written or deleted for the week',
    ])
  })

  it('FLOOR boundary pair: 1 fresh vs 4 stored is exempt (a stored set too small to be a real week); 2 fresh vs 5 stored fails', () => {
    expect(sharpDrops(4, per({ K: 1 }), st('K', ...ghosts(4)))).toEqual([])
    expect(sharpDrops(4, per({ K: 2 }), st('K', ...ghosts(5)))).toHaveLength(1)
  })

  it('first sync (nothing stored) never trips it, however small the fresh count', () => {
    expect(sharpDrops(4, per({ QB: 1, RB: 1, WR: 1, TE: 1, K: 1, DEF: 1 }), [])).toEqual([])
  })

  it('a stored line whose player has no position is not attributed (never counted against a position)', () => {
    expect(sharpDrops(4, per({ QB: 1 }), ghosts(40).map((player_id) => ({ player_id, position: null })))).toEqual([])
  })
})

describe('the sharp-drop guard (R1105) — the run', () => {
  it('SHARP DROP: 10 QBs stored, 3 fresh ⇒ ok:false, named, and NO upsert or delete is issued', async () => {
    const { db, calls } = fakeDb(CAL, [...st('QB', ...QB_FRESH, ...ghosts(7)), ...st('WR', '9488')])
    const report = await syncWeeklyProjections(
      { db, time: T, knownPlayerIds: async () => new Set(ALL_IDS), fetchWeek: recordedWeek4 },
      { season: 2026, weeks: [4] },
    )
    expect(report.ok).toBe(false)
    expect(report.failures).toEqual([
      'week 4 QB: the fresh response projects 3 player(s) where 10 are stored — a drop below half reads as a degraded response, not the news; nothing written or deleted for the week',
    ])
    expect(report.counts).toMatchObject({ projected: 17, stored: 0, removed: 0, failedWeeks: 1 })
    expect(writes(calls)).toEqual([])
  })

  it('MILD DROP: 5 QBs stored, 3 fresh ⇒ proceeds, and deletes ONLY the two stale lines', async () => {
    const { db, calls } = fakeDb(CAL, st('QB', ...QB_FRESH, 'ghost-1', 'ghost-2'))
    const report = await syncWeeklyProjections(
      { db, time: T, knownPlayerIds: async () => new Set(ALL_IDS), fetchWeek: recordedWeek4 },
      { season: 2026, weeks: [4] },
    )
    expect(report.failures).toEqual([])
    expect(report.counts).toMatchObject({ stored: 17, removed: 2, failedWeeks: 0 })
    expect(writes(calls).map((c) => c.op)).toEqual(['upsert', 'delete'])
    expect(calls.filter((c) => c.table === 'player_weekly_projections' && c.op === 'in').map((c) => c.args[0])).toEqual([['ghost-1', 'ghost-2']])
  })

  it('FIRST SYNC of a week (nothing stored) proceeds — no guard, nothing to delete', async () => {
    const { db, calls } = fakeDb(CAL, [])
    const report = await syncWeeklyProjections(
      { db, time: T, knownPlayerIds: async () => new Set(ALL_IDS), fetchWeek: recordedWeek4 },
      { season: 2026, weeks: [4] },
    )
    expect(report.ok).toBe(true)
    expect(report.counts).toMatchObject({ stored: 17, removed: 0 })
    expect(writes(calls).map((c) => c.op)).toEqual(['upsert'])
  })
})

// ---------------------------------------------------------------------------
// 6. R1106 — every write asserts its own row count (pinned)
// ---------------------------------------------------------------------------
describe('a short write is never "done" (R1106)', () => {
  it('the UPSERT reports one row short ⇒ ok:false, named, and NO delete is issued', async () => {
    const { db, calls } = fakeDb(CAL, st('QB', 'ghost-1'), { upsert: (n) => n - 1 })
    const report = await syncWeeklyProjections(
      { db, time: T, knownPlayerIds: async () => new Set(ALL_IDS), fetchWeek: recordedWeek4 },
      { season: 2026, weeks: [4] },
    )
    expect(report.ok).toBe(false)
    expect(report.failures).toEqual(['week 4 upsert wrote 16 row(s) for 17 sent — refusing to call that done'])
    expect(writes(calls).map((c) => c.op)).toEqual(['upsert'])
  })

  it('the stale DELETE reports zero rows for one named ⇒ ok:false, named', async () => {
    const { db, calls } = fakeDb(CAL, st('QB', 'ghost-1'), { delete: () => 0 })
    const report = await syncWeeklyProjections(
      { db, time: T, knownPlayerIds: async () => new Set(ALL_IDS), fetchWeek: recordedWeek4 },
      { season: 2026, weeks: [4] },
    )
    expect(report.ok).toBe(false)
    expect(report.failures).toEqual(['week 4 stale delete removed 0 row(s) for 1 named — refusing to call that done'])
    expect(writes(calls).map((c) => c.op)).toEqual(['upsert', 'delete'])
  })
})

// ---------------------------------------------------------------------------
// 7. R1109 — a hung fetch is a named per-position failure, not a stalled run
// ---------------------------------------------------------------------------
describe('the production fetch is bounded (R1109)', () => {
  it('the default bound is 15 s', () => {
    expect(FETCH_TIMEOUT_MS).toBe(15_000)
  })

  it('a fetch that never answers ends at the timeout as a NAMED failure for every position, and nothing is written', async () => {
    // Would answer `[]` after 1 s — far past the 20 ms bound — unless the signal aborts it first.
    const hanging = ((_url: string, init?: RequestInit) =>
      new Promise<Response>((resolve, reject) => {
        const t = setTimeout(() => resolve(new Response('[]')), 1000)
        init?.signal?.addEventListener('abort', () => {
          clearTimeout(t)
          reject(init.signal?.reason)
        })
      })) as unknown as typeof fetch
    const { db, calls } = fakeDb(CAL)
    const report = await syncWeeklyProjections(
      { db, time: T, knownPlayerIds: async () => new Set(ALL_IDS), fetchWeek: makeSleeperWeeklyFetch({ fetchImpl: hanging, timeoutMs: 20 }) },
      { season: 2026, weeks: [4] },
    )
    expect(report.ok).toBe(false)
    expect(report.failures).toEqual(
      [...WEEKLY_PROJECTION_POSITIONS].sort().map((p) => `week 4 ${p}: fetch failed — timed out after 20 ms (TimeoutError); nothing written for the week`),
    )
    expect(writes(calls)).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// 8. D592 — injury tags stay fresh from the hourly feed (Chris 2026-10-18:
//    "Injuries should not block roster moves and users are not required to
//    remove injured players from their lineups.")
// ---------------------------------------------------------------------------
const healthy = (over: Partial<InjuryReport> = {}): InjuryReport => ({
  tag: null,
  injury_body_part: null,
  injury_notes: null,
  injury_start_date: null,
  ...over,
})
const storedAs = (status: string | null, over: Partial<InjuryFields> = {}): InjuryFields => ({
  status,
  injury_body_part: null,
  injury_notes: null,
  injury_start_date: null,
  ...over,
})

describe('injuryReportsOf — the recorded week 4 (D592)', () => {
  it('every row of a KNOWN player reports — projected AND filler — with the feed\'s tags verbatim', () => {
    const { reports, noField } = injuryReportsOf(week4Responses(), ALL_IDS)
    expect(noField).toBe(0)
    expect(reports.size).toBe(23) // 17 projected + 6 filler
    expect(reports.get('9493')).toEqual({ tag: 'Doubtful', injury_body_part: 'Hip', injury_notes: 'Soreness', injury_start_date: null })
    expect(reports.get('11604')).toEqual({ tag: 'Questionable', injury_body_part: 'Knee - Meniscus', injury_notes: 'Surgery', injury_start_date: null })
    expect(reports.get('13300')).toEqual({ tag: 'NA', injury_body_part: 'Undisclosed', injury_notes: null, injury_start_date: null })
    // a filler row (Blake Sims, not projected) still reports: a player ruled out drops to filler
    expect(reports.get('3957')).toEqual(healthy())
    expect([...reports.values()].filter((r) => r.tag !== null)).toHaveLength(3)
  })

  it('an unknown id reports nothing; a row with no injury field (or a non-string one) says nothing and is counted', () => {
    const r = week4Responses()
    ;(r.QB as Row[])[0] = { ...(r.QB as Row[])[0], player: { first_name: 'Josh' } }
    ;(r.QB as Row[])[1] = { ...(r.QB as Row[])[1], player: { ...(r.QB as Row[])[1].player, injury_status: 7 } }
    const known = new Set([...ALL_IDS].filter((id) => id !== 'MIN'))
    const { reports, noField } = injuryReportsOf(r, known)
    expect(noField).toBe(2)
    expect(reports.has('4984')).toBe(false)
    expect(reports.has('4881')).toBe(false)
    expect(reports.has('MIN')).toBe(false)
    expect(reports.size).toBe(20)
  })

  it('blank strings are no tag; a start date is cut to the date', () => {
    const r = week4Responses()
    ;(r.K as Row[])[0] = {
      ...(r.K as Row[])[0],
      player: { injury_status: '  ', injury_body_part: '', injury_notes: ' Ankle sprain ', injury_start_date: '2026-10-12T00:00:00Z' },
    }
    const { reports } = injuryReportsOf(r, ALL_IDS)
    expect(reports.get('12185')).toEqual({ tag: null, injury_body_part: null, injury_notes: 'Ankle sprain', injury_start_date: '2026-10-12' })
  })
})

describe('planInjuryChanges — pure (D592)', () => {
  it('the clearable set is exactly the injury tags: Q, D, Out, IR, PUP, NFI, Sus / Suspended', () => {
    expect([...CLEARABLE_INJURY_TAGS].sort()).toEqual(['doubtful', 'ir', 'nfi', 'out', 'pup', 'questionable', 'sus', 'suspended'])
    for (const s of ['Questionable', 'Doubtful', 'Out', 'OUT', ' out ', 'IR', 'PUP', 'NFI', 'Sus', 'Suspended']) expect(isClearableInjuryTag(s), s).toBe(true)
    for (const s of ['Active', 'active', 'Inactive', 'NA', 'DNR', 'COV', '', null, undefined]) expect(isClearableInjuryTag(s), String(s)).toBe(false)
  })

  it('THE BUG: a player stored Out whom the feed now reports healthy is cleared back to Active', () => {
    const planned = planInjuryChanges(new Map([['kc', healthy()]]), new Map([['kc', storedAs('Out', { injury_body_part: 'Hamstring' })]]))
    expect(planned).toEqual({
      checked: 1,
      guard: null,
      changes: [{ player_id: 'kc', kind: 'cleared', from: 'Out', to: 'Active', fields: storedAs('Active') }],
    })
  })

  it('a tag in the feed is written (new tag, changed tag, same tag with new details); an identical one is not', () => {
    const reports = new Map<string, InjuryReport>([
      ['new', healthy({ tag: 'Questionable', injury_body_part: 'Ankle' })],
      ['worse', healthy({ tag: 'Out', injury_body_part: 'Ankle' })],
      ['detail', healthy({ tag: 'Questionable', injury_body_part: 'Knee' })],
      ['same', healthy({ tag: 'Questionable', injury_body_part: 'Ankle', injury_start_date: '2026-10-12' })],
    ])
    const stored = new Map<string, InjuryFields>([
      ['new', storedAs('Active')],
      ['worse', storedAs('Questionable', { injury_body_part: 'Ankle' })],
      ['detail', storedAs('Questionable', { injury_body_part: 'Ankle' })],
      ['same', storedAs('Questionable', { injury_body_part: 'Ankle', injury_start_date: '2026-10-12' })],
    ])
    const planned = planInjuryChanges(reports, stored)
    expect(planned.checked).toBe(4)
    expect(planned.changes.map((c) => [c.player_id, c.kind, c.from, c.to])).toEqual([
      ['new', 'tagged', 'Active', 'Questionable'],
      ['worse', 'tagged', 'Questionable', 'Out'],
      ['detail', 'detail', 'Questionable', 'Questionable'],
    ])
    expect(planned.changes[2].fields).toEqual(storedAs('Questionable', { injury_body_part: 'Knee' }))
  })

  it('no tag in the feed clears ONLY injury tags — Active / Inactive / NA / DNR stay; an unreported or unstored player is left', () => {
    const reports = new Map<string, InjuryReport>([
      ...['q', 'd', 'o', 'ir', 'pup', 'nfi', 'sus', 'active', 'inactive', 'na', 'dnr', 'not-stored'].map((id) => [id, healthy()] as const),
      ['live', healthy({ tag: 'Questionable' })], // the feed tags someone, so it is live (see the guard below)
    ])
    const stored = new Map<string, InjuryFields>([
      ['live', storedAs('Questionable')],
      ['q', storedAs('Questionable')],
      ['d', storedAs('Doubtful')],
      ['o', storedAs('out')],
      ['ir', storedAs('IR')],
      ['pup', storedAs('PUP')],
      ['nfi', storedAs('NFI')],
      ['sus', storedAs('Sus')],
      ['active', storedAs('Active')],
      ['inactive', storedAs('Inactive')],
      ['na', storedAs('NA')],
      ['dnr', storedAs('DNR')],
      ['unreported', storedAs('Out')],
    ])
    const planned = planInjuryChanges(reports, stored)
    expect(planned.guard).toBeNull()
    expect(planned.checked).toBe(12)
    expect(planned.changes.map((c) => [c.player_id, c.kind, c.from, c.to])).toEqual([
      ['q', 'cleared', 'Questionable', 'Active'],
      ['d', 'cleared', 'Doubtful', 'Active'],
      ['o', 'cleared', 'out', 'Active'],
      ['ir', 'cleared', 'IR', 'Active'],
      ['pup', 'cleared', 'PUP', 'Active'],
      ['nfi', 'cleared', 'NFI', 'Active'],
      ['sus', 'cleared', 'Sus', 'Active'],
    ])
  })

  it('the degraded-feed guard (boundary pair): no tag anywhere + 5 clears ⇒ nothing cleared, named; + 4 clears ⇒ cleared', () => {
    expect(INJURY_CLEAR_GUARD_MIN).toBe(5)
    const five = new Map(['a', 'b', 'c', 'd', 'e'].map((id) => [id, storedAs('Out')]))
    const fiveReports = new Map([...five.keys()].map((id) => [id, healthy()]))
    const tripped = planInjuryChanges(fiveReports, five)
    expect(tripped.changes).toEqual([])
    expect(tripped.guard).toBe(
      'injuries: the feed tags none of its 5 stored player(s) while 5 of them are stored with an injury tag — read as a degraded response, not a healthy league; nothing cleared',
    )
    const four = new Map(['a', 'b', 'c', 'd'].map((id) => [id, storedAs('Out')]))
    const fourReports = new Map([...four.keys()].map((id) => [id, healthy()]))
    expect(planInjuryChanges(fourReports, four)).toMatchObject({ guard: null })
    expect(planInjuryChanges(fourReports, four).changes).toHaveLength(4)
    // …and ONE tag anywhere in the feed means the feed is live: all five clear
    const withTag = new Map([...fiveReports, ['f', healthy({ tag: 'Questionable' })]])
    const live = planInjuryChanges(withTag, new Map([...five, ['f', storedAs('Questionable')]]))
    expect(live.guard).toBeNull()
    expect(live.changes.filter((c) => c.kind === 'cleared')).toHaveLength(5)
  })
})

describe('syncWeeklyProjections — injury tags in the run (D592)', () => {
  // Stored state the run reads back (fixture ids): two stale tags, two new
  // ones, one unchanged, one non-injury status the feed does not tag.
  const PLAYERS: StoredInjury[] = [
    { id: '4984', ...storedAs('Out', { injury_body_part: 'Ankle' }) }, // healthy in the feed ⇒ cleared
    { id: '3957', ...storedAs('Questionable') }, // a FILLER row, healthy ⇒ cleared
    { id: '9493', ...storedAs('Active') }, // feed: Doubtful ⇒ tagged
    { id: '13300', ...storedAs('Inactive') }, // feed: NA ⇒ tagged (a tag is written as the full sync would)
    { id: '11604', ...storedAs('Questionable', { injury_body_part: 'Knee - Meniscus', injury_notes: 'Surgery' }) }, // same ⇒ untouched
    { id: '9221', ...storedAs('Inactive') }, // healthy in the feed, not an injury tag ⇒ untouched
  ]

  it('writes each change once per value set at the run\'s instant, counts and names every change', async () => {
    const { db, updates } = fakeDb(CAL, [], {}, PLAYERS)
    const report = await syncWeeklyProjections(
      { db, time: T, knownPlayerIds: async () => new Set(ALL_IDS), fetchWeek: recordedWeek4 },
      { season: 2026, weeks: [4] },
    )
    expect(report.failures).toEqual([])
    expect(report.ok).toBe(true)
    expect(report.counts).toMatchObject({ injuryChecked: 6, injuryTagged: 2, injuryCleared: 2, injuryDetail: 0 })
    expect(report.injuryChanges).toEqual([
      { player_id: '4984', kind: 'cleared', from: 'Out', to: 'Active' },
      { player_id: '3957', kind: 'cleared', from: 'Questionable', to: 'Active' },
      { player_id: '13300', kind: 'tagged', from: 'Inactive', to: 'NA' },
      { player_id: '9493', kind: 'tagged', from: 'Active', to: 'Doubtful' },
    ])
    const at = '2026-09-27T12:40:00.000Z'
    expect(updates).toEqual([
      { fields: { ...storedAs('Active'), updated_at: at }, opts: { count: 'exact' }, ids: ['4984', '3957'] },
      { fields: { ...storedAs('NA', { injury_body_part: 'Undisclosed' }), updated_at: at }, opts: { count: 'exact' }, ids: ['13300'] },
      { fields: { ...storedAs('Doubtful', { injury_body_part: 'Hip', injury_notes: 'Soreness' }), updated_at: at }, opts: { count: 'exact' }, ids: ['9493'] },
    ])
  })

  it('a second run over the same feed and the new state changes nothing', async () => {
    const after: StoredInjury[] = [
      { id: '4984', ...storedAs('Active') },
      { id: '9493', ...storedAs('Doubtful', { injury_body_part: 'Hip', injury_notes: 'Soreness' }) },
    ]
    const { db, updates } = fakeDb(CAL, [], {}, after)
    const report = await syncWeeklyProjections(
      { db, time: T, knownPlayerIds: async () => new Set(ALL_IDS), fetchWeek: recordedWeek4 },
      { season: 2026, weeks: [4] },
    )
    expect(report.ok).toBe(true)
    expect(report.counts).toMatchObject({ injuryChecked: 2, injuryTagged: 0, injuryCleared: 0, injuryDetail: 0 })
    expect(updates).toEqual([])
  })

  it('a week whose projections were REFUSED (all filler) is trusted for nothing: no injury read, no write', async () => {
    const { db, calls, updates } = fakeDb(CAL, [], {}, PLAYERS)
    const report = await syncWeeklyProjections(
      { db, time: T, knownPlayerIds: async () => new Set(ALL_IDS), fetchWeek: async (_s, w) => structuredClone(WEEK19_QB).map((r) => ({ ...r, week: w })) },
      { season: 2026, weeks: [4] },
    )
    expect(report.ok).toBe(false)
    expect(calls.filter((c) => c.table === 'players')).toEqual([])
    expect(updates).toEqual([])
    expect(report.counts).toMatchObject({ injuryChecked: 0, injuryTagged: 0, injuryCleared: 0 })
  })

  it('a SHORT players update is never "done": ok:false, named', async () => {
    const { db } = fakeDb(CAL, [], { update: (n) => n - 1 }, PLAYERS)
    const report = await syncWeeklyProjections(
      { db, time: T, knownPlayerIds: async () => new Set(ALL_IDS), fetchWeek: recordedWeek4 },
      { season: 2026, weeks: [4] },
    )
    expect(report.ok).toBe(false)
    expect(report.failures).toEqual(['injuries: players update wrote 1 row(s) for 2 named (Active) — refusing to call that done'])
  })

  it('a feed whose rows carry NO injury field at all fails loudly (a silent stale-again is the bug)', async () => {
    const { db, updates } = fakeDb(CAL, [], {}, PLAYERS)
    const report = await syncWeeklyProjections(
      {
        db,
        time: T,
        knownPlayerIds: async () => new Set(ALL_IDS),
        fetchWeek: async (_s, w, p) => (WEEK4[p] as Row[]).map((r) => ({ ...structuredClone(r), week: w, player: { first_name: 'x' } })),
      },
      { season: 2026, weeks: [4] },
    )
    expect(report.ok).toBe(false)
    expect(report.failures).toEqual(['injuries: none of the 23 feed row(s) for known players carried an injury field — no tag refreshed'])
    expect(report.counts).toMatchObject({ stored: 17 }) // the projections themselves still landed
    expect(updates).toEqual([])
  })
})

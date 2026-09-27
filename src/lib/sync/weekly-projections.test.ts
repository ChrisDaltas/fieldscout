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
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import { STAT_KEYS } from '@/lib/leagues/stats/stat-keys'
import type { TimeProvider } from '@/lib/leagues/time/time-provider'

import type { SyncClient } from './types'
import {
  isProjectedRow,
  parseWeeklyProjections,
  planProjectionWeeks,
  sleeperWeeklyProjectionsUrl,
  syncWeeklyProjections,
  WEEKLY_PROJECTION_POSITIONS,
  type ProjectionCalendarWeek,
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
    expect(shape).toEqual({ QB: [5, 3], RB: [5, 4], WR: [4, 3], TE: [3, 2], K: [3, 2], DEF: [2, 2] })
    // a filler row is exactly the measured shape — Sleeper's "not projected" placeholder
    expect(WEEK4.QB[3].stats).toEqual({ adp_dd_ppr: 1000 })
    expect(WEEK19_QB.map((r) => r.stats)).toEqual([{ adp_dd_ppr: 1000 }, { adp_dd_ppr: 1000 }])
    expect(WEEK19_QB.every((r) => r.week === 19)).toBe(true)
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

  it('stores exactly the 16 PROJECTED rows; the 6 filler rows are counted, never stored', () => {
    expect(parsed.failures).toEqual([])
    expect(parsed.rows.map((r) => r.player_id)).toEqual([
      '4984', '4881', '5849', '9221', '6813', '9509', '13300', '9488', '9493', '7547', '8130', '11604', '12185', '3451', 'MIN', 'BAL',
    ])
    expect(parsed.perPosition).toEqual({
      QB: { rows: 5, projected: 3, filler: 2 },
      RB: { rows: 5, projected: 4, filler: 1 },
      WR: { rows: 4, projected: 3, filler: 1 },
      TE: { rows: 3, projected: 2, filler: 1 },
      K: { rows: 3, projected: 2, filler: 1 },
      DEF: { rows: 2, projected: 2, filler: 0 },
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
    expect(by.get('MIN')?.stats).toEqual({ def_sack: 3.17, def_int: 0.94, def_fumble_rec: 0.72, def_td: 0.14, def_points_allowed: 16 })
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
    expect(parsed.rows).toHaveLength(14)
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

function fakeDb(calendar: ProjectionCalendarWeek[], stored: string[] = []): { db: SyncClient; calls: Call[] } {
  const calls: Call[] = []
  const db = {
    from(table: string) {
      let op = 'select'
      let payload: unknown[] = []
      const b = {
        select: (...args: unknown[]) => { calls.push({ table, op: 'select', args }); return b },
        eq: () => b,
        order: () => b,
        range: () => b,
        in: (_c: string, ids: unknown[]) => { payload = ids; return b },
        upsert: (rows: unknown[], ...args: unknown[]) => { op = 'upsert'; payload = rows; calls.push({ table, op, args: [rows, ...args] }); return b },
        delete: (...args: unknown[]) => { op = 'delete'; calls.push({ table, op, args }); return b },
        then(resolve: (v: unknown) => void) {
          if (table === 'nfl_weeks') return resolve({ data: calendar, error: null })
          if (op === 'upsert') return resolve({ data: null, error: null, count: payload.length })
          if (op === 'delete') return resolve({ data: null, error: null, count: payload.length })
          return resolve({ data: stored.map((player_id) => ({ player_id })), error: null, count: stored.length })
        },
      }
      return b
    },
  }
  return { db: db as unknown as SyncClient, calls }
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
    expect(report.counts).toEqual({ weeks: 2, projected: 0, stored: 0, removed: 0, unknownPlayer: 0, duplicates: 0, failedWeeks: 2 })
    expect(report.failures).toHaveLength(12)
    expect(writes(calls)).toEqual([])
  })

  it('a clean week lands: 16 stored in ONE upsert, the stale row removed, counts by value', async () => {
    const { db, calls } = fakeDb(CAL, ['4984', 'ghost-1'])
    const report = await syncWeeklyProjections(
      { db, time: T, knownPlayerIds: async () => new Set(ALL_IDS), fetchWeek: async (_s, w, p) => (WEEK4[p] as Row[]).map((r) => ({ ...structuredClone(r), week: w })) },
      { season: 2026, weeks: [4] },
    )
    expect(report.failures).toEqual([])
    expect(report.ok).toBe(true)
    expect(report.counts).toEqual({ weeks: 1, projected: 16, stored: 16, removed: 1, unknownPlayer: 0, duplicates: 0, failedWeeks: 0 })
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

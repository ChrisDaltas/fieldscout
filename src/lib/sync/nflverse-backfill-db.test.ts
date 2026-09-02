/**
 * nflverse-backfill-db.test.ts — L.D3.1 over the REAL local stack: the
 * nflverse adapter composed with `ingestWeek` (L.D2.1's writer — the ONLY
 * `nfl_games` writer, D303(3); this task adds no second one) back-fills the
 * real 2026 calendar into `nfl_games` and `nfl_weeks` (F11; spec §23.1,
 * §23.3, §12.20; E42 real edition).
 *
 * The provider reads the RECORDED `__fixtures__/games-trimmed.csv` (2026
 * weeks 1, 2, 8, 9, 18 — 77 games) through an injected `fetchText`; no
 * network. Pins, each a stored literal or a counted result:
 *   - the golden back-fill: 77 `nfl_games` rows with UTC kickoffs (the
 *     opener at 2026-09-10T00:20Z; the Rams as `LAR`; `game_type` defaults
 *     to `regular`; `status = scheduled`), `nfl_weeks.first_kickoff_at` for
 *     exactly the five fixture weeks (EDT weeks 1/2/8's Thursday, EST week
 *     9/18), `last_game_ends_at` NULL everywhere (nothing is final), the 13
 *     other weeks untouched, ZERO `player_stats` / `score_fanout` writes
 *     (nflverse supplies no stat lines, and the report says so);
 *   - idempotent re-sync: the same fixture again writes nothing (0/0/77);
 *   - E42 real edition: the CHI@CAR 1:00 → 8:20 SNF flex moves exactly that
 *     row's `kickoff_at` (the week's first kickoff stays); moving the
 *     opener by ONE minute moves `first_kickoff_at` with it (D146 one unit);
 *   - a posted result flips the row to `final` and, with the rest of the
 *     week still ahead, leaves `last_game_ends_at` NULL.
 *
 * Fixture hygiene (F199/R708): every game row is deleted BY ID (the 77
 * nflverse ids from the fixture — a real feed's ids share this shape, so no
 * prefix deletes) and the five touched `nfl_weeks` rows are restored to
 * NULL; `afterAll` asserts every 2026 week NULL (pgTAP 003's pin) and the
 * ids gone. If the stack is down this suite FAILS (never skips — D59).
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { createClient } from '@supabase/supabase-js'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { DegradationTracker } from '@/lib/leagues/stats/degradation'
import { NflverseProvider, NFLVERSE_URLS, parseGamesCsv } from '@/lib/leagues/stats/nflverse/nflverse-provider'

import { ingestWeek, type IngestReport } from './ingest-week'
import type { SyncClient } from './types'

const LOCAL_URL = process.env.SUPABASE_LOCAL_URL ?? 'http://127.0.0.1:54321'
const LOCAL_SERVICE_ROLE_KEY =
  process.env.SUPABASE_LOCAL_SERVICE_ROLE_KEY ??
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU'

const service = createClient(LOCAL_URL, LOCAL_SERVICE_ROLE_KEY, { auth: { persistSession: false } })
const db = service as unknown as SyncClient

const SEASON = 2026
const FIXTURE = resolve(__dirname, '../leagues/stats/nflverse/__fixtures__/games-trimmed.csv')
const GAMES_CSV = readFileSync(FIXTURE, 'utf8')
const FIXTURE_IDS = parseGamesCsv(GAMES_CSV)
  .filter((r) => r.season === String(SEASON))
  .map((r) => r.game_id)
const FIXTURE_WEEKS = [1, 2, 8, 9, 18]
const UNTOUCHED_WEEKS = [3, 4, 5, 6, 7, 10, 11, 12, 13, 14, 15, 16, 17]

let instant = new Date('2026-09-02T12:00:00.000Z')
const time = { now: () => instant }

function provider(csv = GAMES_CSV): NflverseProvider {
  return new NflverseProvider(time, {
    fetchText: async (url) => {
      if (url === NFLVERSE_URLS.games) return csv
      throw new Error(`unexpected fetch in test: ${url}`)
    },
  })
}

function editGameRow(csv: string, gameId: string, edit: (fields: string[]) => void): string {
  const lines = csv.split('\n')
  const idx = lines.findIndex((l) => l.startsWith(`${gameId},`))
  if (idx === -1) throw new Error(`fixture has no row ${gameId}`)
  const fields = lines[idx].split(',')
  edit(fields)
  lines[idx] = fields.join(',')
  return lines.join('\n')
}
const IDX = { gametime: 6, away_score: 8, home_score: 10, result: 12 } as const

/** A read that must return rows. */
async function must<T>(p: PromiseLike<{ data: T | null; error: { message: string } | null }>, what: string): Promise<T> {
  const { data, error } = await p
  if (error) throw new Error(`${what}: ${error.message}`)
  if (data === null) throw new Error(`${what}: no data`)
  return data
}

/** A write whose only contract is "no error" (delete/update without .select()). */
async function run(p: PromiseLike<{ error: { message: string } | null }>, what: string): Promise<void> {
  const { error } = await p
  if (error) throw new Error(`${what}: ${error.message}`)
}

async function poll(csv = GAMES_CSV, week = 1): Promise<IngestReport> {
  return ingestWeek(provider(csv), time, { db, degradation: new DegradationTracker(), season: SEASON, week })
}

async function readGame(id: string) {
  const rows = await must(
    service.from('nfl_games').select('id, season, week, game_type, home_team, away_team, kickoff_at, status').eq('id', id),
    `read ${id}`,
  )
  expect(rows).toHaveLength(1)
  return { ...rows[0], kickoff_at: new Date(rows[0].kickoff_at).toISOString() }
}

async function readWeeks(): Promise<Map<number, { first: string | null; last: string | null }>> {
  const rows = await must(
    service.from('nfl_weeks').select('week, first_kickoff_at, last_game_ends_at').eq('season', SEASON).order('week'),
    'read nfl_weeks',
  )
  return new Map(
    rows.map((r) => [
      r.week,
      {
        first: r.first_kickoff_at === null ? null : new Date(r.first_kickoff_at).toISOString(),
        last: r.last_game_ends_at === null ? null : new Date(r.last_game_ends_at).toISOString(),
      },
    ]),
  )
}

async function cleanup(): Promise<void> {
  await run(service.from('nfl_games').delete().in('id', FIXTURE_IDS), 'cleanup nfl_games')
  await run(
    service
      .from('nfl_weeks')
      .update({ first_kickoff_at: null, last_game_ends_at: null })
      .eq('season', SEASON)
      .in('week', FIXTURE_WEEKS),
    'cleanup nfl_weeks',
  )
}

async function fixtureGameCount(): Promise<number> {
  const { count, error } = await service.from('nfl_games').select('id', { count: 'exact', head: true }).in('id', FIXTURE_IDS)
  if (error) throw new Error(`count nfl_games: ${error.message}`)
  return count ?? -1
}

async function statCount(): Promise<number> {
  const { count, error } = await service
    .from('player_stats')
    .select('player_id', { count: 'exact', head: true })
    .eq('season', SEASON)
    .eq('week', 1)
  if (error) throw new Error(`count player_stats: ${error.message}`)
  return count ?? -1
}

async function queueCount(): Promise<number> {
  const { count, error } = await service.from('score_fanout').select('player_id', { count: 'exact', head: true })
  if (error) throw new Error(`count score_fanout: ${error.message}`)
  return count ?? -1
}

beforeAll(async () => {
  await cleanup()
  expect(FIXTURE_IDS).toHaveLength(77)
  expect(await fixtureGameCount()).toBe(0)
})

afterAll(async () => {
  await cleanup()
  // pgTAP 003 pins every 2026 week NULL — prove the restore.
  const weeks = await readWeeks()
  expect([...weeks.values()].filter((w) => w.first !== null || w.last !== null)).toEqual([])
  expect(await fixtureGameCount()).toBe(0)
})

describe('the real-2026 calendar back-fill (nflverse fixture → ingestWeek → nfl_games / nfl_weeks)', () => {
  it('golden back-fill: 77 games with UTC kickoffs, five weeks bounded, nothing else touched, zero stat/queue writes', async () => {
    const statsBefore = await statCount()
    const queueBefore = await queueCount()

    const report = await poll()
    expect(report.ok).toBe(true)
    expect(report.provider).toBe('nflverse')
    expect(report.games).toEqual({ seen: 77, withoutKickoff: 0, inserted: 77, updated: 0, unchanged: 0 })
    expect(report.weeks).toEqual({ touched: 5, updated: 5, unchanged: 0, outsideCalendar: 0 })
    expect(report.stats).toMatchObject({ seen: 0, inserted: 0, updated: 0, deltas: 0, enqueued: 0 })
    expect(report.reasons).toEqual([
      'provider returned zero stat rows for 2026 week 1',
      'score_fanout: no scoring delta — nothing enqueued',
    ])

    expect(await readGame('2026_01_NE_SEA')).toEqual({
      id: '2026_01_NE_SEA',
      season: 2026,
      week: 1,
      game_type: 'regular', // 001's DEFAULT — the adapter emits regular-season games only
      home_team: 'SEA',
      away_team: 'NE',
      kickoff_at: '2026-09-10T00:20:00.000Z',
      status: 'scheduled',
    })
    expect(await readGame('2026_01_SF_LA')).toMatchObject({ home_team: 'LAR', away_team: 'SF', kickoff_at: '2026-09-11T00:35:00.000Z' })
    expect(await readGame('2026_08_BAL_BUF')).toMatchObject({ kickoff_at: '2026-11-01T18:00:00.000Z' }) // EST side of the fall-back
    expect(await readGame('2026_09_CIN_ATL')).toMatchObject({ kickoff_at: '2026-11-08T14:30:00.000Z' })
    expect(await fixtureGameCount()).toBe(77)

    const weeks = await readWeeks()
    expect(weeks.get(1)).toEqual({ first: '2026-09-10T00:20:00.000Z', last: null }) // Wed opener, EDT
    expect(weeks.get(2)).toEqual({ first: '2026-09-18T00:15:00.000Z', last: null }) // Thu 20:15 EDT
    expect(weeks.get(8)).toEqual({ first: '2026-10-30T00:15:00.000Z', last: null }) // Thu 20:15 EDT — the week that crosses the fall-back
    expect(weeks.get(9)).toEqual({ first: '2026-11-06T01:15:00.000Z', last: null }) // Thu 20:15 EST
    expect(weeks.get(18)).toEqual({ first: '2027-01-10T18:00:00.000Z', last: null }) // Sun 13:00 EST
    for (const w of UNTOUCHED_WEEKS) expect(weeks.get(w)).toEqual({ first: null, last: null })
    // 039's seed (Wed 00:00 ET `starts_at`, day-math from the Sleeper calendar) and nflverse's
    // minute-exact kickoffs are independent derivations of the same calendar — they must agree:
    // every bounded week's first kickoff falls AFTER its seeded start.
    const seeded = await must(service.from('nfl_weeks').select('week, starts_at').eq('season', SEASON).in('week', FIXTURE_WEEKS), 'read starts_at')
    for (const row of seeded) {
      const first = weeks.get(row.week)?.first
      expect(first).not.toBeNull()
      expect(new Date(first!).getTime()).toBeGreaterThan(new Date(row.starts_at).getTime())
    }

    expect(await statCount()).toBe(statsBefore)
    expect(await queueCount()).toBe(queueBefore)
  })

  it('idempotent re-sync: the same fixture again writes nothing (77 unchanged, 5 weeks unchanged)', async () => {
    instant = new Date('2026-09-03T12:00:00.000Z')
    const report = await poll()
    expect(report.games).toEqual({ seen: 77, withoutKickoff: 0, inserted: 0, updated: 0, unchanged: 77 })
    expect(report.weeks).toEqual({ touched: 5, updated: 0, unchanged: 5, outsideCalendar: 0 })
    expect(report.reasons).toContain('nfl_games unchanged: 77 games identical to stored')
    expect((await readGame('2026_01_NE_SEA')).kickoff_at).toBe('2026-09-10T00:20:00.000Z')
  })

  it('E42 real edition: the CHI@CAR 1:00 → 8:20 flex moves exactly that row; the week\'s first kickoff stays', async () => {
    const flexed = editGameRow(GAMES_CSV, '2026_01_CHI_CAR', (f) => {
      f[IDX.gametime] = '20:20'
    })
    const report = await poll(flexed)
    expect(report.games).toEqual({ seen: 77, withoutKickoff: 0, inserted: 0, updated: 1, unchanged: 76 })
    expect(report.weeks).toEqual({ touched: 5, updated: 0, unchanged: 5, outsideCalendar: 0 })
    expect(await readGame('2026_01_CHI_CAR')).toMatchObject({ kickoff_at: '2026-09-14T00:20:00.000Z', status: 'scheduled' })
    expect((await readWeeks()).get(1)?.first).toBe('2026-09-10T00:20:00.000Z')
  })

  it('moving the opener by ONE minute moves nfl_weeks.first_kickoff_at with it (D146 one unit)', async () => {
    const moved = editGameRow(GAMES_CSV, '2026_01_NE_SEA', (f) => {
      f[IDX.gametime] = '20:21'
    })
    const report = await poll(moved)
    // CHI@CAR reverts to 13:00 in this fixture (the previous test's flex is undone) — two rows move.
    expect(report.games).toEqual({ seen: 77, withoutKickoff: 0, inserted: 0, updated: 2, unchanged: 75 })
    expect(report.weeks).toEqual({ touched: 5, updated: 1, unchanged: 4, outsideCalendar: 0 })
    expect((await readGame('2026_01_NE_SEA')).kickoff_at).toBe('2026-09-10T00:21:00.000Z')
    expect((await readWeeks()).get(1)?.first).toBe('2026-09-10T00:21:00.000Z')
    // Sibling: the unmodified fixture puts it back.
    const back = await poll()
    expect(back.games.updated).toBe(1)
    expect((await readWeeks()).get(1)?.first).toBe('2026-09-10T00:20:00.000Z')
  })

  it('a posted result flips the row to final; with the rest of the week ahead, last_game_ends_at stays NULL', async () => {
    const played = editGameRow(GAMES_CSV, '2026_01_NE_SEA', (f) => {
      f[IDX.away_score] = '17'
      f[IDX.home_score] = '24'
      f[IDX.result] = '7'
    })
    const report = await poll(played)
    expect(report.games).toMatchObject({ inserted: 0, updated: 1, unchanged: 76 })
    expect((await readGame('2026_01_NE_SEA')).status).toBe('final')
    expect((await readWeeks()).get(1)).toEqual({ first: '2026-09-10T00:20:00.000Z', last: null })
  })
})

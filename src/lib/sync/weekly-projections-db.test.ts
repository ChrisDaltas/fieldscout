/**
 * weekly-projections-db.test.ts — the sync's SERVICE-ROLE write path over the
 * REAL local stack (M6A L.E1.19; migration 136; PROGRESS F379 / D373).
 *
 * Pinned here:
 *   1. THE WRITE: the recorded week-4 response (src/lib/sync/fixtures/
 *      sleeper-weekly-projections-2026.json, ids prefixed `wpj-` so no real player is
 *      touched) lands 16 lines through the service role; a golden line and
 *      the TimeProvider instant read back BY VALUE.
 *   2. THE REFRESH: a player who drops to filler (ruled out) loses his line
 *      on the next run (`removed = 1`), the others are re-stamped.
 *   3. ZERO PROJECTIONS IS A FAILURE: an all-filler week is `ok: false` and
 *      the stored lines are BYTE-IDENTICAL afterwards (nothing written).
 *   4. THE 1000-ROW CAP: 1,200 stale lines planted for one week are ALL
 *      removed — the stale read pages past PostgREST's cap (pageAll with an
 *      exact count), never a silent first-1000.
 *   5. RLS through PostgREST: anon reads 0 lines and cannot insert.
 *
 * Season 2099 (the synthetic calendar, seeded idempotently); requires the
 * local stack (001–136) — D59(5); FAILS loudly when the stack is down.
 * Fixture hygiene (F199): every `wpj-` player and line is deleted before and
 * after.
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { createClient } from '@supabase/supabase-js'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { SYNTHETIC_SEASON, seedSyntheticSeason } from '@/lib/leagues/sim/synthetic-season'
import type { TimeProvider } from '@/lib/leagues/time/time-provider'
import type { Database } from '@/types/database'

import { syncWeeklyProjections, WEEKLY_PROJECTION_POSITIONS, type WeeklyProjectionPosition } from './weekly-projections'

const LOCAL_URL = process.env.SUPABASE_LOCAL_URL ?? 'http://127.0.0.1:54321'
const LOCAL_ANON_KEY =
  process.env.SUPABASE_LOCAL_ANON_KEY ??
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0'
const LOCAL_SERVICE_ROLE_KEY =
  process.env.SUPABASE_LOCAL_SERVICE_ROLE_KEY ??
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU'

const service = createClient<Database>(LOCAL_URL, LOCAL_SERVICE_ROLE_KEY, { auth: { persistSession: false } })
const anon = createClient<Database>(LOCAL_URL, LOCAL_ANON_KEY, { auth: { persistSession: false } })
const SEASON = SYNTHETIC_SEASON
const P = 'wpj-'

type Row = { player_id: string; week: number; stats: Record<string, number>; updated_at?: number; player: Record<string, unknown> }
const FIXTURE = JSON.parse(
  readFileSync(fileURLToPath(new URL('./fixtures/sleeper-weekly-projections-2026.json', import.meta.url)), 'utf8'),
) as { weeks: Record<string, Partial<Record<WeeklyProjectionPosition, Row[]>>> }
const WEEK4 = FIXTURE.weeks['4'] as Record<WeeklyProjectionPosition, Row[]>
const FILLER = FIXTURE.weeks['19'].QB as Row[]

/** The recorded response for (week, position), ids prefixed, `week` relabelled. */
function recorded(week: number, position: WeeklyProjectionPosition, drop: string[] = []): Row[] {
  return WEEK4[position].map((r) => {
    const row = structuredClone(r)
    row.player_id = P + row.player_id
    row.week = week
    if (drop.includes(r.player_id)) row.stats = { adp_dd_ppr: 1000 } // dropped to filler, the measured shape
    return row
  })
}

const clock = (iso: string): TimeProvider => ({ now: () => new Date(iso) })

async function cleanup(): Promise<void> {
  const lines = await service.from('player_weekly_projections').delete().like('player_id', `${P}%`)
  if (lines.error) throw new Error(`cleanup lines: ${lines.error.message}`)
  const players = await service.from('players').delete().like('id', `${P}%`)
  if (players.error) throw new Error(`cleanup players: ${players.error.message}`)
}

async function linesFor(week: number) {
  const { data, error } = await service
    .from('player_weekly_projections')
    .select('player_id, stats, raw_stats, source, source_updated_at, fetched_at')
    .eq('season', SEASON)
    .eq('week', week)
    .like('player_id', `${P}%`)
    .order('player_id')
  if (error) throw new Error(error.message)
  return data ?? []
}

beforeAll(async () => {
  await seedSyntheticSeason(service)
  await cleanup()
  const ids = WEEKLY_PROJECTION_POSITIONS.flatMap((p) => WEEK4[p].map((r) => ({ id: P + r.player_id, full_name: `WPJ ${r.player_id}`, position: p === 'DEF' ? 'DEF' : p })))
  const { error, count } = await service.from('players').insert(ids, { count: 'exact' })
  if (error) throw new Error(`fixture players: ${error.message}`)
  expect(count).toBe(22)
})

afterAll(async () => {
  await cleanup()
})

describe('weekly projections — the service-role write path (stack)', () => {
  it('1. THE WRITE: week 4 lands 16 lines; a golden line and the injected instant read back by value', async () => {
    const report = await syncWeeklyProjections(
      { db: service, time: clock('2099-09-29T15:40:00.000Z'), fetchWeek: async (_s, w, p) => recorded(w, p) },
      { season: SEASON, weeks: [4] },
    )
    expect(report.failures).toEqual([])
    expect(report.ok).toBe(true)
    expect(report.counts).toEqual({ weeks: 1, projected: 16, stored: 16, removed: 0, unknownPlayer: 0, duplicates: 0, failedWeeks: 0 })

    const lines = await linesFor(4)
    expect(lines).toHaveLength(16)
    const allen = lines.find((l) => l.player_id === `${P}4984`)
    expect(allen).toEqual({
      player_id: `${P}4984`,
      stats: {
        pass_attempts: 31.94, pass_completions: 20.34, pass_yards: 241.87, pass_tds: 1.59, interceptions: 0.48,
        qb_sack_taken: 2.77, pass_2pt: 0.1, rush_attempts: 7.87, rush_yards: 37.34, rush_tds: 0.68, rush_2pt: 0.05,
        fumbles_lost: 0.2,
      },
      raw_stats: WEEK4.QB[0].stats,
      source: 'sleeper',
      source_updated_at: '2026-09-24T23:45:51.844+00:00',
      fetched_at: '2099-09-29T15:40:00+00:00',
    })
    // the real projected zero is stored as a line, not dropped
    expect(lines.find((l) => l.player_id === `${P}13300`)?.stats).toEqual({ receiving_tds: 0 })
  })

  it('2. THE REFRESH: a player who drops to filler loses his line; everyone else is re-stamped', async () => {
    const report = await syncWeeklyProjections(
      { db: service, time: clock('2099-09-29T16:40:00.000Z'), fetchWeek: async (_s, w, p) => recorded(w, p, ['5849']) },
      { season: SEASON, weeks: [4] },
    )
    expect(report.ok).toBe(true)
    expect(report.counts).toMatchObject({ projected: 15, stored: 15, removed: 1 })
    const lines = await linesFor(4)
    expect(lines.map((l) => l.player_id)).not.toContain(`${P}5849`)
    expect(lines).toHaveLength(15)
    expect(new Set(lines.map((l) => l.fetched_at))).toEqual(new Set(['2099-09-29T16:40:00+00:00']))
  })

  it('3. ZERO PROJECTIONS IS A FAILURE: an all-filler week is ok:false, and the stored lines are byte-identical afterwards', async () => {
    const before = await linesFor(4)
    const report = await syncWeeklyProjections(
      { db: service, time: clock('2099-09-29T17:40:00.000Z'), fetchWeek: async (_s, w) => FILLER.map((r) => ({ ...structuredClone(r), week: w })) },
      { season: SEASON, weeks: [4] },
    )
    expect(report.ok).toBe(false)
    expect(report.counts).toMatchObject({ projected: 0, stored: 0, removed: 0, failedWeeks: 1 })
    expect(report.failures).toHaveLength(6)
    expect(await linesFor(4)).toEqual(before)
  })

  it('4. THE 1000-ROW CAP: 1,200 stale lines for one week are ALL removed (the stale read pages past the cap)', async () => {
    const bulk = Array.from({ length: 1200 }, (_, i) => `${P}bulk-${String(i).padStart(4, '0')}`)
    for (let i = 0; i < bulk.length; i += 500) {
      const chunk = bulk.slice(i, i + 500)
      const p = await service.from('players').insert(chunk.map((id) => ({ id, full_name: id, position: 'WR' })), { count: 'exact' })
      if (p.error) throw new Error(p.error.message)
      const l = await service.from('player_weekly_projections').insert(
        chunk.map((player_id) => ({ season: SEASON, week: 5, player_id, stats: { receiving_yards: 1 }, raw_stats: {}, source: 'sleeper', fetched_at: '2099-09-01T00:00:00Z' })),
        { count: 'exact' },
      )
      if (l.error) throw new Error(l.error.message)
      expect(l.count).toBe(chunk.length)
    }
    const { count: planted } = await service
      .from('player_weekly_projections')
      .select('player_id', { count: 'exact', head: true })
      .eq('season', SEASON)
      .eq('week', 5)
    expect(planted).toBe(1200) // PREMISE: more than one PostgREST page

    const report = await syncWeeklyProjections(
      { db: service, time: clock('2099-10-06T15:40:00.000Z'), fetchWeek: async (_s, w, p) => recorded(w, p) },
      { season: SEASON, weeks: [5] },
    )
    expect(report.ok).toBe(true)
    expect(report.counts).toMatchObject({ stored: 16, removed: 1200 })
    expect((await linesFor(5)).map((l) => l.player_id).filter((id) => id.startsWith(`${P}bulk-`))).toEqual([])
    expect(await linesFor(5)).toHaveLength(16)
  })

  it('5. RLS through PostgREST: anon reads 0 lines and cannot insert', async () => {
    const read = await anon.from('player_weekly_projections').select('player_id').like('player_id', `${P}%`)
    expect(read.error).toBeNull()
    expect(read.data).toEqual([])
    const write = await anon
      .from('player_weekly_projections')
      .insert({ season: SEASON, week: 6, player_id: `${P}4984`, stats: {}, raw_stats: {}, source: 'sleeper', fetched_at: '2099-10-01T00:00:00Z' })
    expect(write.error?.code).toBe('42501')
  })
})

/**
 * core-stats-db.test.ts — the player page's core-stats read (D486(10)/(11))
 * over the REAL local stack, outside a league (the preset systems — ESPN
 * Standard default, Half PPR, Full PPR), read as anon through RLS.
 *
 * Pinned (stored literals): season points under ESPN Standard (0.1/rec yd,
 * 6/rec TD, 0.1/rush yd); a bye-week row is not a game (avg 32 / 2 = 16);
 * standard competition ranking (two WRs tied at 32 share WR 1 and #2; the
 * next WR is WR 3 / #4); a player with no stored week is unranked with a
 * NULL total and NULL avg (never 0); no calendar ⇒ no week ⇒ NULL projection;
 * an unknown player is a 404.
 *
 * R1504 presets: a WR line of 5 catches / 80 yds / 1 TD scores ESPN 14,
 * Half 16.5, Full PPR 19 (season 2078). R1506: a stored all-zero line (did
 * not play) is not a game, and a still-live row counts in the total but not
 * the average.
 *
 * Seasons 2079 / 2078 (unused elsewhere). Requires the local stack — D59(5). Fixture
 * hygiene (F199): every `pcs-` player and stat row is deleted before and after.
 */
import { createClient } from '@supabase/supabase-js'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import type { Database } from '@/types/database'

import type { TimeProvider } from '../leagues/time/time-provider'
import type { CoreStatsPayload, ScoringSystemKey } from './core-stats-ops'
import { readPlayerCoreStats } from './core-stats-service'

const LOCAL_URL = process.env.SUPABASE_LOCAL_URL ?? 'http://127.0.0.1:54321'
const LOCAL_ANON_KEY =
  process.env.SUPABASE_LOCAL_ANON_KEY ??
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0'
const LOCAL_SERVICE_ROLE_KEY =
  process.env.SUPABASE_LOCAL_SERVICE_ROLE_KEY ??
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU'

const service = createClient<Database>(LOCAL_URL, LOCAL_SERVICE_ROLE_KEY, { auth: { persistSession: false } })
const anon = createClient<Database>(LOCAL_URL, LOCAL_ANON_KEY, { auth: { persistSession: false } })
const SEASON = 2079
const clock: TimeProvider = { now: () => new Date('2079-10-01T12:00:00.000Z') }

async function cleanup() {
  const s = await service.from('player_stats').delete().like('player_id', 'pcs-%')
  if (s.error) throw new Error(s.error.message)
  const p = await service.from('players').delete().like('id', 'pcs-%')
  if (p.error) throw new Error(p.error.message)
}

beforeAll(async () => {
  await cleanup()
  const players = await service.from('players').insert([
    { id: 'pcs-wr1', full_name: 'PCS Wr One', position: 'WR', bye_week: 9 },
    { id: 'pcs-wr2', full_name: 'PCS Wr Two', position: 'WR' },
    { id: 'pcs-wr3', full_name: 'PCS Wr Three', position: 'WR' },
    { id: 'pcs-wr4', full_name: 'PCS Wr Rookie', position: 'WR' },
    { id: 'pcs-rb1', full_name: 'PCS Rb One', position: 'RB' },
    { id: 'pcs-wr5', full_name: 'PCS Wr Five', position: 'WR' },
  ])
  if (players.error) throw new Error(players.error.message)
  const stats = await service.from('player_stats').insert([
    { player_id: 'pcs-wr1', season: SEASON, week: 1, receiving_yards: 100, receiving_tds: 1 },
    { player_id: 'pcs-wr1', season: SEASON, week: 2, receiving_yards: 100, receiving_tds: 1 },
    { player_id: 'pcs-wr1', season: SEASON, week: 9 }, // his bye — not a game
    { player_id: 'pcs-wr2', season: SEASON, week: 1, receiving_yards: 320 },
    { player_id: 'pcs-wr3', season: SEASON, week: 1, receiving_yards: 50 },
    { player_id: 'pcs-rb1', season: SEASON, week: 1, rush_yards: 400 },
    // 2078 — the preset fixture line (wk1), a stored zero line (wk2 — did
    // not play), and a still-live row (wk3).
    { player_id: 'pcs-wr5', season: 2078, week: 1, receptions: 5, receiving_yards: 80, receiving_tds: 1 },
    { player_id: 'pcs-wr5', season: 2078, week: 2, receptions: 0, receiving_yards: 0 },
    { player_id: 'pcs-wr5', season: 2078, week: 3, receiving_yards: 30, is_live: true },
  ])
  if (stats.error) throw new Error(stats.error.message)
})

afterAll(cleanup)

async function read(id: string, system: ScoringSystemKey = 'espn_standard', season = SEASON) {
  const r = await readPlayerCoreStats(anon, id, { kind: 'system', system }, clock, { defaultSeason: season })
  return { status: r.status, body: r.body as unknown as CoreStatsPayload }
}

describe('core stats read — default scoring over the whole pool', () => {
  it('season points, bye-free avg, tied ranks', async () => {
    const r = await read('pcs-wr1')
    expect(r.status).toBe(200)
    expect(r.body).toEqual({
      basis: { kind: 'system', system: 'espn_standard' },
      season: SEASON,
      week: null,
      total_points: 32,
      games: 2,
      avg_points: 16,
      projected_points: null,
      pos_rank: 1,
      overall_rank: 2,
      // D486(12) table weeks + D486(14) key stats (wk 9 is his bye — not a game).
      weekly: [
        { week: 1, points: 16, proj: null },
        { week: 2, points: 16, proj: null },
      ],
      // Box columns default to 0 in the schema, so a stored 0 comes back as 0.
      box: { games: 2, totals: expect.objectContaining({ receiving_yards: 200, receiving_tds: 2, targets: 0 }) },
      usage: null,
    })
    const two = await read('pcs-wr2')
    expect([two.body.total_points, two.body.pos_rank, two.body.overall_rank]).toEqual([32, 1, 2])
    const three = await read('pcs-wr3')
    expect([three.body.total_points, three.body.pos_rank, three.body.overall_rank]).toEqual([5, 3, 4])
    const rb = await read('pcs-rb1')
    expect([rb.body.total_points, rb.body.pos_rank, rb.body.overall_rank]).toEqual([40, 1, 1])
  })

  it('no games → NULL total, NULL avg, unranked (never 0)', async () => {
    const r = await read('pcs-wr4')
    expect(r.status).toBe(200)
    expect([r.body.total_points, r.body.games, r.body.avg_points, r.body.pos_rank, r.body.overall_rank]).toEqual([null, 0, null, null, null])
  })

  it('R1504: each preset scores the fixture line — ESPN 14, Half 16.5, Full PPR 19 (the completed-weeks avg); totals add the live wk3', async () => {
    const got: Record<string, [number | null, number | null, number, string]> = {}
    for (const sys of ['espn_standard', 'half_ppr', 'ppr'] as const) {
      const r = await read('pcs-wr5', sys, 2078)
      expect(r.status).toBe(200)
      got[sys] = [r.body.avg_points, r.body.total_points, r.body.games, JSON.stringify(r.body.basis)]
    }
    expect(got).toEqual({
      espn_standard: [14, 17, 1, '{"kind":"system","system":"espn_standard"}'],
      half_ppr: [16.5, 19.5, 1, '{"kind":"system","system":"half_ppr"}'],
      ppr: [19, 22, 1, '{"kind":"system","system":"ppr"}'],
    })
  })

  it('an unknown player is a 404', async () => {
    expect((await read('pcs-nobody')).status).toBe(404)
  })
})

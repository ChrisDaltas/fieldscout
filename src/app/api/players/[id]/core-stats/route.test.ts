/**
 * The cached pool (R1503) is what production reads for a preset player page's
 * total, average and ranks, so it has to prepare lines the way the page's own
 * weekly cells do (K0). A pool that read stored lines would show a kicker a top
 * row of 10 above cells of 13 and 8. No database: the Supabase stand-in returns
 * only what a read selected.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { BASS_2026_WK1, BOSWELL_2026_WK8, cowboysThroughKickoff, fakeSupabase, storedGame } from '@/lib/players/preset-scoring.fixtures'

import { GET } from './route'

const cached = vi.hoisted(() => [] as string[][])

vi.mock('next/cache', () => ({
  unstable_cache: (run: () => Promise<unknown>, keys: string[]) => {
    cached.push(keys)
    return run
  },
}))

const tables = {
  players: [
    { id: 'BASS', position: 'K', bye_week: null },
    { id: 'DAL', position: 'DEF', bye_week: null },
  ],
  player_stats: [storedGame('BASS', 2026, 1, BASS_2026_WK1), storedGame('BASS', 2026, 8, BOSWELL_2026_WK8), ...cowboysThroughKickoff()],
}

vi.mock('@supabase/supabase-js', () => ({ createClient: () => fakeSupabase(tables) }))
vi.mock('@/lib/supabase/server', () => ({
  createServerClient: async () => ({ ...fakeSupabase(tables), auth: { getUser: async () => ({ data: { user: { id: 'viewer' } } }) } }),
}))

async function read(id: string) {
  const response = await GET(new Request(`http://test/api/players/${id}/core-stats?scoring=espn_standard`), { params: Promise.resolve({ id }) })
  expect(response.status).toBe(200)
  return (await response.json()) as { total_points: number; weekly: Array<{ week: number; points: number | null }> }
}

describe('GET /api/players/[id]/core-stats, a preset, through the cached pool', () => {
  beforeEach(() => {
    cached.length = 0
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'http://test')
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', 'test')
  })

  it('a kicker: the total is his worked-out games, 13 + 8, and agrees with the weekly cells', async () => {
    const body = await read('BASS')
    expect(cached).toHaveLength(1)
    expect(cached[0]?.slice(0, 3)).toEqual(['player-core-stats-pool', 'espn_standard', '2026'])
    expect(body.total_points).toBe(21)
    expect(body.weekly.filter((cell) => cell.points !== null).map((cell) => [cell.week, cell.points])).toEqual([
      [1, 13],
      [8, 8],
    ])
  })

  it('a D/ST: a refused live game adds nothing, −2 + 5 = 3 (stored lines would pay it +5)', async () => {
    const body = await read('DAL')
    expect(cached).toHaveLength(1)
    expect(body.total_points).toBe(3)
  })
})

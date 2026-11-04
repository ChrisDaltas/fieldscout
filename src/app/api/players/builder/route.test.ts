import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * The Stats Center's numbers (K0): a kicker reads ESPN's table, and a refused
 * game adds no points, no count and no season totals. No database.
 */
import { BASS_2026_WK1, BOSWELL_2026_WK8, cowboysThroughKickoff, storedGame } from '@/lib/players/preset-scoring.fixtures'

const tables = vi.hoisted(() => ({ current: {} as Record<string, readonly Record<string, unknown>[]> }))

vi.mock('@/lib/supabase/server', async () => {
  const { fakeSupabase } = await import('@/lib/players/preset-scoring.fixtures')
  return { createServerClient: async () => fakeSupabase(tables.current) }
})

import { GET } from './route'

const pool = [
  { id: 'K1', full_name: 'K One', position: 'K', team: 'BUF', projected_pts_ppr: 116 },
  { id: 'DAL', full_name: 'Dallas', position: 'DEF', team: 'DAL', projected_pts_ppr: 90 },
  { id: 'SEA', full_name: 'Seattle', position: 'DEF', team: 'SEA', projected_pts_ppr: 106 },
]

interface PoolPlayer {
  id: string
  current_pts: number
  current_games: number
  last_pts: number
  last_games: number
  projected_pts: number | null
  stats_current: Record<string, number>
}

async function read(): Promise<Map<string, PoolPlayer>> {
  const res = await GET(new Request('http://x.test/api/players/builder?scoring=ppr'))
  expect(res.status).toBe(200)
  const body = (await res.json()) as { players: PoolPlayer[] }
  return new Map(body.players.map((p) => [p.id, p]))
}

beforeEach(() => {
  tables.current = {
    players: pool,
    player_stats: [
      storedGame('K1', 2026, 1, BASS_2026_WK1),
      storedGame('K1', 2026, 8, BOSWELL_2026_WK8),
      ...cowboysThroughKickoff(),
      storedGame('SEA', 2026, 1, { sack: 2 }, { def_points_allowed: null, def_yards_allowed: 300, is_live: true }),
    ],
  }
})

describe('/api/players/builder', () => {
  it('a kicker reads ESPN table: Bass 13 + Boswell 8, paced on scored games', async () => {
    const k = (await read()).get('K1')
    expect(k).toMatchObject({ current_pts: 21, current_games: 2, projected_pts: 178.5 })
  })

  it('a refused game adds no points, no count and no totals', async () => {
    const dal = (await read()).get('DAL')
    expect(dal).toMatchObject({ current_pts: 3, current_games: 2, projected_pts: 25.5 })
    expect(dal?.stats_current.def_sacks).toBe(4)
  })

  it('a D/ST whose only game is refused has 0 games and falls through to its stored projection', async () => {
    const sea = (await read()).get('SEA')
    expect(sea).toMatchObject({ current_pts: 0, current_games: 0, projected_pts: 106 })
    expect(sea?.stats_current.def_sacks).toBeUndefined()
  })
})

import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * The desktop player card's numbers (K0). No database: a stand-in that returns
 * only the columns the route selected, so a wrong SELECT throws here too.
 */
import type { PlayerStatsResponse } from '@/hooks/use-player-stats'
import {
  BASS_2026_WK1,
  BOSWELL_2026_WK8,
  cowboysThroughKickoff,
  KICKOFF_DST,
  PRESCOTT_2025_WK1,
  SEA_2026_WK1,
  storedGame,
} from '@/lib/players/preset-scoring.fixtures'

const tables = vi.hoisted(() => ({ current: {} as Record<string, readonly Record<string, unknown>[]> }))

vi.mock('@/lib/supabase/server', async () => {
  const { fakeSupabase: fake } = await import('@/lib/players/preset-scoring.fixtures')
  return { createServerClient: async () => fake(tables.current) }
})

import { GET } from './route'

const playerRow = (id: string, position: string, over: Record<string, unknown> = {}) => ({
  id,
  full_name: id,
  position,
  projected_stats: null,
  projected_pts_ppr: null,
  projected_pts_standard: null,
  ...over,
})

async function card(player: Record<string, unknown>, games: ReadonlyArray<Record<string, unknown>>): Promise<PlayerStatsResponse> {
  tables.current = { players: [player], player_stats: games }
  const res = await GET(new Request('http://x.test'), { params: Promise.resolve({ id: String(player.id) }) })
  expect(res.status).toBe(200)
  return (await res.json()) as PlayerStatsResponse
}

beforeEach(() => {
  tables.current = {}
})

describe('/api/players/[id]/stats', () => {
  it('a kicker: season 21 (Bass 13 + Boswell 8), pace 178.5, one number under both scorings', async () => {
    const data = await card(playerRow('K1', 'K'), [storedGame('K1', 2026, 1, BASS_2026_WK1), storedGame('K1', 2026, 8, BOSWELL_2026_WK8)])
    expect(data.seasons.current).toMatchObject({ gamesPlayed: 2, fantasy: { ppr: 21, standard: 21 } })
    expect(data.seasons.projection).toMatchObject({ basis: 'pace', fantasy: { ppr: 178.5, standard: 178.5 } })
    expect(data.gameLog.map((g) => g.fantasy.ppr)).toEqual([13, 8])
  })

  it('a refused game is not a game: Cowboys 5 and 6 final, 7 a live kickoff row, is 2 games, 3 points, pace 25.5', async () => {
    const data = await card(playerRow('DAL', 'DEF'), cowboysThroughKickoff())
    expect(data.seasons.current).toMatchObject({ gamesPlayed: 2, fantasy: { ppr: 3, standard: 3 } })
    expect(data.seasons.projection).toMatchObject({ basis: 'pace', fantasy: { ppr: 25.5, standard: 25.5 } })
    // The game log keeps the row, as a dash.
    expect(data.gameLog.map((g) => g.fantasy.ppr)).toEqual([-2, 5, null])
    // Week 7's totals don't reach the season line.
    expect(data.seasons.current.totals.def_sacks).toBe(4)
  })

  it('pre-season K and D/ST read the stored totals (116, 106), and a missing one is null, not a 0', async () => {
    const line = { xp_made: 42, fg_made_40_plus: 9, fg_made_50_plus: 8 }
    const k = await card(playerRow('K1', 'K', { projected_stats: line, projected_pts_ppr: 116, projected_pts_standard: 116 }), [])
    expect(k.seasons.projection).toMatchObject({ basis: 'projections', fantasy: { ppr: 116, standard: 116 } })
    expect(k.seasons.current.fantasy).toEqual({ ppr: null, standard: null })
    const d = await card(playerRow('LAR', 'DEF', { projected_stats: { def_sacks: 52 }, projected_pts_ppr: 106, projected_pts_standard: 106 }), [])
    expect(d.seasons.projection).toMatchObject({ basis: 'projections', fantasy: { ppr: 106, standard: 106 } })
    const none = await card(playerRow('K2', 'K', { projected_stats: line }), [])
    expect(none.seasons.projection).toMatchObject({ basis: 'projections', fantasy: { ppr: null, standard: null } })
  })

  it('every game refused falls through to the stored projection, as the Stats Center does: never a division by 0', async () => {
    const stored = { projected_stats: { def_sacks: 52 }, projected_pts_ppr: 106, projected_pts_standard: 90 }
    const data = await card(playerRow('SEA', 'DEF', stored), [storedGame('SEA', 2026, 1, KICKOFF_DST, { is_live: true })])
    expect(data.seasons.current).toMatchObject({ gamesPlayed: 0, fantasy: { ppr: null, standard: null } })
    expect(data.seasons.projection).toMatchObject({ basis: 'projections', fantasy: { ppr: 106, standard: 90 } })
    expect(data.gameLog.map((g) => g.fantasy)).toEqual([{ ppr: null, standard: null }])
    const noLine = await card(playerRow('SEA', 'DEF', { ...stored, projected_stats: {} }), [storedGame('SEA', 2026, 1, KICKOFF_DST)])
    expect(noLine.seasons.projection).toMatchObject({ basis: 'projections', fantasy: { ppr: 106, standard: 90 } })
  })

  it('no Sleeper line and no stored total: the last_season basis reuses last season, per game', async () => {
    const data = await card(playerRow('SEA', 'DEF'), [storedGame('SEA', 2025, 1, SEA_2026_WK1)])
    expect(data.seasons.last).toMatchObject({ gamesPlayed: 1, fantasy: { ppr: 14, standard: 14 } })
    expect(data.seasons.projection).toMatchObject({ basis: 'last_season', fantasy: { ppr: 14, standard: 14 } })
  })

  it('a WR paces each stat, as before: PPR 227.3, Standard 142.3 (hand-checked against the old calculator)', async () => {
    const data = await card(playerRow('WR1', 'WR'), [
      storedGame('WR1', 2026, 1, { rec: 6, rec_yd: 85, rec_td: 1 }),
      storedGame('WR1', 2026, 2, { rec: 4, rec_yd: 40, fum_lost: 1 }),
    ])
    expect(data.seasons.current).toMatchObject({ gamesPlayed: 2, fantasy: { ppr: 26.5, standard: 16.5 } })
    expect(data.seasons.projection).toMatchObject({ basis: 'pace', fantasy: { ppr: 227.3, standard: 142.3 } })
  })

  it('a WR with no games reads 0, and pre-season scores his projected stat line', async () => {
    const data = await card(playerRow('WR1', 'WR', { projected_stats: { receptions: 80, receiving_yards: 1000, receiving_tds: 6 } }), [])
    expect(data.seasons.current.fantasy).toEqual({ ppr: 0, standard: 0 })
    expect(data.seasons.projection).toMatchObject({ basis: 'projections', fantasy: { ppr: 216, standard: 136 } })
  })

  it('a game-log value keeps the route 1-decimal contract, so offense shows no difference: Prescott 7.82 is 7.8', async () => {
    const data = await card(playerRow('QB1', 'QB'), [storedGame('QB1', 2026, 1, PRESCOTT_2025_WK1)])
    expect(data.gameLog[0]?.fantasy).toEqual({ ppr: 7.8, standard: 7.8 })
  })

  it('a game-log value just below zero never prints as -0.0', async () => {
    const data = await card(playerRow('QB1', 'QB'), [storedGame('QB1', 2026, 1, { pass_yd: -1 })])
    expect(JSON.stringify(data.gameLog[0]?.fantasy.ppr)).toBe('0')
  })
})

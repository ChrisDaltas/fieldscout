/**
 * The list payload's numbers (K0): each game scored alone by the one preset
 * scorer, with the current-versus-live split kept. No database: a stand-in that
 * returns only the columns the read selected.
 */
import { describe, expect, it } from 'vitest'

import {
  BASS_2026_WK1,
  BOSWELL_2026_WK8,
  cowboysThroughKickoff,
  fakeSupabase,
  KICKOFF_DST,
  storedGame,
} from '@/lib/players/preset-scoring.fixtures'

import { aggregateFantasyStats } from './aggregate-fantasy'

const players = [
  { id: 'BASS', position: 'K', projected_pts_ppr: 116, projected_pts_standard: 116, projected_pts_half_ppr: 116 },
  { id: 'DAL', position: 'DEF', projected_pts_ppr: 106, projected_pts_standard: 106, projected_pts_half_ppr: 106 },
  { id: 'SEA', position: 'DEF', projected_pts_ppr: 106, projected_pts_standard: 106, projected_pts_half_ppr: 106 },
  { id: 'WR1', position: 'WR', projected_pts_ppr: 200, projected_pts_standard: 150, projected_pts_half_ppr: 175 },
  { id: 'NONE', position: 'K', projected_pts_ppr: null, projected_pts_standard: null, projected_pts_half_ppr: null },
]

describe('aggregateFantasyStats', () => {
  it('a kicker reads ESPN table and paces on points per game: 21 over 2 games, 178.5', async () => {
    const client = fakeSupabase({
      players,
      player_stats: [storedGame('BASS', 2026, 1, BASS_2026_WK1), storedGame('BASS', 2026, 8, BOSWELL_2026_WK8)],
    })
    const stats = await aggregateFantasyStats(client, ['BASS'], 'standard')
    expect(stats.get('BASS')).toEqual({ current_pts: 21, current_games: 2, last_pts: null, last_games: 0, projected_pts: 178.5 })
  })

  it('a refused game counts for nothing: Cowboys 5 and 6 final, 7 live at kickoff, is 3 over 2 games, pace 25.5, under every scoring', async () => {
    const client = fakeSupabase({ players, player_stats: cowboysThroughKickoff() })
    for (const scoring of ['ppr', 'half_ppr', 'standard'] as const) {
      const stats = await aggregateFantasyStats(client, ['DAL'], scoring)
      expect(stats.get('DAL'), scoring).toEqual({ current_pts: 3, current_games: 2, last_pts: null, last_games: 0, projected_pts: 25.5 })
    }
  })

  it('every game refused falls through to the stored projection, as the Stats Center does', async () => {
    const client = fakeSupabase({ players, player_stats: [storedGame('SEA', 2026, 1, KICKOFF_DST, { is_live: true })] })
    const stats = await aggregateFantasyStats(client, ['SEA'], 'ppr')
    expect(stats.get('SEA')).toEqual({ current_pts: null, current_games: 0, last_pts: null, last_games: 0, projected_pts: 106 })
  })

  it('K and D/ST with no number read null, not 0; a WR with no games still reads 0', async () => {
    const client = fakeSupabase({ players, player_stats: [] })
    const stats = await aggregateFantasyStats(client, ['NONE', 'WR1'], 'ppr')
    expect(stats.get('NONE')).toEqual({ current_pts: null, current_games: 0, last_pts: null, last_games: 0, projected_pts: null })
    expect(stats.get('WR1')).toEqual({ current_pts: 0, current_games: 0, last_pts: 0, last_games: 0, projected_pts: 200 })
  })

  it('offense scores under the chosen scoring, and last season is its own bucket', async () => {
    const line = { rec: 10, rec_yd: 100, rec_td: 1 }
    const client = fakeSupabase({ players, player_stats: [storedGame('WR1', 2025, 1, line)] })
    const ppr = await aggregateFantasyStats(client, ['WR1'], 'ppr')
    const std = await aggregateFantasyStats(client, ['WR1'], 'standard')
    expect(ppr.get('WR1')?.last_pts).toBe(26)
    expect(std.get('WR1')?.last_pts).toBe(16)
    expect(ppr.get('WR1')?.last_games).toBe(1)
  })

  it('mock rows count toward current but never toward the live pace', async () => {
    const client = fakeSupabase({
      players,
      player_stats: [
        storedGame('BASS', 2026, 1, BASS_2026_WK1),
        storedGame('BASS', 2026, 2, BOSWELL_2026_WK8, { source: 'mock' }),
      ],
    })
    const stats = await aggregateFantasyStats(client, ['BASS'], 'ppr')
    expect(stats.get('BASS')?.current_pts).toBe(21)
    expect(stats.get('BASS')?.current_games).toBe(2)
    expect(stats.get('BASS')?.projected_pts).toBe(221) // 13 live, paced over 17
  })

  it('a player with rows and no position fails loudly, so a list route shows no stats rather than a 0', async () => {
    const client = fakeSupabase({
      players: [{ id: 'GHOST', position: null, projected_pts_ppr: null }],
      player_stats: [storedGame('GHOST', 2026, 1, BASS_2026_WK1)],
    })
    await expect(aggregateFantasyStats(client, ['GHOST'], 'ppr')).rejects.toThrow(/no position/)
  })
})

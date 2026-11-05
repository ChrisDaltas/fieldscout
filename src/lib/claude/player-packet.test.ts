/** What the AI's prompt reads for last season (K0): the one preset scorer, each
 *  game alone. No generation runs here. */
import { describe, expect, it } from 'vitest'

import { BASS_2026_WK1, cowboysThroughKickoff, JEANTY_2025_WK2, storedGame } from '@/lib/players/preset-scoring.fixtures'

import { aggregateLastSeason } from './player-packet'

describe('aggregateLastSeason', () => {
  it('a kicker reads ESPN table', () => {
    expect(aggregateLastSeason([storedGame('k', 2025, 1, BASS_2026_WK1)], 'K', 'ppr')).toEqual({
      points: 13,
      games: 1,
      targets: 0,
      receptions: 0,
      rushAttempts: 0,
    })
  })

  it('a D/ST sums its games, and a refused game counts for nothing', () => {
    expect(aggregateLastSeason(cowboysThroughKickoff(), 'DEF', 'standard')).toMatchObject({ points: 3, games: 2 })
  })

  it('no scored game is null, which the prompt prints as "no stats": for offense too, as before', () => {
    expect(aggregateLastSeason([storedGame('k', 2025, 1, {})], 'K', 'ppr').points).toBeNull()
    expect(aggregateLastSeason([], 'WR', 'ppr').points).toBeNull()
  })

  it('offense scores under the format and keeps the volume sums', () => {
    const rows = [storedGame('r', 2025, 2, JEANTY_2025_WK2, { rush_attempts: 12, targets: 4 })]
    expect(aggregateLastSeason(rows, 'RB', 'ppr')).toEqual({ points: 7.4, games: 1, targets: 4, receptions: 3, rushAttempts: 12 })
    expect(aggregateLastSeason(rows, 'RB', 'half_ppr').points).toBe(5.9)
    expect(aggregateLastSeason(rows, 'RB', 'standard').points).toBe(4.4)
  })
})

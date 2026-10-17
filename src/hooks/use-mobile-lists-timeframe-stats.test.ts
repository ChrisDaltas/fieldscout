/** A frame's points under each list scoring (gap list #19). */
import { describe, expect, it } from 'vitest'

import { frameTotals } from './use-mobile-lists-timeframe-stats'

const row = (over: Record<string, number>) => ({ player_id: 'p1', season: 2026, week: 1, source: null, ...over })

describe('frameTotals', () => {
  it('sums the games and scores them four ways (only the catch value differs)', () => {
    const totals = frameTotals([
      row({ receptions: 6, receiving_yards: 80, receiving_tds: 1 }),
      row({ receptions: 2, receiving_yards: 20 }),
    ])
    // Standard: 100 yds × 0.1 + 1 TD × 6 = 16; catches: 8.
    expect(totals?.games).toBe(2)
    expect(totals?.receptions).toBe(8)
    expect(totals?.pts).toEqual({ standard: 16, quarter: 18, half: 20, ppr: 24 })
  })

  it('no games is no frame', () => {
    expect(frameTotals([])).toBeNull()
  })
})

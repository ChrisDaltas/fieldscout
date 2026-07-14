import { describe, expect, it } from 'vitest'

import {
  computeMatchupFactors,
  computePositionalSosRanks,
  rankSplits,
  splitKey,
  type WeeklyProjectionRow,
} from './splits'

// One RB projected at a 10-point weekly baseline: soft matchup vs GEN
// (12 pts, +20%), tough matchup vs STL (8 pts, −20%).
const rows: WeeklyProjectionRow[] = [
  { playerId: 'a', position: 'RB', opponent: 'GEN', points: 12 },
  { playerId: 'a', position: 'RB', opponent: 'STL', points: 8 },
  { playerId: 'a', position: 'RB', opponent: 'MID', points: 10 },
]

describe('computeMatchupFactors', () => {
  it('derives factors from deviation off each player’s own average', () => {
    const splits = computeMatchupFactors(rows)
    expect(splits.get(splitKey('GEN', 'RB'))?.factor).toBeCloseTo(1.2)
    expect(splits.get(splitKey('STL', 'RB'))?.factor).toBeCloseTo(0.8)
    expect(splits.get(splitKey('MID', 'RB'))?.factor).toBeCloseTo(1.0)
  })

  it('volume-weights so near-zero players cannot swing the factor', () => {
    const withScrub: WeeklyProjectionRow[] = [
      ...rows,
      // Scrub averaging 0.5/wk spikes to 1.0 vs GEN — a 2× ratio, but only
      // half a point of volume. GEN's factor should stay ≈ the star's 1.2.
      { playerId: 'scrub', position: 'RB', opponent: 'GEN', points: 1 },
      { playerId: 'scrub', position: 'RB', opponent: 'STL', points: 0 },
    ]
    const factor = computeMatchupFactors(withScrub).get(splitKey('GEN', 'RB'))!.factor
    expect(factor).toBeGreaterThan(1.15)
    expect(factor).toBeLessThan(1.3)
  })

  it('keeps positions separate', () => {
    const mixed: WeeklyProjectionRow[] = [
      ...rows,
      { playerId: 'wr1', position: 'WR', opponent: 'GEN', points: 8 },
      { playerId: 'wr1', position: 'WR', opponent: 'STL', points: 12 },
    ]
    const splits = computeMatchupFactors(mixed)
    // GEN is soft for RBs but tough for WRs — the positional difference.
    expect(splits.get(splitKey('GEN', 'RB'))!.factor).toBeGreaterThan(1)
    expect(splits.get(splitKey('GEN', 'WR'))!.factor).toBeLessThan(1)
  })
})

describe('rankSplits', () => {
  it('ranks 1 = most generous within each position', () => {
    const ranks = rankSplits(computeMatchupFactors(rows))
    expect(ranks.get(splitKey('GEN', 'RB'))).toBe(1)
    expect(ranks.get(splitKey('MID', 'RB'))).toBe(2)
    expect(ranks.get(splitKey('STL', 'RB'))).toBe(3)
  })
})

describe('computePositionalSosRanks', () => {
  it('ranks a team facing generous defenses as the easiest schedule', () => {
    const splits = computeMatchupFactors(rows)
    // EAS plays GEN twice; HRD plays STL twice; MIX plays one of each.
    const games = [
      { week: 1, home: 'EAS', away: 'GEN' },
      { week: 2, home: 'GEN', away: 'EAS' },
      { week: 1, home: 'HRD', away: 'STL' },
      { week: 2, home: 'STL', away: 'HRD' },
      { week: 3, home: 'MIX', away: 'GEN' },
      { week: 4, home: 'STL', away: 'MIX' },
    ]
    const ranks = computePositionalSosRanks(games, splits)
    expect(ranks.get(splitKey('EAS', 'RB'))).toBe(1)
    expect(ranks.get(splitKey('MIX', 'RB'))).toBeLessThan(
      ranks.get(splitKey('HRD', 'RB'))!,
    )
  })

  it('omits teams whose opponents have no splits for the position', () => {
    const ranks = computePositionalSosRanks(
      [{ week: 1, home: 'X', away: 'Y' }],
      computeMatchupFactors(rows),
    )
    expect(ranks.has(splitKey('X', 'RB'))).toBe(false)
  })
})

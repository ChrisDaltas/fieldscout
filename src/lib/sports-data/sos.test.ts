import { describe, expect, it } from 'vitest'

import {
  computeSosRanks,
  computeTeamStrength,
  type ScheduleGame,
} from './sos'

describe('computeTeamStrength', () => {
  it('sums projected points per team', () => {
    const strength = computeTeamStrength([
      { team: 'ATL', projected: 300 },
      { team: 'ATL', projected: 200 },
      { team: 'CAR', projected: 150 },
      { team: null, projected: 999 },
      { team: 'CAR', projected: null },
    ])
    expect(strength.get('ATL')).toBe(500)
    expect(strength.get('CAR')).toBe(150)
    expect(strength.has('FA')).toBe(false)
  })

  it('caps each team at its top players so bench depth cannot inflate strength', () => {
    const deepBench = Array.from({ length: 30 }, () => ({
      team: 'DEN',
      projected: 10,
    }))
    const topHeavy = Array.from({ length: 11 }, () => ({
      team: 'KC',
      projected: 10,
    }))
    const strength = computeTeamStrength([...deepBench, ...topHeavy])
    // 30 × 10 capped to top-11 × 10 — same as KC's 11 players.
    expect(strength.get('DEN')).toBe(strength.get('KC'))
  })

  it('ignores zero and negative projections', () => {
    const strength = computeTeamStrength([
      { team: 'NYJ', projected: 100 },
      { team: 'NYJ', projected: 0 },
      { team: 'NYJ', projected: -5 },
    ])
    expect(strength.get('NYJ')).toBe(100)
  })
})

describe('computeSosRanks', () => {
  // Round-robin: A plays B+C, B plays A+C, C plays A+B.
  const games: ScheduleGame[] = [
    { week: 1, home: 'A', away: 'B' },
    { week: 2, home: 'C', away: 'A' },
    { week: 3, home: 'B', away: 'C' },
  ]

  it('ranks 1 = easiest (weakest average opponents)', () => {
    const strength = new Map([
      ['A', 1000], // strongest team
      ['B', 500],
      ['C', 100], // weakest team
    ])
    const ranks = computeSosRanks(games, strength)
    // A faces B+C (avg 300) — easiest. C faces A+B (avg 750) — hardest.
    expect(ranks.get('A')).toBe(1)
    expect(ranks.get('B')).toBe(2)
    expect(ranks.get('C')).toBe(3)
  })

  it('omits teams whose opponents have no strength data', () => {
    const ranks = computeSosRanks(
      [{ week: 1, home: 'X', away: 'Y' }],
      new Map([['Z', 100]]),
    )
    expect(ranks.size).toBe(0)
  })
})

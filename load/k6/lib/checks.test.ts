import { describe, expect, it } from 'vitest'

import { allPass, describeTrend, duplicatePicks, judgeStorm, percentile, renderAsserts, type BidRow } from './checks'

describe('percentile (nearest rank)', () => {
  it('golden values', () => {
    const v = [5, 1, 4, 2, 3, 10, 9, 8, 7, 6]
    expect(percentile(v, 50)).toBe(5)
    expect(percentile(v, 95)).toBe(10)
    expect(percentile(v, 90)).toBe(9)
    expect(percentile([42], 95)).toBe(42)
    expect(percentile([], 95)).toBeNull()
  })
  it('the boundary of the §22.6 (1) assert: 19 fast + 1 slow is p95 fast; 18 + 2 is p95 slow', () => {
    const fast = Array(19).fill(100)
    expect(percentile([...fast, 900], 95)).toBe(100)
    expect(percentile([...Array(18).fill(100), 900, 900], 95)).toBe(900)
  })
  it('refuses a nonsense p', () => {
    expect(() => percentile([1], 0)).toThrow(RangeError)
    expect(() => percentile([1], 101)).toThrow(RangeError)
  })
})

describe('duplicatePicks (§22.6 (1) "zero duplicate picks")', () => {
  it('flags a player drafted twice and a pick number written twice', () => {
    const r = duplicatePicks([
      { pick_number: 1, player_id: 'a', team_id: 't1', is_undone: false },
      { pick_number: 2, player_id: 'a', team_id: 't2', is_undone: false },
      { pick_number: 2, player_id: 'b', team_id: 't2', is_undone: null },
    ])
    expect(r).toEqual({ duplicatePlayers: ['a'], duplicatePickNumbers: [2] })
  })
  it('an UNDONE pick does not count (the board took it back)', () => {
    const r = duplicatePicks([
      { pick_number: 1, player_id: 'a', team_id: 't1', is_undone: true },
      { pick_number: 1, player_id: 'a', team_id: 't2', is_undone: false },
    ])
    expect(r).toEqual({ duplicatePlayers: [], duplicatePickNumbers: [] })
  })
})

describe('judgeStorm (§22.6 (2) / §22.1 serialization)', () => {
  const bid = (amount: number, at: string, voided: string | null = null, seq = 7): BidRow => ({
    nomination_seq: seq,
    team_id: 't',
    amount,
    created_at: at,
    voided_at: voided,
  })
  it('rising bids in commit order are serialized; the award at the high bid matches', () => {
    const v = judgeStorm(7, [bid(1, '2026-01-01T00:00:00.000Z'), bid(2, '2026-01-01T00:00:00.100Z'), bid(5, '2026-01-01T00:00:00.200Z')], 5)
    expect(v).toMatchObject({ bids: 3, serialized: true, maxAmount: 5, awardMatchesHigh: true })
  })
  it('a later commit at a lower-or-equal amount is NOT serialized', () => {
    expect(judgeStorm(7, [bid(1, '2026-01-01T00:00:00.000Z'), bid(3, '2026-01-01T00:00:00.100Z'), bid(3, '2026-01-01T00:00:00.200Z')], null).serialized).toBe(false)
  })
  it('an award below the high bid is flagged; voided rows and other nominations are ignored', () => {
    const v = judgeStorm(7, [bid(1, '2026-01-01T00:00:00.000Z'), bid(9, '2026-01-01T00:00:00.100Z', '2026-01-01T00:00:01Z'), bid(4, '2026-01-01T00:00:00.200Z'), bid(50, '2026-01-01T00:00:00.300Z', null, 8)], 3)
    expect(v).toMatchObject({ bids: 2, maxAmount: 4, awardedPrice: 3, awardMatchesHigh: false })
  })
})

describe('renderAsserts', () => {
  it('INFO lines are printed and never counted', () => {
    const lines = [
      { name: 'a', pass: true, detail: 'x' },
      { name: 'b', pass: true, detail: 'y', info: true },
    ]
    expect(renderAsserts('H', lines)).toEqual(['H', '  PASS  a — x', '  INFO  b — y', '  GREEN: 1/1 asserts'])
    expect(allPass([...lines, { name: 'c', pass: false, detail: 'z' }])).toBe(false)
  })
  it('describeTrend names the sample count', () => {
    expect(describeTrend([])).toBe('no samples')
    expect(describeTrend([10, 20, 30])).toBe('p50 20 ms · p95 30 ms · max 30 ms over 3 samples')
  })
})

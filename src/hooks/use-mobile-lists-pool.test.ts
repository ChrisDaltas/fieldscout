/** Pos rk in the list's scoring (gap list #19). */
import { describe, expect, it } from 'vitest'

import { posRanks, quarterPosRanks, type PoolPlayer } from './use-mobile-lists-pool'

const p = (id: string, position: string, current_pts: number, current_games = 4): PoolPlayer => ({
  id,
  full_name: id,
  position,
  team: null,
  headshot_url: null,
  status: null,
  projected_pts: null,
  current_pts,
  current_games,
})

describe('posRanks', () => {
  it('ranks within each position by season points, skipping players with no games', () => {
    const ranks = posRanks([p('a', 'WR', 80), p('b', 'WR', 90), p('c', 'RB', 70), p('d', 'WR', 200, 0)])
    expect([...ranks]).toEqual([
      ['b', 1],
      ['a', 2],
      ['c', 1],
    ])
  })

  it('Quarter PPR is ¾ Standard + ¼ PPR — a catch-heavy player can pass a runner', () => {
    // a: 40 catches (PPR 100, Std 60); b: 4 catches (PPR 74, Std 70).
    const ppr = [p('a', 'RB', 100), p('b', 'RB', 74)]
    const std = [p('a', 'RB', 60), p('b', 'RB', 70)]
    expect(posRanks(std).get('a')).toBe(2)
    expect(posRanks(ppr).get('a')).toBe(1)
    // Quarter: a = ¾·60 + ¼·100 = 70, b = ¾·70 + ¼·74 = 71 → b first.
    expect(quarterPosRanks(ppr, std).get('b')).toBe(1)
    // With 62 Standard points a reaches 71.5 and passes b.
    expect(quarterPosRanks(ppr, [p('a', 'RB', 62), p('b', 'RB', 70)]).get('a')).toBe(1)
  })
})

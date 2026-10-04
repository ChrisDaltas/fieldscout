import { describe, expect, it } from 'vitest'

import { avgPerGame, basisLabel, competitionRanks, coreTiles, type CoreStatsPayload, gamesPlayed, MISSING } from './core-stats-ops'

const player = { position: 'WR', sos: 7, bye_week: 9 }

function payload(over: Partial<CoreStatsPayload> = {}): CoreStatsPayload {
  return {
    basis: { kind: 'default' },
    season: 2026,
    week: 5,
    total_points: 84.6,
    games: 4,
    avg_points: 21.15,
    projected_points: 17.3,
    pos_rank: 12,
    overall_rank: 31,
    ...over,
  }
}

describe('core stats — ranks (standard competition ranking)', () => {
  it('ties share a rank and the next rank skips; no-games players are unranked', () => {
    const ranks = competitionRanks(
      new Map<string, number | null>([
        ['a', 100],
        ['b', 90],
        ['c', 90],
        ['d', 80],
        ['e', null],
      ]),
    )
    expect(Object.fromEntries(ranks)).toEqual({ a: 1, b: 2, c: 2, d: 4 })
    expect(ranks.has('e')).toBe(false)
  })

  it('a negative season still ranks below zero', () => {
    const ranks = competitionRanks(new Map<string, number | null>([['x', -2], ['y', 0]]))
    expect(ranks.get('y')).toBe(1)
    expect(ranks.get('x')).toBe(2)
  })
})

describe('core stats — avg per game', () => {
  it('a bye week is not a game', () => {
    expect(gamesPlayed([1, 2, 3, 9, 10], 9)).toBe(4)
    expect(avgPerGame(80, gamesPlayed([1, 2, 3, 9, 10], 9))).toBe(20)
  })

  it('no games → null (the tile shows —), never 0', () => {
    expect(avgPerGame(null, 0)).toBeNull()
    expect(avgPerGame(0, 0)).toBeNull()
  })

  it('rounds to the stored precision (2dp half-up)', () => {
    expect(avgPerGame(10, 3)).toBe(3.33)
  })
})

describe('core stats — basis label', () => {
  it('names the league, or the default', () => {
    expect(basisLabel({ kind: 'league', league_name: 'Hadouken Bowl' })).toBe('Hadouken Bowl scoring')
    expect(basisLabel({ kind: 'default' })).toBe('Standard scoring')
  })
})

describe('core stats — tiles', () => {
  it("Chris's seven, in his order", () => {
    expect(coreTiles(payload(), player).map((t) => [t.key, t.value])).toEqual([
      ['total', '84.6'],
      ['avg', '21.1'],
      ['proj', '17.3'],
      ['pos-rank', 'WR 12'],
      ['overall-rank', '#31'],
      ['sos', '7 of 32'],
      ['bye', 'Wk 9'],
    ])
  })

  it('missing data is — everywhere, never 0', () => {
    const tiles = coreTiles(
      payload({ total_points: null, games: 0, avg_points: null, projected_points: null, pos_rank: null, overall_rank: null }),
      { position: 'WR', sos: null, bye_week: null },
    )
    expect(tiles.every((t) => t.value === MISSING)).toBe(true)
  })

  it('a real zero projection is 0.0, not —', () => {
    expect(coreTiles(payload({ projected_points: 0 }), player)[2].value).toBe('0.0')
  })

  it('still loading → the point tiles are —, SOS and bye still show', () => {
    const tiles = coreTiles(null, player)
    expect(tiles.slice(0, 5).every((t) => t.value === MISSING)).toBe(true)
    expect(tiles[5].value).toBe('7 of 32')
  })
})

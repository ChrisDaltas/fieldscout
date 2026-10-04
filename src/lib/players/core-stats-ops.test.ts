import { describe, expect, it } from 'vitest'

import {
  avgPerGame,
  basisLabel,
  choiceValue,
  completedGames,
  competitionRanks,
  coreStatsQuery,
  coreTiles,
  type CoreStatsPayload,
  MISSING,
  pointsWeeks,
  weeklyCells,
  resolveChoice,
  scoringOptions,
} from './core-stats-ops'

const player = { position: 'WR' }

function payload(over: Partial<CoreStatsPayload> = {}): CoreStatsPayload {
  return {
    basis: { kind: 'system', system: 'espn_standard' },
    season: 2026,
    week: 5,
    total_points: 84.6,
    games: 4,
    avg_points: 21.15,
    projected_points: 17.3,
    pos_rank: 12,
    overall_rank: 31,
    weekly: [],
    box: { games: 0, totals: {} },
    usage: null,
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
    const wk = (week: number) => ({ week, appeared: true, live: false })
    expect(completedGames([1, 2, 3, 9, 10].map(wk), 9)).toHaveLength(4)
  })

  it('R1506: a zero line (did not play) and the live week are not games', () => {
    const games = completedGames(
      [
        { week: 1, appeared: true, live: false },
        { week: 2, appeared: false, live: false }, // stored zeros — missed the game
        { week: 3, appeared: true, live: false },
        { week: 4, appeared: true, live: true }, // still live — total yes, divisor no
      ],
      null,
    )
    expect(games.map((g) => g.week)).toEqual([1, 3])
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
  it('names the league, or the chosen preset (R1505)', () => {
    expect(basisLabel({ kind: 'league', league_name: 'Hadouken Bowl' })).toBe('Hadouken Bowl scoring')
    expect(basisLabel({ kind: 'system', system: 'espn_standard' })).toBe('ESPN Standard scoring')
    expect(basisLabel({ kind: 'system', system: 'half_ppr' })).toBe('Half PPR scoring')
    expect(basisLabel({ kind: 'system', system: 'ppr' })).toBe('Full PPR scoring')
  })
})

describe('core stats — scoring dropdown (Chris 2026-10-04)', () => {
  const leagues = [
    { id: 'L1', name: 'Hadouken Bowl' },
    { id: 'L2', name: 'Work League' },
  ]

  it('options: the three presets, then one per league the viewer is in', () => {
    expect(scoringOptions(leagues)).toEqual([
      { value: 'espn_standard', label: 'ESPN Standard' },
      { value: 'half_ppr', label: 'Half PPR' },
      { value: 'ppr', label: 'Full PPR' },
      { value: 'league:L1', label: 'Hadouken Bowl' },
      { value: 'league:L2', label: 'Work League' },
    ])
    expect(scoringOptions([]).map((o) => o.value)).toEqual(['espn_standard', 'half_ppr', 'ppr'])
  })

  it('defaults to ESPN Standard outside a league', () => {
    expect(resolveChoice({ picked: null, leagueParam: null, stored: null, leagues })).toEqual({ kind: 'system', system: 'espn_standard' })
  })

  it('?league= preselects that league, over a stored choice', () => {
    expect(resolveChoice({ picked: null, leagueParam: 'L2', stored: 'ppr', leagues })).toEqual({ kind: 'league', leagueId: 'L2' })
  })

  it('a stored choice is remembered; a stored league they left falls back to the default', () => {
    expect(resolveChoice({ picked: null, leagueParam: null, stored: 'half_ppr', leagues })).toEqual({ kind: 'system', system: 'half_ppr' })
    expect(resolveChoice({ picked: null, leagueParam: null, stored: 'league:L1', leagues })).toEqual({ kind: 'league', leagueId: 'L1' })
    expect(resolveChoice({ picked: null, leagueParam: null, stored: 'league:GONE', leagues })).toEqual({ kind: 'system', system: 'espn_standard' })
    expect(resolveChoice({ picked: null, leagueParam: null, stored: 'garbage', leagues })).toEqual({ kind: 'system', system: 'espn_standard' })
  })

  it('a pick changes the choice, and the request (query key + URL) moves with it — recompute on change', () => {
    const before = resolveChoice({ picked: null, leagueParam: 'L1', stored: null, leagues })
    const after = resolveChoice({ picked: 'ppr', leagueParam: 'L1', stored: null, leagues })
    expect(choiceValue(before)).toBe('league:L1')
    expect(choiceValue(after)).toBe('ppr')
    expect(coreStatsQuery(before)).toBe('?league=L1')
    expect(coreStatsQuery(after)).toBe('?scoring=ppr')
    expect(coreStatsQuery(resolveChoice({ picked: 'half_ppr', leagueParam: null, stored: null, leagues }))).toBe('?scoring=half_ppr')
  })
})

describe('core stats — the strip (D486(12))', () => {
  it('five tiles, in the waiver order — SOS and bye live elsewhere (each fact once)', () => {
    expect(coreTiles(payload(), player).map((t) => [t.key, t.value])).toEqual([
      ['pos-rank', 'WR 12'],
      ['overall-rank', '#31'],
      ['avg', '21.1'],
      ['total', '84.6'],
      ['proj', '17.3'],
    ])
  })

  it('missing data is — everywhere, never 0', () => {
    const tiles = coreTiles(
      payload({ total_points: null, games: 0, avg_points: null, projected_points: null, pos_rank: null, overall_rank: null }),
      player,
    )
    expect(tiles.every((t) => t.value === MISSING)).toBe(true)
  })

  it('a real zero projection is 0.0, not —', () => {
    expect(coreTiles(payload({ projected_points: 0 }), player)[4].value).toBe('0.0')
  })

  it('still loading → every tile is —', () => {
    expect(coreTiles(null, player).every((t) => t.value === MISSING)).toBe(true)
  })
})

describe('core stats — the season table weeks (D486(12))', () => {
  const w = (week: number, appeared = true, live = false) => ({ week, appeared, live })
  it('points only for completed games — bye, zero lines and the live week skipped', () => {
    expect(pointsWeeks([w(1), w(2), w(3, false), w(4), w(5), w(6, true, true)], 5)).toEqual([1, 2, 4])
    expect(pointsWeeks([], null)).toEqual([])
  })
  it('points and projections merge by week, ascending; a missing side is null', () => {
    expect(weeklyCells(new Map([[2, 10], [1, 4.5]]), new Map([[2, 9.1], [3, 12]]))).toEqual([
      { week: 1, points: 4.5, proj: null },
      { week: 2, points: 10, proj: 9.1 },
      { week: 3, points: null, proj: 12 },
    ])
  })
})

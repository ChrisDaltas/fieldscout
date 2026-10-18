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
  isScoringSystemKey,
  SCORING_SYSTEMS,
  scoredLeagues,
  scoringOptions,
} from './core-stats-ops'
import { systemRules } from './core-stats-service'

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

describe('core stats — a pre-draft league is not a scoring choice (spec §7.3.3)', () => {
  const leagues = [
    { id: 'L1', name: 'Hadouken Bowl', status: 'in_season' },
    { id: 'L2', name: 'Practice Squad League', status: 'setup' },
    { id: 'L3', name: 'Draft Night', status: 'scheduled' },
    { id: 'L4', name: 'On the Clock', status: 'drafting' },
    { id: 'L5', name: 'Last Year', status: 'complete' },
  ]

  it('only leagues past draft start (scoring frozen) are offered', () => {
    expect(scoredLeagues(leagues).map((l) => l.id)).toEqual(['L1', 'L4', 'L5'])
    expect(scoringOptions(scoredLeagues(leagues)).map((o) => o.value)).not.toContain('league:L2')
  })

  it('a remembered pre-draft league falls back to the default; a drafted one is kept', () => {
    const scored = scoredLeagues(leagues)
    expect(resolveChoice({ picked: null, leagueParam: null, stored: 'league:L2', leagues: scored })).toEqual({ kind: 'system', system: 'espn_standard' })
    expect(resolveChoice({ picked: null, leagueParam: null, stored: 'league:L3', leagues: scored })).toEqual({ kind: 'system', system: 'espn_standard' })
    expect(resolveChoice({ picked: null, leagueParam: null, stored: 'league:L4', leagues: scored })).toEqual({ kind: 'league', leagueId: 'L4' })
  })
})

describe('core stats — 0.25 PPR (gap list §3 #18: the phone chip)', () => {
  const leagues = [{ id: 'L1', name: 'Hadouken Bowl' }]
  const phone = ['ppr', 'half_ppr', 'quarter_ppr', 'espn_standard'] as const

  it('is a preset the read scores, named "0.25 PPR"', () => {
    expect(isScoringSystemKey('quarter_ppr')).toBe(true)
    expect(basisLabel({ kind: 'system', system: 'quarter_ppr' })).toBe('0.25 PPR scoring')
    expect(coreStatsQuery({ kind: 'system', system: 'quarter_ppr' })).toBe('?scoring=quarter_ppr')
  })

  it('the desktop dropdown is unchanged: three presets, and a remembered 0.25 PPR falls back to its default', () => {
    expect(SCORING_SYSTEMS.map((s) => s.key)).toEqual(['espn_standard', 'half_ppr', 'ppr'])
    expect(resolveChoice({ picked: null, leagueParam: null, stored: 'quarter_ppr', leagues })).toEqual({ kind: 'system', system: 'espn_standard' })
    expect(resolveChoice({ picked: 'quarter_ppr', leagueParam: 'L1', stored: null, leagues })).toEqual({ kind: 'league', leagueId: 'L1' })
  })

  it('a picker that offers it (the phone) picks and remembers it', () => {
    expect(resolveChoice({ picked: 'quarter_ppr', leagueParam: 'L1', stored: null, leagues, systems: phone })).toEqual({ kind: 'system', system: 'quarter_ppr' })
    expect(resolveChoice({ picked: null, leagueParam: null, stored: 'quarter_ppr', leagues, systems: phone })).toEqual({ kind: 'system', system: 'quarter_ppr' })
    // The league he was opened in still beats a remembered pick.
    expect(resolveChoice({ picked: null, leagueParam: 'L1', stored: 'quarter_ppr', leagues, systems: phone })).toEqual({ kind: 'league', leagueId: 'L1' })
  })

  it('scored as ESPN Standard plus 0.25 a catch — between Standard and Half PPR', () => {
    const std = systemRules('espn_standard') as unknown as Record<string, unknown>
    const quarter = systemRules('quarter_ppr') as unknown as Record<string, unknown>
    expect(quarter.receptions).toBe(0.25)
    expect({ ...quarter, receptions: std.receptions }).toEqual(std)
    expect((systemRules('half_ppr') as unknown as Record<string, unknown>).receptions).toBe(0.5)
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

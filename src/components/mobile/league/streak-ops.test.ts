import { describe, expect, it } from 'vitest'

import { streakArrowText, streakTileText, streakToneClass, teamStreak, type StreakMatchup } from './streak-ops'

/** A game between `a` (home) and `b` (away). */
const g = (week: number, result: string | null, over: Partial<StreakMatchup> = {}): StreakMatchup => ({
  season: 2099,
  week,
  round_type: 'regular',
  status: 'final',
  home_team_id: 'a',
  away_team_id: 'b',
  result,
  ...over,
})

describe('teamStreak — the one count (gap list #39)', () => {
  it('the run of identical results at the end, oldest to newest, from either side', () => {
    const games = [g(1, 'away'), g(2, 'home'), g(3, 'home')]
    expect(teamStreak('a', games)).toEqual({ kind: 'W', count: 2 })
    expect(teamStreak('b', games)).toEqual({ kind: 'L', count: 2 })
  })

  it('reads the week order, not the order the rows arrive in', () => {
    expect(teamStreak('a', [g(3, 'home'), g(1, 'away'), g(2, 'home')])).toEqual({ kind: 'W', count: 2 })
  })

  it('a tie ends a W or L run; back-to-back ties are a tie streak', () => {
    expect(teamStreak('a', [g(1, 'home'), g(2, 'home'), g(3, 'tie')])).toEqual({ kind: 'T', count: 1 })
    expect(teamStreak('a', [g(1, 'home'), g(2, 'tie'), g(3, 'home')])).toEqual({ kind: 'W', count: 1 })
    expect(teamStreak('b', [g(1, 'tie'), g(2, 'tie')])).toEqual({ kind: 'T', count: 2 })
  })

  it('only a decided game counts: a live, scheduled or undecided week is not a result yet', () => {
    expect(teamStreak('a', [g(1, 'home'), g(2, 'away', { status: 'live' })])).toEqual({ kind: 'W', count: 1 })
    expect(teamStreak('a', [g(1, 'home'), g(2, null)])).toEqual({ kind: 'W', count: 1 })
    expect(teamStreak('a', [g(1, null, { status: 'scheduled' })])).toBeNull()
    expect(teamStreak('a', [])).toBeNull()
  })

  it('the weekly head-to-head game of the regular season only — no bye, playoff or second-opponent game', () => {
    const base = [g(1, 'home'), g(2, 'home')]
    expect(teamStreak('a', [...base, g(3, null, { away_team_id: null })])).toEqual({ kind: 'W', count: 2 })
    expect(teamStreak('a', [...base, g(15, 'away', { round_type: 'playoff' })])).toEqual({ kind: 'W', count: 2 })
    expect(teamStreak('a', [...base, g(2, 'away', { round_type: 'secondary', away_team_id: 'c' })])).toEqual({ kind: 'W', count: 2 })
    expect(teamStreak('a', [...base, g(16, 'away', { round_type: 'consolation' })])).toEqual({ kind: 'W', count: 2 })
  })

  it('only the team’s own games', () => {
    expect(teamStreak('a', [g(1, 'home'), g(2, 'home', { home_team_id: 'c', away_team_id: 'd' })])).toEqual({ kind: 'W', count: 1 })
    expect(teamStreak('z', [g(1, 'home')])).toBeNull()
  })

  it('one season when a season is named; the newest season last otherwise', () => {
    const games = [g(1, 'away', { season: 2098 }), g(2, 'away', { season: 2098 }), g(1, 'home', { season: 2099 })]
    expect(teamStreak('a', games, 2099)).toEqual({ kind: 'W', count: 1 })
    expect(teamStreak('a', games, 2098)).toEqual({ kind: 'L', count: 2 })
    expect(teamStreak('a', [g(1, 'home', { season: 2099 }), g(5, 'away', { season: 2098 })])).toEqual({ kind: 'W', count: 1 })
  })
})

describe('streak text and colour', () => {
  it('arrows on the Match card and Standings ("▲8W" / "▼2L"); a tie run has none', () => {
    expect(streakArrowText({ kind: 'W', count: 8 })).toBe('▲8W')
    expect(streakArrowText({ kind: 'L', count: 2 })).toBe('▼2L')
    expect(streakArrowText({ kind: 'T', count: 1 })).toBe('1T')
  })
  it('the Team view tile reads "W8" / "L2" / "T1"', () => {
    expect(streakTileText({ kind: 'W', count: 8 })).toBe('W8')
    expect(streakTileText({ kind: 'L', count: 2 })).toBe('L2')
    expect(streakTileText({ kind: 'T', count: 1 })).toBe('T1')
  })
  it('green for W, red for L, the surrounding colour for a tie', () => {
    expect(streakToneClass({ kind: 'W', count: 1 }, 'text-m-t3')).toBe('text-positive-strong')
    expect(streakToneClass({ kind: 'L', count: 1 }, 'text-m-t3')).toBe('text-negative-strong')
    expect(streakToneClass({ kind: 'T', count: 1 }, 'text-m-t3')).toBe('text-m-t3')
  })
})

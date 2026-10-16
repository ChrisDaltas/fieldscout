import { describe, expect, it } from 'vitest'

import {
  streakArrowText,
  streakTileText,
  streakToneClass,
  teamStreak,
  type StreakMatchup,
  type StreakMedianResult,
} from './streak-ops'

/** A game between `a` (home) and `b` (away). */
const g = (week: number, result: string | null, over: Partial<StreakMatchup> = {}): StreakMatchup => ({
  season: 2099,
  week,
  round_type: 'regular',
  status: 'final',
  home_team_id: 'a',
  away_team_id: 'b',
  home_score: null,
  away_score: null,
  result,
  ...over,
})

/** A team's stored result against the League Median (default team `a`). */
const med = (week: number, result: string | null, over: Partial<StreakMedianResult> = {}): StreakMedianResult => ({
  season: 2099,
  week,
  team_id: 'a',
  median_result: result,
  is_final: true,
  ...over,
})

const games = (...matchups: StreakMatchup[]) => ({ matchups })

describe('teamStreak — every decided result (Chris, 2026-10-16)', () => {
  it('the run of identical results at the end, oldest to newest, from either side', () => {
    const s = games(g(1, 'away'), g(2, 'home'), g(3, 'home'))
    expect(teamStreak('a', s)).toEqual({ kind: 'W', count: 2 })
    expect(teamStreak('b', s)).toEqual({ kind: 'L', count: 2 })
  })

  it('reads the week order, not the order the rows arrive in', () => {
    expect(teamStreak('a', games(g(3, 'home'), g(1, 'away'), g(2, 'home')))).toEqual({ kind: 'W', count: 2 })
  })

  it('a tie ends a W or L run; back-to-back ties are a tie streak', () => {
    expect(teamStreak('a', games(g(1, 'home'), g(2, 'home'), g(3, 'tie')))).toEqual({ kind: 'T', count: 1 })
    expect(teamStreak('a', games(g(1, 'home'), g(2, 'tie'), g(3, 'home')))).toEqual({ kind: 'W', count: 1 })
    expect(teamStreak('b', games(g(1, 'tie'), g(2, 'tie')))).toEqual({ kind: 'T', count: 2 })
  })

  it('only a decided game counts: a live, scheduled or undecided week is not a result yet', () => {
    expect(teamStreak('a', games(g(1, 'home'), g(2, 'away', { status: 'live' })))).toEqual({ kind: 'W', count: 1 })
    expect(teamStreak('a', games(g(1, 'home'), g(2, null)))).toEqual({ kind: 'W', count: 1 })
    expect(teamStreak('a', games(g(1, null, { status: 'scheduled' })))).toBeNull()
    expect(teamStreak('a', games())).toBeNull()
  })

  it('a bye is no game', () => {
    expect(teamStreak('a', games(g(1, 'home'), g(2, 'home'), g(3, null, { away_team_id: null })))).toEqual({ kind: 'W', count: 2 })
    expect(teamStreak('a', games(g(1, null, { away_team_id: null })))).toBeNull()
  })

  it('the playoffs extend the run, and a playoff loss ends it', () => {
    const season = [g(13, 'home'), g(14, 'home')]
    // One-week rounds: the semifinal against b, the final against c.
    expect(teamStreak('a', games(...season, g(15, 'home', { round_type: 'playoff' }), g(16, 'home', { round_type: 'playoff', away_team_id: 'c' })))).toEqual({ kind: 'W', count: 4 })
    expect(teamStreak('a', games(...season, g(15, 'away', { round_type: 'playoff' })))).toEqual({ kind: 'L', count: 1 })
  })

  describe('a two-week playoff round is one game, won on the total (118 (B))', () => {
    /** One week of a two-week round between a (home) and b. */
    const leg = (week: number, home: number, away: number, over: Partial<StreakMatchup> = {}) =>
      g(week, home > away ? 'home' : home < away ? 'away' : 'tie', { round_type: 'playoff', home_score: home, away_score: away, ...over })

    it('won the round but lost its second week: one W', () => {
      const s = games(g(14, 'home'), leg(15, 120, 100), leg(16, 95, 100))
      expect(teamStreak('a', s)).toEqual({ kind: 'W', count: 2 })
      expect(teamStreak('b', s)).toEqual({ kind: 'L', count: 2 })
    })

    it('lost the round but won its first week: one L', () => {
      expect(teamStreak('a', games(g(14, 'home'), leg(15, 101, 100), leg(16, 90, 120)))).toEqual({ kind: 'L', count: 1 })
    })

    it('no result until both weeks are final', () => {
      const s = games(g(14, 'away'), leg(15, 130, 90), g(16, null, { round_type: 'playoff', status: 'live', home_score: 40, away_score: 60 }))
      expect(teamStreak('a', s)).toEqual({ kind: 'L', count: 1 })
      expect(teamStreak('a', games(g(14, 'away'), leg(15, 130, 90), leg(16, 0, 0, { status: 'scheduled', result: null })))).toEqual({ kind: 'L', count: 1 })
    })

    it('an equal total is a tie, to the hundredth', () => {
      expect(teamStreak('a', games(g(14, 'home'), leg(15, 100.1, 75.15), leg(16, 50.2, 75.15)))).toEqual({ kind: 'T', count: 1 })
    })

    it('reads either side as home, in any row order', () => {
      const s = games(leg(16, 100, 95, { home_team_id: 'b', away_team_id: 'a' }), g(14, 'home'), leg(15, 110, 100))
      // a: 110 + 95 = 205 against b's 100 + 100 = 200.
      expect(teamStreak('a', s)).toEqual({ kind: 'W', count: 2 })
      expect(teamStreak('b', s)).toEqual({ kind: 'L', count: 2 })
    })

    it('the next round is its own game, and a week’s median follows the round', () => {
      const s = {
        matchups: [leg(15, 120, 100), leg(16, 110, 100), leg(17, 90, 100, { away_team_id: 'c' }), leg(18, 95, 100, { away_team_id: 'c' })],
        median_results: [med(15, 'win'), med(16, 'win')],
      }
      // Semifinal W (at week 16), then the final L: L1.
      expect(teamStreak('a', s)).toEqual({ kind: 'L', count: 1 })
      // Up to week 16: median 15 W, the semifinal W, median 16 W — W3.
      expect(teamStreak('a', { ...s, matchups: s.matchups.slice(0, 2) })).toEqual({ kind: 'W', count: 3 })
    })
  })

  it('consolation and third-place games count', () => {
    const season = [g(13, 'away'), g(14, 'away')]
    expect(teamStreak('a', games(...season, g(15, 'away', { round_type: 'consolation' })))).toEqual({ kind: 'L', count: 3 })
    expect(teamStreak('a', games(...season, g(15, 'home', { round_type: 'third_place' })))).toEqual({ kind: 'W', count: 1 })
  })

  it('the second-opponent game counts, after the week’s main game', () => {
    const second = (week: number, result: string) => g(week, result, { round_type: 'secondary', away_team_id: 'c' })
    expect(teamStreak('a', games(g(1, 'home'), second(1, 'home'), g(2, 'home'), second(2, 'home')))).toEqual({ kind: 'W', count: 4 })
    // Main game won, second game lost: the week ends on the loss…
    expect(teamStreak('a', games(g(1, 'home'), g(2, 'home'), second(2, 'away')))).toEqual({ kind: 'L', count: 1 })
    // …and a lost main game before a won second game ends on the win, whatever order the rows arrive in.
    expect(teamStreak('a', games(second(2, 'home'), g(1, 'away'), g(2, 'away')))).toEqual({ kind: 'W', count: 1 })
    // The opponent in the second game, from the away side.
    expect(teamStreak('c', games(second(1, 'home'), second(2, 'tie')))).toEqual({ kind: 'T', count: 1 })
  })

  it('a league with median scoring counts each final median result, last in its week', () => {
    // Won head-to-head, lost to the median: the week ends on the loss — L1.
    expect(teamStreak('a', { matchups: [g(1, 'home'), g(2, 'home')], median_results: [med(1, 'win'), med(2, 'loss')] })).toEqual({ kind: 'L', count: 1 })
    // Both won, both weeks: four in a row.
    expect(teamStreak('a', { matchups: [g(1, 'home'), g(2, 'home')], median_results: [med(2, 'win'), med(1, 'win')] })).toEqual({ kind: 'W', count: 4 })
    // Lost head-to-head, beat the median: W1. A median tie is a tie.
    expect(teamStreak('b', { matchups: [g(1, 'home')], median_results: [med(1, 'win', { team_id: 'b' })] })).toEqual({ kind: 'W', count: 1 })
    expect(teamStreak('a', { matchups: [g(1, 'home')], median_results: [med(1, 'tie')] })).toEqual({ kind: 'T', count: 1 })
  })

  it('the median follows the second-opponent game within a week', () => {
    // Main W, second game L, median W: W1. A median placed before the second game would read W, W, L — L1.
    const s = { matchups: [g(1, 'home'), g(1, 'away', { round_type: 'secondary', away_team_id: 'c' })], median_results: [med(1, 'win')] }
    expect(teamStreak('a', s)).toEqual({ kind: 'W', count: 1 })
  })

  it('a team on a bye still has its median result', () => {
    expect(teamStreak('a', { matchups: [g(1, 'home'), g(2, null, { away_team_id: null })], median_results: [med(1, 'win'), med(2, 'win')] })).toEqual({ kind: 'W', count: 3 })
  })

  it('a league without median scoring counts its games only', () => {
    expect(teamStreak('a', { matchups: [g(1, 'home'), g(2, 'home')], median_results: [] })).toEqual({ kind: 'W', count: 2 })
    expect(teamStreak('a', { matchups: [g(1, 'home'), g(2, 'home')], median_results: [med(2, null)] })).toEqual({ kind: 'W', count: 2 })
    expect(teamStreak('a', { matchups: [g(1, 'home'), g(2, 'home')] })).toEqual({ kind: 'W', count: 2 })
  })

  it('a median result that is not final yet is not a result', () => {
    expect(teamStreak('a', { matchups: [g(1, 'home')], median_results: [med(1, 'loss', { is_final: false })] })).toEqual({ kind: 'W', count: 1 })
    // A pending week: its game is live and its median not final — neither counts.
    expect(
      teamStreak('a', { matchups: [g(1, 'home'), g(2, 'away', { status: 'live' })], median_results: [med(1, 'win'), med(2, 'loss', { is_final: false })] }),
    ).toEqual({ kind: 'W', count: 2 })
  })

  it('only the team’s own games and median results', () => {
    expect(teamStreak('a', games(g(1, 'home'), g(2, 'home', { home_team_id: 'c', away_team_id: 'd' })))).toEqual({ kind: 'W', count: 1 })
    expect(teamStreak('a', { matchups: [g(1, 'home')], median_results: [med(1, 'loss', { team_id: 'c' })] })).toEqual({ kind: 'W', count: 1 })
    expect(teamStreak('z', { matchups: [g(1, 'home')], median_results: [med(1, 'win')] })).toBeNull()
  })

  it('one season when a season is named; the newest season last otherwise', () => {
    const s = {
      matchups: [g(1, 'away', { season: 2098 }), g(2, 'away', { season: 2098 }), g(1, 'home', { season: 2099 })],
      median_results: [med(2, 'loss', { season: 2098 }), med(1, 'win', { season: 2099 }), med(3, 'loss', { season: 2098 })],
    }
    expect(teamStreak('a', s, 2099)).toEqual({ kind: 'W', count: 2 })
    expect(teamStreak('a', s, 2098)).toEqual({ kind: 'L', count: 4 })
    expect(teamStreak('a', s, 2097)).toBeNull()
    expect(teamStreak('a', games(g(1, 'home', { season: 2099 }), g(5, 'away', { season: 2098 })))).toEqual({ kind: 'W', count: 1 })
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

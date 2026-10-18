import { describe, expect, it } from 'vitest'

import {
  BLANK,
  catalogue,
  colNeeds,
  DEFAULT_COLS,
  gameState,
  gameText,
  groupRuns,
  isLiveStatus,
  ordinal,
  posMatches,
  shortName,
  sortAfterToggle,
  sortByCell,
  statCells,
  sumLines,
  toggleCol,
  weekPointsCell,
  type Cell,
} from './players-ops'

describe('players-ops — columns', () => {
  it('offers only sourced columns per surface', () => {
    const league = catalogue('league').map((c) => c.key)
    const research = catalogue('research').map((c) => c.key)
    expect(league).toContain('oprk')
    expect(league).not.toContain('prk')
    expect(research).toContain('prk')
    expect(research).not.toContain('oprk')
    for (const key of DEFAULT_COLS.league) expect(league).toContain(key)
    for (const key of DEFAULT_COLS.research) expect(research).toContain(key)
  })

  it('removing keeps the order; adding re-sorts into catalogue order (spec §3)', () => {
    const cols = DEFAULT_COLS.league
    expect(toggleCol(cols, 'oprk', 'league')).toEqual(cols.filter((k) => k !== 'oprk'))
    expect(toggleCol(cols, 'tottd', 'league')).toEqual(['proj', 'avg', 'tot', 'oprk', 'totyd', 'tottd', 'snap', 'ratt', 'tgt', 'tshare'])
  })

  it('resets the sort when its column is removed', () => {
    expect(sortAfterToggle(['proj', 'avg'], 'tot')).toBe('proj')
    expect(sortAfterToggle(['avg', 'tot'], 'snap')).toBe('avg')
    expect(sortAfterToggle(['avg', 'tot'], 'tot')).toBe('tot')
  })

  it('bands a run of 3+ with the full group name, else the short one', () => {
    expect(groupRuns(DEFAULT_COLS.league)).toEqual([
      { group: 'fantasy', n: 3, label: 'Fantasy' },
      { group: 'matchup', n: 1, label: 'Match' },
      { group: 'usage', n: 1, label: 'Usage' },
      { group: 'arec', n: 2, label: 'Adv rec' },
      { group: 'arush', n: 1, label: 'Adv rush' },
      { group: 'base', n: 1, label: 'Base' },
    ])
  })

  it('reads only what the shown columns need', () => {
    expect(colNeeds(['proj', 'oprk'], 'proj')).toEqual({ values: true, usage: false, lines: false })
    expect(colNeeds(['snap', 'ryd'], 'snap')).toEqual({ values: false, usage: true, lines: true })
  })
})

describe('players-ops — cells', () => {
  const cell = (sort: number | null): Cell => (sort === null ? BLANK : { text: String(sort), sort })

  it('sorts high to low, stable, with blanks last (never as −1)', () => {
    const rows = [
      { id: 'a', c: cell(null) },
      { id: 'b', c: cell(-0.2) },
      { id: 'c', c: cell(4.1) },
      { id: 'd', c: cell(-3.1) },
      { id: 'e', c: cell(4.1) },
    ]
    expect(sortByCell(rows, (r) => r.c).map((r) => r.id)).toEqual(['c', 'e', 'b', 'd', 'a'])
  })

  it('blanks the columns a position cannot have, and every stat with no game', () => {
    const [line] = sumLines([{ player_id: 'p', pass_yards: 250, pass_attempts: 30, pass_completions: 21, rush_yards: 12, receiving_yards: 5 }]).values()
    const qb = statCells('QB', line!, { snap: 98, tshare: null })
    expect(qb.pyd?.text).toBe('250')
    expect(qb.cmp?.text).toBe('70%')
    expect(qb.totyd?.text).toBe('267')
    expect(qb.recyd).toBe(BLANK)
    expect(qb.snap).toMatchObject({ text: '98%', tier: 'good' })
    const k = statCells('K', null, null)
    expect(k.fgm).toBeUndefined()
    expect(k.snap).toBe(BLANK)
    expect(statCells('WR', null, { snap: 45, tshare: 25 }).tshare).toMatchObject({ text: '25%', tier: 'good' })
  })

  it('derives one week’s points from two season-to-date reads', () => {
    expect(weekPointsCell({ season_points: 40.5, season_games: 3 }, { season_points: 58.25, season_games: 4 })).toMatchObject({ text: '17.8', sort: 17.75 })
    expect(weekPointsCell({ season_points: 40.5, season_games: 3 }, { season_points: 40.5, season_games: 3 })).toBe(BLANK)
    expect(weekPointsCell({ season_points: null, season_games: 0 }, { season_points: 9, season_games: 1 }).text).toBe('9.0')
    expect(weekPointsCell(undefined, { season_points: 9, season_games: 1 })).toBe(BLANK)
  })
})

describe('players-ops — text', () => {
  it('shortens names the way the prototype does', () => {
    expect(shortName('Michael Penix Jr.', 'QB')).toBe('M. Penix Jr.')
    expect(shortName('A.J. Brown', 'WR')).toBe('A.J. Brown')
    expect(shortName('Philadelphia Eagles', 'DEF')).toBe('Philadelphia Eagles')
  })

  it('writes ordinals', () => {
    expect([1, 2, 3, 4, 11, 12, 13, 21, 23].map(ordinal)).toEqual(['1st', '2nd', '3rd', '4th', '11th', '12th', '13th', '21st', '23rd'])
  })

  it('matches FLEX and D/ST to the app positions', () => {
    expect(posMatches('FLEX', 'TE')).toBe(true)
    expect(posMatches('FLEX', 'QB')).toBe(false)
    expect(posMatches('D/ST', 'DEF')).toBe(true)
  })

  it('writes the game line from the stored game', () => {
    const base = { home_team: 'MIA', away_team: 'CIN', kickoff_at: '2026-10-11T17:00:00Z', quarter: null, game_clock: null, home_score: null, away_score: null }
    const kick = () => 'Sun 1:00 PM'
    expect(gameText('MIA', [{ ...base, status: 'scheduled' }], kick)).toEqual({ text: 'Sun 1:00 PM vs CIN', opp: 'CIN' })
    expect(gameText('MIA', [{ ...base, status: 'live', quarter: 4, game_clock: '2:19', home_score: 18, away_score: 28 }], kick)?.text).toBe('Q4 2:19 · 18-28 vs CIN')
    expect(gameText('CIN', [{ ...base, status: 'final', home_score: 31, away_score: 7 }], kick)?.text).toBe('Final L 7-31 @ MIA')
    expect(gameText('KC', [{ ...base, status: 'scheduled' }], kick)).toEqual({ text: 'Bye', opp: null })
    expect(gameText('KC', [], kick)).toBeNull()
  })

  it('says where his game stands without the opponent (the profile card, gap list §3 #19)', () => {
    const base = { home_team: 'ATL', away_team: 'NO', kickoff_at: '2026-10-18T17:00:00Z', quarter: null, game_clock: null, home_score: null, away_score: null }
    const kick = () => 'Sun 1:00 PM'
    // His team's score first, home or away.
    const live = { ...base, status: 'live', quarter: 4, game_clock: '2:00', home_score: 31, away_score: 7 }
    expect(gameState('ATL', live, kick)).toBe('Q4 2:00 · 31-7')
    expect(gameState('NO', live, kick)).toBe('Q4 2:00 · 7-31')
    expect(gameState('ATL', { ...live, status: 'in_progress' }, kick)).toBe('Q4 2:00 · 31-7')
    expect(gameState('ATL', { ...live, quarter: 5, game_clock: '6:12', away_score: 31 }, kick)).toBe('OT 6:12 · 31-31')
    // No clock or score on record: no invented 0-0.
    expect(gameState('ATL', { ...base, status: 'live' }, kick)).toBe('Live')
    expect(gameState('ATL', { ...base, status: 'live', home_score: 3, away_score: 0 }, kick)).toBe('Live · 3-0')
    const final = { ...base, status: 'final', home_score: 31, away_score: 20 }
    expect(gameState('ATL', final, kick)).toBe('Final W 31-20')
    expect(gameState('NO', final, kick)).toBe('Final L 20-31')
    expect(gameState('ATL', { ...final, away_score: 31 }, kick)).toBe('Final T 31-31')
    expect(gameState('ATL', { ...base, status: 'final' }, kick)).toBe('Final')
    // A schedule-only row (no state columns selected) reads as unknown.
    const scheduleOnly = { week: 6, home_team: 'ATL', away_team: 'NO', kickoff_at: base.kickoff_at, status: 'final' }
    expect(gameState('ATL', scheduleOnly, kick)).toBe('Final')
    expect(gameState('ATL', { ...base, status: 'scheduled' }, kick)).toBe('Sun 1:00 PM')
    expect(isLiveStatus('live')).toBe(true)
    expect(isLiveStatus('in_progress')).toBe(true)
    expect(isLiveStatus('final')).toBe(false)
    expect(isLiveStatus(null)).toBe(false)
  })
})

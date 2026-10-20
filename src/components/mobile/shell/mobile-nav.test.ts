import { describe, expect, it } from 'vitest'

import { leagueFallbackTitle, leagueTabHref, mobileFallback, mobileRoute, showsLeagueSwitcher, swipeLeague } from './mobile-nav'

const L = '/app/leagues/lg1'

describe('mobileRoute — which bar and which lit tab (navigation §(c))', () => {
  it('lights the four league tabs on their routes', () => {
    expect(mobileRoute(L, null)).toEqual({ leagueId: 'lg1', leagueTab: 'league', accountTab: null })
    expect(mobileRoute(`${L}/standings`, null).leagueTab).toBe('league')
    expect(mobileRoute(`${L}/activity`, null).leagueTab).toBe('league')
    expect(mobileRoute(`${L}/matchup`, null).leagueTab).toBe('match')
    expect(mobileRoute(`${L}/matchup/m1`, null).leagueTab).toBe('match')
    expect(mobileRoute(`${L}/players`, null).leagueTab).toBe('players')
    expect(mobileRoute(`${L}/team/t1`, 't1').leagueTab).toBe('team')
    expect(mobileRoute(`${L}/team/mine`, null).leagueTab).toBe('team')
  })

  it('keeps the league bar but lights nothing on a league sub-screen or another team', () => {
    expect(mobileRoute(`${L}/team/t2`, 't1')).toEqual({ leagueId: 'lg1', leagueTab: null, accountTab: null })
    expect(mobileRoute(`${L}/activity/transactions`, 't1').leagueTab).toBeNull()
    expect(mobileRoute(`${L}/settings`, 't1').leagueTab).toBeNull()
  })

  it('lights the account tabs, with Lists and Rankings under Profile', () => {
    expect(mobileRoute('/app', null).accountTab).toBe('home')
    expect(mobileRoute('/app/explore', null).accountTab).toBe('community')
    // Community's Latest page (For you's "Latest" → See all) keeps Community lit.
    expect(mobileRoute('/app/explore/latest', null)).toEqual({ leagueId: null, leagueTab: null, accountTab: 'community' })
    expect(mobileRoute('/app/research', null).accountTab).toBe('players')
    expect(mobileRoute('/app/players', null).accountTab).toBe('players')
    for (const path of ['/app/profile', '/app/stats', '/app/lists', '/app/lists/new', '/app/lists/abc', '/app/weekly-ranks', '/app/big-board', '/app/big-board/week/3', '/app/start-or-sit']) {
      expect(mobileRoute(path, null).accountTab, path).toBe('profile')
    }
  })

  it('leaves the bar alone on screens that keep the league context', () => {
    for (const path of ['/app/notifications', '/app/messages', '/app/messages/league-lg1', '/app/listsx', '/app/explorex', '/app/start-or-sit/new', '/app/start-or-sit/q1']) {
      expect(mobileRoute(path, null), path).toEqual({ leagueId: null, leagueTab: null, accountTab: null })
    }
  })
})

describe('leagueFallbackTitle — league pages with no mobile screen yet', () => {
  it('is null everywhere: every league page draws its own mobile screen (gap list §4 item 109 was the last)', () => {
    for (const rest of ['', '/standings', '/activity', '/activity/transactions', '/players', '/team/t1', '/matchup', '/trades', '/draft/recap', '/stats', '/settings', '/members', '/schedule', '/commish']) {
      expect(leagueFallbackTitle(`${L}${rest}`), rest).toBeNull()
    }
    expect(leagueFallbackTitle('/app/settings')).toBeNull()
  })
})

describe('leagueTabHref', () => {
  it('opens your own team, or the mine alias before the roster loads', () => {
    expect(leagueTabHref('lg1', 'team', 't1')).toBe(`${L}/team/t1`)
    expect(leagueTabHref('lg1', 'team', null)).toBe(`${L}/team/mine`)
    expect(leagueTabHref('lg1', 'league', null)).toBe(L)
  })
})

describe('mobileFallback — account pages with no mobile screen yet', () => {
  it('titles them, each returning Home', () => {
    expect(mobileFallback('/app/weekly-ranks/history')).toEqual({ kind: 'account', title: 'Ranking history', parent: '/app', heading: true })
    expect(mobileFallback('/app/start-or-sit/new')?.title).toBe('Ask a question')
  })
  it('leaves screens with their own mobile header alone', () => {
    for (const path of ['/app', '/app/profile', '/app/lists', '/app/lists/new', '/app/weekly-ranks', '/app/start-or-sit', '/app/research', '/app/messages', '/app/notifications', '/app/mocks/m1', '/app/explore', '/app/explore/latest']) {
      expect(mobileFallback(path), path).toBeNull()
    }
  })
  it('leaves Settings and its pages to their own phone screens (gap list §4 item 101)', () => {
    for (const path of ['/app/settings', '/app/settings/', '/app/settings/scoring', '/app/settings/billing']) {
      expect(mobileFallback(path), path).toBeNull()
    }
  })
  it('leaves Trash to its own phone screen (gap list §4 item 102)', () => {
    for (const path of ['/app/trash', '/app/trash/']) {
      expect(mobileFallback(path), path).toBeNull()
    }
  })
  it('leaves Mock drafts and their reports to their own phone screens (gap list §4 item 110)', () => {
    for (const path of ['/app/mocks', '/app/mocks/', '/app/mocks/m1/report', '/app/mocks/m1/report/']) {
      expect(mobileFallback(path), path).toBeNull()
    }
  })
  it('leaves Leagues to its own phone screen (gap list §4 item 104)', () => {
    for (const path of ['/app/leagues', '/app/leagues/']) {
      expect(mobileFallback(path), path).toBeNull()
    }
  })
  it('leaves the NFL team pages to their own phone screens (gap list §4 item 103)', () => {
    for (const path of ['/app/nfl', '/app/nfl/', '/app/nfl/BUF', '/app/nfl/BUF/']) {
      expect(mobileFallback(path), path).toBeNull()
    }
  })
  it('leaves League settings, Scoring and Playoffs to their own phone screens (gap list §4 item 105)', () => {
    for (const path of [`${L}/settings`, `${L}/settings/`]) {
      expect(mobileFallback(path), path).toBeNull()
    }
  })
  it('leaves Members to its own phone screen (gap list §4 item 106)', () => {
    for (const path of [`${L}/members`, `${L}/members/`]) {
      expect(mobileFallback(path), path).toBeNull()
    }
  })
  it('leaves Schedule to its own phone screen (gap list §4 item 107)', () => {
    for (const path of [`${L}/schedule`, `${L}/schedule/`]) {
      expect(mobileFallback(path), path).toBeNull()
    }
  })
  it('leaves Commissioner tools to its own phone screen (gap list §4 item 109)', () => {
    for (const path of [`${L}/commish`, `${L}/commish/`]) {
      expect(mobileFallback(path), path).toBeNull()
    }
  })
})

describe('showsLeagueSwitcher — the strip above the tab bar (Chris, 2026-10-17)', () => {
  it('shows on a league tab only when there is another league to switch to', () => {
    expect(showsLeagueSwitcher(true, 'match', 2)).toBe(true)
    expect(showsLeagueSwitcher(true, 'league', 5)).toBe(true)
    expect(showsLeagueSwitcher(true, 'match', 1)).toBe(false)
  })
  it('never while the leagues are loading, off a league tab, or outside a league', () => {
    expect(showsLeagueSwitcher(true, 'team', 0)).toBe(false)
    expect(showsLeagueSwitcher(true, null, 3)).toBe(false)
    expect(showsLeagueSwitcher(false, 'match', 3)).toBe(false)
  })
})

describe('swipeLeague — the switcher queues quick swipes (gap list §4 item 8)', () => {
  const LEAGUES = [{ id: 'A' }, { id: 'B' }, { id: 'C' }, { id: 'D' }]

  it('left is the next league, right the previous, wrapping round', () => {
    expect(swipeLeague(LEAGUES, 'A', null, 1)?.id).toBe('B')
    expect(swipeLeague(LEAGUES, 'A', null, -1)?.id).toBe('D')
    expect(swipeLeague(LEAGUES, 'D', null, 1)?.id).toBe('A')
  })

  it('two quick swipes move two leagues: the second goes on from where the first is heading, not from the league still on screen', () => {
    const first = swipeLeague(LEAGUES, 'A', null, 1)
    const second = swipeLeague(LEAGUES, 'A', first!.id, 1)
    expect([first?.id, second?.id]).toEqual(['B', 'C'])
    // Each swipe has its own league to name — never the same one twice.
    expect(second?.id).not.toBe(first?.id)
    expect(swipeLeague(LEAGUES, 'A', second!.id, 1)?.id).toBe('D')
  })

  it('a quick swipe back returns to the league you started on; with two leagues, two swipes come home', () => {
    expect(swipeLeague(LEAGUES, 'A', 'B', -1)?.id).toBe('A')
    const two = [{ id: 'A' }, { id: 'B' }]
    expect(swipeLeague(two, 'A', swipeLeague(two, 'A', null, 1)!.id, 1)?.id).toBe('A')
  })

  it('goes on from the league on screen when the switch it was heading for is no longer one of yours', () => {
    expect(swipeLeague(LEAGUES, 'C', 'gone', 1)?.id).toBe('D')
  })

  it('nowhere to go with one league', () => {
    expect(swipeLeague([{ id: 'A' }], 'A', null, 1)).toBeNull()
    expect(swipeLeague([], 'A', null, -1)).toBeNull()
  })
})

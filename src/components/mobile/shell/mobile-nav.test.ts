import { describe, expect, it } from 'vitest'

import { leagueFallbackTitle, leagueTabHref, mobileFallback, mobileRoute, showsLeagueSwitcher } from './mobile-nav'

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
  it('names the pages the Menu opens', () => {
    expect(leagueFallbackTitle(`${L}/settings`)).toBe('League settings')
    expect(leagueFallbackTitle(`${L}/schedule`)).toBe('Schedule')
    expect(leagueFallbackTitle(`${L}/members`)).toBe('Members')
    expect(leagueFallbackTitle(`${L}/commish`)).toBe('Commissioner tools')
    expect(leagueFallbackTitle(`${L}/stats`)).toBe('League stats')
  })

  it('is null where the route draws its own mobile screen', () => {
    for (const rest of ['', '/standings', '/activity', '/activity/transactions', '/players', '/team/t1', '/matchup', '/trades', '/draft/recap']) {
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
  it('titles them, with Settings returning to Profile, its sub-pages to Settings and the rest to Home', () => {
    expect(mobileFallback('/app/settings')).toEqual({ kind: 'account', title: 'Settings', parent: '/app/profile', heading: true })
    expect(mobileFallback('/app/settings/scoring')).toEqual({ kind: 'account', title: 'Scoring', parent: '/app/settings', heading: true })
    expect(mobileFallback('/app/mocks')).toEqual({ kind: 'account', title: 'Mock drafts', parent: '/app', heading: true })
    expect(mobileFallback('/app/mocks/m1/report')?.title).toBe('Mock draft report')
    expect(mobileFallback('/app/leagues')?.title).toBe('Leagues')
    expect(mobileFallback('/app/trash')?.title).toBe('Trash')
    expect(mobileFallback('/app/nfl/BUF')).toMatchObject({ title: 'NFL team', heading: false })
    expect(mobileFallback('/app/weekly-ranks/history')?.title).toBe('Ranking history')
  })
  it('leaves screens with their own mobile header alone', () => {
    for (const path of ['/app', '/app/profile', '/app/lists', '/app/lists/new', '/app/weekly-ranks', '/app/start-or-sit', '/app/research', '/app/messages', '/app/notifications', '/app/mocks/m1', '/app/explore', '/app/explore/latest']) {
      expect(mobileFallback(path), path).toBeNull()
    }
  })
  it('names the league for a league page', () => {
    expect(mobileFallback('/app/leagues/lg1/members')).toEqual({ kind: 'league', title: 'Members', leagueId: 'lg1', heading: true })
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

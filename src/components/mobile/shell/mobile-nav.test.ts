import { describe, expect, it } from 'vitest'

import { leagueFallbackTitle, leagueTabHref, mobileRoute } from './mobile-nav'

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
    expect(mobileRoute('/app/research', null).accountTab).toBe('players')
    expect(mobileRoute('/app/players', null).accountTab).toBe('players')
    for (const path of ['/app/profile', '/app/stats', '/app/lists', '/app/lists/new', '/app/lists/abc', '/app/weekly-ranks', '/app/big-board', '/app/big-board/week/3']) {
      expect(mobileRoute(path, null).accountTab, path).toBe('profile')
    }
  })

  it('leaves the bar alone on screens that keep the league context', () => {
    for (const path of ['/app/notifications', '/app/messages', '/app/messages/league-lg1', '/app/listsx']) {
      expect(mobileRoute(path, null), path).toEqual({ leagueId: null, leagueTab: null, accountTab: null })
    }
  })
})

describe('leagueFallbackTitle — league pages with no mobile screen yet', () => {
  it('names the pages the Menu opens', () => {
    expect(leagueFallbackTitle(`${L}/settings`)).toBe('League settings')
    expect(leagueFallbackTitle(`${L}/schedule`)).toBe('Schedule')
    expect(leagueFallbackTitle(`${L}/draft/recap`)).toBe('Draft results')
    expect(leagueFallbackTitle(`${L}/members`)).toBe('Members')
    expect(leagueFallbackTitle(`${L}/commish`)).toBe('Commissioner tools')
    expect(leagueFallbackTitle(`${L}/stats`)).toBe('League stats')
  })

  it('is null where the route draws its own mobile screen', () => {
    for (const rest of ['', '/standings', '/activity', '/activity/transactions', '/players', '/team/t1', '/matchup', '/trades']) {
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

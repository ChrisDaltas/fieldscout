import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  RECENT_MAX,
  RECENT_SEARCHES_KEY,
  bodyState,
  leagueManagers,
  managerSub,
  matchManagers,
  ownerLabel,
  postHref,
  readRecentSearches,
  readState,
  sectionCap,
  showsSection,
  withRecent,
  writeRecentSearches,
  type SectionStatus,
} from './search-ops'

/** FieldScout Mobile full-screen search — the pure half (gap list §3 #1). */

const ready = (count: number): SectionStatus => ({ state: 'ready', count })

describe('scopes and page sizes', () => {
  it('All shows 5 players, 4 people and 4 posts; a scope of its own shows up to 30', () => {
    expect([sectionCap('players', 'all'), sectionCap('people', 'all'), sectionCap('posts', 'all')]).toEqual([5, 4, 4])
    expect([sectionCap('players', 'players'), sectionCap('people', 'people'), sectionCap('posts', 'posts')]).toEqual([30, 30, 30])
  })
  it('a scope hides the other sections', () => {
    expect(showsSection('all', 'people')).toBe(true)
    expect(showsSection('players', 'players')).toBe(true)
    expect(showsSection('players', 'posts')).toBe(false)
  })
})

describe('what the body says', () => {
  it('results as soon as a visible section has rows', () => {
    expect(bodyState('all', { players: { state: 'pending', count: 0 }, people: ready(2), posts: { state: 'error', count: 0 } })).toBe('results')
  })
  it('never "No results" while a visible section is still reading', () => {
    expect(bodyState('all', { players: ready(0), people: { state: 'pending', count: 0 }, posts: ready(0) })).toBe('searching')
  })
  it('a failed read is never dressed up as "No results"', () => {
    expect(bodyState('all', { players: { state: 'error', count: 0 }, people: ready(0), posts: ready(0) })).toBe('failed')
  })
  it('No results only when every visible section answered with nothing — a hidden one doesn’t count', () => {
    expect(bodyState('all', { players: ready(0), people: ready(0), posts: ready(0) })).toBe('none')
    expect(bodyState('people', { players: ready(3), people: ready(0), posts: { state: 'error', count: 0 } })).toBe('none')
  })
})

describe('a section’s read, for the query on screen', () => {
  const read = (over: Partial<{ isError: boolean; isPlaceholderData: boolean; data: unknown }> = {}) => ({ isError: false, isPlaceholderData: false, data: [], ...over })
  it('answered for this query: ready (even with nothing), or error', () => {
    expect(readState(true, read())).toBe('ready')
    expect(readState(true, read({ isError: true, data: undefined }))).toBe('error')
    expect(readState(true, read({ data: undefined }))).toBe('pending')
  })
  it('an earlier query’s rows kept on screen are not this query’s answer', () => {
    expect(readState(true, read({ isPlaceholderData: true }))).toBe('pending')
  })
  it('while the typing is ahead of the reads, nothing has answered it yet', () => {
    expect(readState(false, read())).toBe('pending')
    expect(readState(false, read({ isError: true, data: undefined }))).toBe('pending')
  })
})

describe('recent searches — kept on this phone', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('newest first, once each (case-blind), trimmed, at most six', () => {
    let list: string[] = []
    for (const l of ['Puka Nacua', 'waiver stashes', '@shahranks', 'Tyler Warren']) list = withRecent(list, l)
    expect(list).toEqual(['Tyler Warren', '@shahranks', 'waiver stashes', 'Puka Nacua'])
    expect(withRecent(list, '  puka nacua ')).toEqual(['puka nacua', 'Tyler Warren', '@shahranks', 'waiver stashes'])
    expect(withRecent(list, '   ')).toEqual(list)
    for (const l of ['a', 'b', 'c', 'd', 'e', 'f', 'g']) list = withRecent(list, l)
    expect(list).toHaveLength(RECENT_MAX)
    expect(list[0]).toBe('g')
  })

  it('reads back what was written; clearing removes the key', () => {
    const data = new Map<string, string>()
    vi.stubGlobal('window', {
      localStorage: { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v), removeItem: (k: string) => void data.delete(k) },
    })
    expect(readRecentSearches()).toEqual([])
    writeRecentSearches(['Puka Nacua', '@shahranks'])
    expect(readRecentSearches()).toEqual(['Puka Nacua', '@shahranks'])
    writeRecentSearches([])
    expect(data.has(RECENT_SEARCHES_KEY)).toBe(false)
  })

  it('ignores anything that isn’t a list of words', () => {
    const data = new Map([[RECENT_SEARCHES_KEY, JSON.stringify(['ok', 3, '', null, 'fine'])]])
    vi.stubGlobal('window', { localStorage: { getItem: (k: string) => data.get(k) ?? null } })
    expect(readRecentSearches()).toEqual(['ok', 'fine'])
    data.set(RECENT_SEARCHES_KEY, '{not json')
    expect(readRecentSearches()).toEqual([])
  })

  it('blocked storage (a private window) remembers nothing and never throws', () => {
    vi.stubGlobal('window', {
      localStorage: {
        getItem: () => {
          throw new Error('SecurityError')
        },
        setItem: () => {
          throw new Error('QuotaExceededError')
        },
      },
    })
    expect(() => writeRecentSearches(['x'])).not.toThrow()
    expect(readRecentSearches()).toEqual([])
  })
})

describe('league managers', () => {
  const detail = {
    teams: [
      { id: 't1', name: 'Touchdown Tacos' },
      { id: 't2', name: 'Gridiron Gurus' },
      { id: 't3', name: 'Bench Mob' },
    ],
    members: [
      { user_id: 'u-me', team_id: 't1', profiles: { username: 'dalton', avatar_url: null } },
      { user_id: 'u-2', team_id: 't2', profiles: { username: 'marcus', avatar_url: 'https://x/a.png' } },
      { user_id: null, team_id: 't3', profiles: null }, // an open seat
      { user_id: 'u-3', team_id: 't2', profiles: { username: 'priya', avatar_url: null } }, // co-manager
      { user_id: 'u-4', team_id: null, profiles: { username: 'commish', avatar_url: null } }, // no team
    ],
  }

  it('team order, you left out, every co-manager, no open seats or teamless members', () => {
    expect(leagueManagers(detail, 'u-me').map((m) => `${m.username}:${m.teamName}`)).toEqual(['marcus:Gridiron Gurus', 'priya:Gridiron Gurus'])
    expect(leagueManagers(detail, null).map((m) => m.username)).toEqual(['dalton', 'marcus', 'priya'])
  })

  it('found by handle (with or without the @) or by the team’s name', () => {
    const all = leagueManagers(detail, 'u-me')
    expect(matchManagers(all, 'MAR').map((m) => m.username)).toEqual(['marcus'])
    expect(matchManagers(all, '@pri').map((m) => m.username)).toEqual(['priya'])
    expect(matchManagers(all, 'gurus').map((m) => m.username)).toEqual(['marcus', 'priya'])
    expect(matchManagers(all, '  ')).toEqual([])
    expect(managerSub('Gridiron Gurus')).toBe('Gridiron Gurus · your league')
  })
})

describe('a player’s place in the league', () => {
  const mine = { kind: 'rostered', teamId: 't1', teamName: 'Touchdown Tacos', mine: true, managed: true } as const
  const theirs = { kind: 'rostered', teamId: 't2', teamName: 'Gridiron Gurus', mine: false, managed: true } as const

  it('Your team · another team’s name · Waivers · Free agent', () => {
    expect(ownerLabel(mine, 'in_season')).toEqual({ text: 'Your team', tone: 'mine' })
    expect(ownerLabel(theirs, 'in_season')).toEqual({ text: 'Gridiron Gurus', tone: 'other' })
    expect(ownerLabel({ kind: 'on_waivers', until: '2026-10-20T07:00:00Z' }, 'in_season')).toEqual({ text: 'Waivers', tone: 'open' })
    expect(ownerLabel({ kind: 'free_agent' }, 'playoffs')).toEqual({ text: 'Free agent', tone: 'open' })
  })

  it('Pre-draft before the league has drafted him — never "Free agent" in a league with no rosters (#44)', () => {
    expect(ownerLabel({ kind: 'free_agent' }, 'setup')).toEqual({ text: 'Pre-draft', tone: 'pre' })
    expect(ownerLabel({ kind: 'free_agent' }, 'scheduled').text).toBe('Pre-draft')
    expect(ownerLabel({ kind: 'free_agent' }, 'drafting').text).toBe('Pre-draft')
    // Mid-draft, a picked player is on his team.
    expect(ownerLabel(theirs, 'drafting').text).toBe('Gridiron Gurus')
  })
})

describe('where a post opens', () => {
  it('Community’s list page while Community is on, else the List view', () => {
    expect(postHref('l 1', true)).toBe('/app/explore?list=l%201')
    expect(postHref('l1', false)).toBe('/app/lists?list=l1')
  })
})

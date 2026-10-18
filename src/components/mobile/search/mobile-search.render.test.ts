/**
 * FieldScout Mobile full-screen search (gap list §3 #1; handoff m-match
 * §2.4 / §3.6) rendered over seeded query caches:
 *   - the empty query: Recent (this phone's) and Trending (Home's Risers);
 *   - a query: Players / People / Posts with All's caps (5 / 4 / 4) and a
 *     single scope's page; people open their profile, a list opens its page;
 *   - inside a league: its managers first (opening their team) and each
 *     player's place there — Your team / their team / Waivers / Free agent,
 *     Pre-draft before the league has drafted;
 *   - honest states: Searching… while a read is out (or the typing is ahead
 *     of the reads, or the last query's rows are still on screen), a failed
 *     read says so (never "No results"), and No results only when this
 *     query's every read answered.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

const nav = vi.hoisted(() => ({ pathname: '/app' }))
vi.mock('next/navigation', () => ({
  usePathname: () => nav.pathname,
  useRouter: () => ({ push: () => {}, replace: () => {}, refresh: () => {}, back: () => {}, prefetch: () => {} }),
}))
vi.mock('@/lib/supabase/client', () => ({ createBrowserClient: () => ({ from: () => ({}) }) }))
vi.mock('@/hooks/use-auth', () => ({ useAuth: () => ({ user: { id: 'u-me' }, profile: { username: 'dalton' }, isLoading: false }) }))
const flags = vi.hoisted(() => ({ community: false, leagues: true, messages: false }))
vi.mock('@/lib/feature-flags', () => ({ featureFlags: flags }))
// An earlier query's answer kept on screen while the typed one reads (what
// `keepPreviousData` does; a static render has no earlier observer to keep).
const kept = vi.hoisted(() => ({ from: null as string | null }))
vi.mock('@/hooks/use-mobile-search', async (importActual) => {
  const actual = await importActual<typeof import('@/hooks/use-mobile-search')>()
  return {
    ...actual,
    useMobileSearch: (term: string) => {
      if (!kept.from) return actual.useMobileSearch(term)
      const earlier = actual.useMobileSearch(kept.from)
      return { players: { ...earlier.players, isPlaceholderData: true }, community: { ...earlier.community, isPlaceholderData: true } }
    },
  }
})
const stored = vi.hoisted(() => ({ recent: [] as string[] }))
vi.mock('./search-ops', async (importActual) => ({
  ...(await importActual<typeof import('./search-ops')>()),
  readRecentSearches: () => stored.recent,
}))

import { leaguesKeys } from '@/hooks/use-leagues'
import { leaguePoolKeys } from '@/hooks/use-league-pool'
import { mobileSearchKeys } from '@/hooks/use-mobile-search'
import { leagueRosterKeys } from '@/hooks/use-rosters'

import { Results, SearchPanel } from './mobile-search'
import type { SearchScope } from './search-ops'

const P = (id: string, full_name: string, position: string, team: string, adp: number) => ({ id, full_name, position, team, adp, headshot_url: null, status: 'Active' })
const PLAYERS = [
  P('p1', 'Puka Nacua', 'WR', 'LAR', 4),
  P('p2', 'Saquon Barkley', 'RB', 'PHI', 5),
  P('p3', 'Tyler Warren', 'TE', 'IND', 60),
  P('p4', 'Jake Ferguson', 'TE', 'DAL', 90),
  P('p5', 'Philadelphia Eagles', 'DEF', 'PHI', 120),
  P('p6', 'Jalen Hurts', 'QB', 'PHI', 30),
  P('p7', 'DeVonta Smith', 'WR', 'PHI', 70),
]
const U = (id: string, username: string, follower_count: number) => ({ id, username, avatar_url: null, follower_count })
const USERS = [U('u-2', 'marcus', 3), U('u-a', 'shahranks', 12400), U('u-b', 'ortizff', 8400), U('u-c', 'halefantasy', 3200), U('u-d', 'kellyscouts', 2100), U('u-e', 'bellball', 640)]
const LISTS = [
  { id: 'l1', title: 'Week 7 sleepers', owner_username: 'shahranks' },
  { id: 'l2', title: 'Waiver stashes', owner_username: 'ortizff' },
  { id: 'l3', title: 'Deep TE targets', owner_username: null },
  { id: 'l4', title: 'Rookie risers', owner_username: 'bellball' },
  { id: 'l5', title: 'Fade list', owner_username: 'mom' },
]

function seeded(term = 'a', opts: { players?: unknown[]; users?: unknown[]; lists?: unknown[]; community?: boolean } = {}) {
  // A failed read stays failed on mount (no optimistic refetch in a static render).
  const qc = new QueryClient({ defaultOptions: { queries: { retryOnMount: false, staleTime: Infinity } } })
  qc.setQueryData(['home', 'players', 'ppr'], {
    players: [
      { ...P('r1', 'Rome Odunze', 'WR', 'CHI', 40), current_pts: 0, current_games: 0, last_pts: 100, last_games: 16, projected_pts: 190 },
      { ...P('r2', 'Brock Bowers', 'TE', 'LV', 20), current_pts: 0, current_games: 0, last_pts: 150, last_games: 16, projected_pts: 200 },
      { ...P('r3', 'Faller Guy', 'RB', 'NYG', 99), current_pts: 0, current_games: 0, last_pts: 250, last_games: 16, projected_pts: 120 },
    ],
  })
  if (term) {
    qc.setQueryData(mobileSearchKeys.players(term), opts.players ?? PLAYERS)
    if (opts.community !== false) qc.setQueryData(mobileSearchKeys.community(term.replace(/^@+/, '')), { users: opts.users ?? USERS, lists: opts.lists ?? LISTS })
  }
  return qc
}

const html = (qc: QueryClient, props: { initialQuery?: string; initialScope?: SearchScope } = {}) =>
  renderToStaticMarkup(createElement(QueryClientProvider, { client: qc }, createElement(SearchPanel, { onClose: () => {}, ...props })))
    .replace(/&#x27;/g, "'")
    .replace(/&amp;/g, '&')

const count = (out: string, needle: string) => out.split(needle).length - 1

describe('the search row and the scope chips', () => {
  it('a field with the design’s words, Cancel, and All / Players / People / Posts with All on', () => {
    nav.pathname = '/app'
    const out = html(seeded(''))
    expect(out).toContain('placeholder="Players, people and posts"')
    expect(out).toContain('>Cancel</button>')
    const chips = [...out.matchAll(/aria-pressed="(true|false)"[^>]*>(All|Players|People|Posts)</g)].map((m) => `${m[2]}:${m[1]}`)
    expect(chips).toEqual(['All:true', 'Players:false', 'People:false', 'Posts:false'])
    // No clear button on an empty field.
    expect(out).not.toContain('aria-label="Clear search"')
  })
})

describe('the empty query', () => {
  it('Recent (newest first, with Clear) then Trending from Home’s Risers', () => {
    nav.pathname = '/app'
    stored.recent = ['Puka Nacua', '@shahranks']
    const out = html(seeded(''))
    stored.recent = []
    expect(out).toContain('>Recent</h2>')
    expect(out).toContain('>Clear</button>')
    expect(out.indexOf('Puka Nacua')).toBeLessThan(out.indexOf('@shahranks'))
    expect(out.indexOf('>Recent<')).toBeLessThan(out.indexOf('>Trending<'))
    // Risers by projection gain; a faller is not trending.
    expect(out.indexOf('Rome Odunze')).toBeGreaterThan(-1)
    expect(out.indexOf('Rome Odunze')).toBeLessThan(out.indexOf('Brock Bowers'))
    expect(out).not.toContain('Faller Guy')
    expect(out).not.toContain('>Players</h2>')
  })
  it('nothing searched on this phone yet: no Recent heading at all', () => {
    nav.pathname = '/app'
    const out = html(seeded(''))
    expect(out).not.toContain('Recent')
    expect(out).toContain('>Trending</h2>')
  })
})

describe('a query outside a league', () => {
  it('All: the first 5 players, 4 people and 4 posts — and no league labels', () => {
    nav.pathname = '/app'
    const out = html(seeded('a'), { initialQuery: 'a' })
    expect(out).toContain('aria-label="Clear search"')
    expect(out.indexOf('>Players</h2>')).toBeLessThan(out.indexOf('>People</h2>'))
    expect(out.indexOf('>People</h2>')).toBeLessThan(out.indexOf('>Posts</h2>'))
    expect(out).toContain('Philadelphia Eagles')
    expect(out).not.toContain('Jalen Hurts') // the 6th player
    expect(out).toContain('D/ST · PHI')
    expect(out).toContain('WR · LAR')
    expect(count(out, 'href="/u/')).toBe(4)
    expect(out).not.toContain('href="/u/bellball"')
    expect(count(out, '>List</span>')).toBe(4)
    for (const label of ['Your team', 'Free agent', 'Waivers', 'Pre-draft', 'your league']) expect(out).not.toContain(label)
  })
  it('a person opens their profile, with the follow count under the handle', () => {
    nav.pathname = '/app'
    const out = html(seeded('a'), { initialQuery: 'a' })
    expect(out).toMatch(/href="\/u\/shahranks"[^>]*>[\s\S]*?@shahranks<\/span>[\s\S]*?12\.4k follows/)
  })
  it('a list opens the List view while Community is off, Community’s list page when it’s on', () => {
    nav.pathname = '/app'
    expect(html(seeded('a'), { initialQuery: 'a' })).toContain('href="/app/lists?list=l1"')
    flags.community = true
    const on = html(seeded('a'), { initialQuery: 'a' })
    flags.community = false
    expect(on).toContain('href="/app/explore?list=l1"')
    expect(on).toMatch(/Week 7 sleepers<\/span><span[^>]*>@shahranks<\/span>/)
  })
  it('a single scope shows its own page and hides the other sections', () => {
    nav.pathname = '/app'
    const players = html(seeded('a'), { initialQuery: 'a', initialScope: 'players' })
    expect(players).toContain('Jalen Hurts')
    expect(players).toContain('DeVonta Smith')
    expect(players).not.toContain('>People</h2>')
    expect(players).not.toContain('>Posts</h2>')
    const people = html(seeded('a'), { initialQuery: 'a', initialScope: 'people' })
    expect(count(people, 'href="/u/')).toBe(6)
    expect(people).not.toContain('>Players</h2>')
    const posts = html(seeded('a'), { initialQuery: 'a', initialScope: 'posts' })
    expect(count(posts, '>List</span>')).toBe(5)
  })
  it('a handle typed with its @ finds the person', () => {
    nav.pathname = '/app'
    const out = html(seeded('@shah', { players: [], users: [U('u-a', 'shahranks', 12400)], lists: [] }), { initialQuery: '@shah' })
    expect(out).toContain('href="/u/shahranks"')
  })
})

describe('honest states', () => {
  it('No results only when every section answered with nothing', () => {
    nav.pathname = '/app'
    const out = html(seeded('zzz', { players: [], users: [], lists: [] }), { initialQuery: 'zzz' })
    expect(out).toContain('No results')
    expect(out).not.toContain('Searching')
  })
  it('Searching… while the people and posts read is still out — not "No results"', () => {
    nav.pathname = '/app'
    const out = html(seeded('zzz', { players: [], community: false }), { initialQuery: 'zzz' })
    expect(out).toContain('Searching…')
    expect(out).not.toContain('No results')
  })
  it('typing ahead of the reads: Searching… — the last query’s empty answer is not this one’s "No results"', () => {
    nav.pathname = '/app'
    // "zzzqqq" answered with nothing; "jalen" is typed and its reads haven't gone out yet.
    const qc = seeded('zzzqqq', { players: [], users: [], lists: [] })
    const out = renderToStaticMarkup(
      createElement(QueryClientProvider, { client: qc }, createElement(Results, { raw: 'jalen', term: 'zzzqqq', scope: 'all', leagueId: null, remember: () => {}, onClose: () => {} })),
    )
    expect(out).toContain('Searching…')
    expect(out).not.toContain('No results')
  })
  it('the last query’s empty answer kept on screen while this one reads: Searching…, not "No results"', () => {
    nav.pathname = '/app'
    const qc = seeded('zzzqqq', { players: [], users: [], lists: [] })
    kept.from = 'zzzqqq'
    const out = html(qc, { initialQuery: 'jalen' })
    kept.from = null
    expect(out).toContain('Searching…')
    expect(out).not.toContain('No results')
  })
  it('a failed player read says so, with Try again', () => {
    nav.pathname = '/app'
    const qc = seeded('zzz', { users: [], lists: [] })
    qc.removeQueries({ queryKey: mobileSearchKeys.players('zzz') })
    qc.getQueryCache().build(qc, { queryKey: mobileSearchKeys.players('zzz') }).setState({ status: 'error', error: new Error('boom'), fetchStatus: 'idle', data: undefined })
    const out = html(qc, { initialQuery: 'zzz' })
    expect(out).toContain('Couldn’t search players.')
    expect(out).toContain('Try again')
    expect(out).not.toContain('No results')
  })
})

describe('inside a league', () => {
  const L = 'L1'
  const detail = (status: string) => ({
    league: { id: L, name: 'Sunday Funday League', status, season: 2026 },
    settings: {},
    teams: [
      { id: 't1', name: 'Touchdown Tacos', owner_id: 'u-me', status: 'active', created_at: null },
      { id: 't2', name: 'Gridiron Gurus', owner_id: 'u-2', status: 'active', created_at: null },
      { id: 't3', name: 'Waiver Wire Warriors', owner_id: 'u-3', status: 'active', created_at: null },
    ],
    members: [
      { id: 'm1', user_id: 'u-me', team_id: 't1', role: 'owner', is_placeholder: false, is_autodraft: false, joined_at: null, profiles: { username: 'dalton', avatar_url: null } },
      { id: 'm2', user_id: 'u-2', team_id: 't2', role: 'member', is_placeholder: false, is_autodraft: false, joined_at: null, profiles: { username: 'marcus', avatar_url: null } },
      { id: 'm3', user_id: 'u-3', team_id: 't3', role: 'member', is_placeholder: false, is_autodraft: false, joined_at: null, profiles: { username: 'priya', avatar_url: null } },
    ],
    my_role: 'owner',
    active_draft: null,
  })
  const unlocked = { state: 'unlocked', until: null }
  const leagueSeeded = (status: string, term = 'a') => {
    const qc = seeded(term)
    qc.setQueryData(leaguesKeys.detail(L), detail(status))
    qc.setQueryData(leagueRosterKeys.all(L), {
      league_id: L,
      season: 2026,
      teams: [
        { team_id: 't1', name: 'Touchdown Tacos', manager_user_id: 'u-me', roster: [{ player_id: 'p1', game_lock: unlocked }] },
        { team_id: 't2', name: 'Gridiron Gurus', manager_user_id: 'u-2', roster: [{ player_id: 'p2', game_lock: unlocked }] },
      ],
    })
    qc.setQueryData(leaguePoolKeys.all(L), [{ player_id: 'p3', state: 'on_waivers', waivers_until: '2026-10-20T07:00:00Z', game_lock: unlocked }])
    return qc
  }

  it('each player says where he is: Your team · their team · Waivers · Free agent', () => {
    nav.pathname = `/app/leagues/${L}/matchup`
    const out = html(leagueSeeded('in_season'), { initialQuery: 'a', initialScope: 'players' })
    const label = (name: string) => new RegExp(`${name}</span>[\\s\\S]*?</span></span><span[^>]*>([^<]+)</span>`).exec(out)?.[1]
    expect(label('Puka Nacua')).toBe('Your team')
    expect(label('Saquon Barkley')).toBe('Gridiron Gurus')
    expect(label('Tyler Warren')).toBe('Waivers')
    expect(label('Jake Ferguson')).toBe('Free agent')
    expect(out).toMatch(/text-accent[^"]*">Your team</)
    expect(out).toMatch(/text-positive-strong[^"]*">Waivers</)
  })

  it('before the draft every player reads Pre-draft', () => {
    nav.pathname = `/app/leagues/${L}`
    const out = html(leagueSeeded('scheduled'), { initialQuery: 'a', initialScope: 'players' })
    expect(count(out, '>Pre-draft</span>')).toBe(7)
    expect(out).not.toContain('Free agent')
  })

  it('People: the league’s managers first (you left out), each opening their team; a FieldScout person once', () => {
    nav.pathname = `/app/leagues/${L}/players`
    const out = html(leagueSeeded('in_season'), { initialQuery: 'a', initialScope: 'people' })
    expect(out).toMatch(/href="\/app\/leagues\/L1\/team\/t2"[^>]*>[\s\S]*?@marcus<\/span>[\s\S]*?Gridiron Gurus · your league/)
    expect(out).toContain(`href="/app/leagues/${L}/team/t3"`)
    expect(out).not.toContain('@dalton')
    // marcus is a manager here, so his community row is not repeated.
    expect(out).not.toContain('href="/u/marcus"')
    expect(out.indexOf('/team/t3')).toBeLessThan(out.indexOf('href="/u/shahranks"'))
  })

  it('a team’s name finds its manager', () => {
    nav.pathname = `/app/leagues/${L}/players`
    const out = html(leagueSeeded('in_season', 'warriors'), { initialQuery: 'warriors', initialScope: 'people' })
    expect(out).toContain('@priya</span>')
  })

  it('a league that can’t be read says so instead of labelling players', () => {
    nav.pathname = `/app/leagues/${L}/players`
    const qc = seeded('a')
    qc.getQueryCache().build(qc, { queryKey: leaguesKeys.detail(L) }).setState({ status: 'error', error: new Error('boom'), fetchStatus: 'idle', data: undefined })
    const out = html(qc, { initialQuery: 'a', initialScope: 'players' })
    expect(out).toContain('Couldn’t load your league')
    expect(out).not.toContain('Free agent')
  })
})

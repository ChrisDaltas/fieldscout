/**
 * A person's profile and their Followers / Following as phone screens
 * (audit profile-1), rendered over a seeded query cache in the phone layout:
 *  - every username link opens the phone screen inside the app (`/app/u/…`),
 *    your own @handle included — never the desktop public page;
 *  - the screen shows what the public page shows (handle, bio, Follow,
 *    followers / following opening their lists, cred, public lists) with a
 *    Back, on the m-* tokens;
 *  - nobody by that name, and a failed read, each say so.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('next/navigation', () => ({
  usePathname: () => '/app/u/devpro',
  useRouter: () => ({ push: () => {}, replace: () => {}, refresh: () => {}, back: () => {} }),
  useSearchParams: () => new URLSearchParams(''),
}))
vi.mock('@/lib/supabase/client', () => ({
  createBrowserClient: () => ({ from: () => ({}) }),
}))
const flags = vi.hoisted(() => ({ community: true, leagues: true }))
vi.mock('@/lib/feature-flags', () => ({ featureFlags: flags }))
// The phone layout (`<html data-layout="mobile">`).
vi.mock('@/hooks/use-layout-mode', () => ({ useLayoutModeValue: () => 'mobile' }))
const me = vi.hoisted(() => ({ id: 'user-me', username: 'dev_user' }))
vi.mock('@/hooks/use-auth', () => ({
  useAuth: () => ({ user: { id: me.id }, profile: { id: me.id, username: me.username }, isLoading: false }),
}))

import { UsernameLink } from '@/components/shared/username-link'
import { followKeys } from '@/hooks/use-follows'
import type { PersonFollowsData } from '@/hooks/use-person-follows'
import type { PersonProfileData } from '@/hooks/use-person-profile'

import { MobilePersonFollows } from './person-follows'
import { MobilePersonProfile } from './person-profile'

afterEach(() => {
  flags.community = true
})

const DEVPRO: PersonProfileData = {
  profile: {
    id: 'user-pro',
    username: 'devpro',
    avatar_url: null,
    bio: 'Dynasty grinder.\nRB truther.',
    cred_score: 340,
    follower_count: 12,
    following_count: 3,
  },
  lists: [
    { id: 'list-1', title: 'Week 9 RB rankings', description: null, position_filter: 'RB', ranking_mode: 'ranked', player_count: 24, like_count: 3, updated_at: '2026-10-25T12:00:00Z' },
    { id: 'list-2', title: 'Waiver wire targets', description: 'Adds for week 9.', position_filter: null, ranking_mode: 'unranked', player_count: 8, like_count: 0, updated_at: '2026-10-27T07:00:00Z' },
  ],
  listCount: 2,
}

function render(el: ReturnType<typeof createElement>, seed?: (qc: QueryClient) => void) {
  // retryOnMount off: a seeded failed read stays failed in the server render.
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, retryOnMount: false } } })
  qc.setQueryData(followKeys.followingSet(me.id), new Set<string>())
  seed?.(qc)
  return renderToStaticMarkup(createElement(QueryClientProvider, { client: qc }, el))
    .replace(/&#x27;/g, "'")
    .replace(/&amp;/g, '&')
}

const profileOf = (username: string, data: PersonProfileData | null) =>
  render(createElement(MobilePersonProfile, { username }), (qc) => qc.setQueryData(followKeys.person(username), data))

describe('in the phone layout every username opens the phone screen, inside the app', () => {
  it('UsernameLink → /app/u/<username> (never the desktop /u page)', () => {
    const out = render(createElement(UsernameLink, { username: 'chris_gm' }))
    expect(out).toContain('href="/app/u/chris_gm"')
    expect(out).not.toContain('href="/u/')
  })
})

describe('a person’s profile on the phone', () => {
  it('Back, the avatar, the @handle as the heading, Follow and the bio — in the phone language', () => {
    const out = profileOf('devpro', DEVPRO)
    expect(out).toContain('data-mobile-screen')
    expect(out).toContain('aria-label="Back"')
    expect(out).toMatch(/<h1[^>]*>@devpro<\/h1>/)
    // Community's phone Follow pill — this viewer doesn't follow devpro yet.
    expect(out).toMatch(/<button[^>]*aria-pressed="false"[^>]*>Follow<\/button>/)
    expect(out).toContain('Dynasty grinder.\nRB truther.')
    expect(out).toMatch(/<p[^>]*whitespace-pre-line[^>]*data-profile-bio/)
    // Phone tokens, not the desktop page's.
    expect(out).toContain('bg-m-b1')
    expect(out).not.toMatch(/\bbg-white\b|\btext-ink\b|\btext-n-\d/)
  })

  it('Followers and Following show the counts and open those lists on the phone', () => {
    const out = profileOf('devpro', DEVPRO)
    const card = (label: string) => out.match(new RegExp(`<a[^>]*data-stat-link="${label}"[^>]*>.*?</a>`))?.[0] ?? ''
    expect(card('Followers')).toContain('href="/app/u/devpro/followers"')
    expect(card('Followers')).toMatch(/>12<\/span><span[^>]*>Followers</)
    expect(card('Following')).toContain('href="/app/u/devpro/following"')
    expect(card('Following')).toMatch(/>3<\/span><span[^>]*>Following</)
    // Pressed tint, like the design's tiles.
    expect(card('Followers')).toContain('active:bg-m-b2')
  })

  it('the Cred card, from the stored cred score', () => {
    const out = profileOf('devpro', DEVPRO)
    expect(out).toContain('data-profile-cred')
    expect(out).toContain('340 cred')
    expect(out).toContain('260 to Varsity')
  })

  it('public lists, newest first, each opening where a phone opens a public list', () => {
    const out = profileOf('devpro', DEVPRO)
    expect(out).toContain('>Public lists</h2>')
    const first = out.indexOf('Week 9 RB rankings')
    const second = out.indexOf('Waiver wire targets')
    expect(first).toBeGreaterThan(-1)
    expect(second).toBeGreaterThan(first)
    expect(out).toMatch(/24 players · Ranked · Updated [^<]+ · 3 likes/)
    // Community's list page while Community is on…
    expect(out).toContain('href="/app/explore?list=list-1"')
    flags.community = false
    // …else the List view.
    expect(profileOf('devpro', DEVPRO)).toContain('href="/app/lists?list=list-1"')
  })

  it('with no public lists it says so', () => {
    const out = profileOf('devpro', { ...DEVPRO, lists: [], listCount: 0 })
    expect(out).toContain('No public lists yet')
  })

  it('your own @handle opens your public profile: no Follow, and it says whose it is', () => {
    const own: PersonProfileData = { ...DEVPRO, profile: { ...DEVPRO.profile, id: me.id, username: me.username } }
    const out = profileOf(me.username, own)
    expect(out).toMatch(/<h1[^>]*>@dev_user<\/h1>/)
    expect(out).toContain('Your public profile')
    expect(out).not.toMatch(/>Follow<\/button>/)
    expect(out).not.toMatch(/>Following<\/button>/)
    expect(out).toContain('bg-accent')
  })

  it('nobody by that name: said plainly, never an empty profile', () => {
    const out = profileOf('ghost', null)
    expect(out).toContain('data-person-not-found')
    expect(out).toContain('We can’t find this person')
    expect(out).not.toContain('Public lists')
  })

  it('while it loads: a skeleton, not "not found"', () => {
    const out = render(createElement(MobilePersonProfile, { username: 'devpro' }))
    expect(out).toContain('aria-busy="true"')
    expect(out).not.toContain('data-person-not-found')
  })

  it('a failed read says so, with Try again — never an empty profile', () => {
    const out = render(createElement(MobilePersonProfile, { username: 'devpro' }), (qc) => {
      qc.getQueryCache()
        .build(qc, { queryKey: followKeys.person('devpro') })
        .setState({ status: 'error', error: new Error('boom'), fetchStatus: 'idle' })
    })
    expect(out).toContain('role="alert"')
    expect(out).toContain('We couldn’t load this profile.')
    expect(out).toContain('Try again')
    expect(out).not.toContain('data-person-not-found')
  })
})

describe('Followers / Following on the phone', () => {
  const FOLLOWERS: PersonFollowsData = {
    owner: { id: 'user-pro', username: 'devpro' },
    people: [
      { id: 'user-a', username: 'amy_ff', avatar_url: null, bio: 'Zero-RB.\nAlways.', cred_score: 120 },
      { id: me.id, username: me.username, avatar_url: null, bio: null, cred_score: null },
    ],
  }
  const follows = (kind: 'followers' | 'following', data: PersonFollowsData | null) =>
    render(createElement(MobilePersonFollows, { username: 'devpro', kind }), (qc) => {
      qc.setQueryData(followKeys.personFollows('devpro', kind), data)
      qc.setQueryData(followKeys.person('devpro'), DEVPRO)
    })

  it('the page bar names whose lists these are, with Back; the switch carries the counts', () => {
    const out = follows('followers', FOLLOWERS)
    expect(out).toMatch(/<h1[^>]*>@devpro<\/h1>/)
    expect(out).toContain('data-page-back')
    expect(out).toMatch(/aria-pressed="true"[^>]*>Followers 12</)
    expect(out).toMatch(/aria-pressed="false"[^>]*>Following 3</)
  })

  it('each row: the @handle opening that person’s phone screen, cred and bio, and Follow — “You” on your own row', () => {
    const out = follows('followers', FOLLOWERS)
    expect(out.match(/data-follow-row/g)).toHaveLength(2)
    expect(out).toContain('href="/app/u/amy_ff"')
    expect(out).toContain('120 cred · Zero-RB.')
    expect(out).toContain('href="/app/u/dev_user"')
    expect(out).toMatch(/>You<\/span>/)
    expect(out.match(/>Follow<\/button>/g)).toHaveLength(1)
  })

  it('an empty list and an unknown name each say so', () => {
    expect(follows('following', { ...FOLLOWERS, people: [] })).toContain('Not following anyone yet.')
    expect(follows('followers', null)).toContain('data-person-not-found')
  })
})

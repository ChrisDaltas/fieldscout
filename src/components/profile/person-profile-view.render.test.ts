/**
 * Plan C6 (readiness S7a) — a person's profile inside the DESKTOP app shell,
 * rendered over a seeded query cache in the desktop layout:
 *  - with Community on, every username in the desktop app opens the profile
 *    inside the app (`/app/u/…`) — C6 reverses C0's "desktop never links
 *    here" on purpose; with it off, desktop opens the public page as before;
 *  - the profile is v7's look with what exists: avatar, @handle, the
 *    followers line, Follow and Share (Edit profile and Share on your own),
 *    Followers / Following / Public lists tiles, and the lists grid — cards
 *    flat at rest, lifting only under the pointer — and no accuracy tiles;
 *  - the lists open where a list opens in the app (`inAppListHref`), the
 *    tiles open the Followers / Following lists inside the app;
 *  - an exact list count, never the page size; nobody by that name, a failed
 *    read and loading each say so;
 *  - Followers / Following inside the app: the public pages' rows, the
 *    switch with the counts, Back.
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createElement, type ReactNode } from 'react'
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
// The desktop layout (`<html data-layout="desktop">`).
const layout = vi.hoisted(() => ({ mode: 'desktop' as 'desktop' | 'mobile' | null }))
vi.mock('@/hooks/use-layout-mode', () => ({ useLayoutModeValue: () => layout.mode }))
const me = vi.hoisted(() => ({ id: 'user-me', username: 'dev_user' }))
vi.mock('@/hooks/use-auth', () => ({
  useAuth: () => ({ user: { id: me.id }, profile: { id: me.id, username: me.username }, isLoading: false }),
}))
// The shell's standard header renders through a store in the real app; here
// it renders its parts in place, so the title, switch and Back can be read.
vi.mock('@/components/layout/app-header', () => ({
  PageHeader: (p: { title: string; subtitle?: ReactNode; aside?: ReactNode; actions?: ReactNode }) =>
    createElement('div', { 'data-page-header': p.title }, p.subtitle, p.aside, p.actions),
}))

import { UsernameLink } from '@/components/shared/username-link'
import { followKeys } from '@/hooks/use-follows'
import type { PersonFollowsData } from '@/hooks/use-person-follows'
import type { PersonProfileData } from '@/hooks/use-person-profile'

import { DesktopPersonFollows, DesktopPersonProfile } from './person-profile-view'

afterEach(() => {
  flags.community = true
  layout.mode = 'desktop'
})

const DEVPRO: PersonProfileData = {
  profile: {
    id: 'user-pro',
    username: 'devpro',
    avatar_url: null,
    bio: 'Dynasty grinder.',
    cred_score: 340,
    follower_count: 12,
    following_count: 3,
  },
  lists: [
    { id: 'list-1', title: 'Week 9 RB rankings', description: 'My RBs for the week.', position_filter: 'RB', ranking_mode: 'ranked', player_count: 24, like_count: 3, updated_at: '2026-10-25T12:00:00Z' },
    { id: 'list-2', title: 'Waiver wire targets', description: null, position_filter: null, ranking_mode: 'unranked', player_count: 8, like_count: 0, updated_at: '2026-10-27T07:00:00Z' },
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
  render(createElement(DesktopPersonProfile, { username }), (qc) => qc.setQueryData(followKeys.person(username), data))

describe('where a username goes on desktop (C6 reverses C0’s “desktop never links here”)', () => {
  it('Community on: the profile inside the app', () => {
    expect(render(createElement(UsernameLink, { username: 'chris_gm' }))).toContain('href="/app/u/chris_gm"')
  })

  it('Community off: the public page, as before C6', () => {
    flags.community = false
    expect(render(createElement(UsernameLink, { username: 'chris_gm' }))).toContain('href="/u/chris_gm"')
  })

  it('pages outside the app (no layout) keep the public page, Community on or off', () => {
    layout.mode = null
    expect(render(createElement(UsernameLink, { username: 'chris_gm' }))).toContain('href="/u/chris_gm"')
  })
})

describe('someone else’s profile, inside the desktop app', () => {
  it('the standard header: “Profile” with Back', () => {
    const out = profileOf('devpro', DEVPRO)
    expect(out).toContain('data-page-header="Profile"')
    expect(out).toMatch(/<button[^>]*>.*Back<\/button>/)
  })

  it('the identity row: avatar, @handle as the heading, the followers line, the bio — Follow and Share at its end', () => {
    const out = profileOf('devpro', DEVPRO)
    expect(out).toMatch(/<h1[^>]*>@devpro<\/h1>/)
    expect(out).toMatch(/>12<\/span> followers/)
    expect(out).toMatch(/>3<\/span> following/)
    expect(out).toContain('Dynasty grinder.')
    // This viewer doesn't follow devpro yet: the blue Follow, v7's 27px.
    expect(out).toMatch(/<button[^>]*h-btn-md[^>]*>Follow<\/button>/)
    expect(out).toMatch(/<button[^>]*>.*Share<\/button>/)
    expect(out).not.toContain('Edit profile')
  })

  it('the followers / following counts open those lists inside the app', () => {
    const out = profileOf('devpro', DEVPRO)
    expect(out).toContain('href="/app/u/devpro/followers"')
    expect(out).toContain('href="/app/u/devpro/following"')
    expect(out).not.toContain('href="/u/devpro/followers"')
  })

  it('tiles: Followers and Following (each opening its list) and Public lists — no accuracy tiles', () => {
    const out = profileOf('devpro', DEVPRO)
    const tile = (label: string) => out.match(new RegExp(`<a[^>]*data-stat-link="${label}"[^>]*>.*?</a>`))?.[0] ?? ''
    expect(tile('Followers')).toContain('href="/app/u/devpro/followers"')
    expect(tile('Followers')).toMatch(/>Followers<\/div><div[^>]*>12</)
    expect(tile('Following')).toContain('href="/app/u/devpro/following"')
    expect(out).toMatch(/>Public lists<\/div><div[^>]*>2</)
    for (const placeholder of ['accuracy', 'Accuracy', 'Platform rank', 'streak', 'Teams']) {
      expect(out).not.toContain(placeholder)
    }
    // The links paint under the pointer; nothing lifts at rest.
    expect(tile('Followers')).toContain('hover:bg-surface-hover')
  })

  it('the lists grid: each card opens Community’s list page, flat at rest and lifting only on hover', () => {
    const out = profileOf('devpro', DEVPRO)
    expect(out).toContain('>Public lists</h2>')
    expect(out).toContain('href="/app/explore?list=list-1"')
    expect(out).toContain('href="/app/explore?list=list-2"')
    expect(out).toContain('My RBs for the week.')
    // The page says whose they are — no owner byline on each card.
    expect(out).not.toMatch(/·\s*@devpro/)
    const cards = out.match(/<div class="relative block rounded-2xl[^"]*"/g) ?? []
    expect(cards).toHaveLength(2)
    for (const card of cards) {
      expect(card).toContain('hover:shadow-hard-6')
      expect(card).not.toMatch(/(?<![:\w-])shadow-hard/)
    }
  })

  it('a count past the page: the tile says the real number, and the grid says it shows the newest', () => {
    const out = profileOf('devpro', { ...DEVPRO, listCount: 34 })
    expect(out).toMatch(/>Public lists<\/div><div[^>]*>34</)
    expect(out).toContain('Showing the 2 most recently updated of 34 public lists.')
  })

  it('…and if the count didn’t come back on a full page, “20+”, never the page size as the total', () => {
    const many = Array.from({ length: 20 }, (_, i) => ({ ...DEVPRO.lists[0]!, id: `l${i}` }))
    const out = profileOf('devpro', { ...DEVPRO, lists: many, listCount: null })
    expect(out).toMatch(/>Public lists<\/div><div[^>]*>20\+</)
  })

  it('with no public lists it says so', () => {
    const out = profileOf('devpro', { ...DEVPRO, lists: [], listCount: 0 })
    expect(out).toContain('No public lists yet')
  })

  it('Share copies the public profile link — what anyone can open — not the app’s address', () => {
    const src = readFileSync(path.join(__dirname, 'person-profile-view.tsx'), 'utf8')
    expect(src).toContain('<ShareLinkButton href={userProfileHref(profile.username)} size="md" />')
  })
})

describe('your own profile, inside the desktop app', () => {
  const own: PersonProfileData = { ...DEVPRO, profile: { ...DEVPRO.profile, id: me.id, username: me.username } }

  it('Edit profile and Share, no Follow; your lists open on your Lists', () => {
    const out = profileOf(me.username, own)
    expect(out).toMatch(/<h1[^>]*>@dev_user<\/h1>/)
    expect(out).toContain('href="/app/settings/profile"')
    expect(out).toContain('Edit profile')
    expect(out).not.toMatch(/>Follow<\/button>/)
    expect(out).toContain('href="/app/lists?list=list-1"')
    expect(out).not.toContain('href="/app/explore?list=')
  })

  it('no lists: said as yours', () => {
    expect(profileOf(me.username, { ...own, lists: [], listCount: 0 })).toContain('You haven’t shared any lists yet')
  })
})

describe('when the profile can’t be shown', () => {
  it('nobody by that name: said plainly, never an empty profile', () => {
    const out = profileOf('ghost', null)
    expect(out).toContain('data-person-not-found')
    expect(out).toContain('We can’t find this person')
    expect(out).not.toContain('Public lists')
  })

  it('while it loads: a skeleton, not “not found”', () => {
    const out = render(createElement(DesktopPersonProfile, { username: 'devpro' }))
    expect(out).toContain('aria-busy="true"')
    expect(out).not.toContain('data-person-not-found')
  })

  it('a failed read says “Couldn’t load this profile.” with Try again — red words, never a red fill', () => {
    const out = render(createElement(DesktopPersonProfile, { username: 'devpro' }), (qc) => {
      qc.getQueryCache()
        .build(qc, { queryKey: followKeys.person('devpro') })
        .setState({ status: 'error', error: new Error('boom'), fetchStatus: 'idle' })
    })
    expect(out).toContain('data-profile-read-failed')
    expect(out).toContain('Couldn’t load this profile.')
    expect(out).toContain('Try again')
    expect(out).toContain('text-negative-strong')
    expect(out).not.toMatch(/bg-negative-strong|bg-destructive/)
    expect(out).not.toContain('data-person-not-found')
  })
})

describe('Followers / Following inside the desktop app', () => {
  const FOLLOWERS: PersonFollowsData = {
    owner: { id: 'user-pro', username: 'devpro' },
    people: [
      { id: 'user-a', username: 'amy_ff', avatar_url: null, bio: 'Zero-RB.', cred_score: 120 },
      { id: me.id, username: me.username, avatar_url: null, bio: null, cred_score: null },
    ],
  }
  const follows = (kind: 'followers' | 'following', data: PersonFollowsData | null) =>
    render(createElement(DesktopPersonFollows, { username: 'devpro', kind }), (qc) => {
      qc.setQueryData(followKeys.personFollows('devpro', kind), data)
      qc.setQueryData(followKeys.person('devpro'), DEVPRO)
    })

  it('the standard header: the list’s name, whose it is (a link to them), the switch with the counts, Back', () => {
    const out = follows('followers', FOLLOWERS)
    expect(out).toContain('data-page-header="Followers"')
    expect(out).toMatch(/<a data-username-link="devpro"[^>]*href="\/app\/u\/devpro">@devpro<\/a>/)
    expect(out).toMatch(/aria-pressed="true"[^>]*>.*Followers.*12/)
    expect(out).toMatch(/aria-pressed="false"[^>]*>.*Following.*3/)
    expect(out).toMatch(/<button[^>]*>.*Back<\/button>/)
  })

  it('each row: the person, opening their profile inside the app, and Follow — none on your own row', () => {
    const out = follows('followers', FOLLOWERS)
    expect(out).toContain('href="/app/u/amy_ff"')
    expect(out).toContain('href="/app/u/dev_user"')
    expect(out.match(/>Follow<\/button>/g)).toHaveLength(1)
  })

  it('an empty list and an unknown name each say so', () => {
    expect(follows('following', { ...FOLLOWERS, people: [] })).toContain('Not following anyone yet')
    expect(follows('followers', null)).toContain('data-person-not-found')
  })
})

describe('the in-app routes', () => {
  const route = (rel: string) => readFileSync(path.join(process.cwd(), 'src/app/app/(shell)/u/[username]', rel), 'utf8')

  it('desktop renders inside the shell while Community is on — the public page while it is off, as before C6', () => {
    expect(route('page.tsx')).toMatch(
      /featureFlags\.community \? \(\s*<DesktopPersonProfile username=\{username\} \/>\s*\) : \(\s*<DesktopRedirect href=\{userProfileHref\(username\)\} \/>/,
    )
    for (const kind of ['followers', 'following']) {
      expect(route(`${kind}/page.tsx`)).toContain(`<DesktopPersonFollows username={username} kind="${kind}" />`)
      expect(route(`${kind}/page.tsx`)).toContain(`<DesktopRedirect href={\`\${userProfileHref(username)}/${kind}\`} />`)
    }
  })

  it('the phone keeps its own screens', () => {
    expect(route('page.tsx')).toContain('mobile={<MobilePersonProfile username={username} />}')
    expect(route('followers/page.tsx')).toContain('mobile={<MobilePersonFollows username={username} kind="followers" />}')
  })
})

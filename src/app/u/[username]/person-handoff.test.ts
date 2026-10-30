/**
 * A person's public pages and the app (plan C6, "Signed-in visitors"),
 * pinned through the pages themselves against a fake server client:
 *  - Community on, signed in, someone else's profile (or their Followers /
 *    Following) → redirected on the server to the same page inside the app
 *    (`/app/u/<name>…`), before the lists or rows are read — on either
 *    layout (on a phone that is the phone screen `PhoneHandoff` opened);
 *  - the person themselves, a signed-out visitor (and a search engine — no
 *    session), and everyone while Community is off keep the public,
 *    server-rendered page — and the phone's own hand-off (`PhoneHandoff`,
 *    audit profile-1) is there exactly as before;
 *  - the public profile's header carries Follow while Community is on (a
 *    signed-out click asks you to sign in, then comes back), and nothing
 *    new while it's off.
 */
import { isValidElement, type ReactElement, type ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

type Result = { data: unknown; error: unknown; count?: number | null }

const h = vi.hoisted(() => ({
  community: true,
  user: null as { id: string } | null,
  reads: [] as string[],
}))

class RedirectSignal extends Error {
  constructor(public to: string) {
    super(`redirect ${to}`)
  }
}

const KELLY = {
  id: 'u-kelly',
  username: 'kelly',
  avatar_url: null,
  bio: null,
  cred_score: 7,
  is_pro: false,
  follower_count: 4,
  following_count: 2,
}

function fakeClient() {
  return {
    auth: { getUser: async () => ({ data: { user: h.user }, error: null }) },
    from: (table: string) => {
      h.reads.push(table)
      const answer = (): Result =>
        table === 'profiles'
          ? { data: KELLY, error: null }
          : table === 'lists'
            ? { data: [], error: null }
            : { data: [], error: null, count: 0 }
      const builder: Record<string, unknown> = {
        then: (ok: (r: Result) => unknown, bad?: (e: unknown) => unknown) => Promise.resolve(answer()).then(ok, bad),
      }
      for (const m of ['select', 'eq', 'is', 'in', 'order', 'range', 'limit', 'maybeSingle', 'single']) {
        builder[m] = () => builder
      }
      return builder
    },
  }
}

vi.mock('@/lib/supabase/server', () => ({ createServerClient: async () => fakeClient() }))
vi.mock('@/lib/feature-flags', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/feature-flags')>()
  return {
    featureFlags: {
      ...actual.featureFlags,
      get community() {
        return h.community
      },
    },
  }
})
vi.mock('next/navigation', () => ({
  notFound: () => {
    throw new Error('NEXT_NOT_FOUND')
  },
  redirect: (to: string) => {
    throw new RedirectSignal(to)
  },
  useRouter: () => ({ push: () => {}, replace: () => {}, back: () => {}, refresh: () => {} }),
}))

import { FollowButton, signInHref } from '@/components/explore/follow-button'
import { ProfileHeader } from '@/components/profile/profile-header'
import { PersonFollowsList } from '@/components/profile/person-follows-list'
import { PhoneHandoff } from '@/components/shared/phone-handoff'

import FollowersPage from './followers/page'
import FollowingPage from './following/page'
import PublicProfilePage from './page'

const params = () => ({ params: Promise.resolve({ username: 'kelly' }) })

/** The page's own elements (not rendered — the client parts have their own
 *  tests), found by component. */
function find(node: ReactNode, type: unknown): ReactElement<Record<string, unknown>> | null {
  if (Array.isArray(node)) {
    for (const n of node) {
      const hit = find(n as ReactNode, type)
      if (hit) return hit
    }
    return null
  }
  if (!isValidElement<Record<string, unknown>>(node)) return null
  if (node.type === type) return node
  return find(node.props.children as ReactNode, type)
}

beforeEach(() => {
  h.community = true
  h.user = null
  h.reads.length = 0
})

describe('the public profile, opened by someone signed in, Community on (plan C6)', () => {
  it('someone else’s profile: handed into the app, on the server', async () => {
    h.user = { id: 'u-me' }
    await expect(PublicProfilePage(params())).rejects.toThrow(new RedirectSignal('/app/u/kelly'))
  })

  it('…before the lists are read', async () => {
    h.user = { id: 'u-me' }
    await PublicProfilePage(params()).catch(() => {})
    expect(h.reads).toEqual(['profiles'])
  })
})

describe('who keeps the public profile', () => {
  it('the person themselves — "View public profile", as a stranger sees it; on a phone their phone screen, as before', async () => {
    h.user = { id: 'u-kelly' }
    const page = (await PublicProfilePage(params())) as ReactElement
    expect(find(page, ProfileHeader)).not.toBeNull()
    expect(find(page, PhoneHandoff)?.props.to).toBe('/app/u/kelly')
  })

  it('a signed-out visitor, or a search engine (no session)', async () => {
    const page = (await PublicProfilePage(params())) as ReactElement
    expect(find(page, ProfileHeader)).not.toBeNull()
    expect(h.reads).toEqual(['profiles', 'lists'])
  })

  it('everyone while Community is off — and a signed-in phone is still handed to its phone screen', async () => {
    h.community = false
    h.user = { id: 'u-me' }
    const page = (await PublicProfilePage(params())) as ReactElement
    expect(find(page, ProfileHeader)).not.toBeNull()
    expect(find(page, PhoneHandoff)?.props.to).toBe('/app/u/kelly')
  })
})

describe('Follow on the public profile’s header', () => {
  it('Community on: Follow, for this person, at v7’s profile size', async () => {
    const page = (await PublicProfilePage(params())) as ReactElement
    const follow = find(find(page, ProfileHeader)?.props.actions as ReactNode, FollowButton)
    expect(follow?.props.userId).toBe('u-kelly')
    expect(follow?.props.size).toBe('md')
  })

  it('Community off: nothing new on the public page', async () => {
    h.community = false
    const page = (await PublicProfilePage(params())) as ReactElement
    expect(find(page, ProfileHeader)?.props.actions).toBeNull()
  })

  it('signed out, Follow asks you to sign in and comes back to the page — which then hands you into the app', () => {
    expect(signInHref('/u/kelly', true)).toBe('/login?redirect=%2Fu%2Fkelly')
    // While Community is off the sign-in is the plain one, as before.
    expect(signInHref('/u/kelly', false)).toBe('/login')
  })
})

describe.each([
  ['followers', FollowersPage],
  ['following', FollowingPage],
] as const)('their %s', (kind, Page) => {
  it('someone signed in, Community on: handed into the app before the rows are read', async () => {
    h.user = { id: 'u-me' }
    await expect(Page(params())).rejects.toThrow(new RedirectSignal(`/app/u/kelly/${kind}`))
    expect(h.reads).toEqual(['profiles'])
  })

  it('the person, a signed-out visitor, and everyone while Community is off keep the public page — the phone hand-off as before', async () => {
    for (const [user, community] of [
      [{ id: 'u-kelly' }, true],
      [null, true],
      [{ id: 'u-me' }, false],
    ] as const) {
      h.user = user
      h.community = community
      const page = (await Page(params())) as ReactElement
      expect(find(page, PersonFollowsList)?.props.kind).toBe(kind)
      expect(find(page, PhoneHandoff)?.props.to).toBe(`/app/u/kelly/${kind}`)
    }
  })
})

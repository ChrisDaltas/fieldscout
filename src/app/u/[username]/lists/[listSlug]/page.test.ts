/**
 * The shared list page's hand-off into the app (plan C5, "Signed-in
 * visitors"). Pinned, through the page itself against a fake server client:
 *  - Community on, signed in, someone else's list → redirected to
 *    Community's list page (`/app/explore?list=<id>`) on the server, before
 *    any of the list's own reads — on either layout, since that address is
 *    the phone's Community list page too;
 *  - the owner, a signed-out visitor (and a search engine — no session), and
 *    everyone while Community is off keep the public, server-rendered page —
 *    and the phone's own hand-off (`PhoneHandoff`, #550) goes exactly where
 *    it did: your own list to the List view, someone else's (Community off)
 *    to the List view too.
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

const LIST = {
  id: 'L1',
  owner_id: 'u-kelly',
  title: 'My RB sleepers',
  slug: 'my-rb-sleepers',
  description: null,
  is_private: false,
  ai_persona_id: null,
  comments_enabled: true,
  player_count: 0,
}

function fakeClient() {
  return {
    auth: { getUser: async () => ({ data: { user: h.user }, error: null }) },
    from: (table: string) => {
      h.reads.push(table)
      const answer = (): Result =>
        table === 'profiles'
          ? { data: { id: 'u-kelly', username: 'kelly', avatar_url: null }, error: null }
          : table === 'lists'
            ? { data: LIST, error: null }
            : { data: table === 'list_players' || table === 'list_tags' || table === 'list_links' ? [] : null, error: null, count: 0 }
      const builder: Record<string, unknown> = {
        then: (ok: (r: Result) => unknown, bad?: (e: unknown) => unknown) => Promise.resolve(answer()).then(ok, bad),
      }
      for (const m of ['select', 'eq', 'is', 'in', 'order', 'limit', 'maybeSingle', 'single']) {
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

import { PhoneHandoff } from '@/components/shared/phone-handoff'
import { PublicListView } from '@/components/lists/public-list-view'

import PublicListPage from './page'

const params = () => ({ params: Promise.resolve({ username: 'kelly', listSlug: 'my-rb-sleepers' }) })

/** The page's own elements (not rendered — the client views under it have
 *  their own tests), found by component. */
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

async function open() {
  return (await PublicListPage(params())) as ReactElement
}

beforeEach(() => {
  h.community = true
  h.user = null
  h.reads.length = 0
})

describe('a shared list opened by someone signed in, Community on (plan C5)', () => {
  it('someone else’s list: handed into Community’s list page, on the server', async () => {
    h.user = { id: 'u-me' }
    await expect(open()).rejects.toThrow(new RedirectSignal('/app/explore?list=L1'))
  })

  it('…before the list’s own reads (players, tags, comments, links)', async () => {
    h.user = { id: 'u-me' }
    await open().catch(() => {})
    expect(h.reads).toEqual(['profiles', 'lists'])
  })
})

describe('who keeps the public page', () => {
  it('the owner — their share link, as a stranger sees it; on a phone, their List view with Edit', async () => {
    h.user = { id: 'u-kelly' }
    const page = await open()
    expect(find(page, PublicListView)).not.toBeNull()
    expect(find(page, PhoneHandoff)?.props.to).toBe('/app/lists?list=L1')
  })

  it('a signed-out visitor, or a search engine (no session)', async () => {
    const page = await open()
    expect(find(page, PublicListView)?.props.signedIn).toBe(false)
  })

  it('everyone while Community is off — and a signed-in phone is handed on exactly as before (#550)', async () => {
    h.community = false
    h.user = { id: 'u-me' }
    const page = await open()
    expect(find(page, PublicListView)).not.toBeNull()
    expect(find(page, PhoneHandoff)?.props.to).toBe('/app/lists?list=L1')
  })
})

describe('the page is still the one strangers get', () => {
  it('renders the list itself, server-side', async () => {
    const page = await open()
    const view = find(page, PublicListView)
    expect((view?.props.list as { title: string }).title).toBe('My RB sleepers')
  })
})

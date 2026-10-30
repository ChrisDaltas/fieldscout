/**
 * The public pages Community sends people to — a profile, its Followers /
 * Following, a shared list — and a tag's page (plan C4, readiness S13):
 *  - a failed read THROWS (the segment's error.tsx says "Couldn't load this
 *    page", and Next answers 500) — never a false "not found", a profile
 *    with no lists, "No followers yet" or a board with no players;
 *  - Followers / Following read every row past PostgREST's 1000-row cap
 *    (paged with an exact count), so a long list never stops silently;
 *  - no Pro badge on a person's row while the app offers no Pro (F8).
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { createElement, type ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

type Result = { data: unknown; error: unknown; count?: number | null }
type Call = [string, ...unknown[]]

const h = vi.hoisted(() => ({
  /** Answer for each table, by call order within it. */
  answers: {} as Record<string, ((calls: Call[]) => Result)[]>,
  reads: [] as { table: string; calls: Call[] }[],
}))

/** A fake server client: every read records its calls and resolves with
 *  the next answer for its table. */
function fakeClient() {
  const seen: Record<string, number> = {}
  return {
    auth: { getUser: async () => ({ data: { user: null }, error: null }) },
    from: (table: string) => {
      const calls: Call[] = []
      h.reads.push({ table, calls })
      const i = seen[table] ?? 0
      seen[table] = i + 1
      const answer = () => (h.answers[table]?.[i] ?? h.answers[table]?.at(-1) ?? (() => ({ data: null, error: null })))(calls)
      const builder: Record<string, unknown> = {
        then: (ok: (r: Result) => unknown, bad?: (e: unknown) => unknown) => Promise.resolve(answer()).then(ok, bad),
      }
      for (const m of ['select', 'eq', 'is', 'gt', 'not', 'order', 'range', 'limit', 'maybeSingle', 'single']) {
        builder[m] = (...a: unknown[]) => (calls.push([m, ...a]), builder)
      }
      return builder
    },
  }
}

vi.mock('@/lib/supabase/server', () => ({ createServerClient: async () => fakeClient() }))
vi.mock('@/components/layout/guest-shell', () => ({
  GuestShell: ({ children }: { children: ReactNode }) => createElement('main', null, children),
}))
vi.mock('@/components/shared/phone-handoff', () => ({ PhoneHandoff: () => null }))
vi.mock('next/navigation', () => ({
  notFound: () => {
    throw new Error('NEXT_NOT_FOUND')
  },
  useRouter: () => ({ push: () => {}, replace: () => {}, back: () => {}, refresh: () => {} }),
}))
vi.mock('@/hooks/use-auth', () => ({ useAuth: () => ({ user: null }) }))
vi.mock('@/hooks/use-follows', () => ({
  useFollowingIds: () => ({ data: new Set<string>() }),
  useToggleFollow: () => ({ mutate: () => {}, isPending: false }),
}))

import FollowersPage from './followers/page'
import FollowingPage from './following/page'
import PublicProfilePage from './page'

const params = (username = 'kelly') => ({ params: Promise.resolve({ username }) })
const fail = (message: string) => () => ({ data: null, error: { message } })
const profile = (over: Record<string, unknown> = {}) => () => ({
  data: {
    id: 'u-kelly',
    username: 'kelly',
    avatar_url: null,
    bio: null,
    cred_score: 7,
    is_pro: false,
    follower_count: 0,
    following_count: 0,
    ...over,
  },
  error: null,
})
const text = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/&#x27;/g, "'").replace(/\s+/g, ' ').trim()

beforeEach(() => {
  h.answers = {}
  h.reads.length = 0
})

describe('the public profile page', () => {
  it('a failed profile read throws — never "User not found"', async () => {
    h.answers.profiles = [fail('db down')]
    await expect(PublicProfilePage(params())).rejects.toThrow(/Couldn't load the profile: db down/)
  })

  it('a failed lists read throws — never "No public lists yet"', async () => {
    h.answers.profiles = [profile()]
    h.answers.lists = [fail('lists down')]
    await expect(PublicProfilePage(params())).rejects.toThrow(/lists down/)
  })

  it('nobody with that name is still not found (a read that worked)', async () => {
    h.answers.profiles = [() => ({ data: null, error: null })]
    await expect(PublicProfilePage(params())).rejects.toThrow('NEXT_NOT_FOUND')
  })
})

/** A follows page: `total` rows, served at most `cap` per request. */
function followRows(key: 'follower' | 'following', total: number, cap = 1000) {
  return (calls: Call[]): Result => {
    const range = calls.find((c) => c[0] === 'range') as [string, number, number] | undefined
    const from = range?.[1] ?? 0
    const to = Math.min(range?.[2] ?? total - 1, from + cap - 1, total - 1)
    const data = []
    for (let i = from; i <= to; i++) {
      data.push({ [key]: { id: `p${i}`, username: `p${i}`, avatar_url: null, bio: null, cred_score: 7, is_pro: true } })
    }
    return { data, error: null, count: total }
  }
}

describe.each([
  ['Followers', FollowersPage, 'follower' as const, 'following_id'],
  ['Following', FollowingPage, 'following' as const, 'follower_id'],
])('%s', (label, Page, key, filterColumn) => {
  it('a failed read throws — never a false 404', async () => {
    h.answers.profiles = [fail('db down')]
    await expect(Page(params())).rejects.toThrow(/db down/)
  })

  it(`a failed ${label} read throws — never an empty list`, async () => {
    h.answers.profiles = [profile()]
    h.answers.follows = [fail('follows down')]
    await expect(Page(params())).rejects.toThrow(/follows down/)
  })

  it('reads every row past the 1000-row cap, with an exact count and a stable order', async () => {
    h.answers.profiles = [profile()]
    h.answers.follows = [followRows(key, 1203)]
    const out = text(renderToStaticMarkup(await Page(params())))

    const pages = h.reads.filter((r) => r.table === 'follows')
    expect(pages.length).toBe(2)
    const first = pages[0]!.calls
    expect(first).toContainEqual(['eq', filterColumn, 'u-kelly'])
    expect(first.find((c) => c[0] === 'select')?.[2]).toEqual({ count: 'exact' })
    expect(first.filter((c) => c[0] === 'order').map((c) => c[1])).toEqual([
      'created_at',
      key === 'follower' ? 'follower_id' : 'following_id',
    ])
    expect(pages.map((p) => p.calls.find((c) => c[0] === 'range')?.slice(1))).toEqual([
      [0, 999],
      [1000, 1999],
    ])
    expect(out).toContain('1203')
    expect(out).toContain('@p1202')
  })

  it('no Pro badge on anyone’s row while the app offers no Pro', async () => {
    h.answers.profiles = [profile()]
    h.answers.follows = [followRows(key, 2)]
    const out = text(renderToStaticMarkup(await Page(params())))
    expect(out).toContain('@p1')
    expect(out).not.toMatch(/\bPro\b/)
  })
})

describe('the shared list and tag pages throw on a failed read', () => {
  const read = (file: string) => readFileSync(join(process.cwd(), file), 'utf8')

  it('the shared list page checks every read’s error (profile, list, players, tags, comments, AI note, pin)', () => {
    const src = read('src/app/u/[username]/lists/[listSlug]/page.tsx')
    for (const name of ['profileError', 'listError', 'playersError', 'tagsError', 'commentsError', 'personaError', 'favError', 'viewerError']) {
      expect(src).toContain(name)
    }
    expect(src.match(/throw new Error\(`Couldn't load/g)?.length).toBeGreaterThanOrEqual(5)
  })

  it('the tag page checks both reads', () => {
    const src = read('src/app/tag/[tag]/page.tsx')
    expect(src).toMatch(/if \(tagError\) throw/)
    expect(src).toMatch(/if \(listsError\) throw/)
  })

  it('both segments have the "Couldn’t load this page" boundary', () => {
    const boundary = read('src/app/u/[username]/error.tsx')
    expect(boundary).toMatch(/^'use client'/)
    expect(boundary).toContain('Couldn&apos;t load this page')
    expect(boundary).toContain('router.refresh()')
    expect(read('src/app/tag/[tag]/error.tsx')).toContain("export { default } from '@/app/u/[username]/error'")
  })
})

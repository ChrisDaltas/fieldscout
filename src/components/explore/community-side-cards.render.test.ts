/**
 * Desktop Community's side cards (package screen 08's right column; plan C4,
 * readiness S1 / S13):
 *  - "Scouts to follow" (it was "Top ranked scouts", ranked by a cred nothing
 *    awards yet): the read's rows in order, each "N followers" — never cred —
 *    with Follow, or "You" on your own row;
 *  - both cards say "Couldn't load", with Try again, when their read fails —
 *    never "No scouts" / "No tags yet" for a failure.
 */
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  scouts: {} as Record<string, unknown>,
  tags: {} as Record<string, unknown>,
}))

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: () => {}, replace: () => {}, back: () => {} }),
}))
vi.mock('@/hooks/use-auth', () => ({ useAuth: () => ({ user: { id: 'u-me' } }) }))
vi.mock('@/hooks/use-follows', () => ({
  useFollowingIds: () => ({ data: new Set<string>(['u-kelly']) }),
  useToggleFollow: () => ({ mutate: () => {}, isPending: false }),
}))
vi.mock('@/hooks/use-scouts-to-follow', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/hooks/use-scouts-to-follow')>()),
  useScoutsToFollow: () => h.scouts,
}))
vi.mock('@/hooks/use-tags', () => ({ useTags: () => h.tags }))

import { ScoutsToFollowCard } from './scouts-to-follow-card'
import { TrendingTagsCard } from './trending-tags-card'

const SCOUTS = [
  { id: 'u-kelly', username: 'kelly', avatar_url: null, followers: 12 },
  { id: 'u-me', username: 'me', avatar_url: null, followers: 1 },
  { id: 'u-ortiz', username: 'ortiz', avatar_url: null, followers: 0 },
]

const text = (html: string) =>
  html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&#x27;/g, "'")
    .replace(/\s+/g, ' ')
    .trim()

const scoutsRender = () => renderToStaticMarkup(createElement(ScoutsToFollowCard)).replace(/&#x27;/g, "'")
const tagsRender = () => renderToStaticMarkup(createElement(TrendingTagsCard)).replace(/&#x27;/g, "'")
const rows = (out: string) => out.split('data-scout').slice(1)

beforeEach(() => {
  h.scouts = { isPending: false, isError: false, isSuccess: true, isFetching: false, data: SCOUTS, refetch: () => {} }
  h.tags = { isPending: false, isError: false, isSuccess: true, isFetching: false, data: { tags: [] }, refetch: () => {} }
})

describe('Scouts to follow (desktop card)', () => {
  it('is titled "Scouts to follow"; each row is the handle (a profile link) and "N followers", in the read’s order', () => {
    const out = scoutsRender()
    expect(out).toContain('Scouts to follow')
    expect(out).not.toMatch(/Top ranked scouts|Top scouts/i)
    const r = rows(out)
    expect(r).toHaveLength(3)
    expect(r[0]).toMatch(/<a[^>]*href="\/u\/kelly"[^>]*>@?kelly<\/a>/)
    expect(text(r[0]!)).toContain('12 followers')
    expect(text(r[1]!)).toContain('1 follower')
    expect(text(r[2]!)).toContain('0 followers')
    // Followers, not cred: nothing awards cred yet.
    expect(out).not.toMatch(/cred/i)
  })

  it('Follow on someone else’s row; "You" on your own', () => {
    const r = rows(scoutsRender())
    expect(r[0]).toContain('Following')
    expect(r[1]).toContain('>You</')
    expect(r[1]).not.toContain('Follow')
    expect(r[2]).toMatch(/>Follow</)
  })

  it('a failed read says "Couldn’t load", with Try again — never an empty board', () => {
    h.scouts = { isPending: false, isError: true, isSuccess: false, isFetching: false, data: undefined, refetch: () => {} }
    const out = scoutsRender()
    expect(out).toContain("Couldn't load scouts to follow.")
    expect(out).toContain('Try again')
    expect(out).not.toMatch(/No scouts/)
    expect(rows(out)).toEqual([])
  })

  it('loading: placeholders; nobody yet: says so', () => {
    h.scouts = { isPending: true, isError: false, isSuccess: false, data: undefined }
    expect(scoutsRender()).toContain('aria-busy="true"')
    h.scouts = { ...h.scouts, isPending: false, isSuccess: true, data: [] }
    expect(scoutsRender()).toContain('No scouts to follow yet.')
  })
})

describe('Trending tags (desktop card)', () => {
  it('a failed read says "Couldn’t load", with Try again — never "No tags yet"', () => {
    h.tags = { isPending: false, isError: true, isSuccess: false, isFetching: false, data: undefined, refetch: () => {} }
    const out = tagsRender()
    expect(out).toContain("Couldn't load trending tags.")
    expect(out).toContain('Try again')
    expect(out).not.toContain('No tags yet')
  })

  it('no tags at all (a read that worked): "No tags yet."', () => {
    expect(tagsRender()).toContain('No tags yet.')
  })
})

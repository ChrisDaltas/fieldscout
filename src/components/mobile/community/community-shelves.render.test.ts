/**
 * For you's "Top scouts" and "Trending tags" shelves (gap list §3 #26 —
 * desktop Community's right-hand cards on the phone). Pinned:
 *  - Top scouts: the leaderboard's rows in its order (rank, avatar, the
 *    handle as the profile link stretched over the row, "N cred"), Follow on
 *    others' rows and "You" on yours; loading, a failed read (says so, with
 *    a retry), and no scouts (not drawn);
 *  - Trending tags: desktop's trending read, offered only where a list on
 *    Community carries the tag, in trending order, as "#Tag" pills that
 *    pick that topic; loading, a failed read, and none to offer (not drawn).
 */
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { CommunityItem } from '@/hooks/use-mobile-community-feed'

const h = vi.hoisted(() => ({
  scouts: {} as Record<string, unknown>,
  tags: {} as Record<string, unknown>,
  tagsArg: undefined as unknown,
}))

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: () => {}, replace: () => {}, back: () => {} }),
}))
vi.mock('@/hooks/use-auth', () => ({ useAuth: () => ({ user: { id: 'u-me' } }) }))
vi.mock('@/hooks/use-follows', () => ({
  useFollowingIds: () => ({ data: new Set<string>(['u-kelly']) }),
  useToggleFollow: () => ({ mutate: () => {}, isPending: false }),
}))
vi.mock('@/hooks/use-top-scouts', () => ({ useTopScouts: () => h.scouts }))
vi.mock('@/hooks/use-tags', () => ({
  useTags: (arg: unknown) => {
    h.tagsArg = arg
    return h.tags
  },
}))

import { TopScoutsShelf, TrendingTagsShelf } from './community-shelves'

const SCOUTS = [
  { id: 'u-kelly', username: 'kelly', avatar_url: null, cred_score: 1240 },
  { id: 'u-me', username: 'me', avatar_url: null, cred_score: 980 },
  { id: 'u-ortiz', username: 'ortiz', avatar_url: null, cred_score: 15 },
]

const scoutsRender = () => renderToStaticMarkup(createElement(TopScoutsShelf)).replace(/&#x27;/g, "'")

/** One `<li>` per scout row. */
const rows = (out: string) => [...out.matchAll(/<li[^>]*data-top-scout[^>]*>(.*?)<\/li>/g)].map((m) => m[1]!)

beforeEach(() => {
  h.scouts = { isPending: false, isError: false, isSuccess: true, data: SCOUTS, refetch: () => {} }
  h.tags = { isPending: false, isError: false, isSuccess: true, data: { tags: [] }, refetch: () => {} }
  h.tagsArg = undefined
})

describe('Top scouts', () => {
  it('the leaderboard in its order: rank, the handle linking to the profile over the row, "N cred"', () => {
    const out = scoutsRender()
    expect(out).toContain('>Top scouts</h2>')
    const r = rows(out)
    expect(r).toHaveLength(3)
    expect(r[0]).toMatch(/>1<\/span>/)
    const link = r[0]!.match(/<a[^>]*>@kelly<\/a>/)?.[0] ?? ''
    expect(link).toContain('href="/u/kelly"')
    expect(link).toContain('after:absolute after:inset-0')
    expect(r[0]).toContain('1,240 cred')
    expect(r[2]).toMatch(/>3<\/span>/)
    expect(r[2]).toContain('15 cred')
  })

  it('Follow on someone else’s row (Following once you do); "You" on your own', () => {
    const r = rows(scoutsRender())
    expect(r[0]).toMatch(/aria-pressed="true"[^>]*>Following<\/button>/)
    expect(r[2]).toMatch(/aria-pressed="false"[^>]*>Follow<\/button>/)
    expect(r[1]).toContain('>You</span>')
    expect(r[1]).not.toContain('Follow')
  })

  it('no scouts: the shelf isn’t drawn', () => {
    h.scouts = { ...h.scouts, data: [] }
    expect(scoutsRender()).toBe('')
  })

  it('loading: placeholders under the title, no rows', () => {
    h.scouts = { isPending: true, isError: false, isSuccess: false, data: undefined }
    const out = scoutsRender()
    expect(out).toContain('>Top scouts</h2>')
    expect(out).toContain('aria-busy="true"')
    expect(rows(out)).toEqual([])
  })

  it('a failed read says so, with a retry — never an empty-looking shelf', () => {
    h.scouts = { isPending: false, isError: true, isSuccess: false, data: undefined, refetch: () => {} }
    const out = scoutsRender()
    expect(out).toContain('Couldn’t load top scouts.')
    expect(out).toContain('>Try again</button>')
  })
})

const tag = (id: string, name: string) => ({ id, name, slug: id, is_system_tag: true, use_count: 1 })

function shown(...tagIds: string[]): Pick<CommunityItem, 'tags'>[] {
  return [{ tags: tagIds.map((id) => ({ id, name: id, slug: id })) }]
}

const tagsRender = (items: Pick<CommunityItem, 'tags'>[]) =>
  renderToStaticMarkup(createElement(TrendingTagsShelf, { shown: items, onPick: () => {} })).replace(/&#x27;/g, "'")

const pills = (out: string) => [...out.matchAll(/data-trending-tag[^>]*>#(.*?)<\/button>/g)].map((m) => m[1])

describe('Trending tags', () => {
  it('desktop’s trending read; only tags a list on Community carries, in trending order, as #pills', () => {
    h.tags = {
      ...h.tags,
      data: { tags: [tag('t-sleep', 'Sleepers'), tag('t-busts', 'Busts'), tag('t-rook', 'Rookies')] },
    }
    const out = tagsRender(shown('t-rook', 't-sleep'))
    expect(h.tagsArg).toEqual({ trending: true })
    expect(out).toContain('>Trending tags</h2>')
    expect(pills(out)).toEqual(['Sleepers', 'Rookies'])
  })

  it('none to offer: the shelf isn’t drawn', () => {
    h.tags = { ...h.tags, data: { tags: [tag('t-busts', 'Busts')] } }
    expect(tagsRender(shown('t-rook'))).toBe('')
  })

  it('loading: placeholders; a failed read says so, with a retry', () => {
    h.tags = { isPending: true, isError: false, isSuccess: false, data: undefined }
    let out = tagsRender(shown('t-rook'))
    expect(out).toContain('aria-busy="true"')
    expect(pills(out)).toEqual([])

    h.tags = { isPending: false, isError: true, isSuccess: false, data: undefined, refetch: () => {} }
    out = tagsRender(shown('t-rook'))
    expect(out).toContain('Couldn’t load trending tags.')
    expect(out).toContain('>Try again</button>')
  })
})

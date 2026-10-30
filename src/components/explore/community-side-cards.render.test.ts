/**
 * Desktop Community's side cards (package screen 08's right column; plan C4,
 * readiness S1 / S13):
 *  - "Scouts to follow" (it was "Top ranked scouts", ranked by a cred nothing
 *    awards yet): the read's rows in order, each "N followers" — never cred —
 *    with Follow, or "You" on your own row;
 *  - both cards say "Couldn't load", with Try again, when their read fails —
 *    never "No scouts" / "No tags yet" for a failure;
 *  - "Trending tags" offers only the tags a list Community shows carries
 *    (the phone shelf's rule, over the feed's own unfiltered Popular read),
 *    and a tag sets the feed's own topic inside the app — a button, never a
 *    link to the public /tag page (WDO-2). With no tag to offer, no card.
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'

import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  scouts: {} as Record<string, unknown>,
  tags: {} as Record<string, unknown>,
  feed: {} as Record<string, unknown>,
  feedArgs: [] as unknown[][],
  topic: null as string | null,
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
vi.mock('@/hooks/use-explore-feed', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/hooks/use-explore-feed')>()),
  useExploreFeed: (...args: unknown[]) => {
    h.feedArgs.push(args)
    return h.feed
  },
}))
// The feed's topic, shared with the card (a static render reads a store's
// initial state, so the test hands the card its own).
vi.mock('@/stores/community-topic-store', () => ({
  useCommunityTopicStore: (pick: (s: { tagId: string | null; setTagId: () => void }) => unknown) =>
    pick({ tagId: h.topic, setTagId: () => {} }),
}))

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

const code = (file: string) =>
  readFileSync(path.resolve(process.cwd(), file), 'utf8').replace(/\/\*[\s\S]*?\*\/|(^|[^:])\/\/.*$/gm, (_m, before) => before ?? '')

const scoutsRender = () => renderToStaticMarkup(createElement(ScoutsToFollowCard)).replace(/&#x27;/g, "'")
const tagsRender = () => renderToStaticMarkup(createElement(TrendingTagsCard)).replace(/&#x27;/g, "'")
const rows = (out: string) => out.split('data-scout').slice(1)

const tag = (id: string, name: string) => ({ id, name, slug: name.toLowerCase().replace(/\s+/g, '-'), use_count: 3 })
const WAIVER = tag('t-waiver', 'Waiver Wire')
const SLEEPERS = tag('t-sleep', 'Sleepers')
const BOUNCEBACK = tag('t-bounce', 'Bounceback')
/** Most used first, as /api/tags?trending=true answers. */
const TRENDING = [BOUNCEBACK, SLEEPERS, WAIVER]

/** The feed's unfiltered Popular read: rows Community shows, with their tags. */
const feedOf = (rowTags: (typeof WAIVER)[][], over: Record<string, unknown> = {}) => ({
  data: {
    pages: [{ items: rowTags.map((tags, i) => ({ id: `L${i}`, tags })), next: null }],
    pageParams: [{ at: 'start' }],
  },
  isPending: false,
  isError: false,
  isFetching: false,
  refetch: () => {},
  ...over,
})

const tagButtons = (out: string) =>
  [...out.matchAll(/<button type="button" aria-pressed="(true|false)"[^>]*>([\s\S]*?)<\/button>/g)].map(
    (m) => `${m[2]!.replace(/<[^>]+>/g, '').trim()}${m[1] === 'true' ? ' (on)' : ''}`,
  )

beforeEach(() => {
  h.scouts = { isPending: false, isError: false, isSuccess: true, isFetching: false, data: SCOUTS, refetch: () => {} }
  h.tags = { isPending: false, isError: false, isSuccess: true, isFetching: false, data: { tags: TRENDING }, refetch: () => {} }
  h.feed = feedOf([[WAIVER], [SLEEPERS, WAIVER]])
  h.feedArgs = []
  h.topic = null
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
  it('offers only the trending tags a list Community shows carries, most used first', () => {
    // #Bounceback trends, but only lists Community doesn't show carry it
    // (an empty list, a ranking while Rankings is off): no chip.
    expect(tagButtons(tagsRender())).toEqual(['#Sleepers', '#Waiver Wire'])
  })

  it('…drawn from the feed’s own unfiltered Popular read — the rows its topic pills come from', () => {
    tagsRender()
    expect(h.feedArgs).toEqual([['popular', null]])
  })

  it('a tag is a button that sets the feed’s topic in the app — never a link to the public /tag page', () => {
    const out = tagsRender()
    expect(out).not.toContain('href="/tag/')
    expect(out).not.toMatch(/<a\b/)
    const src = code('src/components/explore/trending-tags-card.tsx')
    expect(src).toContain('onClick={() => setTagId(tagId === tag.id ? null : tag.id)}')
    // The feed's pills read and write the same topic.
    const feed = code('src/components/explore/explore-feed.tsx')
    expect(feed).toContain('const tagId = useCommunityTopicStore((s) => s.tagId)')
    expect(feed).toContain('const setTagId = useCommunityTopicStore((s) => s.setTagId)')
    expect(feed).not.toMatch(/useState<string \| null>\(null\)/)
  })

  it('the tag the feed is filtered by shows pressed (pressed again, it goes back to All)', () => {
    h.topic = 't-waiver'
    expect(tagButtons(tagsRender())).toEqual(['#Sleepers', '#Waiver Wire (on)'])
  })

  // This pinned "No tags yet." for a read that worked with nothing in it;
  // WDO-2 changes it: with no tag to offer the card isn't shown, as the
  // phone's shelf isn't.
  it('no tag a shown list carries — or no tags at all — no card', () => {
    // The rows shown carry no tag, or only one that isn't trending.
    h.feed = feedOf([[], [tag('t-other', 'Dynasty')]])
    expect(tagsRender()).toBe('')
    h.tags = { ...h.tags, data: { tags: [] } }
    h.feed = feedOf([[WAIVER]])
    expect(tagsRender()).toBe('')
  })

  it('loading — either read — placeholders, never no card', () => {
    h.tags = { isPending: true, isError: false, isSuccess: false, isFetching: true, data: undefined, refetch: () => {} }
    expect(tagsRender()).toContain('aria-busy="true"')
    h.tags = { isPending: false, isError: false, isSuccess: true, isFetching: false, data: { tags: TRENDING }, refetch: () => {} }
    h.feed = { data: undefined, isPending: true, isError: false, isFetching: true, refetch: () => {} }
    expect(tagsRender()).toContain('aria-busy="true"')
  })

  it('a failed read says "Couldn’t load", with Try again — never "No tags yet", never no card', () => {
    h.tags = { isPending: false, isError: true, isSuccess: false, isFetching: false, data: undefined, refetch: () => {} }
    let out = tagsRender()
    expect(out).toContain("Couldn't load trending tags.")
    expect(out).toContain('Try again')
    expect(out).not.toContain('No tags yet')
    // The feed's read failing is the same: its tags can't be known.
    h.tags = { isPending: false, isError: false, isSuccess: true, isFetching: false, data: { tags: TRENDING }, refetch: () => {} }
    h.feed = { data: undefined, isPending: false, isError: true, isFetching: false, refetch: () => {} }
    out = tagsRender()
    expect(out).toContain("Couldn't load trending tags.")
    expect(out).toContain('Try again')
  })

  it('a later feed page failing keeps the tags of the rows already shown', () => {
    h.feed = feedOf([[WAIVER]], { isError: true })
    expect(tagButtons(tagsRender())).toEqual(['#Waiver Wire'])
  })
})

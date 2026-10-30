/**
 * Plan C5 (readiness S7b, F10): someone else's list opens inside the app on
 * desktop, at the phone's own address (`/app/explore?list=<id>`). Pinned:
 *  - the page is the share page's body (`PublicListView`, one renderer) with
 *    everything it offers — the list, Details, Comments with their count,
 *    Share, Pin — plus Like with its count, Follow beside the author (a
 *    person's list only), the AI note on an expert's board, and Back;
 *  - Share copies the public share link, not the app's address;
 *  - the list's ⋯ holds Report (C10);
 *  - your own list goes to your Lists (ruling #20);
 *  - a failed read says so with Try again; a gone list says it's gone;
 *    loading is a skeleton, never an empty list;
 *  - desktop Community shows this page at `?list=` and keeps the feed
 *    mounted (hidden) under it, so Back returns to the feed as it was.
 * What a click does can't run in a static render: those wirings are pinned
 * by source (the house idiom for `.tsx` behaviour, `explore-feed.render`).
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createElement, type ReactElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { ListWithDetails } from '@/hooks/use-lists'

const h = vi.hoisted(() => ({
  list: {} as Record<string, unknown>,
  meta: {} as Record<string, unknown>,
  persona: { data: undefined } as { data: unknown },
  comments: { data: undefined } as Record<string, unknown>,
  params: new URLSearchParams(),
  user: { id: 'u-me' } as { id: string } | null,
}))

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: () => {}, replace: () => {}, back: () => {}, refresh: () => {} }),
  usePathname: () => '/app/explore',
  useSearchParams: () => h.params,
}))
vi.mock('@/lib/feature-flags', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/feature-flags')>()
  return { featureFlags: { ...actual.featureFlags, community: true, personas: false } }
})
vi.mock('@/hooks/use-auth', () => ({
  useAuth: () => ({ user: h.user, profile: h.user ? { username: 'me', avatar_url: null } : null }),
}))
vi.mock('@/hooks/use-lists', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/hooks/use-lists')>()
  const idle = () => ({ mutate: () => {}, isPending: false })
  return { ...actual, useList: () => h.list, useToggleLike: idle, useToggleFavorite: idle }
})
vi.mock('@/hooks/use-mobile-community-detail', () => ({ useMobileCommunityListMeta: () => h.meta }))
vi.mock('@/hooks/use-list-persona', () => ({ useListPersona: () => h.persona }))
vi.mock('@/hooks/use-comments', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/hooks/use-comments')>()
  const idle = () => ({ mutate: () => {}, isPending: false })
  return { ...actual, useComments: () => h.comments, useAddComment: idle, useDeleteComment: idle }
})
vi.mock('@/hooks/use-follows', () => ({
  useFollowingIds: () => ({ data: new Set<string>() }),
  useToggleFollow: () => ({ mutate: () => {}, isPending: false }),
}))
vi.mock('@/hooks/use-profile-href', () => ({ useProfileHref: (u: string) => `/app/u/${u}` }))
// The feed under the page — its own render tests cover it.
vi.mock('@/components/explore/explore-feed', () => ({
  ExploreFeed: () => createElement('div', { 'data-feed-under': true }),
  toastLikeFailed: () => {},
}))

import { CommunityListPage } from './community-list-page'
import { DesktopCommunity } from './desktop-community'

function list(over: Partial<ListWithDetails> = {}): ListWithDetails {
  return {
    id: 'L1',
    owner_id: 'u-kelly',
    title: 'My RB sleepers',
    slug: 'my-rb-sleepers',
    description: 'Late-round backs',
    is_private: false,
    is_favorites: false,
    is_favorited: false,
    is_big_board: false,
    ai_persona_id: null,
    ranking_mode: 'ranked',
    comments_enabled: true,
    like_count: 12,
    view_count: 40,
    player_count: 0,
    created_at: '2026-10-20T00:00:00Z',
    updated_at: '2026-10-20T00:00:00Z',
    cover_color: null,
    thumbnail_url: null,
    position_filter: null,
    is_owner: false,
    is_liked: false,
    players: [],
    tags: [],
    links: [],
    ...over,
  } as unknown as ListWithDetails
}

const PERSON = { profileId: 'u-kelly', username: 'kelly', avatarUrl: null, followers: 3, isPersona: false }
const EXPERT = { profileId: null, username: 'bathew', avatarUrl: null, followers: null, isPersona: true }

const loaded = (over: Partial<ListWithDetails> = {}) => ({ data: list(over), isError: false, isFetching: false, error: null, refetch: () => {} })
const metaOf = (author: typeof PERSON | typeof EXPERT, ownerUsername = 'kelly') => ({
  data: { ownerUsername, ownerAvatarUrl: null, author, scoring: null },
  isError: false,
  isFetching: false,
  refetch: () => {},
})

const html = (node: ReactElement) =>
  renderToStaticMarkup(createElement(QueryClientProvider, { client: new QueryClient() }, node))
    .replace(/&#x27;/g, "'")
    .replace(/&quot;/g, '"')
const page = () => html(createElement(CommunityListPage, { listId: 'L1' }))
const text = (out: string) => out.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ')

const code = (file: string) =>
  readFileSync(path.resolve(process.cwd(), file), 'utf8').replace(/\/\*[\s\S]*?\*\/|(^|[^:])\/\/.*$/gm, (_m, before) => before ?? '')
const PAGE_SRC = 'src/components/explore/community-list-page.tsx'

beforeEach(() => {
  h.list = loaded()
  h.meta = metaOf(PERSON)
  h.persona = { data: undefined }
  h.comments = { data: { comments: [], pagination: { total: 4, hasMore: false } } }
  h.params = new URLSearchParams()
  h.user = { id: 'u-me' }
})

describe('someone else’s list, inside the app', () => {
  it('the share page’s body: the list’s title as the page heading, its tabs, Share and Pin', () => {
    const out = page()
    expect(out).toContain('data-community-list-page')
    expect(out).toMatch(/<h1[^>]*>My RB sleepers<\/h1>/)
    for (const tab of ['>List<', '>Details<', '>Comments<']) expect(out).toContain(tab)
    expect(text(out)).toContain('Share')
    expect(out).toMatch(/aria-pressed="false"[^>]*>.*?Pin</)
  })

  it('…plus Like, with the list’s count, pressed once you like it — and the count shows once', () => {
    let out = page()
    expect(out).toMatch(/<button class="[^"]*\btext-ink\b[^"]*" aria-pressed="false" aria-label="Like · 12 likes"/)
    expect(out.match(/>12</g)?.length).toBe(1)
    h.list = loaded({ is_liked: true, like_count: 1 })
    out = page()
    expect(out).toMatch(/<button class="[^"]*text-accent[^"]*" aria-pressed="true" aria-label="Like · 1 like"/)
  })

  it('…Follow beside the author, whose name opens their profile', () => {
    const out = page()
    expect(out).toContain('data-username-link="kelly"')
    expect(out).toContain('href="/app/u/kelly"')
    const byline = out.slice(out.indexOf('data-username-link="kelly"'))
    expect(byline.indexOf('>Follow<')).toBeGreaterThan(-1)
    expect(byline.indexOf('>Follow<')).toBeLessThan(byline.indexOf('Share'))
  })

  it('…Back, to where you came from', () => {
    expect(page()).toMatch(/<button[^>]*>.*?Back<\/button>/)
    // History when the app is behind this page, else Community.
    expect(code(PAGE_SRC)).toContain('onClick={() => goBack(COMMUNITY_HREF)}')
  })

  it('…the comments, counted from the thread the tab shows — no badge until it’s read, never a guessed 0', () => {
    expect(page()).toMatch(/>Comments<[\s\S]{0,80}>4</)
    h.comments = { data: undefined }
    expect(page()).not.toMatch(/>Comments<\/span><span[^>]*fs-num/)
  })

  it('Share copies the public share link — what someone else can open — never the app’s address', () => {
    expect(code(PAGE_SRC)).toContain('shareHref={`${userProfileHref(ownerUsername)}/lists/${encodeURIComponent(list.slug)}`}')
    // The list's Share is the shared ShareLinkButton (also the in-app
    // profile's, plan C6), which copies `href` when it is given one.
    expect(code('src/components/lists/public-list-view.tsx')).toContain('<ShareLinkButton href={shareHref} />')
    const button = code('src/components/shared/share-link-button.tsx')
    expect(button).toContain('const url = href ? new URL(href, window.location.origin).toString() : window.location.href')
  })

  // Plan C10 fills the slot C5 left empty (this pinned "no item yet, so no
  // ⋯" until Report existed): the list's ⋯ now holds Report.
  it('the list’s ⋯ holds Report (plan C10) — the Report dialog, then "Reported"', () => {
    expect(page()).toContain('title="List options"')
    const src = code(PAGE_SRC)
    expect(src).toContain("reportAccess({ viewerId: user?.id, ownerId: list.owner_id }) === 'report' ? <ListMenu list={list} /> : null")
    expect(src).toContain('<ReportMenuItem type="list" reported={reported} onSelect={() => setReportOpen(true)} />')
    expect(src).toContain("<ReportDialog open={reportOpen} onOpenChange={setReportOpen} target={{ type: 'list', id: list.id }} quote={list.title} />")
  })

  it('Like, Pin and Follow say so when they don’t go through', () => {
    const src = code(PAGE_SRC)
    expect(src).toContain('onError: () => toastLikeFailed(!liked)')
    // Back shows the same like on the feed row.
    expect(src).toContain('withLikeCount(old, list.id, data.like_count, data.liked)')
    expect(code('src/components/lists/pin-list-button.tsx')).toContain("title: next ? 'Couldn’t pin this list' : 'Couldn’t unpin this list'")
    expect(code('src/components/explore/follow-button.tsx')).toContain('onError: () => toastFollowFailed(isFollowing)')
  })
})

describe('an AI expert’s board', () => {
  beforeEach(() => {
    h.list = loaded({ ai_persona_id: 'p1' })
    h.meta = metaOf(EXPERT, 'fieldscout-ai')
  })

  it('says it was made by AI, naming the expert', () => {
    h.persona = { data: { username: 'bathew', display_name: 'Bathew Merry' } }
    const out = text(page())
    expect(out).toContain('Generated by FieldScout AI as Bathew Merry — a fictional, parody analyst persona')
  })

  it('…still says so before the expert is read, or if it can’t be', () => {
    expect(text(page())).toContain('Generated by FieldScout AI.')
  })

  it('…but not for a switched-off expert, as on the share page', () => {
    h.persona = { data: null }
    expect(page()).not.toContain('data-list-ai-note')
  })

  it('has no Follow — the board’s owner is the FieldScout AI account, not a person', () => {
    expect(page()).not.toContain('>Follow<')
  })
})

describe('a person’s list has no AI note', () => {
  it('none', () => {
    expect(page()).not.toContain('data-list-ai-note')
  })
})

describe('your own list goes to your Lists, with Edit (ruling #20)', () => {
  it('shows nothing of it here while it goes', () => {
    h.list = loaded({ is_owner: true })
    const out = page()
    expect(out).not.toContain('My RB sleepers')
    expect(out).toContain('aria-busy="true"')
    expect(code(PAGE_SRC)).toContain('if (own) router.replace(listHref(listId))')
  })
})

describe('reads that fail say so — never an empty page', () => {
  it('loading: a skeleton', () => {
    h.list = { data: undefined, isError: false, isFetching: true, error: null, refetch: () => {} }
    const out = page()
    expect(out).toContain('aria-busy="true"')
    expect(text(out)).not.toMatch(/Couldn't|isn't available/)
  })

  it('a list that’s gone (404) says so', () => {
    h.list = { data: undefined, isError: true, isFetching: false, error: Object.assign(new Error('nope'), { status: 404 }), refetch: () => {} }
    expect(text(page())).toContain("This list isn't available. It may have been deleted or made private.")
  })

  it('any other failed read: "Couldn’t load this list." with Try again', () => {
    h.list = { data: undefined, isError: true, isFetching: false, error: Object.assign(new Error('boom'), { status: 500 }), refetch: () => {} }
    const out = text(page())
    expect(out).toContain("Couldn't load this list.")
    expect(out).toContain('Try again')
  })

  it('who made it couldn’t be read: the same, never a list with no author', () => {
    h.meta = { data: undefined, isError: true, isFetching: false, refetch: () => {} }
    const out = text(page())
    expect(out).toContain("Couldn't load this list.")
    expect(out).not.toContain('My RB sleepers')
  })

  it('who made it is still loading: the skeleton', () => {
    h.meta = { data: undefined, isError: false, isFetching: true, refetch: () => {} }
    expect(page()).toContain('aria-busy="true"')
  })
})

describe('desktop Community at ?list= (plan C5, readiness F10)', () => {
  const community = () =>
    html(createElement(DesktopCommunity, { feed: createElement('div', { 'data-the-feed': true }, 'The feed') }))

  it('no list: the feed', () => {
    const out = community()
    expect(out).toContain('data-the-feed')
    expect(out).not.toContain('data-community-list-page')
    expect(out).not.toMatch(/data-community-feed[^>]*class="hidden"|class="hidden"[^>]*data-community-feed/)
  })

  it('?list=<id>: the list — with the feed kept, hidden, under it so Back returns to it as it was', () => {
    h.params = new URLSearchParams('list=L1')
    const out = community()
    expect(out).toContain('data-community-list-page')
    expect(out).toMatch(/class="hidden" data-community-feed/)
    expect(out).toContain('data-the-feed')
  })

  it('the route renders it on desktop; the phone keeps its own screen', () => {
    const route = code('src/app/app/(shell)/explore/page.tsx')
    expect(route).toContain('<DesktopCommunity')
    expect(route).toContain('<MobileCommunityRoute />')
  })
})

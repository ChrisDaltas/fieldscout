/**
 * FieldScout Mobile — New list / Edit details: the Public switch and up to 10
 * videos (gap list §3 #4; m-composer §2.5).
 *
 * Pinned here:
 *   - New list opens Public (the composer's default), the switch's line says
 *     what it means, and the Videos block offers the link field with "Add".
 *   - Edit details shows the list's visibility, and EVERY attached video as a
 *     row — the stored title, or no title line at all when YouTube gave none
 *     (never a placeholder), with the link under it and a remove button.
 *   - At the cap (10, shared with article links) the link field gives way to
 *     a line, so an 11th can't be tried.
 * What each screen sends is pinned in `details-payload.test.ts`.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

let search = new URLSearchParams()
vi.mock('next/navigation', () => ({
  usePathname: () => '/app/lists',
  useSearchParams: () => search,
  useRouter: () => ({ push: () => {}, replace: () => {}, refresh: () => {}, back: () => {} }),
}))
vi.mock('@/hooks/use-auth', () => ({
  useAuth: () => ({ profile: { username: 'dalton', avatar_url: null }, user: { id: 'u1' } }),
}))

import type { ListWithDetails } from '@/hooks/use-lists'

import { NewListScreen } from './list-details-screen'
import { MobileLists } from './mobile-lists'

type Link = { id: string; kind: 'video' | 'article'; url: string; title: string | null }

const video = (n: number, title: string | null = `Film room ${n}`): Link => ({
  id: `v${n}`,
  kind: 'video',
  url: `https://youtu.be/${`vid${n}`.padEnd(11, '0')}`,
  title,
})
const article = (n: number): Link => ({ id: `a${n}`, kind: 'article', url: `https://example.com/${n}`, title: 'Read' })

function detail(extra: Record<string, unknown>): ListWithDetails {
  return {
    id: 'l1',
    title: 'My top 5 QBs',
    description: null,
    player_count: 0,
    updated_at: new Date().toISOString(),
    thumbnail_url: null,
    position_filter: 'QB',
    is_favorites: false,
    is_team: false,
    ranking_mode: 'ranked',
    is_owner: true,
    is_private: false,
    slug: 'my-top-5',
    owner_id: 'u1',
    cover_color: null,
    tags: [],
    links: [],
    players: [],
    ...extra,
  } as unknown as ListWithDetails
}

function renderEdit(list: ListWithDetails) {
  search = new URLSearchParams('list=l1&details=1')
  const qc = new QueryClient()
  qc.setQueryData(['lists', 'detail', 'l1'], list)
  qc.setQueryData(['lists', 'collection', 1, 50], { lists: [], pagination: { page: 1, pageSize: 50, total: 0, hasMore: false } })
  qc.setQueryData(['folders'], { folders: [] })
  return renderToStaticMarkup(createElement(QueryClientProvider, { client: qc }, createElement(MobileLists)))
}

function renderNew() {
  search = new URLSearchParams()
  const qc = new QueryClient()
  qc.setQueryData(['list-cover-color-support'], true)
  return renderToStaticMarkup(createElement(QueryClientProvider, { client: qc }, createElement(NewListScreen)))
}

/** The Public switch's state and its line. */
function publicSwitch(html: string): { checked: string | undefined; line: string | undefined } {
  const m = /role="switch" aria-checked="(true|false)"[^>]*>(?:(?!<\/button>).)*>Public<\/span><span[^>]*>([^<]*)</.exec(html)
  return { checked: m?.[1], line: m?.[2] }
}

const rows = (html: string) => html.split('data-video-row').length - 1

describe('New list', () => {
  it('opens Public, saying what that means', () => {
    expect(publicSwitch(renderNew())).toEqual({ checked: 'true', line: 'Anyone can find and save this list' })
  })

  it('offers the link field with Add, and no rows yet', () => {
    const out = renderNew()
    expect(out).toContain('>Videos<')
    expect(out).toContain('placeholder="Paste a YouTube link"')
    expect(out).toMatch(/>Add<\/button>/)
    expect(rows(out)).toBe(0)
  })
})

describe('Edit details', () => {
  it('shows a private list’s switch off', () => {
    expect(publicSwitch(renderEdit(detail({ is_private: true })))).toEqual({
      checked: 'false',
      line: 'Only you can see this list',
    })
    expect(publicSwitch(renderEdit(detail({ is_private: false }))).checked).toBe('true')
  })

  it('shows every attached video, with its stored title or none — never a placeholder', () => {
    const out = renderEdit(detail({ links: [video(1), article(1), video(2, null), video(3)] }))
    expect(rows(out)).toBe(3)
    expect(out).toContain('>Film room 1<')
    expect(out).toContain('>Film room 3<')
    expect(out).not.toContain('YouTube video')
    // The untitled one still shows its link, its thumbnail and a remove.
    expect(out).toContain('>https://youtu.be/vid20000000<')
    expect(out).toContain('https://i.ytimg.com/vi/vid20000000/hqdefault.jpg')
    expect(out).toContain('aria-label="Remove Film room 1"')
    expect(out).toContain('aria-label="Remove video"')
    // Articles aren't videos: no row for them here.
    expect(out).not.toContain('https://example.com/1')
    // Room left: the link field is still offered.
    expect(out).toContain('placeholder="Paste a YouTube link"')
  })

  it('at 10 videos the field gives way to a line', () => {
    const out = renderEdit(detail({ links: Array.from({ length: 10 }, (_, i) => video(i)) }))
    expect(rows(out)).toBe(10)
    expect(out).not.toContain('placeholder="Paste a YouTube link"')
    expect(out).toContain('That’s 10 videos, the most a list can hold')
  })

  it('article links share the cap: 8 videos + 2 articles is full too', () => {
    const out = renderEdit(detail({ links: [...Array.from({ length: 8 }, (_, i) => video(i)), article(1), article(2)] }))
    expect(rows(out)).toBe(8)
    expect(out).not.toContain('placeholder="Paste a YouTube link"')
    expect(out).toContain('This list is full: videos and links share a limit of 10')
  })
})

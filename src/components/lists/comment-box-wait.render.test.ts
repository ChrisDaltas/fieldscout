/**
 * The comment box's countdown (migration 213 — 5 comments a minute), on both
 * layouts: with five of the poster's own comments in the last minute the
 * box says "You can comment again in Ns" and Post is held; with four it says
 * nothing. The count comes from the shared `my-recent-comments` read (seeded
 * here); the server's own refusal is covered by the route test and the
 * pure `commentWaitMs` tests.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createElement, forwardRef, type ReactElement, type ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: () => {}, replace: () => {}, back: () => {} }),
  usePathname: () => '/app/explore',
  useSearchParams: () => new URLSearchParams(),
}))
vi.mock('@/hooks/use-auth', () => ({
  useAuth: () => ({ user: { id: 'u-me' }, profile: { username: 'me', avatar_url: null } }),
}))
vi.mock('@/hooks/use-comments', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/hooks/use-comments')>()
  return {
    ...actual,
    useComments: () => ({ data: { comments: [], pagination: { page: 1, pageSize: 20, total: 0, hasMore: false } }, isPending: false, isError: false }),
    useAddComment: () => ({ mutate: () => {}, isPending: false }),
  }
})
// Radix portals don't render on the server: draw the phone sheet inline.
vi.mock('@/components/ui/sheet', () => ({
  Sheet: ({ open, children }: { open: boolean; children: ReactNode }) => (open ? children : null),
  SheetContent: forwardRef<HTMLDivElement, { children: ReactNode; className?: string }>(function Panel({ children, className }, ref) {
    return createElement('div', { ref, 'data-panel': '', className }, children)
  }),
  SheetTitle: ({ children }: { children: ReactNode }) => createElement('h2', null, children),
  SheetDescription: ({ children }: { children: ReactNode }) => createElement('p', null, children),
}))

import { CommentsSheet } from '@/components/mobile/lists/comments-sheet'
import { myRecentCommentsKey } from '@/hooks/use-comment-cooldown'

import { ListCommentsTab } from './v2/list-comments-tab'

const NOW = Date.UTC(2026, 9, 29, 12, 0, 0)
const ago = (ms: number) => new Date(NOW - ms).toISOString()

function render(element: ReactElement, recent: string[]): string {
  const qc = new QueryClient()
  qc.setQueryData(myRecentCommentsKey('u-me'), recent)
  return renderToStaticMarkup(createElement(QueryClientProvider, { client: qc }, element))
}

const phone = () =>
  createElement(CommentsSheet, {
    open: true,
    onOpenChange: () => {},
    listId: 'L1',
    enabled: true,
    listOwned: false,
    viewer: { username: 'me', avatarUrl: null },
  })
const desktop = () => createElement(ListCommentsTab, { listId: 'L1', viewer: { username: 'me', avatarUrl: null } })

const FIVE = [ago(40_000), ago(30_000), ago(20_000), ago(10_000), ago(1_000)]
const FOUR = FIVE.slice(1)

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(NOW)
})
afterEach(() => {
  vi.useRealTimers()
})

describe('the comment box holds Post at five a minute', () => {
  it('phone: "You can comment again in 20s", Post disabled', () => {
    const out = render(phone(), FIVE)
    expect(out).toContain('You can comment again in 20s')
    expect(out).toMatch(/<button[^>]*disabled=""[^>]*aria-label="Post comment"/)
  })

  it('desktop: the same line under the field', () => {
    const out = render(desktop(), FIVE)
    expect(out).toContain('You can comment again in 20s')
  })

  it('four in the last minute: no line on either layout', () => {
    expect(render(phone(), FOUR)).not.toContain('data-comment-wait')
    expect(render(desktop(), FOUR)).not.toContain('data-comment-wait')
  })

  it('the line is quiet text, not a system message (no role, no red, no pill)', () => {
    for (const out of [render(phone(), FIVE), render(desktop(), FIVE)]) {
      const line = out.slice(out.lastIndexOf('<p', out.indexOf('data-comment-wait')), out.indexOf('</p>', out.indexOf('data-comment-wait')))
      expect(line).not.toMatch(/role=|negative|m-red|m-tr|rounded-pill|rounded-full/)
      expect(line).toContain('aria-live="polite"')
    }
  })
})

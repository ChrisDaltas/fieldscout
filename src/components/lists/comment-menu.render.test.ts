/**
 * Comments: Delete, Comments on / off, older comments (Community launch plan
 * C1, readiness B1 / S12) — phone and desktop. Pinned:
 *   - who sees Delete: the comment's author and the list's owner; everyone
 *     else gets no ⋯ at all (hidden, not disabled), and signed out nobody does;
 *   - confirm → delete: the ⋯'s Delete asks first; only the confirm's Delete
 *     calls the delete; the answer reaches the toast — and a refused delete
 *     puts the comment back on every page;
 *   - the owner's Comments on / off: phone List options and desktop's list
 *     menu, owner only, sending `{ comments_enabled }`; off, the box is gone
 *     and the thread says so;
 *   - older comments: "Show older comments" only while the API has more, and
 *     the thread reads the next page and keeps each comment once;
 *   - the desktop comment heart (a like with nothing behind it) is gone;
 *   - all of it rides the Community switch: while `community` is off every
 *     comment box is exactly as it was.
 */
import {
  InfiniteQueryObserver,
  MutationObserver,
  QueryClient,
  QueryClientProvider,
  type InfiniteData,
} from '@tanstack/react-query'
import { createElement, isValidElement, type ReactElement, type ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  community: true,
  user: { id: 'u-me' } as { id: string } | null,
  thread: undefined as unknown,
  update: vi.fn(),
  rows: new Map<string, { onClick: () => void; sub?: string }>(),
}))

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: () => {}, replace: () => {}, back: () => {}, refresh: () => {} }),
  usePathname: () => '/app/lists',
  useSearchParams: () => new URLSearchParams(),
}))
vi.mock('@/hooks/use-auth', () => ({
  useAuth: () => ({ user: h.user, profile: h.user ? { username: 'me', avatar_url: null } : null }),
}))
vi.mock('@/lib/feature-flags', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/feature-flags')>()
  return {
    featureFlags: {
      ...actual.featureFlags,
      leagues: false,
      get community() {
        return h.community
      },
    },
  }
})
vi.mock('@/hooks/use-comments', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/hooks/use-comments')>()
  return {
    ...actual,
    useComments: () => h.thread,
    useAddComment: () => ({ mutate: () => {}, isPending: false }),
  }
})
vi.mock('@/hooks/use-lists', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/hooks/use-lists')>()
  const idle = () => ({ mutate: () => {}, isPending: false })
  return {
    ...actual,
    useUpdateList: () => ({ mutate: h.update, isPending: false }),
    useToggleFavorite: idle,
    useDuplicateList: idle,
    useDeleteList: idle,
  }
})
// Radix portals don't render on the server: draw the open sheets, menus and
// dialogs inline.
vi.mock('@/components/mobile/ui/mobile-sheet', () => ({
  MobileSheet: ({ open, title, subtitle, children, footer }: { open: boolean; title: string; subtitle?: string; children: ReactNode; footer?: ReactNode }) =>
    open ? createElement('section', { 'data-sheet': title, 'data-sub': subtitle }, children, footer) : null,
}))
vi.mock('@/components/mobile/lists/folder-sheets', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/components/mobile/lists/folder-sheets')>()
  return {
    ...actual,
    // The List options rows, with their taps kept so a test can make one.
    SheetRow: ({ label, sub, onClick }: { label: string; sub?: string; onClick: () => void }) => {
      h.rows.set(label, { onClick, sub })
      return createElement('button', { 'data-row': label, 'data-sub': sub }, label)
    },
  }
})
vi.mock('@/components/ui/dropdown-menu', () => {
  const pass = ({ children }: { children?: ReactNode }) => createElement('div', null, children)
  return {
    DropdownMenu: pass,
    DropdownMenuTrigger: pass,
    DropdownMenuContent: pass,
    DropdownMenuSub: pass,
    DropdownMenuSubTrigger: pass,
    DropdownMenuSubContent: pass,
    DropdownMenuSeparator: () => null,
    DropdownMenuItem: ({ children }: { children?: ReactNode }) => createElement('div', { role: 'menuitem' }, children),
  }
})

import { readFileSync } from 'node:fs'
import path from 'node:path'

import { ListDetailHero } from '@/components/lists/v2/list-detail-hero'
import { CommentMenuSheet, CommentsSheet } from '@/components/mobile/lists/comments-sheet'
import { ListActionsSheet } from '@/components/mobile/lists/list-actions-sheet'
import {
  commentsKeys,
  commentsThreadOptions,
  deleteCommentMutationOptions,
  type CommentsResponse,
  type CommentWithAuthor,
} from '@/hooks/use-comments'
import type { ListWithDetails } from '@/hooks/use-lists'

import { commentMenuItems, confirmCommentDelete, DELETE_COMMENT } from './comment-menu-ops'
import { DeleteCommentDialog, ListCommentsTab } from './v2/list-comments-tab'

const noop = () => {}

function comment(id: string, authorId: string, username: string, body = `Comment ${id}`): CommentWithAuthor {
  return {
    id,
    list_id: 'L1',
    author_id: authorId,
    body,
    parent_id: null,
    created_at: '2026-10-29T11:00:00Z',
    updated_at: '2026-10-29T11:00:00Z',
    deleted_at: null,
    author: { id: authorId, username, avatar_url: null, cred_score: 7, is_pro: false },
  } as unknown as CommentWithAuthor
}

const MINE = comment('c-mine', 'u-me', 'me', 'My own take')
const KELLYS = comment('c-kelly', 'u-kelly', 'kelly', 'Kelly says hold him')

function thread(comments: CommentWithAuthor[], over: Record<string, unknown> = {}) {
  return {
    data: { comments, pagination: { total: comments.length, hasMore: false } },
    isPending: false,
    isError: false,
    isFetchNextPageError: false,
    hasNextPage: false,
    isFetchingNextPage: false,
    isPlaceholderData: false,
    fetchNextPage: noop,
    ...over,
  }
}

const html = (node: ReactElement) =>
  renderToStaticMarkup(createElement(QueryClientProvider, { client: new QueryClient() }, node)).replace(/&#x27;/g, '’')

const phone = (over: { listOwned?: boolean; enabled?: boolean } = {}) =>
  html(
    createElement(CommentsSheet, {
      open: true,
      onOpenChange: noop,
      listId: 'L1',
      enabled: over.enabled ?? true,
      listOwned: over.listOwned ?? false,
      viewer: { username: 'me', avatarUrl: null },
    }),
  )
const desktop = (over: { listOwned?: boolean; enabled?: boolean; signedIn?: boolean } = {}) =>
  html(
    createElement(ListCommentsTab, {
      listId: 'L1',
      viewer: { username: 'me', avatarUrl: null },
      signedIn: over.signedIn ?? true,
      commentsEnabled: over.enabled ?? true,
      listOwned: over.listOwned ?? false,
    }),
  )

/** The rows that carry a ⋯, by comment id. */
const menuRows = (out: string) =>
  [...out.matchAll(/data-comment="([^"]+)"/g)]
    .map((m) => {
      const start = m.index ?? 0
      const next = out.indexOf('data-comment="', start + 1)
      return { id: m[1], row: out.slice(start, next === -1 ? undefined : next) }
    })
    .filter((r) => r.row.includes('data-comment-menu'))
    .map((r) => r.id)

/** Every element of a tree (through mocked wrappers) whose props match. */
function find(node: ReactNode, match: (props: Record<string, unknown>) => boolean, out: ReactElement<Record<string, unknown>>[] = []) {
  if (Array.isArray(node)) node.forEach((n) => find(n as ReactNode, match, out))
  else if (isValidElement<Record<string, unknown>>(node)) {
    if (match(node.props)) out.push(node)
    find(node.props.children as ReactNode, match, out)
    if (isValidElement(node.props.actions)) find(node.props.actions as ReactNode, match, out)
  }
  return out
}

const textOf = (node: ReactNode): string =>
  Array.isArray(node)
    ? node.map(textOf).join('')
    : isValidElement<{ children?: ReactNode }>(node)
      ? textOf(node.props.children)
      : typeof node === 'string'
        ? node
        : ''

beforeEach(() => {
  h.community = true
  h.user = { id: 'u-me' }
  h.thread = thread([KELLYS, MINE])
  h.update.mockReset()
  h.rows.clear()
})

describe('who sees Delete', () => {
  it('the comment’s author and the list’s owner; nobody else; nobody signed out', () => {
    expect(commentMenuItems({ viewerId: 'u-me', authorId: 'u-me', listOwned: false })).toEqual(['delete'])
    expect(commentMenuItems({ viewerId: 'u-me', authorId: 'u-kelly', listOwned: true })).toEqual(['delete'])
    expect(commentMenuItems({ viewerId: 'u-me', authorId: 'u-kelly', listOwned: false })).toEqual([])
    expect(commentMenuItems({ viewerId: null, authorId: 'u-kelly', listOwned: false })).toEqual([])
  })

  it('phone: a reader gets ⋯ on his own comment only', () => {
    expect(menuRows(phone())).toEqual(['c-mine'])
  })

  it('phone: the list’s owner gets ⋯ on every comment', () => {
    expect(menuRows(phone({ listOwned: true }))).toEqual(['c-kelly', 'c-mine'])
  })

  it('desktop: the same — reader on his own, owner on all', () => {
    expect(menuRows(desktop())).toEqual(['c-mine'])
    expect(menuRows(desktop({ listOwned: true }))).toEqual(['c-kelly', 'c-mine'])
  })

  it('someone else’s comment on someone else’s list: no ⋯ at all (hidden, not disabled)', () => {
    h.thread = thread([KELLYS])
    for (const out of [phone(), desktop()]) {
      expect(out).not.toContain('data-comment-menu')
      expect(out).not.toContain(DELETE_COMMENT.item)
    }
  })

  it('signed out: no ⋯ on either layout', () => {
    h.user = null
    expect(phone()).not.toContain('data-comment-menu')
    expect(desktop({ signedIn: false })).not.toContain('data-comment-menu')
  })

  it('a thread still showing the last list’s comments (placeholder): no ⋯ yet', () => {
    h.thread = thread([KELLYS, MINE], { isPlaceholderData: true })
    expect(phone({ listOwned: true })).not.toContain('data-comment-menu')
    expect(desktop({ listOwned: true })).not.toContain('data-comment-menu')
  })

  it('desktop’s menu holds Delete comment', () => {
    expect(desktop()).toContain(DELETE_COMMENT.item)
  })
})

describe('confirm → delete', () => {
  it('phone: the ⋯ sheet’s Delete asks first, it doesn’t delete', () => {
    const onStep = vi.fn()
    const onDelete = vi.fn()
    const tree = CommentMenuSheet({ open: true, onOpenChange: noop, comment: MINE, items: ['delete'], step: 'menu', onStep, onDelete })
    const out = html(tree)
    expect(out).toContain('data-sheet="Comment"')
    // Which comment: quoted (a handle shown here would have to be a link).
    expect(out).toContain('My own take')
    const row = find(tree, (p) => p.label === DELETE_COMMENT.item)
    expect(row).toHaveLength(1)
    ;(row[0]!.props.onClick as () => void)()
    expect(onStep).toHaveBeenCalledWith('confirm-delete')
    expect(onDelete).not.toHaveBeenCalled()
  })

  it('phone: the confirm quotes the comment; Delete deletes, Cancel only closes', () => {
    const onOpenChange = vi.fn()
    const onDelete = vi.fn()
    const tree = CommentMenuSheet({ open: true, onOpenChange, comment: MINE, items: ['delete'], step: 'confirm-delete', onStep: noop, onDelete })
    const out = html(tree)
    expect(out).toContain(`data-sheet="${DELETE_COMMENT.title}"`)
    expect(out).toContain('My own take')
    // The soft red tint, never bright red paint.
    const deleteButton = out.slice(out.lastIndexOf('<button', out.indexOf('data-comment-confirm-delete')), out.indexOf('</button>', out.indexOf('data-comment-confirm-delete')))
    expect(deleteButton).toContain('bg-m-gr')
    expect(deleteButton).toContain('text-m-tr')
    expect(deleteButton).not.toMatch(/bg-m-red|bg-negative-strong|bg-destructive/)

    ;(find(tree, (p) => 'data-comment-confirm-cancel' in p)[0]!.props.onClick as () => void)()
    expect(onOpenChange).toHaveBeenCalledWith(false)
    expect(onDelete).not.toHaveBeenCalled()
    ;(find(tree, (p) => 'data-comment-confirm-delete' in p)[0]!.props.onClick as () => void)()
    expect(onDelete).toHaveBeenCalledTimes(1)
  })

  it('desktop: the dialog’s Delete confirms, Cancel closes', () => {
    const onOpenChange = vi.fn()
    const onConfirm = vi.fn()
    const tree = DeleteCommentDialog({ open: true, onOpenChange, body: 'Kelly says hold him', onConfirm })
    expect(textOf(tree)).toContain(DELETE_COMMENT.title)
    expect(textOf(tree)).toContain('Kelly says hold him')
    ;(find(tree, (p) => 'data-comment-confirm-cancel' in p)[0]!.props.onClick as () => void)()
    expect(onOpenChange).toHaveBeenCalledWith(false)
    expect(onConfirm).not.toHaveBeenCalled()
    ;(find(tree, (p) => 'data-comment-confirm-delete' in p)[0]!.props.onClick as () => void)()
    expect(onConfirm).toHaveBeenCalledTimes(1)
  })

  it('confirmed: the delete runs for that comment, and its answer is toasted', () => {
    const notify = vi.fn()
    const ok = { mutate: vi.fn((_id: string, opts: { onSuccess: () => void }) => opts.onSuccess()) }
    confirmCommentDelete(ok, 'c-mine', notify)
    expect(ok.mutate).toHaveBeenCalledWith('c-mine', expect.anything())
    expect(notify).toHaveBeenLastCalledWith({ title: DELETE_COMMENT.done })

    const refused = {
      mutate: vi.fn((_id: string, opts: { onError: (e: Error) => void }) => opts.onError(new Error('Forbidden'))),
    }
    confirmCommentDelete(refused, 'c-kelly', notify)
    expect(notify).toHaveBeenLastCalledWith({ title: DELETE_COMMENT.failed, description: 'Forbidden', variant: 'destructive' })
  })
})

describe('the delete itself (useDeleteComment)', () => {
  const pages = (): InfiniteData<CommentsResponse, number> => ({
    pageParams: [1, 2],
    pages: [
      { comments: [KELLYS], pagination: { page: 1, pageSize: 1, total: 2, hasMore: true } },
      { comments: [MINE], pagination: { page: 2, pageSize: 1, total: 2, hasMore: false } },
    ],
  })
  const key = commentsKeys.thread('L1', 1)

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('the comment leaves every page at once, and the DELETE names it', async () => {
    const fetchSpy = vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200 }))
    vi.stubGlobal('fetch', fetchSpy)
    const qc = new QueryClient()
    qc.setQueryData(key, pages())
    await new MutationObserver(qc, deleteCommentMutationOptions(qc, 'L1')).mutate('c-mine')
    expect(fetchSpy).toHaveBeenCalledWith('/api/lists/L1/comments/c-mine', { method: 'DELETE' })
    const after = qc.getQueryData<InfiniteData<CommentsResponse, number>>(key)!
    expect(after.pages.flatMap((p) => p.comments.map((c) => c.id))).toEqual(['c-kelly'])
    expect(after.pages[0]!.pagination.total).toBe(1)
  })

  it('a refused delete: the comment stays, and the error is the server’s words', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: 'That comment isn’t yours to remove.' }), { status: 403 })))
    const qc = new QueryClient()
    qc.setQueryData(key, pages())
    await expect(new MutationObserver(qc, deleteCommentMutationOptions(qc, 'L1')).mutate('c-kelly')).rejects.toThrow(
      'That comment isn’t yours to remove.',
    )
    expect(qc.getQueryData(key)).toEqual(pages())
  })
})

describe('the owner’s Comments on / off', () => {
  const list = (over: Record<string, unknown> = {}) =>
    ({
      id: 'L1',
      title: 'Sleepers',
      slug: 'sleepers',
      description: null,
      owner_id: 'u-me',
      is_owner: true,
      is_favorited: false,
      is_favorites: false,
      is_private: false,
      is_big_board: false,
      ai_persona_id: null,
      folder_id: null,
      ranking_mode: 'ranked',
      comments_enabled: true,
      created_at: '2026-10-01T00:00:00Z',
      updated_at: '2026-10-01T00:00:00Z',
      tags: [],
      links: [],
      players: [],
      ...over,
    }) as unknown as ListWithDetails

  const sheet = (l: ListWithDetails, onOpenChange: (open: boolean) => void = noop) =>
    html(
      createElement(ListActionsSheet, {
        open: true,
        onOpenChange,
        list: l,
        ownerUsername: 'me',
        canEdit: l.is_owner,
        viewer: { username: 'me', avatarUrl: null },
        onEditDetails: noop,
        onDeleted: noop,
        tools: {
          group: null,
          onGroupBy: noop,
          checkOff: false,
          onCheckOff: noop,
          marked: 0,
          onClearDrafted: noop,
          notes: 0,
          notesShown: false,
          onNotes: noop,
          onCompare: noop,
        },
      }),
    )

  it('phone: the owner turns comments off from List options (sheet closes, the list is sent the switch)', () => {
    const onOpenChange = vi.fn()
    const out = sheet(list(), onOpenChange)
    expect(out).toContain('data-row="Turn off comments" data-sub="On"')
    h.rows.get('Turn off comments')!.onClick()
    expect(onOpenChange).toHaveBeenCalledWith(false)
    expect(h.update).toHaveBeenCalledWith({ comments_enabled: false }, expect.anything())
  })

  it('phone: comments off → "Turn on comments", sending true', () => {
    expect(sheet(list({ comments_enabled: false }))).toContain('data-row="Turn on comments" data-sub="Off"')
    h.rows.get('Turn on comments')!.onClick()
    expect(h.update).toHaveBeenCalledWith({ comments_enabled: true }, expect.anything())
  })

  it('phone: someone else’s list has no switch (its thread stays reachable)', () => {
    const out = sheet(list({ is_owner: false, owner_id: 'u-kelly' }))
    expect(out).not.toMatch(/Turn (off|on) comments/)
    expect(out).toContain('data-row="Comments"')
  })

  const heroProps = (l: ListWithDetails, onSetCommentsEnabled?: (enabled: boolean) => void) => ({
    list: l,
    owner: { username: 'me', avatarUrl: null },
    canEdit: l.is_owner,
    expanded: false,
    onToggleExpanded: noop,
    onClose: noop,
    onPopOut: noop,
    onRename: noop,
    onShare: noop,
    onDuplicate: noop,
    onSetPrivate: noop,
    onSetCommentsEnabled,
    onClearDrafted: noop,
    onDelete: noop,
    onTogglePin: noop,
    folders: [],
    onMoveToFolder: noop,
  })

  it('desktop: the list menu’s Comments, beside Visibility — On / Off, the current one ticked', () => {
    const set = vi.fn()
    const out = html(createElement(ListDetailHero, heroProps(list(), set)))
    const visibility = out.indexOf('</svg>Visibility<')
    const comments = out.indexOf('</svg>Comments<')
    const pin = out.indexOf('</svg>Pin<')
    expect(visibility).toBeGreaterThan(-1)
    // Right after Visibility, before the rest of the menu.
    expect(comments).toBeGreaterThan(visibility)
    expect(pin).toBeGreaterThan(comments)
    expect(out.slice(comments, pin)).toMatch(/<\/svg>On<[\s\S]*<\/svg>Off</)

    const tree = ListDetailHero(heroProps(list(), set))
    const items = find(tree, (p) => typeof p.onSelect === 'function')
    const off = items.find((i) => textOf(i.props.children as ReactNode) === 'Off')!
    const on = items.find((i) => textOf(i.props.children as ReactNode) === 'On')!
    ;(off.props.onSelect as () => void)()
    expect(set).toHaveBeenLastCalledWith(false)
    ;(on.props.onSelect as () => void)()
    expect(set).toHaveBeenLastCalledWith(true)
  })

  it('desktop: no handler (not the owner) → no Comments item', () => {
    const out = html(createElement(ListDetailHero, heroProps(list({ is_owner: false }))))
    expect(out).toContain('</svg>Pin<') // the menu rendered
    expect(out).not.toContain('</svg>Comments<')
  })

  it('comments off: no comment box, and a plain note — the owner’s says only he sees them', () => {
    h.thread = thread([])
    for (const out of [phone({ enabled: false }), desktop({ enabled: false })]) {
      expect(out).not.toContain('aria-label="Add a comment"')
      expect(out).toContain('Comments are turned off on this list.')
      expect(out).not.toContain('No comments yet.')
    }
    h.thread = thread([KELLYS])
    for (const out of [phone({ enabled: false, listOwned: true }), desktop({ enabled: false, listOwned: true })]) {
      expect(out).toContain('You turned comments off. Only you can see these, and nobody can add new ones.')
      // What was there stays his to read and to delete.
      expect(menuRows(out)).toEqual(['c-kelly'])
    }
  })
})

describe('older comments', () => {
  it('"Show older comments" only while the API has more — both layouts', () => {
    h.thread = thread([KELLYS, MINE], { hasNextPage: true })
    expect(phone()).toContain('Show older comments')
    expect(desktop()).toContain('Show older comments')
    h.thread = thread([KELLYS, MINE])
    expect(phone()).not.toContain('Show older comments')
    expect(desktop()).not.toContain('Show older comments')
  })

  it('reading the next page: "Loading…"; a failed read says so beside Try again, the thread kept', () => {
    h.thread = thread([KELLYS], { hasNextPage: true, isFetchingNextPage: true })
    expect(phone()).toMatch(/data-older-comments[^>]*>Loading…/)
    h.thread = thread([KELLYS], { hasNextPage: true, isError: true, isFetchNextPageError: true, error: new Error('Network down') })
    for (const out of [phone(), desktop()]) {
      expect(out).toContain('Couldn’t load older comments. Network down')
      expect(out).toMatch(/data-older-comments[^>]*>Try again/)
      expect(out).toContain('Kelly says hold him')
      expect(out).not.toContain('Comments could not be loaded')
    }
  })

  it('the thread reads page 2 on demand and keeps each comment once', async () => {
    const page = (n: number, comments: CommentWithAuthor[], hasMore: boolean): CommentsResponse => ({
      comments,
      pagination: { page: n, pageSize: 2, total: 3, hasMore },
    })
    const A = comment('a', 'u-kelly', 'kelly')
    const B = comment('b', 'u-kelly', 'kelly')
    const C = comment('c', 'u-me', 'me')
    const fetchSpy = vi.fn(async (url: string) =>
      new Response(JSON.stringify(url.includes('page=1&') ? page(1, [A, B], true) : page(2, [B, C], false))),
    )
    vi.stubGlobal('fetch', fetchSpy)
    try {
      const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
      const observer = new InfiniteQueryObserver(qc, commentsThreadOptions('L1', 2))
      const unsubscribe = observer.subscribe(noop)
      await vi.waitFor(() => expect(observer.getCurrentResult().isSuccess).toBe(true))
      expect(fetchSpy).toHaveBeenLastCalledWith('/api/lists/L1/comments?page=1&pageSize=2')
      expect(observer.getCurrentResult().hasNextPage).toBe(true)
      expect(observer.getCurrentResult().data?.comments.map((c) => c.id)).toEqual(['a', 'b'])

      await observer.fetchNextPage()
      expect(fetchSpy).toHaveBeenLastCalledWith('/api/lists/L1/comments?page=2&pageSize=2')
      const result = observer.getCurrentResult()
      // B slid onto page 2 (a newer comment arrived between reads): once.
      expect(result.data?.comments.map((c) => c.id)).toEqual(['a', 'b', 'c'])
      expect(result.data?.pagination).toEqual({ total: 3, hasMore: false })
      expect(result.hasNextPage).toBe(false)
      unsubscribe()
    } finally {
      vi.unstubAllGlobals()
    }
  })
})

describe('the desktop comment heart', () => {
  it('is gone — no like control with nothing behind it', () => {
    const out = desktop()
    expect(out).not.toContain('Comment likes are not stored yet')
    const rows = out.slice(out.indexOf('data-comment='))
    expect(rows).not.toMatch(/fs-num">0</)
  })
})

describe('while Community is off, every comment box is as it was', () => {
  beforeEach(() => {
    h.community = false
  })

  it('phone: no ⋯ (even on your own comment, even as the owner), no "Show older comments", the old note', () => {
    h.thread = thread([KELLYS, MINE], { hasNextPage: true })
    const out = phone({ listOwned: true })
    expect(out).not.toContain('data-comment-menu')
    expect(out).not.toContain('Show older comments')
    h.thread = thread([KELLYS])
    expect(phone({ listOwned: true, enabled: false })).toContain('Comments are turned off on this list.')
  })

  it('desktop: the old heart, no ⋯, no "Show older comments", the old note and empty line', () => {
    h.thread = thread([KELLYS, MINE], { hasNextPage: true })
    const out = desktop({ listOwned: true })
    expect(out).toContain('Comment likes are not stored yet')
    expect(out).not.toContain('data-comment-menu')
    expect(out).not.toContain('Show older comments')
    h.thread = thread([])
    const off = desktop({ listOwned: true, enabled: false })
    expect(off).toContain('Comments are turned off on this list.')
    expect(off).toContain('No comments yet.')
  })

  it('phone List options: no comments switch for the owner', () => {
    const l = {
      id: 'L1', title: 'Sleepers', slug: 'sleepers', owner_id: 'u-me', is_owner: true, is_favorited: false,
      is_favorites: false, is_private: false, is_big_board: false, ai_persona_id: null, folder_id: null,
      ranking_mode: 'ranked', comments_enabled: true, players: [], tags: [], links: [],
    } as unknown as ListWithDetails
    const out = html(
      createElement(ListActionsSheet, {
        open: true, onOpenChange: noop, list: l, ownerUsername: 'me', canEdit: true,
        viewer: { username: 'me', avatarUrl: null }, onEditDetails: noop, onDeleted: noop,
        tools: { group: null, onGroupBy: noop, checkOff: false, onCheckOff: noop, marked: 0, onClearDrafted: noop, notes: 0, notesShown: false, onNotes: noop, onCompare: noop },
      }),
    )
    expect(out).toContain('data-row="Make private"') // the owner's rows rendered
    expect(out).not.toMatch(/Turn (off|on) comments/)
  })

  it('desktop list menu: the panel hands the switch over only while Community is on', () => {
    const panel = readFileSync(path.join(process.cwd(), 'src/components/lists/v2/list-detail-panel.tsx'), 'utf8')
    expect(panel).toContain('onSetCommentsEnabled={canEdit && commentControlsOn() ? setCommentsEnabled : undefined}')
  })
})

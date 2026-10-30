/**
 * "@x commented on your list" lands where the comment is (Community sweep
 * WPO-1). The alert (`list_comment`, migration 213 — it fires with Community
 * off too: comments on your own lists are Lists) links to the list with
 * `comments=1`; the phone List view opens its Comments sheet on arrival and
 * desktop's Lists panel opens on its Comments tab, and each then drops the
 * flag from the address so Back and a reload show the list as usual. Pinned:
 *  - the address and the flag helpers (pure);
 *  - both alert targets — the desktop rail / page and the phone row;
 *  - the screens' wiring (source pins: the effects can't run in a static
 *    render; the comment-menu render test pins the sheet itself opening).
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'

import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/feature-flags', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/feature-flags')>()
  return { featureFlags: { ...actual.featureFlags, community: false } }
})

import { mobileNotificationHref } from '@/components/mobile/notifications/mobile-notification-href'
import { notificationHref } from '@/components/notifications/notification-href'

import { LIST_COMMENTS_PARAM, listCommentsHref, listHref, phoneListIdOf, withoutCommentsFlag } from './lists-routes'

const code = (file: string) => readFileSync(path.resolve(process.cwd(), file), 'utf8')

describe('the address', () => {
  it('your list, opened on its comments: the List view’s own address plus comments=1', () => {
    expect(LIST_COMMENTS_PARAM).toBe('comments')
    expect(listCommentsHref('L1')).toBe('/app/lists?list=L1&comments=1')
    expect(listCommentsHref('L1').startsWith(listHref('L1'))).toBe(true)
    expect(listCommentsHref('a b')).toBe('/app/lists?list=a%20b&comments=1')
  })

  it('is still a phone list address (a signed-out tap goes to the public page, not sign-in)', () => {
    const url = new URL(listCommentsHref('L1'), 'http://x')
    expect(phoneListIdOf(url.pathname, url.searchParams)).toBe('L1')
  })

  it('dropping the flag keeps the rest of the address as it was', () => {
    expect(withoutCommentsFlag('/app/lists?list=L1&comments=1')).toBe('/app/lists?list=L1')
    expect(withoutCommentsFlag('/app/lists?list=L1&comments=1&from=grid')).toBe('/app/lists?list=L1&from=grid')
    expect(withoutCommentsFlag('/app/lists?comments=1')).toBe('/app/lists')
    // Nothing to drop: the address is left alone, character for character.
    expect(withoutCommentsFlag('/app/lists?list=L1&from=grid')).toBe('/app/lists?list=L1&from=grid')
    expect(withoutCommentsFlag('/app/lists')).toBe('/app/lists')
  })
})

describe('the alert’s target', () => {
  const alert = { type: 'list_comment', data: { list_id: 'L9', actor_id: 'u2' } }

  it('desktop and phone alike, with Community off: the list’s comments', () => {
    expect(notificationHref(alert)).toBe('/app/lists?list=L9&comments=1')
    expect(mobileNotificationHref(alert)).toBe('/app/lists?list=L9&comments=1')
  })

  it('only the comment alert: a saved list’s update still opens the plain list', () => {
    expect(notificationHref({ type: 'list_updated', data: { list_id: 'L9' } })).toBe('/app/lists/L9')
  })
})

describe('the screens open the comments, then drop the flag', () => {
  it('phone List view: once the list is on screen, the Comments sheet opens and the flag leaves the address', () => {
    const view = code('src/components/mobile/lists/list-view.tsx')
    expect(view).toContain("const commentsAsked = useSearchParams().get(LIST_COMMENTS_PARAM) === '1'")
    expect(view).toMatch(
      /React\.useEffect\(\(\) => \{\s*if \(!commentsAsked \|\| !loaded\) return\s*setCommentsOpen\(true\)\s*window\.history\.replaceState\(null, '', withoutCommentsFlag\(window\.location\.pathname \+ window\.location\.search\)\)\s*\}, \[commentsAsked, loaded\]\)/,
    )
    // The one Comments sheet — List options' — opened from the List view's state.
    expect(view).toContain('commentsSheet={{ open: commentsOpen, onOpenChange: setCommentsOpen }}')
    expect(view).not.toContain('<CommentsSheet')
  })

  it('desktop Lists: the flag selects the list (also with the page already open) and the panel opens on Comments', () => {
    const page = code('src/components/lists/v2/lists-page-v2.tsx')
    expect(page).toContain("const commentsAsked = useSearchParams().get(LIST_COMMENTS_PARAM) === '1'")
    expect(page).toContain('const commentsLinkId = commentsAsked ? deepLinkId : null')
    const effect = page.slice(page.indexOf('if (!commentsLinkId) return'), page.indexOf('}, [commentsLinkId])'))
    expect(effect).toContain('setSelectedId(commentsLinkId)')
    expect(effect).toContain('setCommentsFor(commentsLinkId)')
    expect(effect).toContain("window.history.replaceState(null, '', withoutCommentsFlag(window.location.pathname + window.location.search))")
    // Both of the page's panels (List mode and an opened card) take the request.
    expect(page.match(/openComments=\{commentsFor === (detailId|openedId)\}/g)).toHaveLength(2)
    expect(page.match(/onCommentsShown=\{commentsShown\}/g)).toHaveLength(2)

    const panel = code('src/components/lists/v2/list-detail-panel.tsx')
    // After the reset to List on a new list, so the asked-for list lands on Comments.
    const reset = panel.indexOf("setTab('list')\n  }, [listId])")
    const open = panel.indexOf("if (!openComments) return\n    setTab('comments')\n    onCommentsShown?.()")
    expect(reset).toBeGreaterThan(-1)
    expect(open).toBeGreaterThan(reset)
  })
})

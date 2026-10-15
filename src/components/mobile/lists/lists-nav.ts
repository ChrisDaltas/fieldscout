'use client'

import { useRouter, useSearchParams } from 'next/navigation'
import { useMemo } from 'react'

/**
 * FieldScout Mobile — Lists routes (lr-lists §4; the prototype has none, so
 * these are the app's own URLs):
 *
 * | Screen        | URL                                   |
 * | ------------- | ------------------------------------- |
 * | Lists grid    | `/app/lists` (`?tab=saved` for Saved) |
 * | List view     | `/app/lists?list=<id>` (`/app/lists/<id>` redirects here) |
 * | List editor   | `/app/lists?list=<id>&edit=1` (`&add=1` opens Add players) |
 * | Edit details  | `/app/lists?list=<id>&details=1`      |
 * | New list      | `/app/lists/new`                      |
 *
 * ## Back
 *
 * Each screen's on-screen back goes to its parent (view → grid, editor and
 * Edit details → view, New list → grid, grid → Profile, lr-frame §2.4). When
 * the parent is the history entry right behind, back *is* history back, so
 * the on-screen control and the OS gesture agree and history never grows a
 * loop. Otherwise the screen is **replaced** by its parent, so the OS back
 * from there doesn't return to the screen just left.
 *
 * Which parent is behind is carried in the entry's own URL (`from=grid` /
 * `from=view`, or `from=back` for New list opened from Profile or
 * Community), set by the tap that pushed it. It survives a reload (the
 * history behind survives too) and never goes stale the way in-memory flags
 * do when a screen is left by the OS gesture; a shared or deep link has none,
 * so it navigates to the parent instead of leaving the app (and a copied URL
 * that does carry one, opened in a fresh tab, is caught by `appEntryBehind`).
 */

type From = 'grid' | 'view'

export const listHref = (id: string, from?: From) =>
  `/app/lists?list=${encodeURIComponent(id)}${from ? `&from=${from}` : ''}`
export const editorHref = (id: string, addPlayers = false, from?: From) =>
  `/app/lists?list=${encodeURIComponent(id)}&edit=1${addPlayers ? '&add=1' : ''}${from ? `&from=${from}` : ''}`
export const detailsHref = (id: string, from?: From) =>
  `/app/lists?list=${encodeURIComponent(id)}&details=1${from ? `&from=${from}` : ''}`
const newHref = (from?: From) => `/app/lists/new${from ? `?from=${from}` : ''}`
/** New list opened from outside Lists (Profile's "New list", Community's
 *  Create sheet): its back returns to that screen when it is behind. */
export const NEW_LIST_FROM_ELSEWHERE_HREF = '/app/lists/new?from=back'

/**
 * Whether the entry behind this one belongs to the app. The Navigation API
 * lists only same-origin entries, so a current index above 0 means the
 * previous entry is ours; without the API, fall back to a same-origin
 * referrer (a page opened from another site, or in a fresh tab, has none).
 */
export function appEntryBehind(): boolean {
  if (typeof window === 'undefined') return false
  const nav = (window as Window & { navigation?: { currentEntry?: { index: number } | null } }).navigation
  if (nav?.currentEntry) return nav.currentEntry.index > 0
  if (window.history.length <= 1) return false
  try {
    return Boolean(document.referrer) && new URL(document.referrer).origin === window.location.origin
  } catch {
    return false
  }
}

export function useListsNav() {
  const router = useRouter()
  const params = useSearchParams()
  const from = params.get('from')
  return useMemo(
    () => ({
      openList(id: string) {
        router.push(listHref(id, 'grid'))
      },
      /** The List view's back → the grid. */
      closeList() {
        if (from === 'grid' && appEntryBehind()) router.back()
        else router.replace('/app/lists')
      },
      openEditor(id: string, addPlayers = false) {
        router.push(editorHref(id, addPlayers, 'view'))
      },
      openDetails(id: string) {
        router.push(detailsHref(id, 'view'))
      },
      /** Leave the editor or Edit details for the List view. A screen with
       *  the grid behind it hands that on to the view that replaces it. */
      closeEdit(id: string) {
        if (from === 'view' && appEntryBehind()) router.back()
        else router.replace(listHref(id, from === 'grid' ? 'grid' : undefined))
      },
      openNew() {
        router.push(newHref('grid'))
      },
      closeNew() {
        if ((from === 'grid' || from === 'back') && appEntryBehind()) router.back()
        else router.replace('/app/lists')
      },
      /** A just-created list: the New list entry is replaced by its editor,
       *  which inherits what was behind New list. */
      createdList(id: string) {
        router.replace(editorHref(id, true, from === 'grid' ? 'grid' : undefined))
      },
      /** The grid's back: Profile, Lists' parent (history back when the
       *  entry behind is in the app — normally Profile itself). */
      leaveLists() {
        if (appEntryBehind()) router.back()
        else router.replace('/app/profile')
      },
      setTab(tab: 'mine' | 'saved') {
        router.replace(tab === 'saved' ? '/app/lists?tab=saved' : '/app/lists', { scroll: false })
      },
    }),
    [router, from],
  )
}

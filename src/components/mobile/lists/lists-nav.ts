'use client'

import { useRouter, useSearchParams } from 'next/navigation'
import { useMemo } from 'react'

import { appEntryBehind, useGoBack } from '@/components/mobile/ui/back-nav'

import { compareHref } from './list-tools'

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
 * | Side by side  | `/app/lists?compare=<id>,<id>`        |
 *
 * ## Back
 *
 * "Back always goes to where you came from. Period." (Chris, 2026-10-15,
 * gap list #27.) The grid, the List view and New list go back through
 * history to whatever screen opened them — the grid, Profile, Home's
 * recently viewed, Community, a player — via `useGoBack`. Only when nothing
 * in the app is behind (a shared or deep link) do they go to their parent
 * (view and New list → grid, grid → Profile, lr-frame §2.4), replacing the
 * screen so the OS back from there doesn't return to it.
 *
 * The editor and Edit details hand back to their List view. When they were
 * pushed from it (`from=view` in their own URL, set by the tap that pushed
 * them) that *is* history back; otherwise (New list → Next, which replaces
 * New list; a deep link) the screen is replaced by the view. The marker
 * lives in the entry's URL so it survives a reload and never goes stale the
 * way in-memory flags do when a screen is left by the OS gesture. `from=grid`
 * is handed on to a view that replaces an editor.
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
 *  Create sheet). Its back returns there as every Back does (#27); the
 *  marker only keeps it from reading as opened from the grid. */
export const NEW_LIST_FROM_ELSEWHERE_HREF = '/app/lists/new?from=back'

export function useListsNav() {
  const router = useRouter()
  const goBack = useGoBack()
  const params = useSearchParams()
  const from = params.get('from')
  return useMemo(
    () => ({
      openList(id: string) {
        router.push(listHref(id, 'grid'))
      },
      /** The List view's back: where you came from, else the grid (#27). */
      closeList() {
        goBack('/app/lists')
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
      /** New list's back: where you came from, else the grid (#27). */
      closeNew() {
        goBack('/app/lists')
      },
      /** A just-created list: the New list entry is replaced by its editor,
       *  which inherits what was behind New list. */
      createdList(id: string) {
        router.replace(editorHref(id, true, from === 'grid' ? 'grid' : undefined))
      },
      /** The grid's back: where you came from (normally Profile), else
       *  Profile, Lists' parent (#27). */
      leaveLists() {
        goBack('/app/profile')
      },
      /** Side by side, from a list's options (gap list §3 #3). */
      openCompare(ids: readonly string[]) {
        router.push(compareHref(ids))
      },
      /** A changed comparison (Change, Remove column) replaces this one, so
       *  Back still goes to where the comparison was opened from. */
      changeCompare(ids: readonly string[]) {
        router.replace(compareHref(ids))
      },
      /** The comparison's back: where you came from, else its first list. */
      closeCompare(firstId: string | undefined) {
        goBack(firstId ? listHref(firstId) : '/app/lists')
      },
      /** A column's "Open list" — Back from it returns to the comparison. */
      openListFromCompare(id: string) {
        router.push(listHref(id))
      },
      setTab(tab: 'mine' | 'saved') {
        router.replace(tab === 'saved' ? '/app/lists?tab=saved' : '/app/lists', { scroll: false })
      },
    }),
    [router, goBack, from],
  )
}

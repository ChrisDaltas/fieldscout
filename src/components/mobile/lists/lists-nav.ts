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
 * | New list      | `/app/lists/new` (`step=2` in its query is step 2 of 2, `step=1` step 1 again, `new-list-save.ts`) |
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
 * them) that *is* history back; otherwise (a deep link) the screen is
 * replaced by the view. The marker lives in the entry's URL so it survives a
 * reload and never goes stale the way in-memory flags do when a screen is
 * left by the OS gesture. `from=grid` is handed on to a view that replaces
 * an editor.
 *
 * ## New list: one draft until Save (lr-lists §4)
 *
 * New list's Next opens its step 2 — the editor, for a list that doesn't
 * exist yet — as a pushed `step=2` entry of New list's own URL, over a
 * pushed `step=1` (step 1 again), so Back from step 2 (on screen or the OS
 * gesture) is history back to step 1 with the draft kept, and the gesture
 * from there stays on New list's page, which asks before it drops added
 * players (`newListStrayBack`). Only Save makes the list; it then takes New
 * list's place in history with the List view (`NewListScreen`), or —
 *
 * ## A list started from Community (gap list §3 #8)
 *
 * — Community's Create sheet opens New list with `from=community`, and Save
 * returns there — the handoff's composer posts and stays on the screen that
 * opened it — with "List created", the feed refreshed and on For you
 * (`refreshCommunity`). History there is Community, New list's first entry,
 * step 1 again, then step 2, so it steps back three (`returnToCommunity`).
 */

type From = 'grid' | 'view'

export const listHref = (id: string, from?: From) =>
  `/app/lists?list=${encodeURIComponent(id)}${from ? `&from=${from}` : ''}`

export interface EditorHrefOptions {
  /** Open Add players on arrival (when the list has no players). */
  add?: boolean
  from?: From
}
export const editorHref = (id: string, { add = false, from }: EditorHrefOptions = {}) =>
  `/app/lists?list=${encodeURIComponent(id)}&edit=1${add ? '&add=1' : ''}${from ? `&from=${from}` : ''}`
export const detailsHref = (id: string, from?: From) =>
  `/app/lists?list=${encodeURIComponent(id)}&details=1${from ? `&from=${from}` : ''}`
const newHref = (from?: From) => `/app/lists/new${from ? `?from=${from}` : ''}`
/** New list opened from outside Lists (Profile's "New list"). Its back
 *  returns there as every Back does (#27); the marker only keeps it from
 *  reading as opened from the grid. Community's Create sheet opens it with
 *  `from=community` instead (`CREATE_LIST_HREF`, gap list §3 #8). */
export const NEW_LIST_FROM_ELSEWHERE_HREF = '/app/lists/new?from=back'
/** Community's address, where a list started there returns. */
export const COMMUNITY_HREF = '/app/explore'

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
        router.push(editorHref(id, { add: addPlayers, from: 'view' }))
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
      /** A new list Community started, saved: back to Community (gap list
       *  §3 #8) — `entries` behind (New list's step 2 is three: past step 1
       *  again and New list's first entry). `false` when Community isn't
       *  there to step back to (New list was opened fresh); the caller then
       *  leaves for `COMMUNITY_HREF`. */
      returnToCommunity(entries: number): boolean {
        if (!appEntryBehind(entries)) return false
        window.history.go(-entries)
        return true
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

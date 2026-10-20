'use client'

import { useRouter } from 'next/navigation'
import { useCallback } from 'react'

/**
 * FieldScout Mobile's ONE Back rule (Chris, 2026-10-15, gap list #27):
 * "Back always goes to where you came from. Period."
 *
 * Every on-screen Back / Close on the phone goes back through history to the
 * screen you were on. Only when nothing in the app is behind (a shared link
 * opened fresh, a new tab) does it go to the screen's sensible parent — and
 * then it REPLACES, so the OS back gesture doesn't bounce you back here.
 */

/**
 * Whether the entry behind this one belongs to the app — or, with `depth`,
 * the `depth` entries behind it (a screen that steps back over more than one,
 * like a saved New list returning to Community). The Navigation API lists
 * only same-origin entries, so a current index of at least `depth` means
 * they are ours; without the API, fall back to a same-origin referrer (a
 * page opened from another site, or in a fresh tab, has none) and a history
 * that long.
 */
/** The slice of the Navigation API these helpers read (absent in some
 *  browsers, so every part is optional). */
interface NavigationLike {
  currentEntry?: { index: number } | null
  entries?: () => ReadonlyArray<{ url: string | null }>
}

const navigationApi = (): NavigationLike | undefined => (window as Window & { navigation?: NavigationLike }).navigation

export function appEntryBehind(depth = 1): boolean {
  if (typeof window === 'undefined') return false
  const nav = navigationApi()
  if (nav?.currentEntry) return nav.currentEntry.index >= depth
  if (window.history.length <= depth) return false
  try {
    return Boolean(document.referrer) && new URL(document.referrer).origin === window.location.origin
  } catch {
    return false
  }
}

/** `goBack(parent)`: back to where you came from, else to `parent`. */
export function useGoBack() {
  const router = useRouter()
  return useCallback(
    (parent: string) => {
      if (appEntryBehind()) router.back()
      else router.replace(parent)
    },
    [router],
  )
}

/**
 * The path of the app screen directly behind this one, when the browser can
 * say (the Navigation API lists same-origin entries with their URLs); `null`
 * when it can't, or nothing of the app is behind.
 */
export function pathBehind(): string | null {
  if (typeof window === 'undefined') return null
  const nav = navigationApi()
  const index = nav?.currentEntry?.index
  if (index === undefined || index < 1 || typeof nav?.entries !== 'function') return null
  const url = nav.entries()[index - 1]?.url
  if (!url) return null
  try {
    return new URL(url).pathname
  } catch {
    return null
  }
}

/**
 * How leaving this screen for `href` goes, so the screen left doesn't stay
 * in history (a report just deleted, an empty one): step `'back'` when
 * `href` is the screen right behind — no second copy of it, and Back from
 * there still goes where it went before — otherwise `'replace'` this screen
 * with it. Only the path is compared: the screen behind keeps its own query.
 */
export function leaveVia(href: string): 'back' | 'replace' {
  return pathBehind() === href.split(/[?#]/)[0] ? 'back' : 'replace'
}

/** `leaveTo(href)`: leave this screen for `href` (`leaveVia`). */
export function useLeaveTo() {
  const router = useRouter()
  return useCallback(
    (href: string) => {
      if (leaveVia(href) === 'back') router.back()
      else router.replace(href)
    },
    [router],
  )
}

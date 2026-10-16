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

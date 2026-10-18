'use client'

import { useCallback, useEffect, useLayoutEffect, useRef, type RefObject } from 'react'

import { isNearTop } from '@/components/mobile/messages/messages-ops'

import { scrollerOf } from './use-mobile-messages-pin-bottom'

/** Where a scroller's visible area starts on screen (0 for the page itself). */
function viewTopOf(s: HTMLElement): number {
  return s === document.scrollingElement || s === document.documentElement || s === document.body ? 0 : s.getBoundingClientRect().top
}

/** A message's place inside the list — the same however far it is scrolled. */
function yIn(list: HTMLElement, node: HTMLElement): number {
  return node.getBoundingClientRect().top - list.getBoundingClientRect().top
}

/** The first message (in order) that reaches below `viewTop`: the post at
 *  the top of what the reader sees. The messages are laid out in order, so
 *  a binary search finds it in a few reads, however long the thread. */
function topVisibleMessage(list: HTMLElement, viewTop: number): HTMLElement | null {
  const nodes = list.querySelectorAll<HTMLElement>('[data-message]')
  let lo = 0
  let hi = nodes.length - 1
  let found: HTMLElement | null = null
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    const node = nodes[mid]!
    if (node.getBoundingClientRect().bottom > viewTop) {
      found = node
      hi = mid - 1
    } else lo = mid + 1
  }
  return found
}

/**
 * Older posts load as you scroll up, and what you are reading stays put when
 * they land above it (gap list §3 #23).
 *
 * `ref` is the message list. While `canLoad`, nearing its top (within
 * `NEAR_TOP_PX` — about a screen) calls `onLoad`; that is checked as the
 * reader scrolls and after every change, so a thread too short to scroll
 * keeps filling. `layout` is any string that changes when the list's
 * contents do (its oldest message, its length, the top slot).
 *
 * Holding the position: on each scroll the post at the top of the screen is
 * noted with its place in the list; when the contents change, that post's
 * shift (the height of whatever landed above it) is added to the scroll,
 * before paint. The browser's own scroll anchoring is off for the thread
 * (`overflow-anchor: none` on its frame), so the two never both correct it.
 */
export function useMobileMessagesOlder(
  ref: RefObject<HTMLElement | null>,
  { canLoad, onLoad, layout }: { canLoad: boolean; onLoad: () => void; layout: string },
) {
  const scroller = useRef<HTMLElement | null>(null)
  const anchor = useRef<{ key: string; y: number } | null>(null)
  const latest = useRef({ canLoad, onLoad })
  useLayoutEffect(() => {
    latest.current = { canLoad, onLoad }
  })

  /** Note the post at the top of the screen; ask for more when near the top. */
  const look = useCallback(() => {
    const list = ref.current
    const s = scroller.current
    if (!list || !s) return
    const viewTop = viewTopOf(s)
    const node = topVisibleMessage(list, viewTop)
    const key = node?.dataset.message
    anchor.current = node && key ? { key, y: yIn(list, node) } : null
    if (latest.current.canLoad && isNearTop({ listTop: list.getBoundingClientRect().top, viewTop })) latest.current.onLoad()
  }, [ref])

  useEffect(() => {
    const list = ref.current
    if (!list) return
    const s = scrollerOf(list)
    scroller.current = s
    let frame = 0
    const onScroll = () => {
      if (frame) return
      frame = requestAnimationFrame(() => {
        frame = 0
        look()
      })
    }
    s.addEventListener('scroll', onScroll, { passive: true })
    return () => {
      cancelAnimationFrame(frame)
      s.removeEventListener('scroll', onScroll)
      scroller.current = null
    }
  }, [ref, look])

  // The contents changed: keep the noted post where the reader saw it.
  useLayoutEffect(() => {
    const list = ref.current
    const s = scroller.current
    const a = anchor.current
    if (!list || !s || !a) return
    const node = list.querySelector<HTMLElement>(`[data-message="${CSS.escape(a.key)}"]`)
    if (!node) return
    const shift = yIn(list, node) - a.y
    if (shift !== 0) s.scrollTop += shift
  }, [layout, ref])

  // …then note it afresh, and see whether the reader is (still) near the top.
  useEffect(() => {
    look()
  }, [layout, canLoad, look])
}

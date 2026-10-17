'use client'

import { useEffect, useLayoutEffect, useRef, type RefObject } from 'react'

import { followsNewMessage, isNearBottom } from '@/components/mobile/messages/messages-ops'

/** The element that scrolls `el`: its nearest ancestor that scrolls
 *  vertically (the app's `main` on a phone), else the page itself. */
function scrollerOf(el: HTMLElement): HTMLElement {
  for (let p = el.parentElement; p; p = p.parentElement) {
    const overflowY = getComputedStyle(p).overflowY
    if (overflowY === 'auto' || overflowY === 'scroll' || overflowY === 'overlay') return p
  }
  return (document.scrollingElement as HTMLElement | null) ?? document.documentElement
}

function toBottom(scroller: HTMLElement) {
  scroller.scrollTop = scroller.scrollHeight
}

/**
 * A conversation opens at its NEWEST message and follows new ones as they
 * arrive (Chris, #47, 2026-10-15): the reader stays pinned to the bottom
 * unless they have scrolled up to read — then a newcomer leaves them where
 * they are (`followsNewMessage`), except their own message, which brings
 * them down to it.
 *
 * `ref` is the message list; `last` the newest message (`lastMessageOf`).
 * "Pinned" is read from the scroller's position on every scroll, so a
 * programmatic jump to the bottom pins and a reader's scroll up unpins; a
 * size change (a message laid out, the keyboard) keeps a pinned reader at
 * the bottom.
 *
 * The opening jump runs as a passive effect, after the router's own
 * navigation scroll (which puts the top of a newly mounted page back in
 * view during the commit), and once more on the next frame.
 */
export function useMobileMessagesPinBottom(ref: RefObject<HTMLElement | null>, last: { key: string; fromMe: boolean } | null) {
  const pinned = useRef(true)
  const scroller = useRef<HTMLElement | null>(null)
  /** The newest message already placed; undefined until the list mounts. */
  const placed = useRef<string | null | undefined>(undefined)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    const s = scrollerOf(el)
    scroller.current = s
    pinned.current = true
    toBottom(s)
    const frame = requestAnimationFrame(() => {
      if (pinned.current) toBottom(s)
    })
    const onScroll = () => {
      pinned.current = isNearBottom(s)
    }
    s.addEventListener('scroll', onScroll, { passive: true })
    const resize =
      typeof ResizeObserver === 'undefined'
        ? null
        : new ResizeObserver(() => {
            if (pinned.current) toBottom(s)
          })
    resize?.observe(el)
    resize?.observe(s)
    return () => {
      cancelAnimationFrame(frame)
      s.removeEventListener('scroll', onScroll)
      resize?.disconnect()
      scroller.current = null
    }
  }, [ref])

  // A new newest message, laid out: follow it if the reader is pinned (or
  // sent it). Before paint, so a followed message never flashes below.
  useLayoutEffect(() => {
    const key = last?.key ?? null
    const opening = placed.current === undefined
    if (key === placed.current) return
    placed.current = key
    const s = scroller.current
    if (opening || !s || !last) return
    if (followsNewMessage({ pinned: pinned.current, fromMe: last.fromMe })) {
      pinned.current = true
      toBottom(s)
    }
  }, [last])
}

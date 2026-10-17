'use client'

import { useEffect, useState, type RefObject } from 'react'

/**
 * FieldScout Mobile — Lists: whether the List view's cover has scrolled off
 * (Chris, 2026-10-15, gap list #25), so the slim bar with Back, the title and
 * Edit takes over from the controls the cover carried.
 *
 * "Off" means the cover's bottom edge has gone up under the bar's bottom edge
 * — everything still on screen of it is behind the bar. Both edges are read
 * from the page itself (the bar is laid out while hidden), so the bar's
 * height, the safe area and anything above the app's scroller are all
 * accounted for without a number written down twice.
 */
export function coverPassed(coverBottom: number, barBottom: number): boolean {
  // Whole pixels: a fractional device pixel ratio can leave the two edges a
  // hair apart when they are meant to meet.
  return Math.round(coverBottom) <= Math.round(barBottom)
}

/** An element whose edge is read: the cover or the slim bar. */
type Edged = { getBoundingClientRect: () => { bottom: number } }

/**
 * Watches whether the cover has gone under the bar, reporting each change
 * to `onChange` (the first reading always). It reads on subscribe, then once a
 * frame after any scroll or resize. Scroll events don't bubble, but a capturing
 * listener on the document hears the app's scroller (`main`), whichever
 * element that is. Returns the unsubscribe.
 *
 * The refs are read at each check, not on subscribe, so a re-mounted cover or
 * bar is picked up; while either is missing nothing is reported.
 */
export function watchCoverPassed(
  cover: RefObject<Edged | null>,
  bar: RefObject<Edged | null>,
  onChange: (passed: boolean) => void,
): () => void {
  let frame = 0
  let last: boolean | null = null
  const check = () => {
    frame = 0
    const c = cover.current
    const b = bar.current
    if (!c || !b) return
    const passed = coverPassed(c.getBoundingClientRect().bottom, b.getBoundingClientRect().bottom)
    if (passed === last) return
    last = passed
    onChange(passed)
  }
  const schedule = () => {
    if (!frame) frame = window.requestAnimationFrame(check)
  }
  check()
  document.addEventListener('scroll', schedule, { capture: true, passive: true })
  window.addEventListener('resize', schedule, { passive: true })
  return () => {
    document.removeEventListener('scroll', schedule, { capture: true })
    window.removeEventListener('resize', schedule)
    if (frame) window.cancelAnimationFrame(frame)
    frame = 0
  }
}

export function useMobileListsCoverPassed(
  cover: RefObject<HTMLElement | null>,
  bar: RefObject<HTMLElement | null>,
  /** The cover and bar are on screen (the list has loaded). */
  ready: boolean,
): boolean {
  const [passed, setPassed] = useState(false)

  useEffect(() => {
    if (!ready) return
    return watchCoverPassed(cover, bar, setPassed)
  }, [cover, bar, ready])

  return ready && passed
}

'use client'

import { useCallback, useEffect, useRef } from 'react'

/**
 * FieldScout Mobile — pull a bottom sheet down to close it (gap list §4
 * item 3). Every MobileSheet gets it: drag the sheet down and let go past a
 * quarter of its height (at most 120px), or flick it, and it closes the way
 * a backdrop tap does; let go short of that and it springs back. The sheet
 * follows the finger 1:1 and never moves up past its resting place. Only a
 * real change of mind keeps it open after a long pull — a quick flick back
 * up, or the finger brought back up from its lowest point — never the
 * pixel or two a fingertip shifts as it lifts off the glass.
 *
 * A touch anywhere on the sheet can pull it — unless it belongs to something
 * inside: a scroller that isn't at its top scrolls back up first (as iOS and
 * the Sleeper / ESPN sheets do), a text box keeps its own drags, and a
 * sideways move is left to a sideways scroller (the chip rows). A mouse pulls
 * only from the grab handle and the title row. Hand-rolled on touch and
 * pointer events, like the league switcher — no gesture library.
 */

/** Movement (px) before a touch counts as a drag in any direction. */
export const SWIPE_SLOP = 6
/** A release this far down closes the sheet, whatever the speed. */
export const SWIPE_CLOSE_MAX = 120
export const SWIPE_CLOSE_FRACTION = 0.25
/** A flick at this speed (px/ms) closes from a short pull… */
export const SWIPE_FLICK_SPEED = 0.5
/** …of at least this far. */
export const SWIPE_FLICK_MIN = 24
/** Still for this long before letting go = not a flick. */
export const SWIPE_HOLD_MS = 100
/** The release speed is the finger's average over about its last this-many
 *  ms, not one frame — a single frame is mostly lift-off noise. */
export const SWIPE_SPEED_WINDOW_MS = 60
/** Brought back up more than this (px) from its lowest point before letting
 *  go = the user changed their mind; a fingertip lifting off moves less. */
export const SWIPE_BACK_UP = 12
/** The spring back (README: transitions are linear, about 200ms). */
export const SWIPE_SETTLE_MS = 200

/** How far down a release must be to close a sheet this tall. */
export function swipeCloseDistance(height: number): number {
  return Math.min(SWIPE_CLOSE_MAX, height * SWIPE_CLOSE_FRACTION)
}

/** From the first real movement: does this touch pull the sheet down? */
export function swipeStart(move: { dx: number; dy: number; kept: boolean }): 'wait' | 'drag' | 'ignore' {
  const { dx, dy, kept } = move
  if (Math.abs(dx) < SWIPE_SLOP && Math.abs(dy) < SWIPE_SLOP) return 'wait'
  if (kept || dy <= 0 || Math.abs(dx) >= dy) return 'ignore'
  return 'drag'
}

/** A finger position on the way down: `y` in px, `t` in ms. */
export interface SwipeSample {
  y: number
  t: number
}

/** The finger's speed (px/ms, down positive) as it let go: the average over
 *  its last SWIPE_SPEED_WINDOW_MS, and always over at least the last two
 *  positions. */
export function releaseSpeed(samples: readonly SwipeSample[]): number {
  const n = samples.length
  if (n < 2) return 0
  const last = samples[n - 1]
  let i = n - 2
  while (i > 0 && last.t - samples[i - 1].t <= SWIPE_SPEED_WINDOW_MS) i--
  const dt = last.t - samples[i].t
  return dt > 0 ? (last.y - samples[i].y) / dt : 0
}

/** On release: close, or spring back? `dy` is how far down the sheet is,
 *  `vy` the finger's speed as it let go (px/ms, down positive — see
 *  releaseSpeed), and `backUp` how far the finger had come back up from its
 *  lowest point. */
export function swipeEnd(release: { dy: number; vy: number; height: number; backUp?: number }): 'close' | 'stay' {
  const { dy, vy, height, backUp = 0 } = release
  // A real change of mind: flicked back up, or brought back up. A small
  // upward wobble as the finger lifts falls through to the distance check.
  if (vy <= -SWIPE_FLICK_SPEED || backUp > SWIPE_BACK_UP) return 'stay'
  if (dy >= swipeCloseDistance(height)) return 'close'
  if (dy >= SWIPE_FLICK_MIN && vy >= SWIPE_FLICK_SPEED) return 'close'
  return 'stay'
}

/** The bits of a DOM element the gesture reads (a plain object in tests). */
export interface SwipeTarget {
  scrollTop?: number
  tagName?: string
  isContentEditable?: boolean
  parentElement?: SwipeTarget | null
}

/** Does a touch on `target` belong to something inside the sheet: a
 *  scroller between it and the sheet that isn't at its top, or a text box? */
export function keepsGesture(target: SwipeTarget | null, panel: unknown): boolean {
  for (let el = target; el && el !== panel; el = el.parentElement ?? null) {
    if ((el.scrollTop ?? 0) > 0) return true
    if (el.tagName === 'TEXTAREA' || el.isContentEditable) return true
  }
  return false
}

function reducedMotion(): boolean {
  return typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
}

interface Drag {
  x: number
  y: number
  /** Recent positions, trimmed to the speed window (plus one before it). */
  samples: SwipeSample[]
  lastT: number
  dy: number
  /** The furthest down the sheet has been pulled this drag. */
  maxDy: number
  kept: boolean
  live: boolean
}

/**
 * Wire the gesture onto a sheet panel; returns the detach. `onClose` asks
 * the sheet to close (MobileSheet: `onOpenChange(false)`); the panel then
 * slides the rest of the way out from where the finger left it. A sheet that
 * stays open (one that is busy and refuses) springs back.
 */
export function attachSheetSwipe(panel: HTMLElement, onClose: () => void): () => void {
  let drag: Drag | null = null
  let settleTimer: ReturnType<typeof setTimeout> | undefined

  const follow = (dy: number) => {
    clearTimeout(settleTimer)
    panel.style.transition = 'none'
    panel.style.transform = dy > 0 ? `translate3d(0, ${dy}px, 0)` : ''
  }
  const settle = () => {
    clearTimeout(settleTimer)
    panel.style.transition = reducedMotion() ? 'none' : `transform ${SWIPE_SETTLE_MS}ms linear`
    panel.style.transform = ''
    settleTimer = setTimeout(() => {
      panel.style.transition = ''
    }, SWIPE_SETTLE_MS + 20)
  }

  const begin = (x: number, y: number, t: number, kept: boolean) => {
    drag = { x, y, samples: [{ y, t }], lastT: t, dy: 0, maxDy: 0, kept, live: false }
  }
  /** True once the move is pulling the sheet (the caller then stops the
   *  page from scrolling with it). */
  const moveTo = (x: number, y: number, t: number): boolean => {
    if (!drag) return false
    if (!drag.live) {
      const verdict = swipeStart({ dx: x - drag.x, dy: y - drag.y, kept: drag.kept })
      if (verdict === 'wait') return false
      if (verdict === 'ignore') {
        drag = null
        return false
      }
      drag.live = true
    }
    const samples = drag.samples
    samples.push({ y, t })
    while (samples.length > 2 && t - samples[1].t > SWIPE_SPEED_WINDOW_MS) samples.shift()
    drag.lastT = t
    drag.dy = Math.max(0, y - drag.y)
    drag.maxDy = Math.max(drag.maxDy, drag.dy)
    follow(drag.dy)
    return true
  }
  const end = (t: number) => {
    const d = drag
    drag = null
    if (!d?.live) return
    const vy = t - d.lastT > SWIPE_HOLD_MS ? 0 : releaseSpeed(d.samples)
    if (swipeEnd({ dy: d.dy, vy, height: panel.offsetHeight, backUp: d.maxDy - d.dy }) === 'stay') {
      settle()
      return
    }
    onClose()
    settleTimer = setTimeout(() => {
      if (panel.isConnected && panel.getAttribute('data-state') === 'open') settle()
    }, 60)
  }
  const cancel = () => {
    const d = drag
    drag = null
    if (d?.live) settle()
  }

  const onTouchStart = (e: TouchEvent) => {
    if (e.touches.length !== 1) return cancel()
    const touch = e.touches[0]
    begin(touch.clientX, touch.clientY, e.timeStamp, keepsGesture(e.target as SwipeTarget | null, panel))
  }
  const onTouchMove = (e: TouchEvent) => {
    if (!drag) return
    if (e.touches.length !== 1) return cancel()
    const touch = e.touches[0]
    if (moveTo(touch.clientX, touch.clientY, e.timeStamp) && e.cancelable) e.preventDefault()
  }
  const onTouchEnd = (e: TouchEvent) => end(e.timeStamp)

  // A mouse pulls from the handle and title row only (`data-sheet-grab`),
  // never from a control. Touch is handled above (touch pointers skip this).
  const onPointerDown = (e: PointerEvent) => {
    if (e.pointerType !== 'mouse' || e.button !== 0) return
    const el = e.target as Element | null
    if (typeof el?.closest !== 'function') return
    if (!el.closest('[data-sheet-grab]') || el.closest('button, a, input, textarea, select')) return
    panel.setPointerCapture?.(e.pointerId)
    begin(e.clientX, e.clientY, e.timeStamp, false)
  }
  const onPointerMove = (e: PointerEvent) => {
    if (e.pointerType === 'mouse') moveTo(e.clientX, e.clientY, e.timeStamp)
  }
  const onPointerUp = (e: PointerEvent) => {
    if (e.pointerType === 'mouse') end(e.timeStamp)
  }
  const onPointerCancel = (e: PointerEvent) => {
    if (e.pointerType === 'mouse') cancel()
  }

  const listeners: [string, EventListener, AddEventListenerOptions?][] = [
    ['touchstart', onTouchStart as EventListener, { passive: true }],
    // Not passive: once the sheet is following the finger, the page mustn't
    // scroll (or pull to refresh) with it.
    ['touchmove', onTouchMove as EventListener, { passive: false }],
    ['touchend', onTouchEnd as EventListener],
    ['touchcancel', cancel],
    ['pointerdown', onPointerDown as EventListener],
    ['pointermove', onPointerMove as EventListener],
    ['pointerup', onPointerUp as EventListener],
    ['pointercancel', onPointerCancel as EventListener],
  ]
  for (const [type, fn, opts] of listeners) panel.addEventListener(type, fn, opts)
  return () => {
    clearTimeout(settleTimer)
    for (const [type, fn] of listeners) panel.removeEventListener(type, fn)
  }
}

/**
 * The sheet panel's ref: wires the pull-down gesture onto whichever panel
 * Radix mounts. A sheet reopened while it was still sliding away starts from
 * its resting place, not where the finger left it.
 */
export function useSheetSwipe(open: boolean, onClose: () => void): (node: HTMLElement | null) => void {
  const close = useRef(onClose)
  useEffect(() => {
    close.current = onClose
  })
  const panel = useRef<HTMLElement | null>(null)
  const detach = useRef<(() => void) | null>(null)

  useEffect(() => {
    const node = panel.current
    if (!open || !node) return
    node.style.transform = ''
    node.style.transition = ''
  }, [open])

  return useCallback((node: HTMLElement | null) => {
    detach.current?.()
    detach.current = null
    panel.current = node
    if (node) detach.current = attachSheetSwipe(node, () => close.current())
  }, [])
}

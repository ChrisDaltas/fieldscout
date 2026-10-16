'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

/**
 * The mobile Match tab's matchup swipe (FieldScout Mobile handoff,
 * `m-match.md` §3.2 — the prototype's `mx`). Swiping is how you move
 * between matchups: the pager dots only show where you are (Chris, ruling
 * #23, 2026-10-15 — "no tapping, just swiping").
 *
 * - **Axis lock.** Once the finger has moved more than 8px either way, the
 *   gesture is horizontal if |dx| > |dy| and stays so; a vertical gesture is
 *   left to the page (`touch-action: pan-y` on the host).
 * - **Drag.** The content follows the finger, clamped to ±180px, fading to
 *   `max(.35, 1 − |dx|/320)`.
 * - **Release.** Past 60px it steps (left = next, right = previous);
 *   otherwise it snaps back over 140ms linear. A cancel snaps back.
 * - **Step.** Slide out 160px over 140ms, swap the matchup, jump to the
 *   other side, then slide in over 140ms (two animation frames later).
 *
 * The build notes the spec adds (§3.2 edge cases) are applied: the pointer is
 * captured once the drag is recognised as horizontal (never on pointerdown —
 * capturing then would retarget a plain tap's click); the click that can
 * follow a drag is swallowed; and a second swipe is ignored while a step is
 * still running instead of collapsing into one. One pointer owns a gesture
 * from its pointerdown to its own pointerup / pointercancel: a second finger
 * neither takes the gesture over nor ends it, so a drag can never be left
 * stranded half-translated.
 *
 * The decisions are the pure `swipe*` functions below (unit-tested); the hook
 * only holds the state and runs the animation.
 */

export const SWIPE_LOCK_PX = 8
export const SWIPE_CLAMP_PX = 180
export const SWIPE_STEP_PX = 60
export const SWIPE_SLIDE_PX = 160

export interface SwipeGesture {
  x: number
  y: number
  /** null until the axis locks; true = horizontal. */
  h: boolean | null
  id: number
}

export interface SwipePointer {
  x: number
  y: number
  id: number
}

/** pointerdown: a gesture already owned by another pointer is kept as is;
 *  otherwise a new one starts when swiping is allowed. */
export function swipeStart(g: SwipeGesture | null, p: SwipePointer, allowed: boolean): SwipeGesture | null {
  if (g && g.id !== p.id) return g
  return allowed ? { x: p.x, y: p.y, h: null, id: p.id } : null
}

/** pointermove: lock the axis past 8px; while horizontal, the clamped
 *  offset to draw (`dx`, else null). `lockedNow` = it just locked
 *  horizontal (the moment to capture the pointer). */
export function swipeMove(g: SwipeGesture, p: SwipePointer): { g: SwipeGesture; dx: number | null; lockedNow: boolean } {
  if (p.id !== g.id) return { g, dx: null, lockedNow: false }
  const dx = p.x - g.x
  const dy = p.y - g.y
  let next = g
  let lockedNow = false
  if (g.h === null && (Math.abs(dx) > SWIPE_LOCK_PX || Math.abs(dy) > SWIPE_LOCK_PX)) {
    next = { ...g, h: Math.abs(dx) > Math.abs(dy) }
    lockedNow = next.h === true
  }
  return { g: next, dx: next.h ? Math.max(-SWIPE_CLAMP_PX, Math.min(SWIPE_CLAMP_PX, dx)) : null, lockedNow }
}

/** pointerup / pointercancel: only the owning pointer ends the gesture. A
 *  horizontal gesture steps (1 = next, −1 = previous) past 60px on release,
 *  else snaps back; a cancel always snaps back; a gesture that never went
 *  horizontal just ends. */
export function swipeEnd(
  g: SwipeGesture | null,
  p: SwipePointer,
  cancelled: boolean,
): { g: SwipeGesture | null; action: 1 | -1 | 'snap' | null } {
  if (!g) return { g: null, action: null }
  if (p.id !== g.id) return { g, action: null }
  if (!g.h) return { g: null, action: null }
  if (cancelled) return { g: null, action: 'snap' }
  const dx = p.x - g.x
  return { g: null, action: Math.abs(dx) > SWIPE_STEP_PX ? (dx < 0 ? 1 : -1) : 'snap' }
}

export function swipeOpacity(dx: number): number {
  return Math.max(0.35, 1 - Math.abs(dx) / 320)
}

export function useMobileMatchSwipe({ enabled, onStep }: { enabled: boolean; onStep: (d: 1 | -1) => void }) {
  const [dx, setDx] = useState(0)
  const [anim, setAnim] = useState(false)
  const gesture = useRef<SwipeGesture | null>(null)
  const dragged = useRef(false)
  const busy = useRef(false)
  const timer = useRef<number | null>(null)
  const stepRef = useRef(onStep)
  useEffect(() => {
    stepRef.current = onStep
  })

  useEffect(
    () => () => {
      if (timer.current !== null) window.clearTimeout(timer.current)
    },
    [],
  )

  const snapBack = useCallback(() => {
    setAnim(true)
    setDx(0)
  }, [])

  const step = useCallback((d: 1 | -1) => {
    busy.current = true
    setAnim(true)
    setDx(d > 0 ? -SWIPE_SLIDE_PX : SWIPE_SLIDE_PX)
    timer.current = window.setTimeout(() => {
      timer.current = null
      stepRef.current(d)
      setAnim(false)
      setDx(d > 0 ? SWIPE_SLIDE_PX : -SWIPE_SLIDE_PX)
      requestAnimationFrame(() =>
        requestAnimationFrame(() => {
          setAnim(true)
          setDx(0)
          busy.current = false
        }),
      )
    }, 140)
  }, [])

  const at = (e: React.PointerEvent<HTMLElement>): SwipePointer => ({ x: e.clientX, y: e.clientY, id: e.pointerId })
  const end = (e: React.PointerEvent<HTMLElement>, cancelled: boolean) => {
    const out = swipeEnd(gesture.current, at(e), cancelled)
    gesture.current = out.g
    if (out.action === 'snap') snapBack()
    else if (out.action !== null) step(out.action)
  }

  const handlers = {
    onPointerDown: (e: React.PointerEvent<HTMLElement>) => {
      const prev = gesture.current
      const allowed = enabled && !busy.current && !(e.pointerType === 'mouse' && e.button !== 0)
      const next = swipeStart(prev, at(e), allowed)
      if (prev && next === prev) return // another pointer owns the gesture
      dragged.current = false
      gesture.current = next
    },
    onPointerMove: (e: React.PointerEvent<HTMLElement>) => {
      const g = gesture.current
      if (!g) return
      const out = swipeMove(g, at(e))
      gesture.current = out.g
      if (out.lockedNow) {
        dragged.current = true
        try {
          e.currentTarget.setPointerCapture(e.pointerId)
        } catch {
          // The pointer may already be gone (a cancelled touch) — nothing to capture.
        }
      }
      if (out.dx !== null) {
        setAnim(false)
        setDx(out.dx)
      }
    },
    onPointerUp: (e: React.PointerEvent<HTMLElement>) => end(e, false),
    onPointerCancel: (e: React.PointerEvent<HTMLElement>) => end(e, true),
    /** Swallow the click a horizontal drag can end in (a team name, a row). */
    onClickCapture: (e: React.MouseEvent<HTMLElement>) => {
      if (!dragged.current) return
      dragged.current = false
      e.preventDefault()
      e.stopPropagation()
    },
  }

  const style: React.CSSProperties = {
    transform: `translateX(${dx}px)`,
    opacity: swipeOpacity(dx),
    transition: anim ? 'transform .14s linear, opacity .14s linear' : 'none',
  }

  return { handlers, style }
}

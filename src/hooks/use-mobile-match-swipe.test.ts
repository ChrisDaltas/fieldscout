import { describe, expect, it } from 'vitest'

import { swipeEnd, swipeMove, swipeOpacity, swipeStart, type SwipeGesture } from './use-mobile-match-swipe'

const p = (x: number, y: number, id = 1) => ({ x, y, id })

describe('mobile Match swipe — the gesture (m-match §3.2)', () => {
  it('starts on pointerdown only when allowed', () => {
    expect(swipeStart(null, p(10, 10), true)).toEqual({ x: 10, y: 10, h: null, id: 1 })
    expect(swipeStart(null, p(10, 10), false)).toBeNull()
  })

  it('locks the axis past 8px and keeps it', () => {
    const g = swipeStart(null, p(0, 0), true)!
    const small = swipeMove(g, p(8, 0))
    expect(small).toEqual({ g, dx: null, lockedNow: false })
    const h = swipeMove(g, p(12, 3))
    expect(h.g.h).toBe(true)
    expect(h.lockedNow).toBe(true)
    expect(h.dx).toBe(12)
    // Still horizontal even when the finger then drifts mostly vertically.
    const drift = swipeMove(h.g, p(14, 80))
    expect(drift.g.h).toBe(true)
    expect(drift.lockedNow).toBe(false)
    expect(drift.dx).toBe(14)
    const v = swipeMove(g, p(3, 12))
    expect(v.g.h).toBe(false)
    expect(v.dx).toBeNull()
  })

  it('clamps the drag to ±180px and fades to .35 at most', () => {
    const g: SwipeGesture = { x: 0, y: 0, h: true, id: 1 }
    expect(swipeMove(g, p(400, 0)).dx).toBe(180)
    expect(swipeMove(g, p(-400, 0)).dx).toBe(-180)
    expect(swipeOpacity(0)).toBe(1)
    expect(swipeOpacity(180)).toBeCloseTo(0.4375)
    expect(swipeOpacity(-320)).toBe(0.35)
  })

  it('steps past 60px (left = next, right = previous), else snaps back; a cancel snaps back', () => {
    const g: SwipeGesture = { x: 100, y: 0, h: true, id: 1 }
    expect(swipeEnd(g, p(30, 0), false)).toEqual({ g: null, action: 1 })
    expect(swipeEnd(g, p(170, 0), false)).toEqual({ g: null, action: -1 })
    expect(swipeEnd(g, p(140, 0), false)).toEqual({ g: null, action: 'snap' })
    expect(swipeEnd(g, p(0, 0), true)).toEqual({ g: null, action: 'snap' })
    expect(swipeEnd({ ...g, h: false }, p(0, 0), false)).toEqual({ g: null, action: null })
    expect(swipeEnd({ ...g, h: null }, p(0, 0), true)).toEqual({ g: null, action: null })
    expect(swipeEnd(null, p(0, 0), false)).toEqual({ g: null, action: null })
  })

  it('a second finger neither takes over nor ends the first finger’s drag', () => {
    const first = swipeMove(swipeStart(null, p(100, 0, 1), true)!, p(60, 0, 1)).g
    expect(first.h).toBe(true)
    // pointerdown of finger 2 mid-drag: the gesture stays finger 1's.
    expect(swipeStart(first, p(200, 50, 2), true)).toBe(first)
    // finger 2 moving or lifting changes nothing…
    expect(swipeMove(first, p(0, 0, 2))).toEqual({ g: first, dx: null, lockedNow: false })
    expect(swipeEnd(first, p(0, 0, 2), false)).toEqual({ g: first, action: null })
    expect(swipeEnd(first, p(0, 0, 2), true)).toEqual({ g: first, action: null })
    // …and finger 1's own release still decides (snap back here: 40px).
    expect(swipeEnd(first, p(60, 0, 1), false)).toEqual({ g: null, action: 'snap' })
  })

  it('the same pointer pressing again (a lost mouse-up) starts afresh', () => {
    const stale: SwipeGesture = { x: 0, y: 0, h: null, id: 1 }
    expect(swipeStart(stale, p(5, 5, 1), true)).toEqual({ x: 5, y: 5, h: null, id: 1 })
    expect(swipeStart(stale, p(5, 5, 1), false)).toBeNull()
  })
})

import { describe, expect, it } from 'vitest'

import { createSidewaysSync, type SidewaysScroller, type SidewaysSide } from './sideways-sync'

/**
 * Gap list #25: the List view's pinned column names (head) and its table
 * (body) scroll sideways together. These tests stand in for the browser. A
 * scroller clamps to its range, and a change of position queues one scroll
 * event, which arrives on the next frame. That covers swipes, flings that
 * keep coasting, and the copy each side writes onto the other.
 */
function harness({ headMax = 600, bodyMax = 600 }: { headMax?: number; bodyMax?: number } = {}) {
  const pending: SidewaysSide[] = []
  const writes: Record<SidewaysSide, number> = { head: 0, body: 0 }
  const make = (side: SidewaysSide, max: number): SidewaysScroller => {
    let left = 0
    return {
      get scrollLeft() {
        return left
      },
      set scrollLeft(value: number) {
        writes[side] += 1
        const next = Math.max(0, Math.min(max, value))
        if (next === left) return
        left = next
        if (!pending.includes(side)) pending.push(side)
      },
    }
  }
  const head = make('head', headMax)
  const body = make('body', bodyMax)
  const sync = createSidewaysSync((side) => (side === 'head' ? head : body))
  /** One frame: the queued scroll events arrive, in order. Anything they
   *  write queues for the next frame. */
  const frame = () => pending.splice(0).forEach((side) => sync.scrolled(side))
  /** A finger (or the momentum after it) moving one scroller. */
  const move = (scroller: SidewaysScroller, to: number) => {
    scroller.scrollLeft = to
  }
  return { head, body, sync, frame, move, writes }
}

describe('createSidewaysSync', () => {
  it('a swipe on the table moves the column names with it', () => {
    const { head, body, frame, move } = harness()
    move(body, 120)
    frame()
    expect(head.scrollLeft).toBe(120)
  })

  it('a swipe on the column names moves the table with it', () => {
    const { head, body, frame, move } = harness()
    move(head, 90)
    frame()
    expect(body.scrollLeft).toBe(90)
  })

  it('the copy arriving is not written back: a coasting table is never pulled back', () => {
    const { head, body, frame, move, writes } = harness()
    move(body, 100)
    frame() // head ← 100; head's echo queued
    move(body, 140) // the fling coasts on before the echo arrives
    const bodyWrites = writes.body
    frame() // head's echo (100), then body's 140
    expect(body.scrollLeft).toBe(140)
    expect(writes.body).toBe(bodyWrites) // the echo wrote nothing onto the table
    expect(head.scrollLeft).toBe(140)
  })

  it('momentum on the table after a touch on the names: the names keep following', () => {
    // Fling the table, then put a thumb on the column names to scroll the
    // page down. That touch doesn't move the names sideways, and the table
    // is still coasting. The names must stay over their columns.
    const { head, body, frame, move } = harness()
    move(body, 80)
    frame()
    for (const at of [150, 210, 250, 270, 276]) {
      move(body, at)
      frame()
      expect(head.scrollLeft).toBe(at)
    }
    frame() // the last echo
    expect(body.scrollLeft).toBe(276)
    expect(head.scrollLeft).toBe(276)
  })

  it('momentum on the names after a touch on a row: the table keeps following', () => {
    const { head, body, frame, move } = harness()
    move(head, 60)
    frame()
    for (const at of [130, 190, 220, 231]) {
      move(head, at)
      frame()
      expect(body.scrollLeft).toBe(at)
    }
    frame()
    expect(head.scrollLeft).toBe(231)
  })

  it('swiping the other one while the first coasts: whichever moved last leads', () => {
    const { head, body, frame, move } = harness()
    move(body, 200)
    frame() // head ← 200
    frame() // head's echo
    move(head, 170) // a swipe back on the names
    frame()
    expect(body.scrollLeft).toBe(170)
    move(body, 230) // then the table again
    frame()
    expect(head.scrollLeft).toBe(230)
  })

  it('a scroller that clamps short of the other is not echoed back onto it', () => {
    const { head, body, frame, move, writes } = harness({ headMax: 480 })
    move(body, 500)
    frame() // head clamps at 480
    expect(head.scrollLeft).toBe(480)
    const bodyWrites = writes.body
    frame() // head's echo reads 480, the clamped copy
    expect(body.scrollLeft).toBe(500)
    expect(writes.body).toBe(bodyWrites)
    // Head can't move further, so no event comes, and its next real swipe
    // still leads.
    move(body, 520)
    frame()
    move(head, 400)
    frame()
    expect(body.scrollLeft).toBe(400)
  })

  it('copy() lines the names up with the table (a change of columns), and its echo stays quiet', () => {
    const { head, body, sync, frame, move, writes } = harness()
    move(body, 300)
    sync.copy('body')
    expect(head.scrollLeft).toBe(300)
    const bodyWrites = writes.body
    frame() // body's own event (head already matches) and head's echo
    expect(writes.body).toBe(bodyWrites)
    expect(body.scrollLeft).toBe(300)
  })

  it('a missing scroller (no stats columns) is a no-op', () => {
    const body: SidewaysScroller = { scrollLeft: 40 }
    const sync = createSidewaysSync((side) => (side === 'body' ? body : null))
    expect(() => {
      sync.scrolled('body')
      sync.scrolled('head')
      sync.copy('body')
    }).not.toThrow()
    expect(body.scrollLeft).toBe(40)
  })
})

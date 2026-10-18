/**
 * FieldScout Mobile — pull a bottom sheet down to close it (gap list §4
 * item 3). The decisions are pinned as pure functions (when a touch starts
 * pulling, when a release closes), then the wiring is driven end to end on a
 * stand-in panel: a long pull closes, a short one springs back, a flick
 * closes, a long pull with a lift-off wobble still closes while one flicked
 * or brought back up stays, a sideways or upward move leaves the sheet alone,
 * a sheet that refuses to close springs back, and a detached panel stops
 * listening. Each "closes" case is paired with the "stays" case next to it.
 */
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest'

import {
  SWIPE_BACK_UP,
  SWIPE_CLOSE_MAX,
  SWIPE_FLICK_SPEED,
  SWIPE_SETTLE_MS,
  attachSheetSwipe,
  keepsGesture,
  releaseSpeed,
  swipeCloseDistance,
  swipeEnd,
  swipeStart,
  type SwipeTarget,
} from './sheet-swipe'

describe('swipeStart — does a touch pull the sheet?', () => {
  it('waits until the finger has really moved', () => {
    expect(swipeStart({ dx: 2, dy: 5, kept: false })).toBe('wait')
  })
  it('a mostly-downward move pulls', () => {
    expect(swipeStart({ dx: 3, dy: 12, kept: false })).toBe('drag')
  })
  it('an upward or sideways move is left alone (chip rows scroll sideways)', () => {
    expect(swipeStart({ dx: 0, dy: -12, kept: false })).toBe('ignore')
    expect(swipeStart({ dx: 14, dy: 10, kept: false })).toBe('ignore')
  })
  it('a touch that belongs to a scrolled list or a text box is left alone', () => {
    expect(swipeStart({ dx: 0, dy: 20, kept: true })).toBe('ignore')
  })
})

describe('swipeEnd — close, or spring back?', () => {
  it('a pull past a quarter of the sheet closes it; short of that, it stays', () => {
    expect(swipeCloseDistance(400)).toBe(100)
    expect(swipeEnd({ dy: 100, vy: 0, height: 400 })).toBe('close')
    expect(swipeEnd({ dy: 99, vy: 0, height: 400 })).toBe('stay')
  })
  it('a tall sheet never needs more than 120px', () => {
    expect(swipeCloseDistance(726)).toBe(SWIPE_CLOSE_MAX)
    expect(swipeEnd({ dy: 120, vy: 0, height: 726 })).toBe('close')
  })
  it('a quick flick closes from a short pull; a slow one of the same length stays', () => {
    expect(swipeEnd({ dy: 40, vy: 0.8, height: 726 })).toBe('close')
    expect(swipeEnd({ dy: 40, vy: 0.2, height: 726 })).toBe('stay')
  })
  it('a flick of a few pixels stays (that was a tap that wobbled)', () => {
    expect(swipeEnd({ dy: 10, vy: 2, height: 726 })).toBe('stay')
  })
  it('a long pull with a small upward wobble as the finger lifts still closes', () => {
    expect(swipeEnd({ dy: 300, vy: -0.2, height: 726, backUp: 2 })).toBe('close')
    expect(swipeEnd({ dy: 300, vy: -0.2, height: 726, backUp: SWIPE_BACK_UP })).toBe('close')
  })
  it('a long pull flicked back up, or brought back up, stays — however far it was pulled', () => {
    expect(swipeEnd({ dy: 300, vy: -SWIPE_FLICK_SPEED, height: 726, backUp: 4 })).toBe('stay')
    expect(swipeEnd({ dy: 300, vy: -0.05, height: 726, backUp: SWIPE_BACK_UP + 1 })).toBe('stay')
  })
})

describe('releaseSpeed — how fast the finger was moving as it let go', () => {
  /** Positions every `stepMs`, `dyPerStep` apart, then the `tail` frames. */
  const track = (steps: number, stepMs: number, dyPerStep: number, tail: { dy: number; ms: number }[] = []) => {
    const out = Array.from({ length: steps + 1 }, (_, i) => ({ y: i * dyPerStep, t: i * stepMs }))
    for (const f of tail) {
      const prev = out[out.length - 1]
      out.push({ y: prev.y + f.dy, t: prev.t + f.ms })
    }
    return out
  }

  it('reads a steady pull at its speed', () => {
    expect(releaseSpeed(track(20, 16, 8))).toBeCloseTo(0.5)
  })
  it('averages over the last few frames, so a one-frame wobble up does not read as moving up', () => {
    const wobbled = track(20, 16, 15, [{ dy: -2, ms: 16 }])
    expect(releaseSpeed(wobbled)).toBeGreaterThan(0)
  })
  it('a real flick back up reads as moving up', () => {
    const flicked = track(20, 16, 15, [
      { dy: -25, ms: 16 },
      { dy: -25, ms: 16 },
      { dy: -25, ms: 16 },
      { dy: -25, ms: 16 },
    ])
    expect(releaseSpeed(flicked)).toBeLessThanOrEqual(-SWIPE_FLICK_SPEED)
  })
  it('after a pause, still uses the last two positions; nothing to go on reads as still', () => {
    expect(releaseSpeed([{ y: 0, t: 0 }, { y: 300, t: 900 }, { y: 298, t: 990 }])).toBeCloseTo(-2 / 90)
    expect(releaseSpeed([{ y: 0, t: 0 }])).toBe(0)
  })
})

describe('keepsGesture — what a touch belongs to', () => {
  const panel: SwipeTarget = { scrollTop: 0, tagName: 'DIV', parentElement: null }
  const under = (el: SwipeTarget, parent: SwipeTarget): SwipeTarget => Object.assign(el, { parentElement: parent })

  it('a row in a list scrolled away from its top scrolls (the list keeps the touch)', () => {
    const body = under({ scrollTop: 240, tagName: 'DIV' }, panel)
    const row = under({ scrollTop: 0, tagName: 'BUTTON' }, body)
    expect(keepsGesture(row, panel)).toBe(true)
  })
  it('the same row with its list at the top pulls the sheet', () => {
    const body = under({ scrollTop: 0, tagName: 'DIV' }, panel)
    const row = under({ scrollTop: 0, tagName: 'BUTTON' }, body)
    expect(keepsGesture(row, panel)).toBe(false)
  })
  it('a text box keeps its own drags; a one-line search field does not', () => {
    const body = under({ scrollTop: 0, tagName: 'DIV' }, panel)
    expect(keepsGesture(under({ tagName: 'TEXTAREA' }, body), panel)).toBe(true)
    expect(keepsGesture(under({ tagName: 'DIV', isContentEditable: true }, body), panel)).toBe(true)
    expect(keepsGesture(under({ tagName: 'INPUT' }, body), panel)).toBe(false)
  })
  it('only looks inside the sheet — a scrolled page behind it does not count', () => {
    const page: SwipeTarget = { scrollTop: 900, tagName: 'BODY', parentElement: null }
    const sheet = under({ scrollTop: 0, tagName: 'DIV' }, page)
    const header = under({ scrollTop: 0, tagName: 'DIV' }, sheet)
    expect(keepsGesture(header, sheet)).toBe(false)
  })
})

/** A stand-in for the Radix panel: listens like an element, has a height,
 *  an inline style and Radix's open/closed state. */
class FakePanel extends EventTarget {
  style = { transform: '', transition: '' }
  offsetHeight = 600
  isConnected = true
  state: 'open' | 'closed' = 'open'
  getAttribute(name: string) {
    return name === 'data-state' ? this.state : null
  }
  setPointerCapture() {}
}

function touch(panel: FakePanel, type: 'touchstart' | 'touchmove' | 'touchend', t: number, y?: number, x = 100): Event {
  const ev = new Event(type, { cancelable: true })
  Object.defineProperty(ev, 'timeStamp', { value: t })
  Object.defineProperty(ev, 'touches', { value: y === undefined ? [] : [{ clientX: x, clientY: y }] })
  panel.dispatchEvent(ev)
  return ev
}

/** A steady pull from y=100 to y=100+dy, one move every `stepMs`. */
function pull(panel: FakePanel, dy: number, { steps = 10, stepMs = 16, holdMs = 0, dx = 0 } = {}): Event[] {
  touch(panel, 'touchstart', 0, 100)
  const moves: Event[] = []
  for (let i = 1; i <= steps; i++) moves.push(touch(panel, 'touchmove', i * stepMs, 100 + (dy * i) / steps, 100 + (dx * i) / steps))
  touch(panel, 'touchend', steps * stepMs + holdMs)
  return moves
}

describe('attachSheetSwipe — the gesture on a panel', () => {
  let panel: FakePanel
  let onClose: Mock<() => void>
  let detach: () => void
  beforeEach(() => {
    vi.useFakeTimers()
    panel = new FakePanel()
    onClose = vi.fn<() => void>()
    detach = attachSheetSwipe(panel as unknown as HTMLElement, onClose)
  })
  afterEach(() => {
    detach()
    vi.useRealTimers()
  })

  it('the sheet follows the finger down, and the page does not scroll with it', () => {
    touch(panel, 'touchstart', 0, 100)
    const move = touch(panel, 'touchmove', 16, 180)
    expect(panel.style.transform).toBe('translate3d(0, 80px, 0)')
    expect(panel.style.transition).toBe('none')
    expect(move.defaultPrevented).toBe(true)
  })

  it('a slow pull past the close distance closes it, leaving it where the finger let go to slide out from', () => {
    pull(panel, 220, { steps: 20, stepMs: 40 })
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(panel.style.transform).toBe('translate3d(0, 220px, 0)')
  })

  it('a slow short pull springs back to rest', () => {
    pull(panel, 50, { steps: 10, stepMs: 40 })
    expect(onClose).not.toHaveBeenCalled()
    expect(panel.style.transform).toBe('')
    expect(panel.style.transition).toBe(`transform ${SWIPE_SETTLE_MS}ms linear`)
    vi.advanceTimersByTime(SWIPE_SETTLE_MS + 20)
    expect(panel.style.transition).toBe('')
  })

  it('a quick flick closes from a short pull; the same flick held still before letting go does not', () => {
    pull(panel, 60, { steps: 3, stepMs: 8 })
    expect(onClose).toHaveBeenCalledTimes(1)

    onClose.mockClear()
    pull(panel, 60, { steps: 3, stepMs: 8, holdMs: 300 })
    expect(onClose).not.toHaveBeenCalled()
    expect(panel.style.transform).toBe('')
  })

  it('a long pull whose last frame wobbles up a pixel or two still closes (a fingertip lifting off)', () => {
    for (const back of [1, 2]) {
      onClose.mockClear()
      touch(panel, 'touchstart', 0, 100)
      for (let i = 1; i <= 20; i++) touch(panel, 'touchmove', i * 16, 100 + 15 * i)
      touch(panel, 'touchmove', 21 * 16, 400 - back)
      touch(panel, 'touchend', 21 * 16 + 4)
      expect(onClose).toHaveBeenCalledTimes(1)
    }
  })

  it('a long pull flicked back up, or brought slowly back up, springs back', () => {
    touch(panel, 'touchstart', 0, 100)
    for (let i = 1; i <= 20; i++) touch(panel, 'touchmove', i * 16, 100 + 15 * i)
    for (let i = 1; i <= 4; i++) touch(panel, 'touchmove', 320 + i * 16, 400 - 25 * i)
    touch(panel, 'touchend', 400)
    expect(onClose).not.toHaveBeenCalled()
    expect(panel.style.transform).toBe('')

    touch(panel, 'touchstart', 1000, 100)
    for (let i = 1; i <= 20; i++) touch(panel, 'touchmove', 1000 + i * 16, 100 + 15 * i)
    for (let i = 1; i <= 10; i++) touch(panel, 'touchmove', 1320 + i * 40, 400 - 3 * i)
    touch(panel, 'touchend', 1730)
    expect(onClose).not.toHaveBeenCalled()
    expect(panel.style.transform).toBe('')
  })

  it('a sideways or upward move leaves the sheet where it is', () => {
    const sideways = pull(panel, 30, { dx: 120 })
    expect(sideways.some((ev) => ev.defaultPrevented)).toBe(false)
    expect(panel.style.transform).toBe('')
    pull(panel, -200)
    expect(panel.style.transform).toBe('')
    expect(onClose).not.toHaveBeenCalled()
  })

  it('a sheet that stays open when asked to close (busy) springs back; one that closes does not', () => {
    pull(panel, 300, { steps: 20, stepMs: 40 })
    expect(onClose).toHaveBeenCalledTimes(1)
    vi.advanceTimersByTime(60)
    expect(panel.style.transform).toBe('')

    panel.state = 'open'
    onClose.mockImplementation(() => {
      panel.state = 'closed'
    })
    pull(panel, 300, { steps: 20, stepMs: 40 })
    vi.advanceTimersByTime(60)
    expect(panel.style.transform).toBe('translate3d(0, 300px, 0)')
  })

  it('a second finger cancels the pull and the sheet springs back', () => {
    touch(panel, 'touchstart', 0, 100)
    touch(panel, 'touchmove', 16, 200)
    const ev = new Event('touchmove', { cancelable: true })
    Object.defineProperty(ev, 'touches', { value: [{ clientX: 0, clientY: 200 }, { clientX: 50, clientY: 210 }] })
    panel.dispatchEvent(ev)
    expect(panel.style.transform).toBe('')
    touch(panel, 'touchend', 400)
    expect(onClose).not.toHaveBeenCalled()
  })

  it('once detached, the panel no longer moves', () => {
    detach()
    pull(panel, 300, { steps: 20, stepMs: 40 })
    expect(panel.style.transform).toBe('')
    expect(onClose).not.toHaveBeenCalled()
  })
})

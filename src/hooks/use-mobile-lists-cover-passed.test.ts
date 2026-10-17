import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { coverPassed, watchCoverPassed } from './use-mobile-lists-cover-passed'

/**
 * Gap list #25: the List view's slim bar shows once the cover has scrolled
 * off — its bottom edge gone up under the bar's bottom edge.
 */
describe('coverPassed', () => {
  // A 48px bar under a 47px notch: its bottom edge at 95.
  const BAR = 95

  it('the cover in view (the page at the top): no bar', () => {
    expect(coverPassed(247, BAR)).toBe(false)
  })

  it('the cover partly under the bar: no bar yet', () => {
    expect(coverPassed(120, BAR)).toBe(false)
  })

  it('the cover’s bottom meets the bar’s: the bar shows', () => {
    expect(coverPassed(95, BAR)).toBe(true)
  })

  it('the cover scrolled right off the top: the bar shows', () => {
    expect(coverPassed(-400, BAR)).toBe(true)
  })

  it('edges a fraction of a pixel apart count as meeting', () => {
    expect(coverPassed(95.4, 95.1)).toBe(true)
    expect(coverPassed(96.6, 95)).toBe(false)
  })
})

/**
 * The subscription the hook runs. The unit lane has no DOM, so document,
 * window and requestAnimationFrame are stand-ins that keep the DOM's rules
 * where they matter here:
 *  - A scroll on the app's scroller (`main`, a descendant) doesn't bubble.
 *    The document hears it only through a capturing listener.
 *  - A listener is removed only by the same type, callback and capture flag.
 *  - Frame callbacks run when the test says a frame has passed.
 */
describe('watchCoverPassed', () => {
  type Listener = { type: string; fn: () => void; capture: boolean }
  const captureOf = (opts?: boolean | { capture?: boolean }) =>
    typeof opts === 'boolean' ? opts : Boolean(opts?.capture)
  const eventTarget = () => {
    const listeners: Listener[] = []
    return {
      listeners,
      addEventListener: (type: string, fn: () => void, opts?: boolean | { capture?: boolean }) => {
        listeners.push({ type, fn, capture: captureOf(opts) })
      },
      removeEventListener: (type: string, fn: () => void, opts?: boolean | { capture?: boolean }) => {
        const capture = captureOf(opts)
        const at = listeners.findIndex((l) => l.type === type && l.fn === fn && l.capture === capture)
        if (at > -1) listeners.splice(at, 1)
      },
    }
  }

  let doc: ReturnType<typeof eventTarget>
  let win: ReturnType<typeof eventTarget> & {
    requestAnimationFrame: (cb: () => void) => number
    cancelAnimationFrame: (id: number) => void
  }
  let frames: Map<number, () => void>
  let nextFrame: number

  /** The app's scroller scrolled: only the document's capturing listeners hear it. */
  const scrollMain = () =>
    doc.listeners.filter((l) => l.type === 'scroll' && l.capture).forEach((l) => l.fn())
  const resize = () => win.listeners.filter((l) => l.type === 'resize').forEach((l) => l.fn())
  /** A frame passes: the queued callbacks run. */
  const flushFrame = () => {
    const due = [...frames.values()]
    frames.clear()
    due.forEach((cb) => cb())
  }

  // A 48px bar under a 47px notch (bottom edge at 95) over a 200px cover.
  let coverBottom = 247
  const BAR_BOTTOM = 95
  const cover = { current: { getBoundingClientRect: () => ({ bottom: coverBottom }) } }
  const bar = { current: { getBoundingClientRect: () => ({ bottom: BAR_BOTTOM }) } }

  beforeEach(() => {
    coverBottom = 247
    frames = new Map()
    nextFrame = 1
    doc = eventTarget()
    win = Object.assign(eventTarget(), {
      requestAnimationFrame: (cb: () => void) => {
        const id = nextFrame++
        frames.set(id, cb)
        return id
      },
      cancelAnimationFrame: (id: number) => {
        frames.delete(id)
      },
    })
    vi.stubGlobal('document', doc)
    vi.stubGlobal('window', win)
  })
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('reports the first reading at once: the page at the top, no bar', () => {
    const onChange = vi.fn()
    watchCoverPassed(cover, bar, onChange)
    expect(onChange.mock.calls).toEqual([[false]])
  })

  it('opened already scrolled past the cover: the bar shows at once', () => {
    coverBottom = -300
    const onChange = vi.fn()
    watchCoverPassed(cover, bar, onChange)
    expect(onChange.mock.calls).toEqual([[true]])
  })

  it('hears the app scroller through a capturing listener on the document', () => {
    watchCoverPassed(cover, bar, () => {})
    const scroll = doc.listeners.filter((l) => l.type === 'scroll')
    expect(scroll).toHaveLength(1)
    expect(scroll[0].capture).toBe(true)
  })

  it('scrolling the cover off shows the bar; scrolling back hides it', () => {
    const onChange = vi.fn()
    watchCoverPassed(cover, bar, onChange)
    onChange.mockClear()

    coverBottom = 120 // partly under the bar
    scrollMain()
    flushFrame()
    expect(onChange).not.toHaveBeenCalled()

    coverBottom = 95 // its bottom meets the bar's
    scrollMain()
    flushFrame()
    expect(onChange.mock.calls).toEqual([[true]])

    coverBottom = -800 // further down the list: no repeat
    scrollMain()
    flushFrame()
    expect(onChange.mock.calls).toEqual([[true]])

    coverBottom = 200 // back up to the cover
    scrollMain()
    flushFrame()
    expect(onChange.mock.calls).toEqual([[true], [false]])
  })

  it('reads once a frame, however many scroll events arrive in it', () => {
    const read = vi.fn(() => ({ bottom: coverBottom }))
    watchCoverPassed({ current: { getBoundingClientRect: read } }, bar, () => {})
    read.mockClear()
    scrollMain()
    scrollMain()
    scrollMain()
    expect(frames.size).toBe(1)
    expect(read).not.toHaveBeenCalled() // nothing read until the frame
    flushFrame()
    expect(read).toHaveBeenCalledTimes(1)
  })

  it('a resize (rotating the phone) re-reads the edges too', () => {
    const onChange = vi.fn()
    watchCoverPassed(cover, bar, onChange)
    coverBottom = 60
    resize()
    flushFrame()
    expect(onChange.mock.calls).toEqual([[false], [true]])
  })

  it('nothing is reported while the cover or bar is missing, and it picks them up once there', () => {
    const onChange = vi.fn()
    const lateBar: { current: { getBoundingClientRect: () => { bottom: number } } | null } = { current: null }
    watchCoverPassed(cover, lateBar, onChange)
    expect(onChange).not.toHaveBeenCalled()
    lateBar.current = bar.current
    coverBottom = 10
    scrollMain()
    flushFrame()
    expect(onChange.mock.calls).toEqual([[true]])
  })

  it('unsubscribing removes both listeners and drops a pending frame', () => {
    const onChange = vi.fn()
    const stop = watchCoverPassed(cover, bar, onChange)
    onChange.mockClear()
    coverBottom = 10
    scrollMain() // a frame is queued
    stop()
    expect(doc.listeners).toHaveLength(0)
    expect(win.listeners).toHaveLength(0)
    expect(frames.size).toBe(0)
    flushFrame()
    scrollMain()
    resize()
    flushFrame()
    expect(onChange).not.toHaveBeenCalled()
  })
})

/**
 * FieldScout Mobile — Lists: keeps two sideways scrollers in step (gap list
 * #25). On the List view these are the column names pinned under the slim bar
 * and the table under them. Each scrolls on its own, so whichever one moves
 * drags the other with it.
 *
 * Copying A's position onto B makes B fire a scroll event of its own. If
 * that event were copied back onto A, a fling on A would stutter: by the time
 * the event arrives, A has coasted further, and the write pulls it back. So
 * each copy records where it put the other scroller. When that scroller's
 * next event reads the same place, it is the copy arriving (an echo) and
 * nothing is copied back. Any other position means the scroller moved by
 * itself, through a swipe or a fling still coasting, and it leads.
 *
 * This replaces picking a leader by where the finger last went down. That
 * missed one case: fling the table, then touch the names to scroll the page.
 * The table kept coasting while the names froze, so the pinned labels sat
 * over the wrong columns.
 */

/** What the sync reads and writes: an element, or a stub in a test. */
export interface SidewaysScroller {
  scrollLeft: number
}

export type SidewaysSide = 'head' | 'body'

export interface SidewaysSync {
  /** Call from a scroller's scroll event. */
  scrolled: (side: SidewaysSide) => void
  /** Puts the other scroller where `from` is (e.g. after the columns change). */
  copy: (from: SidewaysSide) => void
}

/** Within a pixel counts as the copy arriving: a fractional device pixel
 *  ratio can round the written position. */
const ECHO_SLACK = 1

const other = (side: SidewaysSide): SidewaysSide => (side === 'head' ? 'body' : 'head')

export function createSidewaysSync(scroller: (side: SidewaysSide) => SidewaysScroller | null): SidewaysSync {
  // Where the last copy put each scroller, until its echo arrives.
  const expected: Record<SidewaysSide, number | null> = { head: null, body: null }

  const copy = (from: SidewaysSide) => {
    const to = other(from)
    const source = scroller(from)
    const target = scroller(to)
    if (!source || !target) return
    const before = target.scrollLeft
    if (before === source.scrollLeft) return
    target.scrollLeft = source.scrollLeft
    // Read back: the browser may clamp the value at the scroller's end or
    // round it. If it didn't move, no event comes, so nothing is expected.
    const after = target.scrollLeft
    if (after !== before) expected[to] = after
  }

  const scrolled = (side: SidewaysSide) => {
    const self = scroller(side)
    if (!self) return
    const want = expected[side]
    if (want !== null) {
      expected[side] = null
      if (Math.abs(self.scrollLeft - want) < ECHO_SLACK) return
    }
    copy(side)
  }

  return { scrolled, copy }
}

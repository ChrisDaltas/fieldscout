import { readFileSync } from 'node:fs'
import path from 'node:path'

import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  WINDOW_CASCADE_ORIGIN,
  WINDOW_CASCADE_STEP_X,
  WINDOW_CASCADE_STEP_Y,
  WINDOW_CASCADE_WRAP,
  WINDOW_DEFAULT_H,
  WINDOW_DEFAULT_W,
  WINDOW_EDGE_KEEP_X,
  WINDOW_EDGE_KEEP_Y,
  WINDOW_EDGE_MARGIN,
  WINDOW_MAX_H,
  WINDOW_MAX_W,
  WINDOW_MIN_H,
  WINDOW_MIN_W,
  WINDOW_MOBILE_HEIGHT_RATIO,
  WINDOW_MOBILE_MAX_W,
  cascadePlacement,
  clampWindowSize,
  isSmallViewport,
  resolveWindowGeometry,
  useListWindowsStore,
} from '@/stores/list-windows-store'

/**
 * LV.15 — the pop-out store and its geometry maths, **executed**.
 *
 * The window and the host are `.tsx`, which this repo's vitest cannot parse
 * (Next's `jsx: "preserve"`, R191) — so everything that could be a decision
 * rather than markup was deliberately put in the `.ts` beside them and is run
 * for real here: the z-stack, the refocus rule, the clamps, the cascade, the
 * viewport rescue, and **what `partialize` actually writes to storage**. The
 * JSX that remains is pinned as source in
 * `src/components/lists/v2/list-windows-host.test.ts`.
 *
 * Three properties are worth stating plainly, because each is a place this
 * build has been bitten before:
 *
 *   1. **`windows` never reaches storage.** D13 says pop-outs persist their
 *      geometry and never their existence, and the difference is only visible
 *      after a reload — so it is driven through the *real* persist middleware
 *      with an observable storage, not argued from the shape of `partialize`.
 *   2. **The array order is the z-stack.** There is no `z` field to disagree
 *      with it (see the store's header), so `focus` moving an entry to the end
 *      is the whole mechanism, and it is tested as such.
 *   3. **The clamps are the design's numbers × 0.8.** A converted constant is
 *      one typo away from silently being the un-converted one, and 1200 vs 960
 *      would look plausible for months.
 */

/**
 * A real `localStorage`, installed **before the store module is imported**.
 *
 * `persist` reads **`window.localStorage`** when the store is created and,
 * finding none under vitest's node environment, degrades to a plain store with
 * no `.persist` API at all — so a suite that skipped this would be testing an
 * unpersisted store and calling it proof of what persistence writes. (Observed
 * twice while writing this file: without the hoist `useListWindowsStore.persist`
 * is `undefined`, and stubbing the bare `localStorage` global is not enough —
 * `zustand/middleware` reads it off `window`, which is the same hole R179 found
 * in `list-display-store.test.ts`.)
 */
const stored = vi.hoisted(() => {
  const data = new Map<string, string>()
  const localStorage = {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => void data.set(key, value),
    removeItem: (key: string) => void data.delete(key),
    clear: () => data.clear(),
    key: () => null,
    get length() {
      return data.size
    },
  }
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: localStorage })
  Object.defineProperty(globalThis, 'window', { configurable: true, value: { localStorage } })
  return data
})

const LIST_A = 'list-aaa'
const LIST_B = 'list-bbb'
const LIST_C = 'list-ccc'
const STORAGE_KEY = 'fieldscout.list-windows'

const read = (file: string) => readFileSync(path.resolve(process.cwd(), file), 'utf8')

/** Comments stripped, so a pin cannot be satisfied by the prose about it. */
const code = (file: string) =>
  read(file).replace(/\/\*[\s\S]*?\*\/|(^|[^:])\/\/.*$/gm, (_match, before) => before ?? '')

const STORE = 'src/stores/list-windows-store.ts'
const PRECEDENT = 'src/stores/player-windows-store.ts'

const ids = () => useListWindowsStore.getState().windows.map((w) => w.listId)

afterEach(() => {
  useListWindowsStore.setState({ windows: [], geometry: {} })
  stored.clear()
})

describe('LV.15 — the z-stack is the array, back-to-front (D13)', () => {
  it('opening appends to the front and keeps one window per list', () => {
    const { open } = useListWindowsStore.getState()
    open(LIST_A)
    open(LIST_B)
    expect(ids()).toEqual([LIST_A, LIST_B])

    // Re-opening refocuses rather than duplicating — the precedent's rule.
    open(LIST_A)
    expect(ids()).toEqual([LIST_B, LIST_A])
    expect(ids().filter((id) => id === LIST_A)).toHaveLength(1)
  })

  /**
   * **LV.17 — "what happens at 6+ windows" is: nothing special, on purpose.**
   *
   * No cap, no eviction, no truncation — Q4's ruling (Chris, 2026-08-11: no cap
   * on the comparison picker) applied to the surface one screen away, and what
   * the LAW asks for in its opening line: *"Open several and set them side by
   * side."* The only thing the sixth window changes is **placement**, and the
   * store answers that by wrapping the cascade rather than marching off the
   * bottom-right corner.
   *
   * This is executed rather than pinned as source, which is the point of having
   * a `.ts` store: a cap added later fails here, however it is spelled.
   */
  it('there is no cap — the twelfth window opens like the first', () => {
    const { open } = useListWindowsStore.getState()
    for (let i = 0; i < 12; i += 1) open(`list-${i}`)
    expect(ids()).toHaveLength(12)
    expect(ids()[0]).toBe('list-0')
    expect(ids()[11]).toBe('list-11')

    // …and the seventh lands back on the first rather than off-screen. The pile
    // is still navigable: the last entry is the only `isTop`, so Escape unwinds
    // it one press at a time (`list-windows-host.tsx`).
    const viewport = { width: 1280, height: 900 }
    for (let i = 0; i < 6; i += 1) {
      const first = resolveWindowGeometry(undefined, i, viewport)
      const seventh = resolveWindowGeometry(undefined, i + WINDOW_CASCADE_WRAP, viewport)
      expect({ x: seventh.x, y: seventh.y }).toEqual({ x: first.x, y: first.y })
    }
  })

  it('focus moves a buried window to the end, and is a no-op for the top one', () => {
    const { open, focus } = useListWindowsStore.getState()
    open(LIST_A)
    open(LIST_B)
    open(LIST_C)

    focus(LIST_A)
    expect(ids()).toEqual([LIST_B, LIST_C, LIST_A])

    const before = useListWindowsStore.getState().windows
    focus(LIST_A)
    // Same array by reference: zustand v5 subscribes through
    // useSyncExternalStore, so a fresh array on a no-op re-renders every window
    // on every pointer-down.
    expect(useListWindowsStore.getState().windows).toBe(before)
  })

  it('focusing a list with no window open changes nothing', () => {
    const { open, focus } = useListWindowsStore.getState()
    open(LIST_A)
    const before = useListWindowsStore.getState().windows
    focus(LIST_B)
    expect(useListWindowsStore.getState().windows).toBe(before)
    expect(ids()).toEqual([LIST_A])
  })

  it('closing removes only that window; closeAll empties the stack', () => {
    const { open, close, closeAll } = useListWindowsStore.getState()
    open(LIST_A)
    open(LIST_B)
    close(LIST_A)
    expect(ids()).toEqual([LIST_B])
    closeAll()
    expect(ids()).toEqual([])
  })

  it('closing a window keeps its geometry — that is the point of the split', () => {
    const { open, setPosition, setSize, setMinimized, close } = useListWindowsStore.getState()
    open(LIST_A)
    setPosition(LIST_A, { x: 210, y: 140 })
    setSize(LIST_A, { w: 500, h: 300 })
    setMinimized(LIST_A, true)
    close(LIST_A)

    expect(ids()).toEqual([])
    expect(useListWindowsStore.getState().geometry[LIST_A]).toEqual({
      x: 210,
      y: 140,
      w: 500,
      h: 300,
      min: true,
    })
  })

  it('the setters merge rather than replace — a drag must not forget the size', () => {
    const { setSize, setPosition } = useListWindowsStore.getState()
    setSize(LIST_A, { w: 500, h: 300 })
    setPosition(LIST_A, { x: 12, y: 34 })
    expect(useListWindowsStore.getState().geometry[LIST_A]).toEqual({
      w: 500,
      h: 300,
      x: 12,
      y: 34,
    })
  })
})

describe('LV.15 — the clamps are the design LAW’s numbers at this app’s ×0.8', () => {
  /**
   * `330–1200 × 220–900` (design LAW §"Pop-out window" → *Resize*) in the
   * prototype's 1× coordinate space. The prototype shell renders at `zoom: 0.8`
   * and this app paints the scaled result directly, so the bounds convert with
   * everything else they bound.
   */
  it('264–960 × 176–720 is 330–1200 × 220–900 × 0.8, to the pixel', () => {
    expect([WINDOW_MIN_W, WINDOW_MAX_W, WINDOW_MIN_H, WINDOW_MAX_H]).toEqual(
      [330, 1200, 220, 900].map((n) => n * 0.8),
    )
    expect([WINDOW_DEFAULT_W, WINDOW_DEFAULT_H]).toEqual([440, 520].map((n) => n * 0.8))
  })

  it('clamps at both ends, and exactly at the boundary', () => {
    // Literal, not `WINDOW_MAX_W` — every other assertion here is written in
    // terms of the constants, so a constant that drifted back to the design's
    // un-converted 1200 would take them all with it and only the arithmetic pin
    // above would notice. (It did: probe 2 reddened exactly one test.)
    expect(clampWindowSize({ w: 5000, h: 5000 })).toEqual({ w: 960, h: 720 })
    expect(clampWindowSize({ w: 1, h: 1 })).toEqual({ w: 264, h: 176 })

    expect(clampWindowSize({ w: 10, h: 10 })).toEqual({ w: WINDOW_MIN_W, h: WINDOW_MIN_H })
    expect(clampWindowSize({ w: 9999, h: 9999 })).toEqual({ w: WINDOW_MAX_W, h: WINDOW_MAX_H })
    // The bounds themselves are legal — a clamp that is exclusive at the edge
    // makes the maximum unreachable by dragging.
    expect(clampWindowSize({ w: WINDOW_MIN_W, h: WINDOW_MAX_H })).toEqual({
      w: WINDOW_MIN_W,
      h: WINDOW_MAX_H,
    })
    // One pixel outside on each side really does move.
    expect(clampWindowSize({ w: WINDOW_MIN_W - 1, h: WINDOW_MAX_H + 1 })).toEqual({
      w: WINDOW_MIN_W,
      h: WINDOW_MAX_H,
    })
    // Sub-pixel drags round rather than persisting 352.40000000000003.
    expect(clampWindowSize({ w: 400.4, h: 300.6 })).toEqual({ w: 400, h: 301 })
  })

  it('the store clamps on the way in, so no illegal size can be persisted', () => {
    const { setSize } = useListWindowsStore.getState()
    setSize(LIST_A, { w: 4000, h: 4000 })
    expect(useListWindowsStore.getState().geometry[LIST_A]).toEqual({
      w: WINDOW_MAX_W,
      h: WINDOW_MAX_H,
    })
    setSize(LIST_A, { w: 1, h: 1 })
    expect(useListWindowsStore.getState().geometry[LIST_A]).toEqual({
      w: WINDOW_MIN_W,
      h: WINDOW_MIN_H,
    })
  })
})

describe('LV.15 — where a window opens, and how a remembered one is rescued', () => {
  it('cascades down-right from 96,96 and wraps after six', () => {
    expect(cascadePlacement(0)).toEqual({
      x: WINDOW_CASCADE_ORIGIN,
      y: WINDOW_CASCADE_ORIGIN,
    })
    expect(cascadePlacement(2)).toEqual({
      x: WINDOW_CASCADE_ORIGIN + 2 * WINDOW_CASCADE_STEP_X,
      y: WINDOW_CASCADE_ORIGIN + 2 * WINDOW_CASCADE_STEP_Y,
    })
    // The seventh starts over rather than marching off the corner.
    expect(cascadePlacement(WINDOW_CASCADE_WRAP)).toEqual(cascadePlacement(0))
    expect([WINDOW_CASCADE_ORIGIN, WINDOW_CASCADE_STEP_X, WINDOW_CASCADE_STEP_Y]).toEqual(
      [120, 46, 34].map((n) => Math.round(n * 0.8)),
    )
  })

  it('an untouched list opens at the cascade, at the design’s default size', () => {
    expect(resolveWindowGeometry(undefined, 0, { width: 1280, height: 900 })).toEqual({
      x: WINDOW_CASCADE_ORIGIN,
      y: WINDOW_CASCADE_ORIGIN,
      w: WINDOW_DEFAULT_W,
      h: WINDOW_DEFAULT_H,
      min: false,
    })
  })

  it('remembered geometry wins over the cascade, in every field independently', () => {
    expect(
      resolveWindowGeometry({ x: 300, y: 200, w: 500, h: 480, min: true }, 3, {
        width: 1280,
        height: 900,
      }),
    ).toEqual({ x: 300, y: 200, w: 500, h: 480, min: true })

    // A half-filled entry — dragged but never resized — keeps the defaults for
    // the rest rather than falling back wholesale to the cascade.
    expect(
      resolveWindowGeometry({ x: 300, y: 200 }, 3, { width: 1280, height: 900 }),
    ).toEqual({
      x: 300,
      y: 200,
      w: WINDOW_DEFAULT_W,
      h: WINDOW_DEFAULT_H,
      min: false,
    })
  })

  /**
   * A window remembered at 1200,700 on a desktop, re-opened on a 375px phone,
   * must not be unreachable — you would have no way to close it. Ported from
   * `window-shell.tsx`'s `resolveInitialPosition`, which the player mini card
   * has done since it shipped.
   */
  it('rescues a remembered position that the current viewport can no longer show', () => {
    const geo = resolveWindowGeometry({ x: 1200, y: 700 }, 0, { width: 375, height: 812 })
    expect(geo.x).toBe(375 - WINDOW_EDGE_KEEP_X)
    expect(geo.y).toBe(700)
    // Still grabbable: at least WINDOW_EDGE_KEEP_X of the window is on screen.
    expect(geo.x + geo.w).toBeGreaterThanOrEqual(WINDOW_EDGE_KEEP_X)
    expect(geo.x).toBeLessThanOrEqual(375 - WINDOW_EDGE_KEEP_X)
  })

  /**
   * The one concession this task makes to small screens, and it is not a phone
   * variant: the cascade origin is 96, so a 352px window on a 375px viewport
   * would open at 96–448 with its **close button off-screen** — reachable only
   * by discovering that the header drags. A window *we* placed lands where it
   * fits; a window the *user* placed is left where they put it (next test).
   * The mobile answer proper is LV.17's.
   */
  it('a cascaded window is pulled back so the whole of it fits, when it can', () => {
    const phone = resolveWindowGeometry(undefined, 0, { width: 375, height: 812 })
    expect(phone.x).toBe(375 - WINDOW_DEFAULT_W - 8)
    expect(phone.x + phone.w).toBeLessThanOrEqual(375)

    // Desktop is untouched: the design's origin already fits.
    expect(resolveWindowGeometry(undefined, 0, { width: 1280, height: 900 }).x).toBe(
      WINDOW_CASCADE_ORIGIN,
    )
    // A short viewport does the same vertically.
    expect(resolveWindowGeometry(undefined, 0, { width: 1280, height: 500 }).y).toBe(
      500 - WINDOW_DEFAULT_H - 8,
    )
    // And when the window genuinely cannot fit, it hugs the edge rather than
    // going negative. 200 is narrower than the LAW's 264px minimum, so the
    // size cannot shrink any further to help.
    expect(resolveWindowGeometry(undefined, 0, { width: 200, height: 812 }).x).toBe(8)
  })

  /**
   * **LV.17 — the size half of the same rule (F-LV15.3).**
   *
   * LV.15 fitted the *position* of a window the store placed. That is not
   * enough on a viewport narrower than the window itself: `list-window.tsx`
   * caps the painted box at `100vw - 16px`, so the store would go on saying 352
   * while the screen shows 304, and the resize grip reads the store. Fitting
   * the size keeps the model and the paint agreeing.
   */
  it('a cascaded window is SIZED to fit too, and never below the LAW’s minimum', () => {
    // 320px phone: 352 does not fit, 320 − 16 does.
    const narrow = resolveWindowGeometry(undefined, 0, { width: 320, height: 812 })
    expect(narrow.w).toBe(320 - 2 * 8)
    expect(narrow.x + narrow.w).toBeLessThanOrEqual(320)

    // 375px phone: the design's default already fits, so it is untouched — the
    // conversion is not re-derived per viewport.
    expect(resolveWindowGeometry(undefined, 0, { width: 375, height: 812 }).w).toBe(
      WINDOW_DEFAULT_W,
    )

    // A short viewport does the same vertically.
    expect(resolveWindowGeometry(undefined, 0, { width: 1280, height: 300 }).h).toBe(300 - 2 * 8)

    // Below the LAW's minimum the clamp wins: a 200px-wide window is not a
    // window, and the frame's `max-w` covers the overflow instead.
    expect(resolveWindowGeometry(undefined, 0, { width: 200, height: 120 })).toMatchObject({
      w: WINDOW_MIN_W,
      h: WINDOW_MIN_H,
    })

    // **Desktop is bit-identical**, which is the whole claim that this is
    // minimum-necessary rather than a mobile variant.
    expect(resolveWindowGeometry(undefined, 0, { width: 1280, height: 900 })).toEqual({
      x: WINDOW_CASCADE_ORIGIN,
      y: WINDOW_CASCADE_ORIGIN,
      w: WINDOW_DEFAULT_W,
      h: WINDOW_DEFAULT_H,
      min: false,
    })
  })

  it('a size the user chose is NOT re-fitted either', () => {
    // Resized to 900 wide on a desktop, then opened on a 375px phone: the store
    // still says 900. Below `WINDOW_MOBILE_MAX_W` the ruled bottom sheet ignores
    // the stored box entirely and writes back neither position nor size
    // (Ruling 2 — it *does* write `min`, see the R257 pin below); on a narrow
    // *desktop* the frame's `max-w` paints it narrower and the grip reads the
    // paint (`list-window.tsx`). Either way the remembered size is theirs and
    // survives the trip back to a big screen.
    expect(
      resolveWindowGeometry({ w: 900, h: 700 }, 0, { width: 375, height: 812 }),
    ).toMatchObject({ w: 900, h: 700 })

    // Half an entry is still the user's: `setSize` writes both, so either one
    // present means they sized it.
    expect(resolveWindowGeometry({ w: 900 }, 0, { width: 375, height: 812 }).w).toBe(900)
  })

  it('a position the user chose is NOT re-fitted, only rescued', () => {
    // 352 wide at x = 200 on a 375px phone hangs off the right, and stays
    // there: they dragged it, and 100px is still grabbable.
    const dragged = resolveWindowGeometry({ x: 200, y: 400 }, 0, { width: 375, height: 812 })
    expect(dragged.x).toBe(200)
    expect(dragged.y).toBe(400)
  })

  it('rescues one dragged off the left edge, and never above the top', () => {
    const left = resolveWindowGeometry({ x: -900, y: -50 }, 0, { width: 1280, height: 900 })
    expect(left.x).toBe(-left.w + WINDOW_EDGE_KEEP_X)
    expect(left.y).toBe(0)

    const low = resolveWindowGeometry({ x: 0, y: 5000 }, 0, { width: 1280, height: 900 })
    expect(low.y).toBe(900 - WINDOW_EDGE_KEEP_Y)
  })

  it('a short viewport cannot push the window to a negative y', () => {
    // A 20px-tall viewport is absurd, but `height - 48` is negative there and a
    // window at y = -28 has no reachable header at all.
    expect(resolveWindowGeometry({ x: 0, y: 10 }, 0, { width: 320, height: 20 }).y).toBe(0)
  })

  it('with no viewport (the server) it resolves without clamping', () => {
    expect(resolveWindowGeometry({ x: 1200, y: 700 }, 0, null)).toEqual({
      x: 1200,
      y: 700,
      w: WINDOW_DEFAULT_W,
      h: WINDOW_DEFAULT_H,
      min: false,
    })
  })
})

/**
 * **Ruling 2 (Chris, 2026-08-12) — the mobile variant's one number, executed.**
 *
 * > *"On a mobile the pop out window is full width but only 60% of the screen
 * > height."*
 *
 * The *shape* of that variant is CSS and is source-pinned in
 * `list-windows-host.test.ts`; what lives here is the only part of it that is a
 * decision rather than markup — **which viewports get it**. It is in the store
 * for R191's reason: a breakpoint left inside a `.tsx` is guarded by nothing in
 * this repo, and "below `md`" is exactly the kind of number that is quietly
 * re-tuned to `lg` a task later.
 */
describe('Ruling 2 — which viewports get the mobile variant, and which do not', () => {
  it('is a strict `< 768`, so the boundary itself is a desktop window', () => {
    expect(WINDOW_MOBILE_MAX_W).toBe(768)
    // A phone, portrait and landscape…
    expect(isSmallViewport({ width: 375, height: 812 })).toBe(true)
    expect(isSmallViewport({ width: 812, height: 375 })).toBe(false)
    // …the boundary, exactly, from both sides.
    expect(isSmallViewport({ width: 767, height: 1024 })).toBe(true)
    expect(isSmallViewport({ width: 768, height: 1024 })).toBe(false)
    // …a tablet and a laptop keep the floating window the design LAW describes.
    expect(isSmallViewport({ width: 1024, height: 768 })).toBe(false)
    expect(isSmallViewport({ width: 1280, height: 900 })).toBe(false)
  })

  it('the server is not a phone — and nothing depends on that being right', () => {
    // `windows` is never persisted, so no window exists at SSR or at hydration
    // on any route; this is the safe default rather than a load-bearing one.
    expect(isSmallViewport(null)).toBe(false)
  })

  it('60% of the height is a ratio, so the ruling and the class cannot drift', () => {
    expect(WINDOW_MOBILE_HEIGHT_RATIO).toBe(0.6)
    // `list-windows-host.test.ts` builds `h-[60dvh]` from this number rather
    // than restating it, which is what makes that the same claim as this one.
    expect(`h-[${WINDOW_MOBILE_HEIGHT_RATIO * 100}dvh]`).toBe('h-[60dvh]')
  })

  it('the phone variant costs the desktop nothing — the maths is untouched', () => {
    // The rescue and the fit are the *desktop* answer and Ruling 2 does not
    // re-tune them: a 375px viewport still resolves exactly as it did before,
    // because on a phone nothing reads the result.
    expect(resolveWindowGeometry(undefined, 0, { width: 375, height: 812 })).toEqual({
      // 352 already fits inside 375 − 2×8, so the size is the design's default…
      w: WINDOW_DEFAULT_W,
      h: WINDOW_DEFAULT_H,
      // …and the cascade's 96 is pulled left to the last x that shows the whole
      // window: 375 − 352 − 8. The vertical has room, so 96 stands.
      x: 375 - WINDOW_DEFAULT_W - WINDOW_EDGE_MARGIN,
      y: WINDOW_CASCADE_ORIGIN,
      min: false,
    })
  })
})

describe('LV.15 — pop-outs persist their geometry, never their existence (D13)', () => {
  /**
   * Driven through the real `persist` middleware. `partialize` is not called
   * directly and the assertion is on the JSON that reaches storage, because the
   * failure this guards — a reload reopening every window you closed — is only
   * observable at that boundary.
   */
  it('the middleware is really installed — otherwise everything below is vacuous', () => {
    expect(useListWindowsStore.persist).toBeTypeOf('object')
    expect(useListWindowsStore.persist.getOptions().name).toBe(STORAGE_KEY)
  })

  it('what reaches storage is geometry, and nothing else', () => {
    const { open, setPosition, setSize, setMinimized } = useListWindowsStore.getState()
    open(LIST_A)
    open(LIST_B)
    setPosition(LIST_A, { x: 210, y: 140 })
    setSize(LIST_A, { w: 500, h: 300 })
    setMinimized(LIST_A, true)

    const raw = stored.get(STORAGE_KEY)
    expect(raw).toBeTruthy()
    const persisted = JSON.parse(raw!) as { state: Record<string, unknown> }

    expect(Object.keys(persisted.state)).toEqual(['geometry'])
    expect(persisted.state.geometry).toEqual({
      [LIST_A]: { x: 210, y: 140, w: 500, h: 300, min: true },
    })
    // The open stack is what must NOT survive: two windows are open right now
    // and the payload knows about neither.
    expect(raw).not.toContain('windows')
    expect(raw).not.toContain(LIST_B)
  })

  /**
   * **R257 — `min` *is* geometry, and a phone writes it.**
   *
   * Six places in this repo claimed *"no geometry is written from a phone"*,
   * one of them the delivery plan's v6.0 changelog. It was false, and the two
   * pointer-down gates the claim rested on could not see it: Ruling 2 moved
   * **Collapse** into the Options menu, and `setMinimized` writes into the same
   * `geometry[listId]` record `partialize` persists. Measured live at 375 × 812
   * — tapping Options → Collapse took `{x:397, y:270, w:406, h:436, min:false}`
   * to `{…, min:true}` in `fieldscout.list-windows`.
   *
   * **The write is kept**, because `min` is a per-window state the user
   * expressed and remembering it is the same promise position and size make;
   * removing it from the persisted slice would change *desktop* behaviour that
   * LV.15 shipped and two reviews upheld, for no ruling. So the claim is
   * narrowed to *"no position or size"* — and this is the executed half of that
   * narrowing: the part that is true, plus the behavioural consequence it
   * causes. The negative half (nothing writes position or size from a phone)
   * is a source pin, in `list-windows-host.test.ts`.
   */
  it('collapse alone reaches storage — the one write a phone makes (R257)', () => {
    const { open, setMinimized } = useListWindowsStore.getState()
    open(LIST_A)
    // Ruling 2's Options → Collapse, and nothing else. No drag, no resize:
    // those are the two writes a phone cannot reach.
    setMinimized(LIST_A, true)

    const persisted = JSON.parse(stored.get(STORAGE_KEY)!) as {
      state: { geometry: Record<string, Record<string, unknown>> }
    }
    // `min` alone, in the persisted record — so the phone did write to
    // `fieldscout.list-windows`, and it wrote nothing else.
    expect(persisted.state.geometry[LIST_A]).toEqual({ min: true })

    // **The consequence, not a proxy for it**: `resolveWindowGeometry` is what a
    // window calls on mount, so this is a desktop window opening over the record
    // a phone left. Collapse a sheet at 375, widen past 768, and it comes back
    // collapsed.
    expect(
      resolveWindowGeometry(useListWindowsStore.getState().geometry[LIST_A], 0, {
        width: 1280,
        height: 900,
      }).min,
    ).toBe(true)
  })

  it('a rehydrated store is a clean page with the geometry remembered', async () => {
    // Seeded *after* the setState: every state change writes through the
    // middleware, so seeding first would be overwritten before rehydration read
    // it — and the test would then prove nothing while looking green.
    useListWindowsStore.setState({ windows: [{ listId: LIST_C }], geometry: {} })
    stored.set(
      STORAGE_KEY,
      JSON.stringify({ state: { geometry: { [LIST_A]: { x: 210, y: 140 } } }, version: 0 }),
    )
    await useListWindowsStore.persist.rehydrate()

    expect(useListWindowsStore.getState().geometry[LIST_A]).toEqual({ x: 210, y: 140 })
    // Rehydration merges the persisted slice over the current state, so the only
    // reason no window opens on a reload is that `windows` was never written —
    // which is exactly the property above. (`LIST_C` is here only because this
    // test put it there; a real reload starts from `windows: []`.)
    expect(ids()).toEqual([LIST_C])
  })
})

describe('LV.15 — the convention is the precedent’s, not a second one (D11/D13)', () => {
  it('mirrors player-windows-store: same array-as-z-stack, same partialize idiom', () => {
    const mine = code(STORE)
    const theirs = code(PRECEDENT)

    for (const shape of [
      'windows: [],',
      'const rest = state.windows.filter(',
      'const top = state.windows[state.windows.length - 1]',
      'closeAll: () => set({ windows: [] }),',
    ]) {
      expect(theirs, shape).toContain(shape)
      expect(mine, shape).toContain(shape)
    }

    expect(mine).toContain('partialize: (state) => ({ geometry: state.geometry })')
    expect(theirs).toContain('partialize: (state) => ({ positions: state.positions })')
  })

  /**
   * The handoff's entry carries a `z`; here the index *is* `z` (store header).
   * A future `z` field would be a second source of truth for stacking, and the
   * one that is not the render order is the one that silently wins.
   */
  it('there is no z field to disagree with the array order', () => {
    const mine = code(STORE)
    expect(mine).not.toMatch(/\bz\??:\s*number/)
    expect(mine).not.toMatch(/Date\.now\(\)/)
  })

  it('the comment stripper is doing its job (control for the two pins above)', () => {
    const mine = code(STORE)
    expect(mine).toContain('export function clampWindowSize')
    // The header explains the `z` decision in prose that names the very shapes
    // the pin above forbids — so without a working stripper that pin is red for
    // the documentation, and the obvious "fix" is to weaken it. Both halves are
    // asserted so this control cannot itself pass for the wrong reason.
    for (const phrase of ['the index of `windows`', 'literal `Date.now()` stamp']) {
      expect(read(STORE), phrase).toContain(phrase)
      expect(mine, phrase).not.toContain(phrase)
    }
  })
})

import { create } from 'zustand'
import { persist } from 'zustand/middleware'

/**
 * Lists v2 — the pop-out window store (LV.15, delivery-plan-lists-v2.md §6,
 * **D13**).
 *
 * ## This is `player-windows-store.ts` with size and collapse added
 *
 * D13 is explicit that Round 2 **follows** the shape the player mini card
 * already settled rather than inventing a second windowing convention, and D11
 * is the standing correction that made that a rule: a parallel tree is how LV.7
 * silently lost four capabilities. So every structural decision below is that
 * file's, and only the remembered fields differ:
 *
 * | Decision | Here | `player-windows-store.ts` |
 * | --- | --- | --- |
 * | open windows | `windows[]`, **ordered back-to-front** | same |
 * | one window per entity | keyed by `listId` | keyed by `playerId` |
 * | re-opening an open one | refocuses, never duplicates | same |
 * | what survives a reload | geometry only, via `partialize` | positions only |
 * | what a reload does | leaves you on a clean page | same |
 *
 * The only additions are `w`, `h` and `min`, which is exactly what D13 says
 * Round 2 adds: *"Round 2's store adds size and minimize to what is
 * remembered."*
 *
 * ## Where the handoff's `z` went
 *
 * The handoff's store shape is `popouts[{ id, x, y, w, h, z, min }]`
 * (`docs/design/lists/README.md` §State) and the prototype keeps `z` as a
 * literal `Date.now()` stamp it sorts by. **Here `z` is the array index**, for
 * the same reason the precedent made it one: two sources of truth for stacking
 * can disagree, and the one that is *not* the render order is the one that
 * silently wins. D13 asks for "an array ordered back-to-front as the z-stack"
 * in as many words, so the field is not dropped so much as spelled differently:
 *
 * | Handoff field | Lives here as |
 * | --- | --- |
 * | `id` | `windows[i].listId` |
 * | `x`, `y` | `geometry[id].x/y` — persisted |
 * | `w`, `h` | `geometry[id].w/h` — persisted, clamped by {@link clampWindowSize} |
 * | `min` | `geometry[id].min` — persisted |
 * | `z` | **the index of `windows`**, back-to-front. `focus()` moves an entry to the end; the host paints in that order |
 *
 * ## The ×0.8 conversion, and which numbers are *not* converted
 *
 * The prototype shell renders at `zoom: 0.8` (`docs/design/lists/README.md`
 * §Fidelity, and `ListsCommon.jsx`'s own `const ZOOM = 0.8`), so every number
 * in the handoff is a 1× coordinate that paints 0.8× on screen; this app paints
 * the scaled result directly, as `window-shell.tsx` already does for the mini
 * card (*"380px wide … rendered at 0.8 zoom — we paint the scaled result"*).
 * The window's own geometry lives in the same coordinate space as the chrome it
 * bounds — a 960px window shows as many stat columns as the design's 1200px one
 * does, because those columns converted too — so **the clamps convert**:
 *
 * | Handoff (1×) | Here | Why |
 * | --- | --- | --- |
 * | default `440 × 520` | `352 × 416` | window geometry |
 * | clamp `330–1200 × 220–900` | `264–960 × 176–720` | same coordinate space as the content it sizes |
 * | cascade `120 + n·46, 120 + n·34` | `96 + n·37, 96 + n·27` | placement is geometry |
 * | pointer deltas (`clientX / ZOOM`) | **no division** | a pointer coordinate is a physical viewport pixel; this app has no zoom to undo |
 * | the 16px resize grip | **16px, unconverted** | a hit target, not a rhythm measure — see `list-window.tsx` |
 *
 * ## Not persisted, deliberately
 *
 * `windows` is left out of storage on the same reasoning as the precedent and
 * as **D3**: which windows are open is display state. A reload leaves a clean
 * page; re-opening a list puts its window back where you left it, at the size
 * you left it, collapsed if you left it collapsed.
 */

export interface ListWindowState {
  /** The list this window shows. One window per list — re-opening refocuses. */
  listId: string
}

/**
 * Remembered geometry for one list. **Every field is optional**: an entry only
 * ever holds what the user has actually changed, so an untouched window falls
 * through to the cascade and the defaults (see {@link resolveWindowGeometry}).
 * The precedent's `positions` record works the same way.
 */
export interface ListWindowGeometry {
  x?: number
  y?: number
  w?: number
  h?: number
  min?: boolean
}

/** Geometry with every fallback applied — what a window actually renders at. */
export interface ResolvedWindowGeometry {
  x: number
  y: number
  w: number
  h: number
  min: boolean
}

export interface WindowViewport {
  width: number
  height: number
}

// ---------------------------------------------------------------------------
// The design's numbers, at this app's ×0.8 (see the header table)
// ---------------------------------------------------------------------------

/** 330 × 0.8 — the design LAW's minimum width. */
export const WINDOW_MIN_W = 264
/** 1200 × 0.8 — the design LAW's maximum width. */
export const WINDOW_MAX_W = 960
/** 220 × 0.8 — the design LAW's minimum height. */
export const WINDOW_MIN_H = 176
/** 900 × 0.8 — the design LAW's maximum height. */
export const WINDOW_MAX_H = 720
/** 440 × 0.8 — the prototype's opening width (`lists.js` `store.popout`). */
export const WINDOW_DEFAULT_W = 352
/** 520 × 0.8 — the prototype's opening height. */
export const WINDOW_DEFAULT_H = 416

/** 120 × 0.8 — where the first window opens. */
export const WINDOW_CASCADE_ORIGIN = 96
/** 46 × 0.8 / 34 × 0.8 — how far each subsequent window steps down-right. */
export const WINDOW_CASCADE_STEP_X = 37
export const WINDOW_CASCADE_STEP_Y = 27
/**
 * The cascade wraps after six, so a seventh window opens back at the origin
 * instead of marching off the bottom-right corner. Ported from
 * `window-shell.tsx` (`(stackIndex % 6) * 28`) — the prototype has no wrap
 * because nothing in it ever opened seven.
 */
export const WINDOW_CASCADE_WRAP = 6

/**
 * How much of the window must stay on screen when remembered geometry is
 * restored into a viewport that has since changed size. Ported from
 * `window-shell.tsx`: 100px of width and 48px of height — enough of the drag
 * handle to grab. A window you cannot reach is a window you cannot close.
 */
export const WINDOW_EDGE_KEEP_X = 100
export const WINDOW_EDGE_KEEP_Y = 48

/**
 * The gap a *cascaded* window leaves from the viewport edge when the default
 * origin would otherwise hang it off the side. Only ever applies to a window
 * this store placed, never to one the user dragged.
 */
export const WINDOW_EDGE_MARGIN = 8

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max)
}

/**
 * The design LAW's resize bounds, converted. Applied in the store rather than
 * only in the drag handler so that **no illegal size can be persisted**,
 * however it arrived — the prototype clamps in `sizePopout` for the same
 * reason.
 */
export function clampWindowSize(size: { w: number; h: number }): {
  w: number
  h: number
} {
  return {
    w: clamp(Math.round(size.w), WINDOW_MIN_W, WINDOW_MAX_W),
    h: clamp(Math.round(size.h), WINDOW_MIN_H, WINDOW_MAX_H),
  }
}

/** Where the n-th simultaneously-open window opens, before any drag. */
export function cascadePlacement(stackIndex: number): { x: number; y: number } {
  const step = ((stackIndex % WINDOW_CASCADE_WRAP) + WINDOW_CASCADE_WRAP) % WINDOW_CASCADE_WRAP
  return {
    x: WINDOW_CASCADE_ORIGIN + step * WINDOW_CASCADE_STEP_X,
    y: WINDOW_CASCADE_ORIGIN + step * WINDOW_CASCADE_STEP_Y,
  }
}

/**
 * Remembered geometry → what to render, with the cascade and the design's
 * bounds filled in, then clamped back into the current viewport.
 *
 * `viewport` is passed in rather than read off `window` so this stays a pure
 * function: it is the one place the drag/resize maths can be *executed* by a
 * node test instead of pinned as source (R191 — this repo's vitest has no
 * jsdom, so a decision left inside a `.tsx` is guarded by nothing). Pass `null`
 * on the server, where there is no viewport to clamp to.
 *
 * **Ours is fitted; theirs is only rescued.** That is one rule applied to both
 * halves of the geometry, and it is the whole of this build's small-screen
 * answer (LV.17, **F-LV15.3**):
 *
 * | | a value the store chose | a value the user set |
 * | --- | --- | --- |
 * | position | fitted, so the whole window lands on screen | rescued only far enough to stay grabbable ({@link WINDOW_EDGE_KEEP_X}) |
 * | size | fitted to the viewport, never below the LAW's minimum | never re-fitted |
 *
 * LV.15 shipped the position half: the design's `120,120` origin puts a 352px
 * window at `96` on a 375px phone with its close button off-screen. **LV.17
 * adds the size half**, because position alone is not enough on a viewport
 * narrower than the window itself: `list-window.tsx` caps the *painted* box at
 * `100vw - 16px`, so a 352px-wide window on a 320px phone paints at 304 while
 * the store still says 352 — and the resize grip reads the store. The first
 * touch of the grip then jumps the window 48px wider before it moves. Fitting
 * the size we chose keeps the model and the paint agreeing, which is what makes
 * "the phone gets the same window" a claim rather than a hope.
 *
 * Fitting is bounded by {@link clampWindowSize}, so a very narrow viewport still
 * gets a legal 264px window and the CSS cap covers the remainder — a window
 * smaller than the design's minimum is not a window.
 */
export function resolveWindowGeometry(
  saved: ListWindowGeometry | undefined,
  stackIndex: number,
  viewport: WindowViewport | null,
): ResolvedWindowGeometry {
  const wanted = clampWindowSize({
    w: saved?.w ?? WINDOW_DEFAULT_W,
    h: saved?.h ?? WINDOW_DEFAULT_H,
  })
  // `setSize` always writes both, so either one present means the user sized
  // this window and neither may be touched.
  const userSized = saved?.w !== undefined || saved?.h !== undefined
  const { w, h } =
    viewport && !userSized
      ? clampWindowSize({
          w: Math.min(wanted.w, viewport.width - 2 * WINDOW_EDGE_MARGIN),
          h: Math.min(wanted.h, viewport.height - 2 * WINDOW_EDGE_MARGIN),
        })
      : wanted
  const fallback = cascadePlacement(stackIndex)
  const min = saved?.min ?? false

  if (!viewport) {
    return { x: saved?.x ?? fallback.x, y: saved?.y ?? fallback.y, w, h, min }
  }

  const fitX = clamp(
    fallback.x,
    WINDOW_EDGE_MARGIN,
    Math.max(WINDOW_EDGE_MARGIN, viewport.width - w - WINDOW_EDGE_MARGIN),
  )
  const fitY = clamp(
    fallback.y,
    WINDOW_EDGE_MARGIN,
    Math.max(WINDOW_EDGE_MARGIN, viewport.height - h - WINDOW_EDGE_MARGIN),
  )
  const x = saved?.x ?? fitX
  const y = saved?.y ?? fitY

  return {
    x: clamp(x, -w + WINDOW_EDGE_KEEP_X, viewport.width - WINDOW_EDGE_KEEP_X),
    y: clamp(y, 0, Math.max(0, viewport.height - WINDOW_EDGE_KEEP_Y)),
    w,
    h,
    min,
  }
}

interface ListWindowsStore {
  /** Open pop-outs, ordered back-to-front (last = focused/top). */
  windows: ListWindowState[]
  /** Last-known geometry per list, remembered across close/re-open + reloads. */
  geometry: Record<string, ListWindowGeometry>
  open: (listId: string) => void
  close: (listId: string) => void
  focus: (listId: string) => void
  setPosition: (listId: string, pos: { x: number; y: number }) => void
  setSize: (listId: string, size: { w: number; h: number }) => void
  setMinimized: (listId: string, min: boolean) => void
  closeAll: () => void
}

export const useListWindowsStore = create<ListWindowsStore>()(
  persist(
    (set) => ({
      windows: [],
      geometry: {},
      open: (listId) =>
        set((state) => {
          // Re-opening an already-open list brings its window to the front
          // rather than spawning a duplicate — the precedent's rule, and the
          // prototype's (`store.popout` bumps `z` and returns early).
          const rest = state.windows.filter((w) => w.listId !== listId)
          return { windows: [...rest, { listId }] }
        }),
      close: (listId) =>
        set((state) => ({
          windows: state.windows.filter((w) => w.listId !== listId),
        })),
      focus: (listId) =>
        set((state) => {
          const top = state.windows[state.windows.length - 1]
          if (!top || top.listId === listId) return state
          const win = state.windows.find((w) => w.listId === listId)
          if (!win) return state
          return {
            windows: [...state.windows.filter((w) => w.listId !== listId), win],
          }
        }),
      setPosition: (listId, pos) =>
        set((state) => ({
          // Not clamped here: what is on screen depends on the viewport, which
          // this module deliberately cannot see. `resolveWindowGeometry` does
          // that clamping, on the way back out.
          geometry: {
            ...state.geometry,
            [listId]: { ...state.geometry[listId], x: pos.x, y: pos.y },
          },
        })),
      setSize: (listId, size) =>
        set((state) => {
          const { w, h } = clampWindowSize(size)
          return {
            geometry: { ...state.geometry, [listId]: { ...state.geometry[listId], w, h } },
          }
        }),
      setMinimized: (listId, min) =>
        set((state) => ({
          geometry: { ...state.geometry, [listId]: { ...state.geometry[listId], min } },
        })),
      /**
       * **No caller outside tests, deliberately** — flagged by **R227** and
       * left in rather than removed, for two reasons that are worth stating so
       * the next reader does not have to re-derive them.
       *
       * 1. It is **the precedent's API, mirrored** (D11/D13). `closeAll` in
       *    `player-windows-store.ts`:81 has no caller outside tests either —
       *    this is not a stub that was forgotten, it is the shape this store
       *    was told to copy, and `list-windows-store.test.ts`'s D11 pin asserts
       *    this exact line is present in *both* files. Deleting it would make
       *    the two conventions diverge on nothing.
       * 2. **It is not the escape hatch.** R227's answer to "a window you
       *    cannot reach" is Escape on the *top* window (`list-window.tsx`),
       *    which unwinds the stack one at a time and is the precedent's
       *    behaviour. A `closeAll` bound to a key would be a second, blunter
       *    answer to the same problem.
       *
       * **LV.17** is where a caller would appear if one is wanted — that task
       * owns "what happens at 6+ windows" and the mobile answer, and a
       * `Close all pop-outs` affordance belongs to whichever of those it
       * serves. It is not wired here on spec.
       */
      closeAll: () => set({ windows: [] }),
    }),
    {
      name: 'fieldscout.list-windows',
      // Persist only remembered geometry — open windows should not survive a
      // reload, but where/how big/collapsed they were should (D13).
      partialize: (state) => ({ geometry: state.geometry }),
    },
  ),
)

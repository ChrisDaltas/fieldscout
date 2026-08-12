'use client'

import * as React from 'react'

import { Icon } from '@/components/ui/icon'
import { useList } from '@/hooks/use-lists'
import { cn } from '@/lib/utils'
import {
  clampWindowSize,
  resolveWindowGeometry,
  useListWindowsStore,
  WINDOW_EDGE_KEEP_X,
  WINDOW_EDGE_KEEP_Y,
} from '@/stores/list-windows-store'

import { ListCoverTile } from './cover-tile'

/**
 * Lists v2 — one pop-out window: **the frame** (LV.15).
 *
 * Design LAW: `docs/design/lists/README.md` → §"Pop-out window"; prototype
 * source `docs/design/lists/design/ListsCommon.jsx` (`PopoutWindow`, :533–678)
 * and `design/lists.js` (`store.popout` / `movePopout` / `sizePopout`, :262–278).
 * There is no `screens/*.png` for this surface, so those two are the reference.
 *
 * ## What this task builds, and what it deliberately leaves
 *
 * | | |
 * | --- | --- |
 * | **LV.15 (here)** | the frame: outer stroke, near-black surface, the 44px→36px header with cover + name, drag anywhere on it, the 16px resize grip and its clamps, collapse, close, and the z-stack the host paints |
 * | **LV.16** | the dark **inversion wrapper** (colour custom properties scoped on an inner div so children invert without restyling), the rows, the footer, and the header's `gear` (stat picker) + `dots` (grouping menu) |
 * | **LV.17** | what opens a window at all — `pop out` in the detail hero and the column menu — plus loading / empty / error *inside* the window, 6+ windows, and the mobile answer |
 *
 * **Nothing opens one of these yet, and that is LV.17's row, not an omission
 * here.** The body below is a marked placeholder in the same spirit as LV.12's
 * `ComparisonPending`, which LV.13 duly deleted; LV.16 deletes this one.
 *
 * **The `gear` and `dots` buttons are deliberately absent rather than dead.**
 * The LAW lists them in this header and LV.16 brings them, because each needs
 * the thing it operates on: the gear opens the Stats modal LV.16 must render
 * *outside* the inversion wrapper, and the `dots` grouping menu regroups rows
 * that do not exist yet. Shipping either as a button that does nothing is the
 * live-but-false affordance **R220** found in the picker's sub-line, one task
 * earlier in this same round.
 *
 * ## Elevation — the one surface in this build with a resting *stroke* instead
 *
 * CLAUDE.md's elevation rule allows a true overlay a resting shadow, and a
 * floating window is the literal case it names — but the handoff overrides it
 * on its own terms: *"**No shadow** — a black offset shadow can't read on a
 * black window, so the stroke carries the lift."* So this window rests on a
 * **1px `n-3` stroke that shifts to `brand` on hover**, and carries no
 * `shadow-hard-*` at any state (pinned in `list-windows-host.test.ts`). The
 * LAW's 1.25px is its own 0.8× artefact — *"in a normal 1× app, use 1px
 * wherever this document says 1.25px"* (README §Fidelity) — and 1.25 × 0.8 is
 * 1 device pixel either way.
 *
 * `src/components/ui/elevation-rule.test.ts` is **not touched**: it guards
 * `src/components/ui/**`, and a pop-out is not a `ui/` primitive (plan §6).
 *
 * ## Scale: the handoff is 1×, this app is ×0.8 — and two numbers are not
 *
 * The prototype shell renders at `zoom: 0.8` (README §Fidelity; `ListsCommon.jsx`
 * `const ZOOM = 0.8`), so its literal numbers are 1× coordinates that paint 0.8×
 * on screen, and this app paints the scaled result directly — the same
 * conversion Round 1 and LV.13 made throughout (`44px row → 36`, `300 → 240`,
 * `26px cover → 21`).
 *
 * | Handoff | Here | |
 * | --- | --- | --- |
 * | header 44px | `h-9` (36px) | the same 44 → 36 Round 1 converted |
 * | name 12.5px/600 | `text-[10px] font-semibold` | 12.5 × 0.8 |
 * | header cover 24px | `size={19}` | 24 × 0.8 |
 * | `440 × 520`, clamp `330–1200 × 220–900` | `352 × 416`, `264–960 × 176–720` | in `list-windows-store.ts` |
 * | **resize grip 16px** | **16px (`h-4 w-4`), unconverted** | a **hit target**, not a rhythm or type measure. 12.8px is below anything this app asks a user to grab, and LV.13 kept the design's 14px checkbox at 1:1 on the same reasoning |
 * | **pointer deltas** | **1:1, no `/ ZOOM`** | a pointer coordinate is a physical viewport pixel; there is no zoom here to undo. The prototype divides only because its own shell is zoomed |
 *
 * ## Drag and resize are pointer-capture, not global listeners
 *
 * The prototype attaches `mousemove`/`mouseup` to `window`. This uses the
 * pointer capture `window-shell.tsx` already uses for the player mini card, for
 * the reason stated there: *"no global listeners, so it can't leak even if the
 * window unmounts mid-drag"* — and this window can unmount mid-drag, because
 * closing it is one route change away. Geometry is committed to the store on
 * **release**, not per frame: the store is `persist`ed, and a write per
 * `pointermove` is a `JSON.stringify` per frame.
 *
 * **Escape is the one deliberate global listener**, and it is the precedent's
 * (`window-shell.tsx`:123–129) rather than a second answer — see the effect
 * below. It is a `keydown` on `window`, added and removed by an effect, so it
 * cannot outlive the window the way a pointer listener attached mid-drag can.
 */

interface WindowBox {
  x: number
  y: number
  w: number
  h: number
}

interface ListWindowProps {
  listId: string
  /** Position in the back-to-front stack — decides where an untouched window opens. */
  stackIndex: number
  /** Painted by the host, which owns layering (see `list-windows-host.tsx`). */
  zIndex: number
  /**
   * Front-most window owns Escape-to-close — the precedent's prop, same name and
   * same meaning (`window-shell.tsx`). Computed by the host, which is the only
   * thing that can see the siblings.
   */
  isTop: boolean
}

function viewportNow(): { width: number; height: number } | null {
  if (typeof window === 'undefined') return null
  return { width: window.innerWidth, height: window.innerHeight }
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max)
}

/**
 * Where an Escape is **someone else's**, so this window must not answer it
 * (**R231**).
 *
 * `defaultPrevented` alone covers only Radix, because it is Radix that calls
 * `preventDefault()`. The app's own Escape handlers do not — measured on four:
 * `players-spreadsheet.tsx`:1092 (`if (e.key === 'Escape') setOpen(false)`),
 * `list-detail-hero.tsx`:121, `list-row-parts.tsx`:531 and
 * `list-builder.tsx`:294 — so before this selector existed, an Escape aimed at
 * the **player search dropdown on `/app/players`** closed the pop-out instead.
 * That route matters: the host mounts in the app shell, so a window survives to
 * every screen, and the user who lost it was not even on Lists.
 *
 * ## What is in it, and why each
 *
 * `input` / `textarea` / `select` / `[contenteditable]` are the native controls
 * where Escape conventionally cancels an edit or closes an attached popup, and
 * `[role=combobox|listbox|searchbox|textbox]` are the ARIA spellings of the same
 * things — included so the guard does not depend on which spelling a component
 * happened to use. `input` deliberately is **not** split by `type`: a selector
 * that excludes checkboxes and radios is one nobody maintains correctly, and a
 * focused form control is a context where Escape plausibly means "cancel this".
 *
 * ## What is deliberately **out**, which is the half that keeps R227 working
 *
 * - **`button`, `[role=button]`, `a`.** None of them handles Escape, and focus
 *   rests on a button after almost every click in this app — bailing there would
 *   leave the escape hatch working only while focus is on `<body>`. A button
 *   that *does* own Escape is a menu trigger, i.e. a Radix layer, i.e. the
 *   `defaultPrevented` check above.
 * - **`[role=dialog]` — and this one is not merely unnecessary, it is wrong.**
 *   *This window is a `role="dialog"`.* Bailing on it would switch Escape off
 *   the moment focus landed inside the very window Escape exists to close —
 *   after a click on its own collapse button, say. A foreign dialog is Radix and
 *   `preventDefault`s. Pinned in `list-windows-host.test.ts`.
 * - **`[tabindex]` / anything focus-shaped.** Focusable is not "owns Escape".
 *
 * The accepted cost, stated rather than glossed: with a **closed** combobox
 * trigger focused, Escape no longer closes the window. That is one press wasted
 * next to a visible close button, against the alternative of destroying a window
 * the user never aimed at — which is the defect this is.
 */
const ESCAPE_BELONGS_TO_TARGET =
  'input, textarea, select, [contenteditable], [role="combobox"], [role="listbox"], [role="searchbox"], [role="textbox"]'

function escapeBelongsToTarget(target: EventTarget | null): boolean {
  return target instanceof Element && target.closest(ESCAPE_BELONGS_TO_TARGET) !== null
}

export function ListWindow({ listId, stackIndex, zIndex, isTop }: ListWindowProps) {
  const detail = useList(listId)
  const saved = useListWindowsStore((state) => state.geometry[listId])
  const close = useListWindowsStore((state) => state.close)
  const focus = useListWindowsStore((state) => state.focus)
  const setPosition = useListWindowsStore((state) => state.setPosition)
  const setSize = useListWindowsStore((state) => state.setSize)
  const setMinimized = useListWindowsStore((state) => state.setMinimized)

  // Resolved once, on mount: the remembered geometry is the *opening* state,
  // and after that this window's own drags own it. `saved` is read again only
  // when it re-opens, which is a fresh mount.
  const [box, setBox] = React.useState<WindowBox>(() => {
    const geo = resolveWindowGeometry(saved, stackIndex, viewportNow())
    return { x: geo.x, y: geo.y, w: geo.w, h: geo.h }
  })
  // Mirrored in a ref so `pointerup` can commit the geometry the last
  // `pointermove` produced without waiting for a re-render — written *with*
  // every update rather than during render, which would be a render-phase
  // mutation.
  const boxRef = React.useRef(box)
  const applyBox = React.useCallback((next: WindowBox) => {
    boxRef.current = next
    setBox(next)
  }, [])

  // Collapse reads straight from the store — one source of truth for the one
  // piece of geometry that is not dragged.
  const minimized = saved?.min ?? false

  const dragRef = React.useRef<{
    startX: number
    startY: number
    origX: number
    origY: number
  } | null>(null)
  const sizeRef = React.useRef<{
    startX: number
    startY: number
    origW: number
    origH: number
  } | null>(null)

  const list = detail.data
  // The header is honest about the three states it can be in. `Loading…`
  // forever over a failed read is CLAUDE.md's "never let 'nothing happened'
  // mean 'it worked'" — the same call `side-by-side-columns.tsx` made for its
  // subline. The states *inside* the window are LV.17's.
  const title = list?.title ?? (detail.isError ? 'Could not load' : 'Loading…')
  const cover = list ?? null
  const coverPlayers = React.useMemo(
    () => list?.players.slice(0, 3).map((entry) => entry.player) ?? null,
    [list],
  )

  // ---- Escape closes the top window ---------------------------------------

  /**
   * `window-shell.tsx`:123–129, mirrored — **D11: compose, don't re-solve.**
   * Only the front window listens, so one Escape closes one window and the
   * stack unwinds front-to-back rather than vanishing.
   *
   * **Why a pop-out needs it at all** (R227). The close button is the only way
   * out, and it travels with the window: drag one to the right of a wide
   * viewport, then narrow the viewport, and mount-time geometry resolution —
   * the precedent's behaviour too — leaves it exactly where it was, off-screen,
   * with nothing to scroll to because it is `position: fixed`. The host mounts
   * in the app shell, so that window is then unreachable on *every* route, not
   * just on Lists. Measured before this existed: rect `[1050, 400, 352, 416]`
   * at 700×700, `visibleWidth: 0`, close button not hit-testable.
   *
   * **The two additions to the precedent, and why neither is a divergence.**
   * Radix's `DismissableLayer` listens on `document` in the **capture** phase
   * and calls `preventDefault()` when it dismisses (`useEscapeKeydown`), so a
   * bubble-phase listener still fires afterwards. Without the
   * `defaultPrevented` check, one Escape aimed at an open dialog — or at the
   * `dots` menu **LV.16** puts in this very header — would dismiss the overlay
   * *and* close the window underneath it.
   *
   * That check covers Radix and **only** Radix, because `preventDefault()` is
   * Radix's habit and not the app's (**R231**). The second guard therefore asks
   * where the key came from rather than what was done with it — see
   * {@link ESCAPE_BELONGS_TO_TARGET}, which carries the whole decision about
   * what counts.
   */
  React.useEffect(() => {
    if (!isTop) return
    const onKey = (e: KeyboardEvent) => {
      // A Radix overlay above this window has already handled it.
      if (e.defaultPrevented) return
      // R231: and the app's own Escape handlers, which mostly do not
      // `preventDefault()` — an Escape typed into a search box is not ours.
      if (escapeBelongsToTarget(e.target)) return
      if (e.key === 'Escape') close(listId)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [isTop, close, listId])

  // ---- drag: anywhere on the header (design LAW) --------------------------

  const onHeaderPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return
    // The controls live on the header, so a press on one is not a drag.
    if ((e.target as HTMLElement).closest('button, a')) return
    e.currentTarget.setPointerCapture(e.pointerId)
    dragRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      origX: box.x,
      origY: box.y,
    }
  }

  const onHeaderPointerMove = (e: React.PointerEvent) => {
    const drag = dragRef.current
    if (!drag) return
    const view = viewportNow()
    const prev = boxRef.current
    const nextX = drag.origX + (e.clientX - drag.startX)
    const nextY = drag.origY + (e.clientY - drag.startY)
    applyBox({
      ...prev,
      // Keep a grabbable strip on screen at all times — the same bound
      // `resolveWindowGeometry` applies to remembered geometry, so a window can
      // never be dragged somewhere it could not be restored to.
      x: view
        ? clamp(nextX, -prev.w + WINDOW_EDGE_KEEP_X, view.width - WINDOW_EDGE_KEEP_X)
        : nextX,
      y: view ? clamp(nextY, 0, Math.max(0, view.height - WINDOW_EDGE_KEEP_Y)) : nextY,
    })
  }

  const onHeaderPointerUp = (e: React.PointerEvent) => {
    if (dragRef.current) {
      setPosition(listId, { x: boxRef.current.x, y: boxRef.current.y })
    }
    dragRef.current = null
    try {
      e.currentTarget.releasePointerCapture(e.pointerId)
    } catch {
      // pointer already released
    }
  }

  // ---- resize: the 16px grip, bottom-right ---------------------------------

  const onGripPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return
    e.preventDefault()
    e.stopPropagation()
    e.currentTarget.setPointerCapture(e.pointerId)
    sizeRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      origW: box.w,
      origH: box.h,
    }
  }

  const onGripPointerMove = (e: React.PointerEvent) => {
    const grip = sizeRef.current
    if (!grip) return
    const next = clampWindowSize({
      w: grip.origW + (e.clientX - grip.startX),
      h: grip.origH + (e.clientY - grip.startY),
    })
    applyBox({ ...boxRef.current, w: next.w, h: next.h })
  }

  const onGripPointerUp = (e: React.PointerEvent) => {
    if (sizeRef.current) {
      setSize(listId, { w: boxRef.current.w, h: boxRef.current.h })
    }
    sizeRef.current = null
    try {
      e.currentTarget.releasePointerCapture(e.pointerId)
    } catch {
      // pointer already released
    }
  }

  return (
    <div
      role="dialog"
      aria-label={`${title} (pop-out)`}
      data-list-window={listId}
      onPointerDownCapture={() => focus(listId)}
      style={{
        zIndex,
        left: box.x,
        top: box.y,
        width: box.w,
        height: minimized ? undefined : box.h,
      }}
      className={cn(
        'fixed flex flex-col overflow-hidden rounded-sm border border-n-3 bg-n-2 text-white',
        // Elevation: the stroke *is* the lift here — no shadow, ever. See the
        // header of this file.
        'transition-colors hover:border-brand',
        // A window wider or taller than the viewport can still be reached; the
        // stored size is untouched by this cap.
        'max-h-[calc(100vh-16px)] max-w-[calc(100vw-16px)]',
      )}
    >
      {/* header — 44 × 0.8; the drag handle is the whole bar (design LAW) */}
      <div
        onPointerDown={onHeaderPointerDown}
        onPointerMove={onHeaderPointerMove}
        onPointerUp={onHeaderPointerUp}
        onPointerCancel={onHeaderPointerUp}
        className="flex h-9 shrink-0 cursor-grab touch-none items-center gap-[7px] border-b border-white/[0.24] pl-2 pr-1.5 active:cursor-grabbing"
      >
        {cover ? (
          <ListCoverTile list={cover} players={coverPlayers} size={19} />
        ) : (
          <span aria-hidden="true" className="h-[19px] w-[19px] shrink-0 rounded-sm bg-white/20" />
        )}
        <span className="mr-auto min-w-0 truncate text-[10px] font-semibold leading-tight">
          {title}
        </span>

        {/* LV.16 fills the gap here: `gear` (stat picker) then `dots` (grouping
            menu), both of which need the rows and the Stats modal that task
            brings. They are absent rather than inert on purpose — see the file
            header. */}

        <WindowChromeButton
          label={minimized ? 'Expand' : 'Collapse'}
          onClick={() => setMinimized(listId, !minimized)}
        >
          <Icon name={minimized ? 'arrow-bottom' : 'arrow-up'} size={13} />
        </WindowChromeButton>
        <WindowChromeButton label="Close" onClick={() => close(listId)}>
          <Icon name="close" size={13} />
        </WindowChromeButton>
      </div>

      {!minimized && (
        <div className="min-h-0 flex-1 overflow-auto">
          <ListWindowBodyPending count={list?.players.length ?? null} error={detail.isError} />
        </div>
      )}

      {!minimized && (
        <span
          onPointerDown={onGripPointerDown}
          onPointerMove={onGripPointerMove}
          onPointerUp={onGripPointerUp}
          onPointerCancel={onGripPointerUp}
          title="Drag to resize"
          aria-hidden="true"
          className="absolute bottom-0 right-0 h-4 w-4 cursor-nwse-resize touch-none"
          // Two hairlines across the corner — the prototype's grip, which is a
          // gradient rather than a glyph because the icon set has none. White at
          // 55% is the same "white at N%" the LAW's dark treatment uses
          // throughout, not a colour from the palette.
          style={{
            backgroundImage:
              'linear-gradient(135deg, transparent 0 46%, rgba(255,255,255,0.55) 46% 54%, transparent 54% 72%, rgba(255,255,255,0.55) 72% 80%, transparent 80%)',
          }}
        />
      )}
    </div>
  )
}

/**
 * A header control. Explicitly light-on-dark rather than token-derived: the
 * inversion wrapper that would let these use `ui/button` normally is LV.16's,
 * and reaching for `ui/button` now would paint ink-on-white here.
 */
function WindowChromeButton({
  label,
  onClick,
  children,
}: {
  label: string
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      aria-label={label}
      className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-sm text-white transition-colors hover:bg-white/[0.09]"
    >
      {children}
    </button>
  )
}

/**
 * The window's body until **LV.16** builds it.
 *
 * Marked, and marked here, in the way LV.12's `ComparisonPending` was: it says
 * what is missing and does not pretend to be the finished surface. **LV.16
 * deletes this function outright** and replaces the branch above with the
 * inversion wrapper, the 36px rows and the footer.
 *
 * It is not empty on purpose. An empty body would make a window bound to a
 * *broken* list look exactly like one bound to a real list, which is the
 * "nothing happened must never mean it worked" shape CLAUDE.md names — so it
 * reports the row count it can see, and says so when it cannot see one.
 */
function ListWindowBodyPending({
  count,
  error,
}: {
  count: number | null
  error: boolean
}) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-1.5 p-4 text-center">
      <Icon name="table" size={19} className="text-white/40" />
      <span className="text-[11px] font-semibold">
        {error
          ? 'This list could not be loaded'
          : count === null
            ? 'Loading…'
            : `${count} ${count === 1 ? 'player' : 'players'}`}
      </span>
      <span className="text-[10px] font-medium text-white/50">
        Rows, stats and the dark inversion arrive with LV.16.
      </span>
    </div>
  )
}

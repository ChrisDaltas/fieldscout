'use client'

import { useQueryClient } from '@tanstack/react-query'
import * as React from 'react'

import { PositionBadge } from '@/components/players/position-badge'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Icon } from '@/components/ui/icon'
import { Popover, PopoverAnchor, PopoverContent } from '@/components/ui/popover'
import { useAuth } from '@/hooks/use-auth'
import { useComments } from '@/hooks/use-comments'
import { useDraftMode } from '@/hooks/use-draft-mode'
import {
  listsKeys,
  useList,
  type ListPlayerWithPlayer,
  type ListWithTags,
} from '@/hooks/use-lists'
import { useToast } from '@/hooks/use-toast'
import { cn } from '@/lib/utils'
import {
  resolveOrg,
  useListDisplay,
  useListDisplayStore,
  type ListOrg,
} from '@/stores/list-display-store'
import {
  clampWindowSize,
  isSmallViewport,
  resolveWindowGeometry,
  useListWindowsStore,
  WINDOW_EDGE_KEEP_X,
  WINDOW_EDGE_KEEP_Y,
  WINDOW_MOBILE_MAX_W,
} from '@/stores/list-windows-store'
import { usePlayerWindowsStore } from '@/stores/player-windows-store'

import { ListCoverTile } from './cover-tile'
import {
  bucketHeading,
  buildBuckets,
  canReorder,
  ORG_OPTIONS,
  rankMap,
  type Bucket,
} from './list-buckets'
import {
  DraftedCheckbox,
  DropGap,
  EmptyListState,
  LIST_UNAVAILABLE,
  listReadIsGone,
  ListReadFailure,
  ListRowsSkeleton,
  PlayerName,
} from './list-row-parts'
import { formatCount, formatStat, resolveStats, type StatDef } from './list-stats'
import { StatsCatalog } from './list-toolbar'
import { ListDragContext, useDragHandle, useListDrag, type ListDragApi } from './use-list-drag'
import { useListDropCommit } from './use-list-drop'

/**
 * Lists v2 — one pop-out window: the frame (LV.15), **its content** (LV.16) and
 * **the states, the wiring and the phone answer** (LV.17).
 *
 * Design LAW: `docs/design/lists/README.md` → §"Pop-out window"; prototype
 * source `docs/design/lists/design/ListsCommon.jsx` (`PopoutWindow`, :533–678)
 * and `design/lists.js` (`store.popout` / `movePopout` / `sizePopout`, :262–278).
 * There is no `screens/*.png` for this surface, so those two are the reference —
 * and where they disagree the README is normative, with the disagreements called
 * out at the line that resolves them.
 *
 * ## Which task built what
 *
 * | | |
 * | --- | --- |
 * | **LV.15** | the frame: outer stroke, near-black surface, the 44px→36px header with cover + name, drag anywhere on it, the 16px resize grip and its clamps, collapse, close, Escape, and the z-stack the host paints |
 * | **LV.16** | the **dark inversion wrapper**, the header's `gear` + `dots`, the 29px rows with their checkbox / `#N` / name / badge / stat cells, drag-reorder through the shared gap model, and the footer |
 * | **LV.17** | the states *inside* the window (loading / empty / failed / **unavailable**), the resize grip starting from the painted box, and the two controls that finally open one of these: `pop out` in `list-detail-hero.tsx` and in a Side by side column's `dots` menu |
 *
 * LV.16 discharged both hand-offs LV.15 filed (PROGRESS §5): `ListWindowBodyPending`
 * is **deleted** rather than decorated (**F-LV15.1**, as LV.13 deleted LV.12's
 * `ComparisonPending`), and the `gear` + `dots` the LAW's header lists are now
 * real controls rather than a marked gap (**F-LV15.2**).
 *
 * ## Six windows, seven windows, twelve windows — LV.17's answer is "no cap"
 *
 * There is no limit, and nothing is truncated. That is Q4's ruling applied to
 * the surface it was made one screen away from (Chris, 2026-08-11, on the
 * comparison picker: no cap, no search, no truncation), and it is what the LAW
 * asks for in its opening line — *"Open several and set them side by side."*
 * What the **sixth** window does is therefore a placement question, and the
 * store already answers it: the cascade steps down-right and **wraps after six**
 * (`WINDOW_CASCADE_WRAP`, ported from `window-shell.tsx`), so a seventh opens
 * back at the origin on top of the first rather than marching off the corner.
 * Stacking stays **one** z layer at 45 — DOM order inside it, never `45 + i`,
 * so a sixth window cannot climb into the dialog layer (`list-windows-host.tsx`).
 * Every window in a pile is still individually reachable: the front one answers
 * Escape and the stack unwinds one press at a time, and each carries its own
 * close button.
 *
 * ## Ruling 1 — a pop-out of a list that is gone **closes, with a toast**
 *
 * > *"Close it, with a toast."* — Chris, 2026-08-12 (PROGRESS §3 **Q5**)
 *
 * This **reverses what LV.17 first shipped** (persist-and-explain) and lands on
 * the prototype's own `store.destroy` (`design/lists.js`:253) without the silent
 * vanishing that made this build diverge from it: the window closes and the app
 * says {@link LIST_UNAVAILABLE} — *"This list is no longer available."*
 *
 * **The neutral copy is the ruling, not a paraphrase of it.** A 404 from
 * `GET /api/lists/[id]` is three situations collapsed into one status, and only
 * one of them is a deletion — the third is a list that is alive and merely no
 * longer visible to this viewer, which the owner produces with one click in the
 * hero's options menu. `listReadIsGone`'s header in `list-row-parts.tsx` carries
 * the measurement (**R248**). Nothing here may say "deleted".
 *
 * ## Ruling 2 — a phone gets a real variant, and this file has **one** breakpoint
 *
 * > *"On a mobile the pop out window is full width but only 60% of the screen
 * > height. the tool bar only shows Close and Options. All options go into the
 * > option menu."* — Chris, 2026-08-12 (PROGRESS §3 **Q6**)
 *
 * So below {@link WINDOW_MOBILE_MAX_W} the window is a bottom sheet: `100%`
 * wide, `WINDOW_MOBILE_HEIGHT_RATIO` (0.6) of the viewport high, header =
 * `Options` + `Close`, and the `gear`, the `dots` menu and `Collapse` all move
 * **into** that menu ({@link WindowMenu}). It replaces LV.17's *"the phone gets
 * the same window"*, which was a Builder decision and is now overruled by the
 * only person who could.
 *
 * ## Ruling 3 — the sheet rests **on** the tab bar, and a tap outside dismisses
 *
 * > *"add tap outside to dismiss but also the bottom should be right at the top
 * > of the bottom bar"* — Chris, 2026-08-12 (**R258**)
 *
 * The first cut of Ruling 2 anchored the sheet at the viewport floor, which
 * **completely covered the bottom tab bar** — measured at 375 × 812, nav
 * `[0, 748, 375, 64]` under a sheet `[0, 324.8, 375, 487.2]` at z 45 against
 * z 40 — so while any pop-out was open a phone could not navigate at all, and
 * the header `Close` was the only way out (no scrim, no outside dismissal, and
 * a phone has no Escape). Both halves are now Chris's:
 *
 * - the frame is `bottom-16`, the bottom bar's **own** `h-16` token, so its
 *   bottom edge is the bar's top edge and the bar is fully clear;
 * - a pointer-down outside the sheet closes it, `isTop` only, without
 *   `preventDefault` — so the tab it lands on still navigates.
 *
 * **The 60% is unchanged and still of the viewport**: the sheet moved up, it
 * did not shrink into the space left over. At 375 × 812 it is
 * `[0, 260.8, 375, 487.2]`.
 *
 * ## Three things follow that Chris did not state
 *
 * Each is minimal, each is derived-not-ruled, and each is cheap to overrule:
 *
 * 1. **A tab tap dismisses as well as navigates** — so a sheet does *not*
 *    survive navigation on a phone, while a desktop window still does. The nav
 *    is outside the sheet and the ruling is *"tap outside to dismiss"*; carving
 *    out the one outside surface that happens to be chrome would be an
 *    invisible exception. **F-LV17.7**.
 * 2. **Drag and resize are switched off, not left dead.** Both are meaningless
 *    at fixed full-width / 60%-height, and a `cursor-grab` header that does
 *    nothing is the live-but-false affordance **R220** named. So the grip is not
 *    rendered at all, the header drops its grab cursor and its `touch-none`
 *    (the gesture belongs to the browser again), and both pointer-down handlers
 *    bail. **No position or size is written from a phone** — which is what keeps
 *    a window you positioned on a desktop exactly where you left it when you
 *    next open the app there.
 *
 *    **`min` is written from a phone, deliberately** (**R257**). `Collapse` is
 *    the one control Ruling 2 *moved into* the Options menu, and it writes into
 *    the same persisted `geometry[listId]` record that position and size live in
 *    (`list-windows-store.ts`:367–369, `partialize` at :399). So collapsing a
 *    sheet and then widening past 768 returns a collapsed desktop window — which
 *    is the same promise position and size make, and is why the write stays. The
 *    claim above used to read *"no geometry is written from a phone"*, which was
 *    false in six places including a governing doc; it is narrowed to what is
 *    true **and** pinned, rather than reworded.
 * 3. **Several windows open: they pile, and nothing is capped.** Every mobile
 *    window has the same geometry, so the cascade is a no-op and the front one
 *    is the one you see; each carries its own `Close`, and closing it reveals
 *    the next — and an outside tap dismisses **the top one only**, so a pile
 *    unwinds a tap at a time exactly as a desktop pile unwinds a press at a
 *    time. Inventing a cap is Chris's call, not a Builder's (Q4's precedent), so
 *    there is none. The honest cost — a pile of three looks like one until you
 *    close the top — is filed as **F-LV17.4** rather than solved by inventing a
 *    switcher the design package does not have.
 *
 * **Desktop is bit-identical.** Every mobile branch is `mobile ? … : <what
 * shipped>`, the {@link WINDOW_EDGE_KEEP_X} rescue and `resolveWindowGeometry`
 * are untouched, the geometry store is still written only by a desktop
 * pointer-up, and **nothing on a desktop closes on an outside click** — a
 * pop-out is not modal, and clicking around it is what it is for. What the
 * *desktop* answer rests on is unchanged and still true:
 *
 * 1. **A window we place opens whole.** Position was fitted at LV.15; **size**
 *    is fitted here (`resolveWindowGeometry`), and the frame's `max-w`/`max-h`
 *    cap the paint at the viewport regardless. **A window the *user* placed is
 *    only rescued**, to {@link WINDOW_EDGE_KEEP_X} of grabbable header — a
 *    position you chose is never re-fitted, which is the trade LV.15 made and
 *    two reviews upheld.
 * 2. **Drag and resize are pointer events**, so they are touch events on a
 *    touch screen — no mouse-only path anywhere in this file. On a **tablet**,
 *    which is above the breakpoint and still gets the floating window, that is
 *    what makes it usable; the header and the grip both carry `touch-none` there
 *    so the browser does not claim the gesture for a scroll.
 * 3. **The grip starts from the painted corner**, so the one place where a
 *    narrow viewport used to make the window jump is closed (see
 *    `onGripPointerDown`).
 *
 * ## The dark inversion — one wrapper, no restyled children
 *
 * The LAW: *"The window inverts … **Implement by scoping the color custom
 * properties on an inner wrapper so children invert without restyling** — and
 * keep the Stats modal it opens *outside* that wrapper, since it belongs to the
 * light page."* The prototype does that with `<div className="fs-dark">`
 * (`ListsCommon.jsx`:580), and so does this: {@link ListWindow} renders one
 * `fs-dark` wrapper around the header, the rows and the footer, and the Stats
 * picker sits **outside** it, as a sibling — visibly outside in this file, and
 * portalled out of the DOM subtree as well.
 *
 * `fs-dark` lives in `src/app/globals.css`, where the reasoning is written out.
 * The short version: this app's Field Scout palette is literal hex in
 * `tailwind.config.ts`, not custom properties, so the wrapper declares the LAW's
 * five values as properties and points the handful of palette utilities that
 * appear inside a pop-out at them. **Nothing in this file styles a shared child
 * for the dark** — `PlayerName`, `PositionBadge`, `DropGap` and `EmptyListState`
 * are rendered exactly as the light surfaces render them.
 *
 * The **one** per-instance class is the drafted checkbox's stroke, because the
 * LAW names a value for it that no generic mapping could produce:
 * *"14px drafted checkbox with a `rgba(255,255,255,.75)` stroke"*.
 *
 * ## Composition (plan §6, **D11**) — this window re-solves nothing
 *
 * | Piece | Comes from |
 * | --- | --- |
 * | grouping / bucketing / band colour | `list-buckets.ts` (`buildBuckets`, `bucketHeading`, `rankMap`, `ORG_OPTIONS`, `canReorder`) |
 * | checkbox, name, drop gap, empty state | `list-row-parts.tsx` |
 * | position badge | `players/position-badge.tsx` |
 * | drag gesture and the gap model | `use-list-drag.tsx` (LV.4, D5) |
 * | what a drop *writes* | `use-list-drop.ts` — `list-detail-panel.tsx`'s own commit, moved so the two cannot drift |
 * | drafted marks | `use-draft-mode.ts`, the account-persisted source LV.1.3 pointed it at |
 * | stat cells and the catalog behind `gear` | `list-stats.ts` + `list-toolbar.tsx`'s `StatsCatalog` |
 * | which grouping / which stats | `list-display-store.ts`, session-only (**D3**) |
 * | the player mini card | `usePlayerWindowsStore`, opened exactly as the panel opens it |
 *
 * **A tick here is one tick on one list.** D12's fan-out belongs to the Side by
 * side comparison set and stops there: a pop-out is a single list, so this uses
 * `use-draft-mode.ts` directly and never imports `drafted-fan-out.ts` — the same
 * boundary LV.14 pinned for the detail panel, now pinned for this file too.
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
 * `26px cover → 21`). **LV.15's conversions are kept, not re-derived.**
 *
 * | Handoff | Here | |
 * | --- | --- | --- |
 * | header 44px | `h-9` (36px) | LV.15's |
 * | name 12.5px/600 | `text-[10px] font-semibold` | LV.15's |
 * | header cover 24px | `size={19}` | LV.15's |
 * | `440 × 520`, clamp `330–1200 × 220–900` | `352 × 416`, `264–960 × 176–720` | LV.15's, in `list-windows-store.ts` |
 * | row 36px | `h-[29px]` | 36 × 0.8 = 28.8. Same conversion as LV.13's 38 → 30 |
 * | row name **13px/400** | `text-[10.5px] font-normal` | 13 × 0.8. **Regular is load-bearing** — the LAW: *"heavier reads as a heading on ink"*. (The prototype's own row says 12.5; the README is normative and the gap is 0.4px) |
 * | `#N` 11px/500, 18px wide | `text-[9px] font-medium`, `w-[21px]` | the width is LV.13's, because `#` + two digits does not fit 14px |
 * | stat cell 60px, 11.5px/500 | `w-[48px]`, `text-[9px]` | 60 × 0.8, 11.5 × 0.8 |
 * | column caption 9.5px/500 | `text-[8px] font-medium` | 9.5 × 0.8. Never 600+ at that size (README §Type) |
 * | band header 26px | `h-[21px]` | LV.13's |
 * | row min-width `190 + cols × 68` | `152 + stats × 54` | × 0.8. This is what *"widening reveals more stat columns"* means: the rows keep their width and the window scrolls, so a wider window simply shows more of them |
 * | footer Share 30px, 12px/600 | `h-6`, `text-[9.5px] font-semibold` | 30 × 0.8, 12 × 0.8 |
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
 * Is this a phone (Ruling 2)? — **the only breakpoint in this file**, read from
 * the store's constant so the number lives in one place and is executed by a
 * node test (`isSmallViewport`, R191).
 *
 * `useSyncExternalStore` rather than an effect + state: the answer must survive
 * a **rotation**, and a window open at 812 × 375 that does not re-read its own
 * variant is the "nothing happened" shape one more time. The server snapshot is
 * `false` and cannot be wrong — the open stack is never persisted, so no window
 * exists at SSR or at hydration on any route (`list-windows-host.tsx`).
 *
 * The query mirrors {@link WINDOW_MOBILE_MAX_W} rather than restating it, so the
 * CSS breakpoint and the predicate cannot drift by a pixel.
 */
function useIsSmallViewport(): boolean {
  const subscribe = React.useCallback((onChange: () => void) => {
    const query = window.matchMedia(`(max-width: ${WINDOW_MOBILE_MAX_W - 1}px)`)
    query.addEventListener('change', onChange)
    return () => query.removeEventListener('change', onChange)
  }, [])
  return React.useSyncExternalStore(
    subscribe,
    () => isSmallViewport(viewportNow()),
    () => false,
  )
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

/** `190 + cols × 68` at ×0.8 — see the scale table. */
function rowMinWidth(statCount: number): number {
  return 152 + statCount * 54
}

export function ListWindow({ listId, stackIndex, zIndex, isTop }: ListWindowProps) {
  const { toast } = useToast()
  // Ruling 2's single branch. Everything it changes is `mobile ? … : <what
  // shipped>`, so desktop is bit-identical.
  const mobile = useIsSmallViewport()
  const detail = useList(listId)
  const comments = useComments(listId)
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
  /**
   * **The list under this window is gone** (LV.17).
   *
   * A pop-out is hosted by the app shell and survives navigation (design LAW),
   * so the list it shows can stop being readable from a screen the user is not
   * even looking at — their own Lists page in another tab, or by the owner of a
   * saved list deleting it *or making it private*. `useDeleteList` invalidates
   * `listsKeys.all`, which matches this window's own detail key, so the next
   * read is a **404** and React Query keeps the last good `data` alongside the
   * error. Left alone, that is a window showing rows for a list nobody can
   * reach, for as long as it stays open.
   *
   * **So it closes, with a toast** — Chris, 2026-08-12 (§3 Q5), reversing the
   * persist-and-explain this task first shipped. See the file header.
   *
   * **This flag drives every *non-destructive* state and nothing else**
   * (**R256**): the footer suppression, the drag gate and the body's neutral
   * copy. What closes the window is {@link goneConfirmed}, one read later.
   */
  const gone = detail.isError && listReadIsGone(detail.error)
  /**
   * **The same 404, twice — which is the only thing that makes it a fact**
   * (**R256**).
   *
   * `listReadIsGone` is `status === 404` and nothing else, and this route
   * answers 404 for *"you sent no valid session"* as readily as for *"the list
   * is gone"*: `GET /api/lists/[id]` has **no auth guard** (`route.ts`:18–36 —
   * `auth.getUser()` is read only for the favourite flag) and leans on RLS,
   * whose SELECT policy is
   * `((is_private = false AND deleted_at IS NULL) OR auth.uid() = owner_id)`.
   * An unauthenticated read of a private list therefore returns zero rows and
   * the route 404s. Measured on the local stack: `curl` of the private
   * `Secret sleepers` fixture → **404** `{"error":"List not found"}`; the same
   * id with a session → **200**.
   *
   * That made the close guard the **R190/R195/R199 shape**: its input
   * *correlated* with the fact instead of *establishing* it. Reproduced end to
   * end with `window.fetch` 404ing exactly **one** GET and every later read
   * real — `{blipped: 1, windows: [], toastShown: true}`, and the very next
   * real read returned **200** with `deleted_at: null`. A window was destroyed,
   * and the app announced a list unavailable, over a list that was alive and
   * readable one request later. **R252** had removed the retry that used to
   * absorb exactly this.
   *
   * **So the destructive step asks a second time.** One corroborating read, no
   * timer, no retry re-added to the shared hook: if it answers, the blip is
   * over and `gone` clears itself; if it 404s too, the list really is not
   * readable and Chris's ruling runs. Chris ruled what happens when a list *is*
   * gone — he did not rule that a bare 404 establishes it.
   *
   * **Why not "gate it on a confirmed session" instead.** The client cannot
   * know whether *the request that 404'd* carried one — only whether it
   * currently believes it has one — so a signed-in viewer's blip would still
   * destroy the window. It answers a different question. The clean fix is the
   * route answering **401** when there is no session, which is a `src/app/api/**`
   * change the standing budget closes: filed as **F-LV17.6**.
   */
  const [goneConfirmed, setGoneConfirmed] = React.useState(false)
  const corroborating = React.useRef(false)
  const refetchDetail = detail.refetch
  // The header is honest about the states it can be in. `Loading…` forever over
  // a failed read is CLAUDE.md's "never let 'nothing happened' mean 'it worked'"
  // — the same call `side-by-side-columns.tsx` made for its subline. There is no
  // *gone* spelling here any more: that window is closing, and the title it
  // carries for the one frame before it goes is the name it always had.
  const title = list?.title ?? (detail.isError ? 'Could not load' : 'Loading…')
  const cover = list ?? null
  const coverPlayers = React.useMemo(
    () => list?.players.slice(0, 3).map((entry) => entry.player) ?? null,
    [list],
  )

  // ---- what the window shows: grouping, stats, marks -----------------------

  /**
   * Display state is **per list, not per surface** (D3, `list-display-store`).
   * A pop-out of a list that is also open in the panel deliberately shows the
   * same grouping and the same stat columns: the store is keyed by list id, so
   * the two read one value rather than two, exactly as LV.13's columns do.
   */
  const display = useListDisplay(listId)
  const setOrg = useListDisplayStore((state) => state.setOrg)
  const toggleCol = useListDisplayStore((state) => state.toggleCol)
  const [statsOpen, setStatsOpen] = React.useState(false)

  const { drafted, toggleDrafted } = useDraftMode(listId)
  const openPlayerWindow = usePlayerWindowsStore((state) => state.open)

  const org: ListOrg = resolveOrg(display.org, list?.ranking_mode)
  const entries = list?.players
  // Every chosen stat, as the list and table views do — card view is the one
  // that truncates to three. Widening the window reveals more of them.
  const stats = React.useMemo(() => resolveStats(display.cols), [display.cols])
  const buckets = React.useMemo(
    () =>
      buildBuckets({
        org,
        entries: entries ?? [],
        bandLabels: display.bandLabels,
        budget: display.budget,
      }),
    [org, entries, display.bandLabels, display.budget],
  )
  const ranks = React.useMemo(() => rankMap(buckets), [buckets])

  // A comparison — and a pop-out — routinely holds a list you do not own. The
  // owner gate is the server's answer, not a client-side comparison.
  const canEdit = Boolean(list?.is_owner)
  // …and never over a list that is gone: the rows are stale by definition, and
  // a reorder PATCH against a list nobody can read can only 404.
  const canDrag = canEdit && !gone && canReorder(org) && !minimized

  const handleDrop = useListDropCommit({ listId, org, buckets, canEdit })
  const drag = useListDrag({ enabled: canDrag, horizontal: false, onDrop: handleDrop })

  const dragName = React.useMemo(() => {
    if (!drag.dragId) return ''
    for (const bucket of buckets) {
      const found = bucket.entries.find((entry) => entry.id === drag.dragId)
      if (found) return found.player.full_name
    }
    return ''
  }, [drag.dragId, buckets])

  const openPlayer = React.useCallback(
    (entry: ListPlayerWithPlayer) =>
      openPlayerWindow(entry.player_id, {
        listContext: canEdit && list ? { listId: list.id, listTitle: list.title } : null,
      }),
    [openPlayerWindow, canEdit, list],
  )

  // ---- Share ---------------------------------------------------------------

  const queryClient = useQueryClient()
  const viewerName = useAuth().profile?.username ?? null

  /**
   * The footer's Share copies **the same link the hero and the gallery card
   * copy** — `/u/{owner}/lists/{slug}`, the URL people paste into group chats
   * and the one `/api/lists/[id]`'s own comment calls the list's permanent
   * identity. It is not a new URL shape and it needs no route.
   *
   * The owner is resolved the way `lists-page-v2.tsx` resolves it — the
   * collection row's `owner.username` when the list is someone else's, the
   * viewer otherwise — read from the React Query **cache** rather than by
   * mounting the collection query, because a pop-out survives onto routes that
   * have no business fetching a list collection. A window is opened *from* the
   * Lists page (LV.17), so that cache is warm.
   *
   * **And when it is not, this says so instead of copying a link that 404s.**
   * The username is load-bearing: the public page looks the list up by
   * `owner_id` *and* `slug`, so the wrong handle is not a cosmetic difference.
   *
   * ## Why the viewer is only a fallback for the viewer's *own* lists (**R237**)
   *
   * `getQueriesData` reads a cache that a pop-out is built to outlive.
   * `query-provider.tsx` sets `staleTime` only, so the collections query keeps
   * React Query's **5-minute default `gcTime`** and is evicted once the user
   * leaves `/app/lists` — which is the ordinary life of a window, since the app
   * shell carries it onto every route. With the cache gone, `cached` is
   * `undefined`; falling straight through to `viewerName` then produced a
   * **non-null and wrong** handle for a *saved* list, the refusal below never
   * fired, and the copied link 404'd. The list already knows whose it is —
   * `is_owner` is on `ListWithDetails` (`use-lists.ts`:50) and this file reads it
   * three dozen lines up — so the fallback asks that question rather than
   * assuming the answer.
   */
  const shareList = () => {
    const cached = queryClient
      .getQueriesData<{ lists: ListWithTags[] }>({ queryKey: listsKeys.collections() })
      .flatMap(([, data]) => data?.lists ?? [])
      .find((row) => row.id === listId)
    const username = cached?.owner?.username ?? (list?.is_owner ? viewerName : null)
    if (!list || !username) {
      toast({
        title: 'Could not build the share link',
        description: 'Open the list on the Lists page and share it from there.',
        variant: 'destructive',
      })
      return
    }
    const link = `${window.location.origin}/u/${username}/lists/${list.slug}`
    void navigator.clipboard
      ?.writeText(link)
      .then(() => toast({ title: 'Link copied', description: link }))
      .catch(() =>
        toast({
          title: 'Could not copy the link',
          description: link,
          variant: 'destructive',
        }),
      )
  }

  // ---- the list is gone: close, with a toast (Ruling 1) --------------------

  /**
   * **Ask a second time before destroying anything** (**R256**).
   *
   * One corroborating read, fired the moment the first 404 lands. Nothing else
   * would fire one: `useList` refuses to retry a 404 (**R252**), the query is
   * already settled, and `refetchOnWindowFocus` is off — so a window over a
   * genuinely unreadable list would otherwise sit there forever, which is the
   * state Ruling 1 exists to remove. There is no delay and no back-off: the
   * question is *"is this still true"*, not *"give the server a moment"*, and a
   * timer here would be a second, invisible policy.
   *
   * `corroborating` is a ref rather than state because it must not itself cause
   * a render, and it is **reset when `gone` clears** — so a window that survives
   * one blip is still protected from the next one, and a real deletion arriving
   * later still gets its own pair of reads.
   *
   * `refetch` is stable for the life of the observer (`queryObserver.js`:46,
   * `this.refetch = this.refetch.bind(this)`), so it is an honest dependency.
   */
  React.useEffect(() => {
    if (!gone) {
      // The read came back. Whatever the 404 was, it was not the list.
      corroborating.current = false
      return
    }
    if (corroborating.current) return
    corroborating.current = true
    void refetchDetail().then((second) => {
      if (second.isError && listReadIsGone(second.error)) setGoneConfirmed(true)
    })
  }, [gone, refetchDetail])

  /**
   * **Chris, 2026-08-12: *"Close it, with a toast."*** (§3 Q5.)
   *
   * In an effect rather than in render, because closing is a store write and a
   * component may not mutate anything during render. The cost is one frame in
   * which the window paints its error state before it goes; the branch it paints
   * is `ListReadFailure`'s neutral one, so nothing false is shown even then.
   *
   * `close()` filters this `listId` out of `windows`, so the effect cannot run
   * twice for one window — the component unmounts. `toast` is the module-level
   * dispatcher (`use-toast.ts`:143), stable across renders, so it is an honest
   * dependency rather than a lint appeasement.
   *
   * **`TOAST_LIMIT` is 1** (`use-toast.ts`:11), so N windows dying together
   * leave one toast on screen rather than a queue — and since every one of them
   * would carry the identical sentence, that reads as the truth rather than as
   * a loss. It is the same reasoning LV.14 used for the fan-out's single report.
   *
   * The copy is {@link LIST_UNAVAILABLE}, imported rather than retyped, so the
   * toast and the state a Side by side column paints for the same 404 cannot
   * drift apart — and neither of them says *"deleted"* (**R248**).
   *
   * **The guard is {@link goneConfirmed}, not `gone`** (**R256**): a single 404
   * from this route is as likely to mean *"that request carried no session"* as
   * *"the list is gone"*, and destroying a window on it was the app inferring
   * the fact from something that merely correlates with it.
   */
  React.useEffect(() => {
    if (!goneConfirmed) return
    close(listId)
    toast({ title: LIST_UNAVAILABLE })
  }, [goneConfirmed, close, listId, toast])

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
   * `defaultPrevented` check, one Escape aimed at a dialog — or at the
   * `dots` menu in this very header — would dismiss the overlay *and* close the
   * window underneath it.
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

  // ---- a tap outside the sheet dismisses it — PHONES ONLY (Ruling 3) -------

  /**
   * > *"add tap outside to dismiss but also the bottom should be right at the
   * > top of the bottom bar"* — Chris, 2026-08-12 (**R258**)
   *
   * A phone has no Escape, so before this the header `Close` was the **only**
   * way out of a sheet covering 60% of the screen. This is the phone's Escape,
   * and it is deliberately built to *be* Escape rather than to resemble it:
   *
   * - **`isTop` only, so a pile unwinds one at a time.** Three sheets take three
   *   taps, exactly as three desktop windows take three presses. Dismissing the
   *   whole pile would be a second, blunter answer to a problem Escape already
   *   answers — the same argument `closeAll` carries in `list-windows-store.ts`.
   * - **A Radix layer above the sheet owns the tap.** With the `Options` menu or
   *   the Stats picker open, the first tap outside belongs to *it*; both are
   *   portalled out of this frame, so DOM containment alone would read a tap on
   *   a menu item as a tap outside the window. This is the pointer spelling of
   *   the `defaultPrevented` precedence the Escape handler above uses.
   *
   * **It never `preventDefault`s or `stopPropagation`s, and that is the point.**
   * The bottom tab bar now sits clear of the sheet (see the frame's `bottom-16`
   * below); a handler that swallowed the tap would have made it visible and
   * still unusable. So the tap reaches whatever it landed on: a tab navigates
   * *and* dismisses.
   *
   * **That a nav tap also dismisses is derived, not ruled** — stated so it can
   * be overruled cheaply (**F-LV17.7**). The nav is outside the sheet, and the
   * ruling says a tap outside dismisses; carving out the one outside surface
   * that happens to be chrome would be an invisible exception for a reader to
   * maintain. The consequence, said plainly: **on a phone a sheet does not
   * survive navigation, and on a desktop it still does.** The design LAW's
   * *"stay until closed"* is untouched — Chris added a way to close it.
   *
   * **Desktop is bit-identical**: this effect returns before it listens unless
   * `mobile`. A desktop pop-out is not modal, and an outside click closing one
   * would destroy the feature — you open a window precisely to click *around*
   * it. The asymmetry is pinned in `list-windows-host.test.ts`.
   */
  React.useEffect(() => {
    if (!mobile || !isTop) return
    const onPointerDown = (e: PointerEvent) => {
      const target = e.target
      if (!(target instanceof Node)) return
      // A menu or the stats picker is open: this tap is theirs.
      if (document.querySelector('[data-radix-popper-content-wrapper]')) return
      if (frameRef.current?.contains(target)) return
      close(listId)
    }
    window.addEventListener('pointerdown', onPointerDown)
    return () => window.removeEventListener('pointerdown', onPointerDown)
  }, [mobile, isTop, close, listId])

  // ---- drag: anywhere on the header (design LAW) --------------------------

  const onHeaderPointerDown = (e: React.PointerEvent) => {
    // Ruling 2, derived: an anchored full-width sheet has nowhere to drag to.
    // Gating the *gesture start* is what makes "no POSITION is written from a
    // phone" true — `dragRef` is the only thing that unlocks the `setPosition`
    // in `onHeaderPointerUp`, and it can only be set here. (`min` is written
    // from a phone, by Collapse in the Options menu — **R257**.)
    if (mobile) return
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

  /**
   * The grip starts from what is **painted**, not from what is stored (LV.17).
   *
   * The frame carries `max-w-[calc(100vw-16px)]`, so a window whose remembered
   * size is wider than the current viewport renders narrower than `box.w` says.
   * Starting the drag from the model then snapped the window out to that model
   * width on the first pointer move — up to a 48px jump before the pointer had
   * travelled a pixel, and on a phone that is most of the gesture. Reading the
   * frame's own rect makes the resize begin where the corner actually is.
   *
   * This is the *second* place the model and the paint can disagree; the first
   * is a freshly-cascaded window, which `resolveWindowGeometry` now sizes to fit
   * so the disagreement never arises (see `list-windows-store.ts`). Together
   * they are what makes "a phone gets the same window" a claim rather than a
   * hope — F-LV15.3.
   */
  const frameRef = React.useRef<HTMLDivElement | null>(null)

  const onGripPointerDown = (e: React.PointerEvent) => {
    // Ruling 2, derived: the size is the ruling's, so there is nothing to
    // resize. The grip is not rendered on a phone either — this is the second
    // half of the same gate, for the same reason as the header's.
    if (mobile) return
    if (e.button !== 0) return
    e.preventDefault()
    e.stopPropagation()
    e.currentTarget.setPointerCapture(e.pointerId)
    const painted = frameRef.current?.getBoundingClientRect()
    sizeRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      origW: painted?.width ?? box.w,
      origH: painted?.height ?? box.h,
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
      ref={frameRef}
      role="dialog"
      aria-label={`${title} (pop-out)`}
      data-list-window={listId}
      onPointerDownCapture={() => focus(listId)}
      // Ruling 2: on a phone the geometry is the ruling's, so none of the
      // dragged/resized model reaches the paint — and neither position nor size
      // is written back to it (**R257**; `min` is, deliberately — see
      // `WindowMenu`'s Collapse). `box` is still resolved on mount and still
      // remembered, which is what makes a window positioned on a wide viewport
      // and then opened on a phone come back to its desktop place unchanged.
      style={
        mobile
          ? { zIndex }
          : {
              zIndex,
              left: box.x,
              top: box.y,
              width: box.w,
              height: minimized ? undefined : box.h,
            }
      }
      className={cn(
        'fixed flex flex-col overflow-hidden rounded-sm border border-n-3 bg-n-2 text-white',
        // Elevation: the stroke *is* the lift here — no shadow, ever. See the
        // header of this file.
        'transition-colors hover:border-brand',
        mobile
          ? // *"full width but only 60% of the screen height"*, resting on the
            // bottom tab bar — *"the bottom should be right at the top of the
            // bottom bar"* (Chris, 2026-08-12, **R258**). `bottom-16` is the
            // nav's **own** token: `bottom-tabs.tsx`:51 is `h-16`, the same
            // Tailwind step, so the sheet's bottom edge and the bar's top edge
            // are one number spelled once. A test derives the expected utility
            // from that file's live class rather than from a remembered 64, so
            // changing the bar's height fails at this line instead of silently
            // re-covering it.
            //
            // **The 60% is still of the viewport, as ruled** — the sheet moved
            // up, it did not shrink to 60% of what is left. At 375 × 812 that
            // is `[0, 260.8, 375, 487.2]`, with the bar's 64px clear beneath it.
            //
            // `dvh` rather than `vh` because "the screen height" on a phone is
            // the *visible* viewport, and `vh` is the URL-bar-collapsed one,
            // which would put ~10% of the sheet under the browser chrome.
            // Collapsed, the sheet is its header and nothing else, so the
            // height is dropped rather than animated.
            cn('inset-x-0 bottom-16 w-full', !minimized && 'h-[60dvh]')
          : // A window wider or taller than the viewport can still be reached;
            // the stored size is untouched by this cap.
            'max-h-[calc(100vh-16px)] max-w-[calc(100vw-16px)]',
      )}
    >
      {/* The inversion wrapper (design LAW). Everything inside inherits white
          text and resolves the palette's muted / hairline / card values to the
          LAW's dark ones — see `.fs-dark` in globals.css. The Stats picker is
          deliberately *outside* it, below. */}
      <div className="fs-dark flex min-h-0 flex-1 flex-col">
        {/* header — 44 × 0.8; the drag handle is the whole bar (design LAW) */}
        <div
          onPointerDown={onHeaderPointerDown}
          onPointerMove={onHeaderPointerMove}
          onPointerUp={onHeaderPointerUp}
          onPointerCancel={onHeaderPointerUp}
          className={cn(
            'flex h-9 shrink-0 items-center gap-[7px] border-b border-ink pl-2 pr-1.5',
            // Desktop only: the whole bar is the drag handle (design LAW). On a
            // phone the sheet is anchored, so a grab cursor would be a lie and
            // `touch-none` would take a gesture from the browser for nothing.
            !mobile && 'cursor-grab touch-none active:cursor-grabbing',
          )}
        >
          {cover ? (
            <ListCoverTile list={cover} players={coverPlayers} size={19} />
          ) : (
            <span aria-hidden="true" className="h-[19px] w-[19px] shrink-0 rounded-sm bg-white/20" />
          )}
          <span className="mr-auto min-w-0 truncate text-[10px] font-semibold leading-tight">
            {title}
          </span>

          {/* gear → the stat picker; `dots` → the grouping menu (design LAW's
              header order: cover, name, gear, dots, collapse, close).
              **F-LV15.2** — LV.15 left both out rather than inert, because each
              needs what this task brings.

              **On a phone the bar is `Options` + `Close`, and nothing else**
              (Ruling 2). The gear and the collapse are not hidden so much as
              *moved*: {@link WindowMenu} is the same `dots` menu with both
              folded into it, which is Chris's *"All options go into the option
              menu"* taken literally. */}
          {!mobile && (
            <WindowChromeButton label="Choose stats" onClick={() => setStatsOpen(true)}>
              <Icon name="gear" size={13} />
            </WindowChromeButton>
          )}

          <WindowMenu
            listId={listId}
            mobile={mobile}
            minimized={minimized}
            onChooseStats={() => setStatsOpen(true)}
            onToggleMinimized={() => setMinimized(listId, !minimized)}
            setOrg={setOrg}
          />

          {!mobile && (
            <WindowChromeButton
              label={minimized ? 'Expand' : 'Collapse'}
              onClick={() => setMinimized(listId, !minimized)}
            >
              <Icon name={minimized ? 'arrow-bottom' : 'arrow-up'} size={13} />
            </WindowChromeButton>
          )}
          <WindowChromeButton label="Close" onClick={() => close(listId)}>
            <Icon name="close" size={13} />
          </WindowChromeButton>
        </div>

        {!minimized && (
          // The scroller *is* the drag surface's root, rendered by
          // `ListDragContext` so the hook's DOM reads are scoped to this window
          // and not to the page it floats over (**R235/R236**). Same one div,
          // same classes as before.
          <ListDragContext drag={drag} className="min-h-0 flex-1 overflow-auto">
            <ListWindowRows
              buckets={buckets}
              entries={entries}
              error={detail.isError ? detail.error : null}
              stats={stats}
              org={org}
              ranks={ranks}
              drafted={drafted}
              onToggleDrafted={toggleDrafted}
              onOpenPlayer={openPlayer}
              canEdit={canEdit}
              canDrag={canDrag}
              drag={drag}
              dragName={dragName}
            />
          </ListDragContext>
        )}

        {/* No footer over a list this viewer can no longer read (LV.17). The
            view and comment counts are the unavailable list's last known ones,
            and Share would copy `/u/{owner}/lists/{slug}` — a URL that now
            resolves to a 404 page, announced as "Link copied". A control that
            confidently does the wrong thing is the live-but-false affordance
            **R220** named; the honest version of this footer is no footer. */}
        {!minimized && !gone && (
          <div className="flex h-8 shrink-0 items-center gap-2.5 border-t border-ink px-2">
            {/* views / comments (design LAW). Read-outs, not buttons: a pop-out
                has no comments panel to open, and a control that does nothing is
                the live-but-false affordance R220 found. */}
            <span className="flex items-center gap-1 text-[9px] font-medium text-n-3" title="Views">
              <Icon name="eye" size={11} />
              <span className="fs-num">{formatCount(list?.view_count)}</span>
            </span>
            <span
              className="flex items-center gap-1 text-[9px] font-medium text-n-3"
              title="Comments"
            >
              <Icon name="comments" size={11} />
              {/* An em dash while the count is unknown or unreadable — `0` over
                  a request that has not answered is the false-empty CLAUDE.md
                  names outright. */}
              <span className="fs-num">
                {comments.data ? formatCount(comments.data.pagination.total) : '—'}
              </span>
            </span>

            <Button
              variant="lime"
              size="sm"
              onClick={shareList}
              // The design LAW's **one sanctioned literal on this surface**:
              // *"a brand-lime Share button with literal `#000` text — inside
              // the dark wrapper `--n-1` resolves to white, so a token-based ink
              // color would render white-on-lime."* `variant="lime"` fills
              // `brand-strong`, so the lime fill is overridden here exactly as
              // `list-detail-hero.tsx` overrides it, and `text-[#000]` pins the
              // ink against the inversion rather than trusting a token to stay
              // black inside it.
              className="ml-auto h-6 gap-1.5 bg-brand px-2.5 text-[9.5px] text-[#000] hover:bg-brand"
            >
              <Icon name="send" size={11} /> Share
            </Button>
          </div>
        )}
      </div>

      {/*
        **Outside the inversion wrapper, deliberately** (design LAW: "keep the
        Stats modal it opens *outside* that wrapper, since it belongs to the
        light page") — a sibling of the wrapper here, and portalled out of the
        DOM subtree by Radix as well, so it cannot inherit `.fs-dark` by either
        route. It is the toolbar's own catalog (`StatsCatalog`), not a second
        picker: one list of stats, one `toggleCol`.

        The anchor is a zero-size span at the header's right edge, so the picker
        hangs from the chrome cluster rather than from the window's corner; the
        button itself lives inside the wrapper, where the header is.
        **Not under the `gear` itself** — `right-9` (36px) with `align="end"`
        puts the panel's right edge level with the *collapse* control, measured
        at `x 956` against gear `885–905` and collapse `939–959` on a 352px
        window (**R242**, which corrected the "opens under the gear that summoned
        it" this comment used to claim). Left as it is deliberately: the header
        is 36px of four 20px controls, the panel is 212px wide, and hanging it
        off the cluster keeps it inside the frame at the 264px minimum width.
      */}
      <Popover open={statsOpen} onOpenChange={setStatsOpen}>
        <PopoverAnchor asChild>
          <span aria-hidden="true" className="absolute right-9 top-8 h-0 w-0" />
        </PopoverAnchor>
        <PopoverContent align="end" className="w-[212px] p-0">
          <StatsCatalog cols={display.cols} onToggleCol={(statId) => toggleCol(listId, statId)} />
        </PopoverContent>
      </Popover>

      {/* Not rendered on a phone at all (Ruling 2, derived): the size is the
          ruling's, and a grip that cannot resize is R220's live-but-false
          affordance drawn in the corner. */}
      {!minimized && !mobile && (
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
 * The header's `dots` menu — **the grouping menu on a desktop, and the whole
 * option menu on a phone** (Ruling 2).
 *
 * > *"the tool bar only shows Close and Options. All options go into the option
 * > menu."* — Chris, 2026-08-12
 *
 * One component with a `mobile` branch rather than two clusters, because the
 * desktop menu is a strict subset of the mobile one: the five grouping options
 * are the middle of it either way, and the phone adds the two controls the
 * header gave up, in the LAW's own header order — stats, grouping, collapse.
 *
 * With `mobile` false this renders **exactly** the markup LV.16 shipped: the
 * two `{mobile && …}` branches produce nothing, the trigger label is
 * `Grouping`, and the content keeps its `w-[136px]`.
 *
 * It is a compose, not a build: the same five options and the same per-list
 * `setOrg` a Side by side column's menu uses. Radix portals it, so it opens on
 * the light page above the window (z 50 > 45) rather than inheriting the
 * inversion — which is also why the `Choose stats` item can hand off to a
 * Popover that lives outside the dark wrapper.
 */
function WindowMenu({
  listId,
  mobile,
  minimized,
  onChooseStats,
  onToggleMinimized,
  setOrg,
}: {
  listId: string
  mobile: boolean
  minimized: boolean
  onChooseStats: () => void
  onToggleMinimized: () => void
  setOrg: (listId: string, org: ListOrg) => void
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <WindowChromeButton label={mobile ? 'Options' : 'Grouping'}>
          <Icon name="dots" size={13} />
        </WindowChromeButton>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-[136px]">
        {mobile && (
          <>
            {/* The one hand-off worth naming: this closes a Radix menu and
                opens a Radix popover, and the two layers can race — a popover
                opened in the same tick as a menu's focus restoration is
                sometimes dismissed by it. **Measured at 375 × 812 and it does
                not happen here**: tapping this item left the Stats picker open
                at `x 127, w 212` inside the 375px sheet, so no deferral is
                added for a race that is not there. (The tap was synthesised —
                the tooling's own input times out under mobile emulation, which
                is F-LV17.5's whole subject.) */}
            <DropdownMenuItem onSelect={onChooseStats}>Choose stats</DropdownMenuItem>
            <DropdownMenuSeparator />
          </>
        )}
        {ORG_OPTIONS.map((option) => (
          <DropdownMenuItem key={option.id} onSelect={() => setOrg(listId, option.id)}>
            {option.label}
          </DropdownMenuItem>
        ))}
        {mobile && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={onToggleMinimized}>
              {minimized ? 'Expand' : 'Collapse'}
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

/**
 * A header control. Explicitly light-on-dark rather than token-derived: `text-ink`
 * is **not** inverted by the wrapper (globals.css says why — in this app it
 * mostly means "ink on a light fill"), and `ui/button`'s hover fills would land
 * a pale wash here. The hover is the LAW's own `rgba(255,255,255,.09)`.
 *
 * `forwardRef` + prop spread because `DropdownMenuTrigger asChild` hands it a
 * ref and the `aria-expanded` / `data-state` attributes that make the trigger
 * announce itself.
 */
const WindowChromeButton = React.forwardRef<
  HTMLButtonElement,
  React.ButtonHTMLAttributes<HTMLButtonElement> & { label: string }
>(function WindowChromeButton({ label, children, ...props }, ref) {
  return (
    <button
      ref={ref}
      type="button"
      title={label}
      aria-label={label}
      {...props}
      className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-sm text-white transition-colors hover:bg-white/[0.09]"
    >
      {children}
    </button>
  )
})

/**
 * The rows, grouped, under the sticky column caption row — and the three states
 * that are not rows (LV.17).
 *
 * **The branch order is `error → !entries → empty → rows`, and it is
 * `side-by-side-columns.tsx`'s, not a second answer.** It is also the order
 * CLAUDE.md forces: an errored read still carries the last good `data`, so
 * testing `entries` first would paint stale rows over a failure, and a read
 * that has not answered has no `entries` at all, so testing `length === 0`
 * first would paint "No players on this list yet" over a request in flight.
 * Each branch asserts the reason for having no rows rather than inferring it.
 *
 * Two of the three are now literally shared with the column
 * (`ListReadFailure`, `ListRowsSkeleton`, `EmptyListState` — all from
 * `list-row-parts.tsx`), which is what stops the window and the column drifting
 * into two vocabularies for one situation. `ListReadFailure` is also where
 * *unavailable* is separated from *failed*, on the error's own status — it may
 * not name a cause, and this sentence said *deleted* until **R259**, which is
 * the framing the file's own header forbids at :123. The Ruling 1 pin cannot
 * catch that, because it reads comment-stripped source (`code()`) and a comment
 * is exactly where it hid.
 */
function ListWindowRows({
  buckets,
  entries,
  error,
  stats,
  org,
  ranks,
  drafted,
  onToggleDrafted,
  onOpenPlayer,
  canEdit,
  canDrag,
  drag,
  dragName,
}: {
  buckets: Bucket[]
  entries: ListPlayerWithPlayer[] | undefined
  /** The read's error, or `null` when it has not failed. */
  error: Error | null
  stats: StatDef[]
  org: ListOrg
  ranks: Map<string, number>
  drafted: ReadonlySet<string>
  onToggleDrafted: (playerId: string) => void
  onOpenPlayer: (entry: ListPlayerWithPlayer) => void
  canEdit: boolean
  canDrag: boolean
  drag: ListDragApi
  dragName: string
}) {
  const minWidth = rowMinWidth(stats.length)

  if (error) {
    return <ListReadFailure error={error} canEdit={canEdit} />
  }
  if (!entries) {
    return <ListRowsSkeleton rowHeight={29} />
  }
  if (entries.length === 0) {
    return (
      <div className="p-2">
        <EmptyListState canEdit={canEdit} />
      </div>
    )
  }

  return (
    <div style={{ minWidth }}>
      {/* 28 × 0.8, sticky, over the 7% wash the prototype gives it. */}
      <div className="sticky top-0 z-[3] flex h-[22px] items-center gap-1.5 border-b border-ink bg-white/[0.07] px-2 text-[8px] font-medium text-n-3">
        <span className="w-[14px] shrink-0" />
        <span className="w-[21px] shrink-0">#</span>
        <span className="min-w-0 flex-1">Player</span>
        {stats.map((stat) => (
          <span key={stat.id} title={stat.full} className="w-[48px] shrink-0 text-right">
            {stat.label}
          </span>
        ))}
      </div>

      {buckets.map((bucket) => {
        const heading = bucketHeading(org, bucket)
        return (
          <div key={bucket.key} data-drop-bucket={bucket.key}>
            {heading !== null && (
              <div
                className={cn(
                  'flex h-[21px] items-center gap-1.5 border-b border-ink px-2 text-[9px] font-bold',
                  bucket.className,
                )}
              >
                <span className="min-w-0 truncate">{heading}</span>
                {/* The prototype's band count, which is the number that helps in
                    a window this narrow — the running spend is the wide
                    surfaces' figure. */}
                <span className="fs-num ml-auto text-[8px] font-medium opacity-85">
                  {bucket.entries.length}
                </span>
              </div>
            )}
            {bucket.entries.map((entry, index) => (
              <React.Fragment key={entry.id}>
                {drag.active && (
                  <DropGap
                    bucketKey={bucket.key}
                    index={index}
                    open={drag.isOpen(bucket.key, index)}
                    height={drag.size.height}
                    width={drag.size.width}
                    name={dragName}
                    minWidth={minWidth}
                  />
                )}
                <ListWindowRow
                  entry={entry}
                  rank={ranks.get(entry.id) ?? 0}
                  stats={stats}
                  drafted={drafted.has(entry.player_id)}
                  onToggleDrafted={() => onToggleDrafted(entry.player_id)}
                  onOpenPlayer={() => onOpenPlayer(entry)}
                  bucketKey={bucket.key}
                  index={index}
                  canDrag={canDrag}
                  dragging={drag.dragId === entry.id}
                />
              </React.Fragment>
            ))}
            {drag.active && bucket.entries.length > 0 && (
              <DropGap
                bucketKey={bucket.key}
                index={bucket.entries.length}
                open={drag.isOpen(bucket.key, bucket.entries.length)}
                height={drag.size.height}
                width={drag.size.width}
                name={dragName}
                minWidth={minWidth}
              />
            )}
            {bucket.entries.length === 0 && (
              <p className="border-b border-n-4 px-2 py-2.5 text-[9px] font-medium text-n-3">
                Nothing in this section yet.
              </p>
            )}
          </div>
        )
      })}
    </div>
  )
}

/**
 * One row: 36px → 29, the 14px checkbox, `#N`, the name at **Regular**, the
 * position badge, then every chosen stat.
 *
 * The team code the Side by side column carries is deliberately absent — the
 * LAW's row for this surface is *"14px drafted checkbox …, `#N`, name, position
 * badge, stat cells"*, and the prototype's row agrees (`ListsCommon.jsx`:643).
 * A 264px window spends that width on a stat column instead.
 */
function ListWindowRow({
  entry,
  rank,
  stats,
  drafted,
  onToggleDrafted,
  onOpenPlayer,
  bucketKey,
  index,
  canDrag,
  dragging,
}: {
  entry: ListPlayerWithPlayer
  rank: number
  stats: StatDef[]
  drafted: boolean
  onToggleDrafted: () => void
  onOpenPlayer: () => void
  bucketKey: string
  index: number
  canDrag: boolean
  dragging: boolean
}) {
  const { listeners, setNodeRef } = useDragHandle(entry.id, !canDrag)

  return (
    <div
      ref={setNodeRef}
      {...listeners}
      data-drop-row={`${bucketKey}:${index}`}
      data-drag-id={entry.id}
      className={cn(
        'flex h-[29px] items-center gap-1.5 border-b border-n-4 px-2 transition-[background-color,opacity]',
        // "Drafted rows dim to 45% with a 5% wash" (design LAW). Drafted is a
        // resting condition, so it is fill and opacity — never elevation
        // (CLAUDE.md → Elevation). The prototype dims only the name; the README
        // is normative and dims the row, which is also what reads correctly when
        // the stat cells are the reason you are looking.
        drafted ? 'bg-white/[0.05] opacity-45' : 'hover:bg-white/[0.09]',
        canDrag && 'cursor-grab touch-manipulation',
        dragging && 'opacity-35',
      )}
    >
      {/* One tick, one list — the fan-out is the Side by side comparison set's
          and stops there (D12). `border-white/75` is the LAW's stroke for this
          surface, and the only per-instance class the inversion needs. */}
      <DraftedCheckbox drafted={drafted} onToggle={onToggleDrafted} className="border-white/75" />
      <span className="fs-num w-[21px] shrink-0 text-[9px] font-medium text-n-3">#{rank}</span>
      <span className="flex min-w-0 flex-1 items-center gap-1.5">
        <PlayerName
          name={entry.player.full_name}
          drafted={drafted}
          onOpen={onOpenPlayer}
          // Regular, deliberately: "heavier reads as a heading on ink".
          className="min-w-0 truncate text-[10.5px] font-normal"
        />
        <PositionBadge position={entry.player.position ?? 'FLEX'} />
      </span>
      {stats.map((stat) => (
        <span
          key={stat.id}
          className="fs-num w-[48px] shrink-0 text-right text-[9px] font-medium"
        >
          {formatStat(stat, entry)}
        </span>
      ))}
    </div>
  )
}

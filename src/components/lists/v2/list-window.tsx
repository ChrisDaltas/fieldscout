'use client'

import { useQueryClient } from '@tanstack/react-query'
import * as React from 'react'

import { PositionBadge } from '@/components/players/position-badge'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
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
  resolveWindowGeometry,
  useListWindowsStore,
  WINDOW_EDGE_KEEP_X,
  WINDOW_EDGE_KEEP_Y,
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
 * | **LV.17** | the states *inside* the window (loading / empty / failed / **deleted**), the resize grip starting from the painted box, and the two controls that finally open one of these: `pop out` in `list-detail-hero.tsx` and in a Side by side column's `dots` menu |
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
 * ## The phone answer (**F-LV15.3**): the same window, and here is why that holds
 *
 * There is **no breakpoint treatment and no phone variant** — the `pop out`
 * control is not hidden below any width, and a small screen gets the floating
 * window everything else gets. That is a decision this task owns rather than an
 * inheritance: Chris's *"leave the phone version as is"* (D14) was ruled about
 * **Side by side**, and is not extended here by assumption. What makes it a
 * claim rather than a shrug is that the three things a phone could break are
 * each closed:
 *
 * 1. **A window we place opens whole**, which matters more here than anywhere
 *    else because a phone has no Escape key, so the R227 hatch does not exist on
 *    one and the close button is the only way out. Position was fitted at LV.15;
 *    **size** is fitted here (`resolveWindowGeometry`), and the frame's
 *    `max-w`/`max-h` cap the paint at the viewport regardless. **A window the
 *    *user* placed is only rescued**, to {@link WINDOW_EDGE_KEEP_X} of grabbable
 *    header — that strip is the drag handle, not the control cluster, so one
 *    carried across from a wider viewport takes **one drag** before its close
 *    button is reachable. That is the trade LV.15 made deliberately and two
 *    reviews upheld: a position you chose is never re-fitted. Measured at 375px:
 *    restored at `x 275` (close off-screen) → one touch-drag → `[10, 142]`,
 *    whole window on screen.
 * 2. **Drag and resize are pointer events**, so they are touch events on a
 *    phone — no mouse-only path anywhere in this file. The header and the grip
 *    both carry `touch-none` so the browser does not claim the gesture for a
 *    scroll.
 * 3. **The grip starts from the painted corner**, so the one place where a
 *    narrow viewport used to make the window jump is closed (see
 *    `onGripPointerDown`).
 *
 * The honest cost, stated rather than glossed: a 352 × 416 window covers most of
 * a 375px screen while it is open, and it floats over the bottom tab bar (z 45
 * against 40) if you drag it down there. Both are true of the player mini card
 * this window mirrors, both are one drag or one close from being fixed by the
 * user, and neither is a trap.
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
   * so the list it shows can be deleted from a screen the user is not even
   * looking at — their own Lists page in another tab, or by the owner of a
   * saved list. `useDeleteList` invalidates `listsKeys.all`, which matches this
   * window's own detail key, so the next read is a **404** and React Query keeps
   * the last good `data` alongside the error. Left alone, that is a window
   * showing a deleted list's rows for as long as it stays open.
   *
   * **It does not close itself.** The prototype's `store.destroy` does splice
   * the pop-out away (`design/lists.js`:253), and this deliberately diverges:
   * that is an in-memory demo with one actor, no soft delete and no Trash. Here
   * the delete may not be the viewer's action at all, and a window that vanishes
   * without a word while you are on `/app/players` is CLAUDE.md's "nothing
   * happened" with the evidence removed. The LAW's own persistence bullet is the
   * other half — pop-outs *"stay until closed"* — so the window stays, says what
   * happened, and the close button it already has is how you dismiss it.
   */
  const gone = detail.isError && listReadIsGone(detail.error)
  // The header is honest about the states it can be in. `Loading…` forever over
  // a failed read is CLAUDE.md's "never let 'nothing happened' mean 'it worked'"
  // — the same call `side-by-side-columns.tsx` made for its subline. A deleted
  // list keeps the **name** it had: that is the only thing on screen that still
  // identifies which window just died, and it is not a claim about the read.
  const title = list?.title ?? (gone ? 'Deleted list' : detail.isError ? 'Could not load' : 'Loading…')
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
  // a reorder PATCH against a deleted list is a request that can only 404.
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
          className="flex h-9 shrink-0 cursor-grab touch-none items-center gap-[7px] border-b border-ink pl-2 pr-1.5 active:cursor-grabbing"
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
              needs what this task brings. */}
          <WindowChromeButton label="Choose stats" onClick={() => setStatsOpen(true)}>
            <Icon name="gear" size={13} />
          </WindowChromeButton>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <WindowChromeButton label="Grouping">
                <Icon name="dots" size={13} />
              </WindowChromeButton>
            </DropdownMenuTrigger>
            {/* A compose, not a build: the same five options and the same
                per-list `setOrg` a Side by side column's menu uses. Radix
                portals it, so it opens on the light page above the window
                (z 50 > 45) rather than inheriting the inversion. */}
            <DropdownMenuContent align="end" className="w-[136px]">
              {ORG_OPTIONS.map((option) => (
                <DropdownMenuItem key={option.id} onSelect={() => setOrg(listId, option.id)}>
                  {option.label}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>

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

        {/* No footer over a list that no longer exists (LV.17). The view and
            comment counts are the deleted list's last known ones, and Share
            would copy `/u/{owner}/lists/{slug}` — a URL that now resolves to a
            404 page, announced as "Link copied". A control that confidently
            does the wrong thing is the live-but-false affordance **R220**
            named; the honest version of this footer is no footer. */}
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
 * *deleted* is separated from *failed*, on the error's own status.
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

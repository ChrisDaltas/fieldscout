'use client'

import {
  DndContext,
  MouseSensor,
  TouchSensor,
  useDraggable,
  useSensor,
  useSensors,
  type DragStartEvent,
} from '@dnd-kit/core'
import * as React from 'react'

import { isBucketKey } from '@/types/schemas/lists'

import { dropTargetKey, type DropTarget } from './list-reorder'

/**
 * Lists v2 — the drag mechanics behind the handoff's **drop-gap model**
 * (design LAW §"Drag and drop", plan **D5**).
 *
 * > Rows never highlight themselves. Instead **the gap opens** where the player
 * > will land: a slot expands to exactly the dragged element's `offsetHeight` /
 * > `offsetWidth` … Position is decided by which half of the row (or which half
 * > horizontally, in card view) the pointer is over … state only updates when
 * > the target slot actually changes — updating on every `dragover` causes
 * > visible jank.
 *
 * ## Why dnd-kit is the sensor layer and nothing more
 *
 * dnd-kit is already the app's drag library (`AppDndContext`, the big board, the
 * legacy list detail), so this adds no dependency — but only its **sensors and
 * lifecycle** are used. `@dnd-kit/sortable` is deliberately not used: its model
 * is "the other items transform out of the way", which is the exact behaviour
 * the design LAW rules out in its first sentence.
 *
 * Its **droppables** are not used either, and that is a correctness decision
 * rather than a stylistic one. dnd-kit caches droppable rectangles, and this
 * model changes layout mid-drag by design — the open gap pushes everything below
 * it down by a row's height. Hit-testing against cached rects would aim at where
 * a row used to be, and the classic result is a gap that oscillates between two
 * slots. So the target is resolved from `document.elementFromPoint` on every
 * move: always live, one `getBoundingClientRect` per move (the hovered row
 * only), and self-stabilising, because the open gap carries the slot it
 * represents and re-aims at itself when the pointer ends up inside it.
 *
 * The prototype gets that property for free from native HTML5 `dragover`
 * (`docs/design/lists/design/ListsCommon.jsx`). Native drag events were the
 * other candidate and were rejected for one reason that matters more than
 * fidelity to the reference's mechanism: they do not work on touch devices at
 * all, and the launch audience is testing on phones.
 *
 * ## Every DOM read is scoped to the surface that owns the gesture (**R235/R236**)
 *
 * Reading the live DOM is the decision above; reading it through `document` was
 * a hidden assumption underneath it — *that there is only one drag surface on
 * the page*. That was true until LV.16, when the pop-out window became the
 * second consumer of this hook. The window is `position: fixed` at `z-45`, so it
 * routinely sits **over** the detail panel, and both surfaces write the same
 * attributes into the same namespace: two ranked lists each render
 * `data-drop-row="all:0"…`.
 *
 * Two defects followed, and both were reproduced live before this scoping
 * existed:
 *
 * - **R235 — a drop released over a *foreign* surface wrote to the dragged
 *   list at the foreign surface's index.** `hitTest` resolved through
 *   `document.elementFromPoint`, and `planDrop`'s only cross-surface guard is
 *   "does a bucket with this key exist here" (`list-reorder.ts`:98) — which
 *   passes whenever the two surfaces share a bucket key, and two ranked lists
 *   both produce `all`. Measured: `#10` dragged inside a pop-out of *Consensus
 *   WR top 10*, released over the **panel's** first row (a different list) →
 *   `PATCH /api/lists/…ab01/players/reorder` moving that player to position 1.
 *   Silent, and persisted. The reverse direction was identical.
 * - **R236 — the dragged row was measured with a global first match.** The same
 *   list open in the panel *and* a pop-out puts the same `data-drag-id` in the
 *   DOM twice; `<ListWindowsHost />` renders after `{children}` in the app
 *   shell, so the panel's copy always won document order. Measured: a drag
 *   inside a window whose rows are **29px** opened a **48px** gap, because
 *   `document.querySelector` had returned the panel's 48px row.
 *
 * So the hook owns a `rootRef`, {@link ListDragContext} attaches it to the one
 * element it wraps, and **both** DOM reads go through it: the hit test refuses
 * a point that is not inside this surface, and the measurement queries within
 * it. A consumer cannot forget to attach it, because the context component
 * renders the element itself rather than asking for one — the same reason the
 * gap model resolves the target from the DOM rather than from a cached rect:
 * the correct answer should not depend on a caller remembering something.
 *
 * **A release over another surface is refused, not redirected.** There is no
 * sensible reading of "drop this list's player into that list's slot", and
 * CLAUDE.md's rule cuts against inventing one: no target means no write, and
 * the gap closes as it does over any other non-target.
 *
 * ## Sensors
 *
 * Mouse drags start after 6px of movement, so a click on the drafted checkbox or
 * the row menu is still a click. Touch drags need a 220ms press first, so a
 * finger dragged up the page still scrolls the list rather than picking a player
 * up. That is the reason for `MouseSensor` + `TouchSensor` instead of the single
 * `PointerSensor` used by `AppDndContext`: a pointer sensor on touch either
 * hijacks the scroll or is cancelled by it.
 */

/** Measurement of the row being dragged — the gap is exactly this size. */
export interface DragSize {
  height: number
  width: number
}

export interface ListDragApi {
  /** `list_players.id` of the row in flight, or `null`. */
  dragId: string | null
  size: DragSize
  target: DropTarget | null
  /** True while a drag is running — gaps exist only then. */
  active: boolean
  /**
   * The drag surface this gesture belongs to — every DOM read is scoped to it
   * (**R235/R236**, see the header). {@link ListDragContext} attaches it to the
   * element it renders; nothing else should, and nothing else needs to.
   */
  rootRef: React.MutableRefObject<HTMLDivElement | null>
  /** Spread onto the `<DndContext>` that wraps the body. */
  contextProps: {
    sensors: ReturnType<typeof useSensors>
    onDragStart: (event: DragStartEvent) => void
    onDragEnd: () => void
    onDragCancel: () => void
  }
  /** Is the gap at this slot the open one? */
  isOpen: (bucketKey: string, index: number) => boolean
  /** Is this section the one a header/append drop would land in? */
  isOverBucket: (bucketKey: string) => boolean
  /** Is the "start tier N" zone the current target? */
  isOverNew: () => boolean
}

interface UseListDragArgs {
  /** Drag is offered at all — owner, and a grouping whose order is the array. */
  enabled: boolean
  /** Card view decides position on the horizontal half of a card. */
  horizontal: boolean
  onDrop: (entryId: string, target: DropTarget) => void
}

/** Attributes the body puts on the DOM so the hit test can read the layout. */
export const DROP_ATTR = {
  /** `<bucketKey>:<index>` — a player row or card. */
  row: 'data-drop-row',
  /** `<bucketKey>:<index>` — an open gap, which re-aims at its own slot. */
  gap: 'data-drop-gap',
  /** `<bucketKey>` — the section: its header, padding and empty space. */
  bucket: 'data-drop-bucket',
  /** The bucket key the "start tier/round N" zone would assign. */
  fresh: 'data-drop-new',
  /** `list_players.id`, so the dragged row can be measured with `offset*`. */
  entry: 'data-drag-id',
} as const

export function useListDrag({ enabled, horizontal, onDrop }: UseListDragArgs): ListDragApi {
  const [dragId, setDragId] = React.useState<string | null>(null)
  const [size, setSize] = React.useState<DragSize>({ height: 40, width: 160 })
  const [target, setTarget] = React.useState<DropTarget | null>(null)

  const pointer = React.useRef<{ x: number; y: number } | null>(null)
  // The surface that owns this gesture. Attached by `ListDragContext`, read by
  // both DOM reads below (R235/R236).
  const rootRef = React.useRef<HTMLDivElement | null>(null)
  const dragRef = React.useRef<string | null>(null)
  const targetRef = React.useRef<DropTarget | null>(null)
  const horizontalRef = React.useRef(horizontal)
  horizontalRef.current = horizontal

  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 220, tolerance: 6 } }),
  )

  // "State only updates when the target slot actually changes" (design LAW):
  // the hit test runs per frame, the setState behind it fires per *slot*.
  const aim = React.useCallback((next: DropTarget | null) => {
    if (dropTargetKey(next) === dropTargetKey(targetRef.current)) return
    targetRef.current = next
    setTarget(next)
  }, [])

  /**
   * Resolve the slot under the pointer, now.
   *
   * Deliberately **not** `requestAnimationFrame`-throttled. D5's warning is
   * about *state*: "updating on every `dragover` causes visible jank" — which
   * `aim` handles by writing state only when the slot changes. The read itself
   * is one `elementFromPoint` plus one rect on the hovered row, which is what
   * the prototype does per `dragover` event. Frame-throttling it also loses
   * every move a coalesced or throttled frame swallows, which is a live bug
   * rather than an optimisation: a fast drag releases one slot behind.
   */
  const resolve = React.useCallback(() => {
    const at = pointer.current
    if (!at || !dragRef.current) return
    aim(hitTest(rootRef.current, at.x, at.y, horizontalRef.current))
  }, [aim])

  // The pointer is tracked from the window rather than from dnd-kit's move
  // events, because dnd-kit reports a *delta* from the activator and the drop
  // target needs real viewport coordinates. Recording it always (rather than
  // only once a drag is running) is what lets the first gap open on the same
  // move that trips the activation constraint.
  React.useEffect(() => {
    if (!enabled) return
    const onPointer = (event: PointerEvent) => {
      pointer.current = { x: event.clientX, y: event.clientY }
      resolve()
    }
    const onTouch = (event: TouchEvent) => {
      const touch = event.touches[0]
      if (!touch) return
      pointer.current = { x: touch.clientX, y: touch.clientY }
      resolve()
    }
    window.addEventListener('pointermove', onPointer, { passive: true })
    window.addEventListener('touchmove', onTouch, { passive: true })
    return () => {
      window.removeEventListener('pointermove', onPointer)
      window.removeEventListener('touchmove', onTouch)
    }
  }, [enabled, resolve])

  const reset = React.useCallback(() => {
    dragRef.current = null
    targetRef.current = null
    setDragId(null)
    setTarget(null)
  }, [])

  const onDragStart = React.useCallback(
    (event: DragStartEvent) => {
      const id = String(event.active.id)
      // Within this surface, never `document`: the same list open in the panel
      // and in a pop-out puts the same id in the DOM twice, and a global first
      // match measured the wrong one — a 29px window row sized its gap at the
      // panel's 48px (**R236**).
      const node = rootRef.current?.querySelector<HTMLElement>(
        `[${DROP_ATTR.entry}="${cssEscape(id)}"]`,
      )
      // `offsetHeight`/`offsetWidth`, never `getBoundingClientRect` (plan D5):
      // the design package's shell renders at `zoom: 0.8` and a rect is scaled
      // by it. At 1× the two agree; only one is right in both.
      setSize({
        height: Math.max(24, node?.offsetHeight ?? 40),
        width: Math.max(72, node?.offsetWidth ?? 160),
      })
      dragRef.current = id
      setDragId(id)
      // The move that tripped the activation constraint has already been seen,
      // so the first gap can open on the same gesture instead of waiting for
      // another move — which a single-step programmatic drag never sends.
      resolve()
    },
    [resolve],
  )

  // dnd-kit's `DragEndEvent` is deliberately unread: `over` is its own
  // droppable's answer and this model resolves the target from the live DOM.
  const onDragEnd = React.useCallback(() => {
    // Resolve once more at the release point rather than trusting the last move
    // that happened to be delivered. The drop is the one moment that has to be
    // exact, and a release can arrive without a preceding `pointermove`.
    resolve()
    const id = dragRef.current
    const landed = targetRef.current
    reset()
    if (id && landed) onDrop(id, landed)
  }, [onDrop, reset, resolve])

  const contextProps = React.useMemo(
    () => ({ sensors, onDragStart, onDragEnd, onDragCancel: reset }),
    [sensors, onDragStart, onDragEnd, reset],
  )

  return {
    dragId,
    size,
    target,
    active: dragId !== null,
    rootRef,
    contextProps,
    isOpen: (bucketKey, index) =>
      target?.kind === 'slot' && target.bucketKey === bucketKey && target.index === index,
    isOverBucket: (bucketKey) => target?.kind === 'bucket' && target.bucketKey === bucketKey,
    isOverNew: () => target?.kind === 'new',
  }
}

/**
 * Which slot the pointer is over, read from the live DOM **of `root`**.
 *
 * Order matters: an open gap wins over the row it sits next to (so hovering the
 * hole keeps it open instead of flipping to the row now underneath the pointer),
 * a row wins over its section, and the section catches the header, the padding
 * and an empty bucket.
 *
 * `elementFromPoint` answers for the whole document, so the answer is gated on
 * `root.contains(at)` **before** any of that: a point over another drag surface
 * — a pop-out floating above the panel, or the panel behind a pop-out — is no
 * target at all here (**R235**). `closest()` walks *upwards*, so a point outside
 * `root` can never resolve to an element inside it, which is what makes the one
 * containment check sufficient.
 */
function hitTest(
  root: HTMLElement | null,
  x: number,
  y: number,
  horizontal: boolean,
): DropTarget | null {
  if (!root) return null
  const at = document.elementFromPoint(x, y)
  if (!at || !root.contains(at)) return null

  const gap = at.closest(`[${DROP_ATTR.gap}]`)
  if (gap) {
    const slot = parseSlot(gap.getAttribute(DROP_ATTR.gap))
    if (slot) return { kind: 'slot', bucketKey: slot.bucketKey, index: slot.index }
  }

  const row = at.closest(`[${DROP_ATTR.row}]`)
  if (row) {
    const slot = parseSlot(row.getAttribute(DROP_ATTR.row))
    if (slot) {
      const rect = row.getBoundingClientRect()
      const past = horizontal
        ? x - rect.left > rect.width / 2
        : y - rect.top > rect.height / 2
      return { kind: 'slot', bucketKey: slot.bucketKey, index: slot.index + (past ? 1 : 0) }
    }
  }

  // The zone only ever renders a value `nextBucket` produced, but it comes back
  // through a DOM attribute as a bare string — so it is re-checked against the
  // vocabulary the tier route actually accepts rather than asserted. Since
  // LV.1.5 that vocabulary is the full bucket set, not just the tier letters.
  const fresh = at.closest(`[${DROP_ATTR.fresh}]`)?.getAttribute(DROP_ATTR.fresh)
  if (isBucketKey(fresh)) return { kind: 'new', tier: fresh }

  const bucket = at.closest(`[${DROP_ATTR.bucket}]`)
  const bucketKey = bucket?.getAttribute(DROP_ATTR.bucket)
  if (bucketKey) return { kind: 'bucket', bucketKey }

  return null
}

/** `<bucketKey>:<index>`; bucket keys are S–F, `r1`–`r30`, `c1`–`c4`, `all`. */
function parseSlot(value: string | null): { bucketKey: string; index: number } | null {
  if (!value) return null
  const split = value.lastIndexOf(':')
  if (split < 0) return null
  const index = Number(value.slice(split + 1))
  if (!Number.isInteger(index) || index < 0) return null
  return { bucketKey: value.slice(0, split), index }
}

/** `CSS.escape` is not in jsdom; the ids are UUIDs, so quoting is enough. */
function cssEscape(value: string): string {
  return value.replace(/["\\]/g, '\\$&')
}

/**
 * One `<DndContext>` for the whole body, in every view style — **and the element
 * that defines what "this surface" means** (R235/R236).
 *
 * It renders the surface's own root rather than accepting one, so the ref cannot
 * be left unattached by a consumer who did not read the hook. Both consumers
 * already wrapped their drop targets in exactly one flex container, so this
 * takes that container over via `className` instead of adding a box: the
 * rendered DOM is unchanged in the detail panel and in the pop-out alike.
 */
export function ListDragContext({
  drag,
  className,
  children,
}: {
  drag: ListDragApi
  /** The class string that used to live on the consumer's own wrapper div. */
  className?: string
  children: React.ReactNode
}) {
  return (
    <DndContext {...drag.contextProps}>
      <div ref={drag.rootRef} className={className}>
        {children}
      </div>
    </DndContext>
  )
}

/**
 * The props that make a row or card draggable. Spread onto the element that
 * carries `data-drop-row` — the whole row, as in the prototype, with the grip as
 * its visual affordance.
 *
 * dnd-kit's `attributes` are deliberately **not** spread. They set
 * `role="button"` and `tabIndex={0}`, which would (a) wrap the row's real
 * buttons — the drafted checkbox and the row menu — in an outer interactive
 * role, and (b) advertise keyboard dragging, which this build does not have:
 * there is no `KeyboardSensor`, because dnd-kit's keyboard coordinate getter
 * moves between *droppables* and this model has none. Recorded as a known gap
 * rather than mimed with ARIA.
 */
export function useDragHandle(entryId: string, disabled: boolean) {
  const { listeners, setNodeRef } = useDraggable({ id: entryId, disabled })
  // A press that starts on the drafted checkbox or the row menu is a press on
  // that control, not the beginning of a drag. dnd-kit's sensors do not filter
  // interactive targets, and the row is the drag surface, so the filter lives
  // here.
  const guarded = React.useMemo(() => guardListeners(listeners), [listeners])
  return { listeners: guarded, setNodeRef }
}

const INTERACTIVE = 'button, a, input, textarea, select, [role="menuitem"], [contenteditable]'

type Listeners = NonNullable<ReturnType<typeof useDraggable>['listeners']>

function guardListeners(listeners: Listeners | undefined): Listeners {
  if (!listeners) return {}
  const out: Listeners = {}
  for (const name of Object.keys(listeners)) {
    const handler = listeners[name]
    if (typeof handler !== 'function') continue
    out[name] = (event: React.SyntheticEvent) => {
      const target = event.target
      if (target instanceof Element && target.closest(INTERACTIVE)) return
      handler(event)
    }
  }
  return out
}

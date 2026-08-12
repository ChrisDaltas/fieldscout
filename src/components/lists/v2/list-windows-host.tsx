'use client'

import { useListWindowsStore } from '@/stores/list-windows-store'

import { ListWindow } from './list-window'

/**
 * Lists v2 — the **app-shell pop-out host** (LV.15, plan §6, **D13**).
 *
 * Design LAW: *"pop-outs are rendered by the **app shell**, not the Lists page,
 * so they survive navigation and stay until closed."* Mounted once in
 * `src/components/layout/app-shell.tsx`, which wraps every `/app/*` route — so
 * a window opened on Lists is still there on Players, on Home, and on a list
 * detail page.
 *
 * ## This is the one Round 2 file that mounts outside `/app/lists`
 *
 * Everything else in this round renders inside the Lists page. This does not,
 * which makes it the only piece able to disturb a screen nobody was working on.
 * So the contract is narrow and **pinned by a test**, not merely intended
 * (D13: *"It renders **nothing** — no wrapper, no portal, no layout box — when
 * no window is open, and that is a test, not an intention"*):
 *
 *   - **With no window open it returns `null` before anything else.** No
 *     wrapper element, no portal, no provider, no layout box — nothing that
 *     could shift a layout or change hydration on any other page.
 *   - `windows` is **not** persisted (D13), so it is empty on every first
 *     render, server and client alike: the host renders nothing during SSR and
 *     nothing at hydration, on every route, until someone opens a window.
 *   - It reads exactly one store and nothing else. There is no query, no
 *     effect, and no subscription on the empty path.
 *
 * ## Two windowing systems now coexist, and the order between them is a choice
 *
 * `player-windows-layer.tsx` (mounted in the **root** layout) already floats
 * the player mini cards at `z-index: 60 + i`. Rather than interleave, this
 * layer sits **below** it at a single `z-index: 45`:
 *
 * | Layer | z | Why there |
 * | --- | --- | --- |
 * | toasts | 100 | must beat everything |
 * | player mini cards | 60+ | a card opened **from a pop-out row** (LV.16 wires the name) has to land in front of the window that spawned it |
 * | Radix dialogs / menus / popovers | 50 | a modal covers a pop-out, and the `dots` menu LV.16 puts *in* the header opens above its own window |
 * | **pop-outs** | **45** | above all page chrome, below every overlay |
 * | rail strip, bottom tabs, mobile top nav | 40 | page chrome |
 *
 * **One number for the whole layer, not `45 + i`.** Relative order inside the
 * layer is carried by DOM order — the array is back-to-front (D13), these are
 * siblings in one fragment, and React reorders keyed siblings on a `focus()`,
 * so the last entry paints last. Numbering per window would instead put a sixth
 * pop-out at 50, inside the dialog layer, which is the kind of drift nobody
 * notices until a menu opens behind a window. (This is also why the windows are
 * **not** portalled: `createPortal` appends on mount and does not re-order on a
 * reorder, so DOM order would freeze at open order and stacking would need the
 * numbers back. `window-shell.tsx` portals *and* numbers, which is the same
 * decision made the other way for a layer that has no upper neighbour.)
 */

/** See the table above. Above page chrome (40), below Radix (50) and mini cards (60). */
const LIST_WINDOW_Z = 45

export function ListWindowsHost() {
  const windows = useListWindowsStore((state) => state.windows)

  // Nothing open → nothing rendered. This early return is the whole contract of
  // this file; `list-windows-host.test.ts` fails if it moves or goes.
  if (windows.length === 0) return null

  return (
    <>
      {windows.map((win, index) => (
        <ListWindow
          key={win.listId}
          listId={win.listId}
          stackIndex={index}
          zIndex={LIST_WINDOW_Z}
        />
      ))}
    </>
  )
}

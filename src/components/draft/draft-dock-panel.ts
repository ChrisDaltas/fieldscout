'use client'

import { createContext, useContext } from 'react'

/**
 * The dock's ONE in-panel dismissal — spec §16.4's dock paragraph, tasks-DR
 * D150/D151; added by M3 task L.C3.3's fix cycle (R446, PROGRESS D196).
 *
 * ## Why this exists
 *
 * The dock panel is a true overlay at a fixed open height (D151:
 * `min(60vh, 640px)` on desktop), absolutely positioned OVER the board.
 * At 1280×800 — and at 1366×768 and 1440×810 — that covers the auction
 * block's nomination composer. So the auction player table's **Nominate**
 * row action, which SELECTS a player into that composer rather than
 * writing (§8.6.2: the opening bid is part of the action), handed the
 * player to a control the user could not reach, with a 30s nomination
 * clock running and no page scroll to recover it. Select → submit has to
 * be ONE gesture.
 *
 * ## Why a context rather than a prop on `DraftDock`
 *
 * D119(6) and its pin (`draft-dock.test.ts`: *"the dock exposes NO
 * external open/close API a dialog could trip"*) exist because a Radix
 * Dialog opened from inside a Sheet registers as an outside interaction
 * and collapses its host, taking the child dialog with it. That pin's
 * substance is that **nothing outside the dock can move its state** — and
 * this context keeps it exactly: the provider wraps the open panel's BODY
 * and nothing else, so only a component rendered INSIDE the open panel can
 * reach it. The room-level `AddDraftListModal` is mounted outside the dock
 * (D119(6)'s own requirement) and therefore still cannot see it, and
 * `DraftDockProps` still carries no `open`/`onOpenChange`.
 *
 * The value is a STABLE callback, not state — CLAUDE.md's "never use React
 * Context for data that changes frequently" is about churning data, and
 * this never changes identity at all.
 *
 * `null` outside a dock panel: a panel body that is also mounted somewhere
 * else must degrade to "no dock to close", never crash.
 */
export const DockPanelCloseContext = createContext<(() => void) | null>(null)

/** The close callback for the panel this component is rendered inside, or
 *  `null` when it is not inside one. */
export function useDockPanelClose(): (() => void) | null {
  return useContext(DockPanelCloseContext)
}

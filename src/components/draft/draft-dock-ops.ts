/**
 * Dock view model (spec §16.4's dock paragraph, §16.2 `draft-dock`;
 * tasks-DR DR.5, D150/D151) — the pure state machine for the bottom dock's
 * tab strip, pinned by a golden table in `draft-dock-ops.test.ts`.
 *
 * The state is a SINGLE scalar (`DockState = DockTabId | null`), which is
 * D150's "exactly one panel open at a time — two open panels is a rail
 * again" carried by the type itself: there is no representation in which
 * two panels are open. `openPanelIds` is the derivation the golden
 * enumerates over every transition.
 *
 * Transitions (D150, verbatim): tapping a tab opens its panel; tapping the
 * ACTIVE tab toggles it closed; tapping another tab switches (still one
 * open); Escape closes; default state is CLOSED (requirement 2's stated
 * purpose — "a focused view on just the draft board").
 *
 * Tab labels: TODAY'S room labels, deliberately (tasks-DR DR.5 item 6) —
 * the "Targets" rename is D140's product-wide sweep and belongs to L.C3.1,
 * whose banner (tasks-M3 §6) already enumerates the dock's tab label as a
 * sweep site (added 2026-08-17). Half-renaming here would fork the copy.
 */

export type DockTabId = 'players' | 'queue' | 'roster' | 'lists' | 'chat'

export interface DockTab {
  id: DockTabId
  label: string
}

/** The five tabs, in strip order — the five SHIPPED panels the dock
 *  re-hosts (§4.2 rehost-don't-rebuild): Available players, My queue
 *  (Targets at L.C3.1), My roster, My lists, Draft chat. */
export const DOCK_TABS: readonly DockTab[] = [
  { id: 'players', label: 'Players' },
  { id: 'queue', label: 'Queue' },
  { id: 'roster', label: 'Roster' },
  { id: 'lists', label: 'Lists' },
  { id: 'chat', label: 'Chat' },
]

/** `null` = closed (the default — the focused board view is the point). */
export type DockState = DockTabId | null

export type DockAction =
  | { type: 'toggle'; tab: DockTabId }
  | { type: 'close' }
  | { type: 'escape' }

export function dockReducer(state: DockState, action: DockAction): DockState {
  switch (action.type) {
    case 'toggle':
      // Active tab closes; any other tab switches to it (one open).
      return state === action.tab ? null : action.tab
    case 'close':
    case 'escape':
      return null
  }
}

/** The single-open derivation the golden enumerates: `[]` or `[state]` —
 *  never longer, by construction of `DockState`. */
export function openPanelIds(state: DockState): readonly DockTabId[] {
  return state === null ? [] : [state]
}

/** DOM id for a tab's strip button — the focus-return target on close and
 *  the other end of the panel's `aria-labelledby`-free labeling. */
export function dockTabButtonId(tab: DockTabId): string {
  return `draft-dock-tab-${tab}`
}

/** DOM id for a tab's slide-up panel — the `aria-controls` target (set
 *  only while that panel is mounted; a dangling idref is the R270 class of
 *  invalid-ARIA defect). */
export function dockPanelId(tab: DockTabId): string {
  return `draft-dock-panel-${tab}`
}

/**
 * Where focus goes after a transition (D150: focus enters the panel on
 * open and RETURNS TO THE TAB BUTTON on close). Returns the tab whose
 * button should receive focus, or null when the transition was not a
 * close (an open/switch focuses the panel instead; no-ops focus nothing).
 */
export function focusReturnTarget(prev: DockState, next: DockState): DockTabId | null {
  return prev !== null && next === null ? prev : null
}

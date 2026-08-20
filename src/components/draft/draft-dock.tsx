'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

import { cn } from '@/lib/utils'

import { DockPanelCloseContext } from './draft-dock-panel'
import {
  DOCK_TABS,
  dockPanelId,
  dockReducer,
  dockTabButtonId,
  focusReturnTarget,
  type DockAction,
  type DockState,
  type DockTabId,
} from './draft-dock-ops'

interface DraftDockProps {
  /** Panel bodies keyed by tab id — the five SHIPPED components (pool,
   *  queue, tracker, lists, chat), composed by the ROOM so their props and
   *  data flow stay exactly where M2 put them (§4.2 rehost-don't-rebuild).
   *  The dock owns hosting and nothing else. */
  panels: Record<DockTabId, React.ReactNode>
}

/**
 * The bottom dock — spec §16.2 `draft-dock`, §16.4's dock paragraph (v2.12;
 * Chris's requirement (2): *"tabs across the bottom of the screen that
 * slide up and down"*); tasks-DR DR.5, D150/D151/D152.
 *
 * A persistent tab strip across the room's bottom edge at EVERY width —
 * this replaces both the M2 desktop rail (deleted in DR.4) and the M2
 * mobile four-way pane switcher, so there is ONE pattern on both platforms
 * (§16.4's v2.12 reconciliation). Tapping a tab slides its panel up OVER
 * the board; tapping the active tab (or Escape, or the panel's close
 * affordance — the tab IS the close affordance) dismisses it. Default
 * closed: a user who opens nothing sees the board and the state of the
 * draft, and nothing else (§16.3 "the board is the room").
 *
 * NON-MODAL by decision (D150): no focus trap, nothing `inert`, no scroll
 * lock, no click-swallowing backdrop — the board, clock, presence and
 * command bar stay visible and operable behind an open panel (watching the
 * clock while browsing the pool IS the draft-night workflow). This is
 * deliberately NOT the shipped Radix Sheet/Dialog, which traps focus and
 * marks the page inert by design. Focus enters the panel on open and
 * returns to its tab button on close; Escape (from within the dock —
 * non-modal means we take no document-level key ownership) closes.
 *
 * The panel is ABSOLUTELY positioned over the board at a FIXED open height
 * (D151: `dock-panel` = min(60vh, 640px) desktop / `dock-panel-mobile` =
 * 75vh below `lg` — tailwind.config tokens, not arbitrary classes). Being
 * out of flow is the geometry contract: the board zone's size cannot
 * change when a panel opens or closes. No drag-to-resize in v1 (D151).
 *
 * ARIA: the strip is a toolbar of disclosure toggles — `aria-expanded` +
 * `aria-controls` on each tab button, the panel an `aria-label`'d region.
 * Deliberately NOT `role="tab"`/`role="tabpanel"`: a tablist's panels are
 * always-one-selected and arrow-key-navigated, and a partial tabs pattern
 * over toggle-closed semantics would be the R270 class of invalid ARIA.
 * D150's substance — non-modal, expanded-state wiring, focus return — is
 * what this implements.
 */
export function DraftDock({ panels }: DraftDockProps) {
  const [open, setOpen] = useState<DockState>(null)
  const prevOpenRef = useRef<DockState>(null)
  const panelRef = useRef<HTMLDivElement | null>(null)

  const dispatch = (action: DockAction) => {
    setOpen((current) => dockReducer(current, action))
  }

  // The ONE in-panel dismissal (R446 — see `draft-dock-panel.ts` for why it
  // is a context and not a prop). Stable identity, and it goes through the
  // same pure reducer every other transition does.
  const closePanel = useCallback(() => {
    setOpen((current) => dockReducer(current, { type: 'close' }))
  }, [])

  // D150's focus contract, effect-side: into the panel on open/switch,
  // back to the owning tab button on close.
  useEffect(() => {
    const prev = prevOpenRef.current
    prevOpenRef.current = open
    if (open !== null && open !== prev) {
      panelRef.current?.focus({ preventScroll: true })
      return
    }
    const returnTo = focusReturnTarget(prev, open)
    if (returnTo !== null) {
      document.getElementById(dockTabButtonId(returnTo))?.focus()
    }
  }, [open])

  const openTab = open !== null ? DOCK_TABS.find((tab) => tab.id === open) : undefined

  return (
    <div
      className="relative z-30 shrink-0"
      onKeyDown={(event) => {
        if (event.key === 'Escape' && open !== null) {
          event.stopPropagation()
          dispatch({ type: 'escape' })
        }
      }}
    >
      {openTab && (
        // D152 exception, stated: the open dock panel is a TRUE OVERLAY —
        // it floats above the board (absolutely positioned, out of flow),
        // so it keeps a RESTING shadow deliberately (`shadow-hard-up-6`,
        // cast upward onto the board it covers). C48 measured (D176(7)):
        // `elevation-rule.test.ts` sweeps `src/components/ui` only, so no
        // OVERLAY_FILES entry is owed for this file; the comment is the
        // D152 requirement and `draft-dock.test.ts` pins it.
        <div
          ref={panelRef}
          role="region"
          id={dockPanelId(openTab.id)}
          aria-label={openTab.label}
          tabIndex={-1}
          className="absolute inset-x-0 bottom-full h-dock-panel-mobile overflow-y-auto border-t border-ink bg-page p-3 shadow-hard-up-6 outline-none lg:h-dock-panel"
        >
          {/* Scoped to the OPEN PANEL'S BODY deliberately: only something
              rendered inside the panel can dismiss it, so D119(6)'s
              room-level modal — mounted outside the dock — still cannot
              trip it, and `DraftDockProps` still exposes no open/close
              API. R446 / D196. */}
          <DockPanelCloseContext.Provider value={closePanel}>
            {panels[openTab.id]}
          </DockPanelCloseContext.Provider>
        </div>
      )}

      {/* D152 exception, stated: the tab strip is pinned chrome over
          scrolling content (the board zone scrolls behind its top edge —
          CLAUDE.md's "bars pinned over scrolling content" overlay clause),
          so it keeps a RESTING shadow deliberately (`shadow-hard-up-4`,
          the upward member — a downward shadow would fall off-screen). */}
      <div
        role="toolbar"
        aria-label="Draft panels"
        className="flex h-11 w-full items-center gap-1 overflow-x-auto border-t border-ink bg-white px-2 shadow-hard-up-4"
      >
        {DOCK_TABS.map((tab) => {
          const isOpen = open === tab.id
          return (
            <button
              key={tab.id}
              type="button"
              id={dockTabButtonId(tab.id)}
              aria-expanded={isOpen}
              // Set only while the panel exists — a dangling idref is the
              // R270 class of invalid ARIA.
              aria-controls={isOpen ? dockPanelId(tab.id) : undefined}
              onClick={() => dispatch({ type: 'toggle', tab: tab.id })}
              className={cn(
                'flex h-btn-md shrink-0 items-center rounded-sm border px-2.5 text-[12px] font-bold transition-colors',
                // Open-state emphasis is fill + border, never a shadow
                // (D152's ordinary rule for state).
                isOpen
                  ? 'border-accent bg-accent-soft'
                  : 'border-transparent text-n-2 hover:border-ink hover:text-ink',
              )}
            >
              {tab.label}
            </button>
          )
        })}
      </div>
    </div>
  )
}

import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'

import {
  columnsReducer,
  DEFAULT_VISIBLE_COLUMNS,
  type AuctionColumnKey,
} from '@/components/draft/auction-player-table-ops'

/**
 * Which columns the auction player table shows — M3 task L.C3.3 (spec
 * §16.4's "Column customization: add/remove stat columns + a
 * Reset-to-default"; the banner's item 2 puts it in Zustand per CLAUDE.md's
 * client-only-UI-state rule, "persistence latitude recorded by the
 * Builder"; PROGRESS D194).
 *
 * **PERSISTED, deliberately** — the `rail-store` shape, not
 * `list-display-store`'s session-only one. Two reasons, both draft-night:
 * a room gets RELOADED (a two-tab takeover releases the old tab, a
 * reconnect can end in a refresh, and people rejoin from a second device),
 * and rebuilding a column layout while a nomination clock runs is exactly
 * the wrong moment to make someone re-pick anything. A search term
 * resetting on reload is fine; a table layout is furniture.
 *
 * The usual hydration hazard of a persisted store — server HTML rendered
 * from the default, client HTML rendered from localStorage — **cannot
 * reach this one**: the table lives inside the dock's Players panel, the
 * dock's state starts CLOSED (`DockState = null`, `draft-dock-ops.ts`) and
 * only a click can open it, so nothing this store feeds has ever been part
 * of a server render. If the table is ever hosted somewhere that renders
 * on the server, that host owes a mounted-flag gate (see `ResearchRail`).
 *
 * The transition function itself is NOT here: `columnsReducer` and
 * `DEFAULT_VISIBLE_COLUMNS` are pure and golden-pinned in
 * `auction-player-table-ops.test.ts`, and this store only applies them —
 * so the customizer's behaviour is tested without mounting a browser.
 */
interface AuctionColumnsStore {
  /** Visible column keys, always in catalog order (the reducer's job). */
  visible: AuctionColumnKey[]
  toggle: (column: AuctionColumnKey) => void
  reset: () => void
}

export const AUCTION_COLUMNS_STORAGE_KEY = 'fieldscout.auction-columns'

export const useAuctionColumnsStore = create<AuctionColumnsStore>()(
  persist(
    (set) => ({
      visible: [...DEFAULT_VISIBLE_COLUMNS],
      toggle: (column) =>
        set((state) => ({ visible: columnsReducer(state.visible, { type: 'toggle', column }) })),
      reset: () => set({ visible: columnsReducer([], { type: 'reset' }) }),
    }),
    {
      name: AUCTION_COLUMNS_STORAGE_KEY,
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({ visible: state.visible }),
    },
  ),
)

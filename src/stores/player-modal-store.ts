import { create } from 'zustand'

import type { PlayerListContext } from '@/components/players/player-detail-actions'

/**
 * The player view modal (D486(13), Chris 2026-10-04: "I also think it works
 * better as a modal window and not a separate page"). One at a time — the
 * decision view. The floating mini card stays the quick peek (its own store);
 * its expand icon, "Open player view" and search results open this.
 * `leagueId` carries the league context the card had (the page's `?league=`).
 */
export interface PlayerModalTarget {
  playerId: string
  leagueId: string | null
  /** Opened from a list the viewer owns → the modal offers "Remove from
   *  list" (Chris 2026-10-05, D494). Null everywhere else. */
  listContext: PlayerListContext | null
}

interface PlayerModalStore {
  target: PlayerModalTarget | null
  openPlayerView: (playerId: string, leagueId?: string | null, listContext?: PlayerListContext | null) => void
  closePlayerView: () => void
}

export const usePlayerModalStore = create<PlayerModalStore>()((set) => ({
  target: null,
  openPlayerView: (playerId, leagueId = null, listContext = null) =>
    set({ target: { playerId, leagueId, listContext } }),
  closePlayerView: () => set({ target: null }),
}))

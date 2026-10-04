import { create } from 'zustand'

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
}

interface PlayerModalStore {
  target: PlayerModalTarget | null
  openPlayerView: (playerId: string, leagueId?: string | null) => void
  closePlayerView: () => void
}

export const usePlayerModalStore = create<PlayerModalStore>()((set) => ({
  target: null,
  openPlayerView: (playerId, leagueId = null) => set({ target: { playerId, leagueId } }),
  closePlayerView: () => set({ target: null }),
}))

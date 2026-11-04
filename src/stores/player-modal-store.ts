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
  /** The view went because a door is leaving the page, not because it was
   *  closed. `PlayerModalUrlSync` then leaves the URL alone: stripping
   *  `?player=` there is a `router.replace` to the page being left, and the
   *  newest navigation wins, so the door's own would be discarded (F881). */
  leftPage: boolean
  openPlayerView: (playerId: string, leagueId?: string | null, listContext?: PlayerListContext | null) => void
  closePlayerView: () => void
  leavePlayerView: () => void
}

export const usePlayerModalStore = create<PlayerModalStore>()((set) => ({
  target: null,
  leftPage: false,
  openPlayerView: (playerId, leagueId = null, listContext = null) =>
    set({ target: { playerId, leagueId, listContext }, leftPage: false }),
  closePlayerView: () => set({ target: null, leftPage: false }),
  leavePlayerView: () => set({ target: null, leftPage: true }),
}))

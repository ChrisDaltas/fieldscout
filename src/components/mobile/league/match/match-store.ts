'use client'

import { create } from 'zustand'

import type { MatchSpot } from './match-ops'

/**
 * Where the Match tab was left, per league (handoff m-match §3.2 item 7 /
 * m-navgraph tab bar): the swiped matchup (`mi`) and a week other than the
 * ladder's current one outlive the tab. Coming back to Match from Team,
 * Players, League or Home restores them; a re-tap of Match while it is
 * already showing forgets them (your matchup, the current week). In memory
 * only — a fresh load starts on your matchup.
 */
interface MatchStore {
  spots: Record<string, MatchSpot>
  remember: (leagueId: string, spot: MatchSpot) => void
  forget: (leagueId: string) => void
}

export const useMatchStore = create<MatchStore>((set) => ({
  spots: {},
  remember: (leagueId, spot) =>
    set((s) => {
      const prev = s.spots[leagueId]
      if (prev && prev.matchupId === spot.matchupId && prev.week === spot.week) return s
      return { spots: { ...s.spots, [leagueId]: spot } }
    }),
  forget: (leagueId) =>
    set((s) => {
      if (!(leagueId in s.spots)) return s
      const spots = { ...s.spots }
      delete spots[leagueId]
      return { spots }
    }),
}))

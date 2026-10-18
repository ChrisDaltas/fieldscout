'use client'

import { create } from 'zustand'

import { NO_FILTER, type LeagueSegment, type TxFilter } from './league-tab-ops'

/**
 * League tab UI state that outlives a screen (handoff m-league §3): the
 * last segment per league (leave the League tab and come back to the same
 * one — a re-tap does not reset it), the week League › Matchups was
 * stepped to (gap list §4 item 9 — Back from a matchup, or a trip to
 * Standings, comes back to that week; none kept = the ladder's current
 * week, so the default follows the season), and the Transaction filters,
 * which League › Activity and the Transactions screen share and which
 * survive leaving Transactions. In memory only — a fresh load starts on
 * the current week.
 */
interface LeagueTabStore {
  segments: Record<string, LeagueSegment>
  setSegment: (leagueId: string, segment: LeagueSegment) => void
  weeks: Record<string, number>
  /** `null` forgets the league's week (back to the current one). */
  setWeek: (leagueId: string, week: number | null) => void
  filters: Record<string, TxFilter>
  setFilter: (leagueId: string, patch: Partial<TxFilter>) => void
}

export const useLeagueTabStore = create<LeagueTabStore>((set) => ({
  segments: {},
  setSegment: (leagueId, segment) => set((s) => ({ segments: { ...s.segments, [leagueId]: segment } })),
  weeks: {},
  setWeek: (leagueId, week) =>
    set((s) => {
      const weeks = { ...s.weeks }
      if (week === null) delete weeks[leagueId]
      else weeks[leagueId] = week
      return { weeks }
    }),
  filters: {},
  setFilter: (leagueId, patch) =>
    set((s) => ({ filters: { ...s.filters, [leagueId]: { ...(s.filters[leagueId] ?? NO_FILTER), ...patch } } })),
}))

/** One league's filter (stable default). */
export function useTxFilter(leagueId: string): [TxFilter, (patch: Partial<TxFilter>) => void] {
  const filter = useLeagueTabStore((s) => s.filters[leagueId]) ?? NO_FILTER
  const setFilter = useLeagueTabStore((s) => s.setFilter)
  return [filter, (patch) => setFilter(leagueId, patch)]
}

/** The week League › Matchups was stepped to in this league (`undefined` =
 *  none kept: the current week), and the setter (`null` forgets it). */
export function useKeptWeek(leagueId: string): [number | undefined, (week: number | null) => void] {
  const kept = useLeagueTabStore((s) => s.weeks[leagueId])
  const setWeek = useLeagueTabStore((s) => s.setWeek)
  return [kept, (week) => setWeek(leagueId, week)]
}

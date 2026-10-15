'use client'

import { create } from 'zustand'

import { NO_FILTER, type LeagueSegment, type TxFilter } from './league-tab-ops'

/**
 * League tab UI state that outlives a screen (handoff m-league §3): the
 * last segment per league (leave the League tab and come back to the same
 * one — a re-tap does not reset it), and the Transaction filters, which
 * League › Activity and the Transactions screen share and which survive
 * leaving Transactions.
 */
interface LeagueTabStore {
  segments: Record<string, LeagueSegment>
  setSegment: (leagueId: string, segment: LeagueSegment) => void
  filters: Record<string, TxFilter>
  setFilter: (leagueId: string, patch: Partial<TxFilter>) => void
}

export const useLeagueTabStore = create<LeagueTabStore>((set) => ({
  segments: {},
  setSegment: (leagueId, segment) => set((s) => ({ segments: { ...s.segments, [leagueId]: segment } })),
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

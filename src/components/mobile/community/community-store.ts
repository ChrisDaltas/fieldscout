import { create } from 'zustand'

import {
  RANK_FILTERS_ALL,
  type CommunityTab,
  type CommunityTopic,
  type RankFilters,
} from '@/components/mobile/community/community-ops'

/**
 * Community's UI state (handoff m-community §4: "State persists across
 * visits: tab, topic, query, … rank filters"). Client-only, in memory for
 * the session — leaving Community and coming back finds it as it was.
 */
interface CommunityState {
  tab: CommunityTab
  topic: CommunityTopic | null
  searchOpen: boolean
  /** The raw query — whitespace-only reads as no query. */
  query: string
  rk: RankFilters
  /** The open detail was reached from the feed (so Back is a history pop). */
  detailFromFeed: boolean

  setTab: (tab: CommunityTab) => void
  toggleTopic: (topic: CommunityTopic) => void
  openSearch: () => void
  closeSearch: () => void
  setQuery: (query: string) => void
  /** Global search's person result (handoff §4): For you, search open,
   *  filtered by that handle. Topic is kept, as in the prototype. */
  searchFor: (query: string) => void
  setRank: (patch: Partial<RankFilters>) => void
  /** Empty-state link: query, tab and topic back to For you. */
  clearFilters: () => void
  resetRankFilters: () => void
  setDetailFromFeed: (v: boolean) => void
}

export const useCommunityStore = create<CommunityState>()((set) => ({
  tab: 'all',
  topic: null,
  searchOpen: false,
  query: '',
  rk: RANK_FILTERS_ALL,
  detailFromFeed: false,

  setTab: (tab) => set({ tab }),
  toggleTopic: (topic) =>
    set((s) => ({ topic: s.topic && s.topic.kind === topic.kind && s.topic.id === topic.id ? null : topic })),
  openSearch: () => set({ searchOpen: true }),
  closeSearch: () => set({ searchOpen: false, query: '' }),
  setQuery: (query) => set({ query }),
  searchFor: (query) => set({ tab: 'all', searchOpen: true, query }),
  setRank: (patch) => set((s) => ({ rk: { ...s.rk, ...patch } })),
  clearFilters: () => set({ query: '', tab: 'all', topic: null }),
  resetRankFilters: () => set({ rk: RANK_FILTERS_ALL }),
  setDetailFromFeed: (detailFromFeed) => set({ detailFromFeed }),
}))

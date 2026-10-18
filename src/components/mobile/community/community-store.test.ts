/**
 * Community's in-memory UI state — what a list started from Community comes
 * back to (gap list §3 #8): For you, no topic, search closed (the handoff's
 * `post()`), with Community's reads marked stale so the new list shows.
 */
import { QueryClient } from '@tanstack/react-query'
import { beforeEach, describe, expect, it } from 'vitest'

import { RANK_FILTERS_ALL, type RankFilters } from '@/components/mobile/community/community-ops'
import { mobileCommunityKeys } from '@/hooks/use-mobile-community-feed'

import { refreshCommunity, useCommunityStore } from './community-store'

beforeEach(() => {
  useCommunityStore.setState({ tab: 'all', topic: null, searchOpen: false, query: '', rk: RANK_FILTERS_ALL })
})

describe('refreshCommunity', () => {
  it('puts Community back on For you: no topic, no query, search closed; the Rankings chips stay', () => {
    const rk: RankFilters = { ...RANK_FILTERS_ALL, pos: 'RB' }
    useCommunityStore.setState({
      tab: 'list',
      topic: { kind: 'tag', id: 'sleepers', label: 'sleepers' },
      searchOpen: true,
      query: 'puka',
      rk,
    })
    refreshCommunity(new QueryClient())
    const s = useCommunityStore.getState()
    expect(s).toMatchObject({ tab: 'all', topic: null, searchOpen: false, query: '' })
    expect(s.rk).toEqual(rk)
  })

  it('marks every Community read stale — the feed and the Latest page — and nothing else', () => {
    const qc = new QueryClient()
    qc.setQueryData(mobileCommunityKeys.pool(), { items: [] })
    qc.setQueryData(mobileCommunityKeys.latestPages(), { pages: [] })
    qc.setQueryData(['lists', 'detail', 'l1'], { id: 'l1' })
    refreshCommunity(qc)
    expect(qc.getQueryState(mobileCommunityKeys.pool())?.isInvalidated).toBe(true)
    expect(qc.getQueryState(mobileCommunityKeys.latestPages())?.isInvalidated).toBe(true)
    expect(qc.getQueryState(['lists', 'detail', 'l1'])?.isInvalidated).toBe(false)
  })
})

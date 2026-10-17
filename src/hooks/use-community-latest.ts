'use client'

import { useInfiniteQuery } from '@tanstack/react-query'

import {
  mapCommunityRows,
  mobileCommunityKeys,
  publicListsQuery,
  type CommunityItem,
  type CommunityRow,
} from '@/hooks/use-mobile-community-feed'
import { createBrowserClient } from '@/lib/supabase/client'

/**
 * FieldScout Mobile — the Latest page (For you's "Latest" shelf → See all,
 * Chris 2026-10-16: "a page with a simple literal most recent"). Everything
 * the shelf draws from — public, not deleted, with players — simply newest
 * POSTED first (`created_at`, then the id for a total order), no popularity.
 *
 * Paged with `.range()`, LATEST_PAGE_SIZE rows a read, for as long as a read
 * comes back full — never one capped read passed off as all of them
 * (PostgREST stops at 1000 rows). A short page is the end. Pages are read by
 * offset, so a list posted between two reads can push a row already shown
 * onto the next page: the screen shows each once (`latestPageItems`).
 */

export const LATEST_PAGE_SIZE = 20

/** No likes are read here: the page orders by time alone. */
const NO_LIKES: ReadonlyMap<string, number[]> = new Map()

export interface LatestPage {
  items: CommunityItem[]
  /** Where the next read starts; null when this read was the last. */
  next: number | null
}

/** One page of the Latest page, starting at row `from`. */
export async function readLatestPage(from: number): Promise<LatestPage> {
  const { data, error } = await publicListsQuery(createBrowserClient())
    .order('created_at', { ascending: false, nullsFirst: false })
    .order('id', { ascending: false })
    .range(from, from + LATEST_PAGE_SIZE - 1)
  if (error) throw error
  const rows = (data ?? []) as unknown as CommunityRow[]
  return {
    items: mapCommunityRows(rows, NO_LIKES),
    next: rows.length < LATEST_PAGE_SIZE ? null : from + rows.length,
  }
}

/** The Latest page, a page at a time (`fetchNextPage` reads the next). */
export function useCommunityLatest() {
  return useInfiniteQuery({
    queryKey: mobileCommunityKeys.latestPages(),
    initialPageParam: 0,
    queryFn: ({ pageParam }) => readLatestPage(pageParam),
    getNextPageParam: (last: LatestPage) => last.next ?? undefined,
    staleTime: 60 * 1000,
  })
}

'use client'

import { useInfiniteQuery } from '@tanstack/react-query'

import { LeagueActionError, sendLeagueAction } from '@/lib/leagues/api/client-fetch'
import type { StatCorrectionsPage } from '@/lib/leagues/api/corrections-service'

/**
 * The league's stat corrections — M6 task L.E2.3 (`GET …/corrections?week=`;
 * spec §15.3 / §23.4; PROGRESS D453 / D454). Only corrections that CHANGED a
 * league score are listed (Q81): each in plain words — the player, the stat,
 * old → new, the team, his points and the team score before → after, and the
 * result change once the week's games were over.
 *
 * READ ONLY, paged newest first: `fetchNextPage` follows the server's opaque
 * `next_cursor` ("show older"). An empty first page carries the server's
 * `note` ("No stat correction changed a score in this league in Week 3.") —
 * render it, never infer emptiness.
 *
 * DEPLOY BEFORE PUSH (TD15): a database without migration 172 answers a
 * named 503, and the page says `unavailable` with the server's sentence —
 * a caller shows that, never an empty list and never an error screen.
 *
 * No realtime yet — the records' own broadcast ships with the corrections
 * view, their first subscriber (F527, L.E2.4).
 */
export const statCorrectionsKeys = {
  /** Everything for one league — the invalidation target. */
  all: (leagueId: string) => ['league-stat-corrections', leagueId] as const,
  list: (leagueId: string, filters: StatCorrectionsFilters) =>
    ['league-stat-corrections', leagueId, { week: filters.week ?? null, limit: filters.limit ?? null }] as const,
}

export interface StatCorrectionsFilters {
  /** One NFL week; omit for every week. */
  week?: number
  limit?: number
}

export type StatCorrectionsState =
  | { state: 'known'; page: StatCorrectionsPage }
  /** 172 not pushed yet (the named 503) — say so; nothing to list. */
  | { state: 'unavailable'; reason: string }

/** Only the params that are SET reach the query string. */
export function statCorrectionsSearchParams(filters: StatCorrectionsFilters, cursor?: string): string {
  const params = new URLSearchParams()
  if (filters.week !== undefined) params.set('week', String(filters.week))
  if (filters.limit !== undefined) params.set('limit', String(filters.limit))
  if (cursor) params.set('cursor', cursor)
  const query = params.toString()
  return query ? `?${query}` : ''
}

export async function fetchStatCorrections(
  leagueId: string,
  filters: StatCorrectionsFilters,
  cursor?: string,
): Promise<StatCorrectionsState> {
  try {
    const page = await sendLeagueAction<StatCorrectionsPage>(
      `/api/leagues/${leagueId}/corrections${statCorrectionsSearchParams(filters, cursor)}`,
    )
    return { state: 'known', page }
  } catch (error) {
    if (error instanceof LeagueActionError && error.status === 503) return { state: 'unavailable', reason: error.message }
    throw error
  }
}

/** Pure: the next page's cursor, or undefined when the list is done (or unavailable). Exported for its pins. */
export function statCorrectionsNextCursor(last: StatCorrectionsState): string | undefined {
  return last.state === 'known' && last.page.has_more && last.page.next_cursor ? last.page.next_cursor : undefined
}

export function useStatCorrections(leagueId: string | undefined, filters: StatCorrectionsFilters = {}) {
  return useInfiniteQuery({
    queryKey: statCorrectionsKeys.list(leagueId ?? 'none', filters),
    enabled: Boolean(leagueId),
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) => fetchStatCorrections(leagueId!, filters, pageParam),
    getNextPageParam: statCorrectionsNextCursor,
    retry: false,
  })
}

'use client'

import { useInfiniteQuery, useQueryClient } from '@tanstack/react-query'

import { statCorrectionPostWeek } from '@/lib/leagues/api/activity-service'
import { LeagueActionError, sendLeagueAction } from '@/lib/leagues/api/client-fetch'
import { CORRECTIONS_UNAVAILABLE_MESSAGE } from '@/lib/leagues/api/corrections-copy'
import type { StatCorrectionsPage } from '@/lib/leagues/api/corrections-service'

import { useLeagueChannel } from './use-league-channel'
import {
  correctionsEventInvalidates,
  invalidatingHandlers,
  type LeagueBroadcastEnvelope,
  type LeagueChannelEvent,
} from './use-league-channel-ops'

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
 * named 503, and the page says `unavailable` with the server's sentence (only
 * THAT sentence — any other 503 still throws; R1350) —
 * a caller shows that, never an empty list and never an error screen.
 *
 * LIVE (M6 L.E2.4 — F527): `useStatCorrectionsLive` joins the ONE
 * refcounted `league:<id>` room (never a second `.channel(`) and refetches
 * when the scoring door's correction post arrives — the post is written in
 * the same transaction as the records it announces (D453(4)), so it is their
 * carrier and no records trigger is needed (`CORRECTIONS_INVALIDATING_EVENTS`,
 * narrowed by `statCorrectionsEventEffect`). Every confirmed (re)join and a
 * return to the tab refetch too (a dropped broadcast is never relied on).
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
    // R1350: only THE named 503 means "172 not pushed yet"; any other 503 is an error.
    if (error instanceof LeagueActionError && error.status === 503 && error.message === CORRECTIONS_UNAVAILABLE_MESSAGE) {
      return { state: 'unavailable', reason: error.message }
    }
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
    // F527: the list is a record of what changed while the viewer was away —
    // a return to the tab re-reads it (the app's default is off).
    refetchOnWindowFocus: true,
  })
}

export type StatCorrectionsEventEffect = 'refetch' | 'ignore'

/**
 * Pure: does this broadcast mean the corrections list may have grown? Only
 * the scoring door's correction post does — a SYSTEM post with NO actor and
 * the door's prefix (`statCorrectionPostWeek`, R1349's two markers). A
 * filtered list ignores a post naming another week. Every other event, chat
 * message and commissioner notice is inert.
 */
export function statCorrectionsEventEffect(
  event: string,
  envelope: LeagueBroadcastEnvelope | null | undefined,
  week?: number,
): StatCorrectionsEventEffect {
  if (!correctionsEventInvalidates(event)) return 'ignore'
  const record = envelope?.record
  if (!record || record.is_system !== true) return 'ignore'
  const actor = typeof record.user_id === 'string' ? record.user_id : null
  const postWeek = statCorrectionPostWeek(typeof record.message === 'string' ? record.message : '', actor)
  if (postWeek === null) return 'ignore'
  if (week !== undefined && postWeek !== week) return 'ignore'
  return 'refetch'
}

/** The handler map `useStatCorrectionsLive` hands the spine — derived from the predicate (R773). */
export function statCorrectionsHandlers(
  week: number | undefined,
  invalidate: () => void,
): Partial<Record<LeagueChannelEvent, (payload: LeagueBroadcastEnvelope) => void>> {
  const handlers: Partial<Record<LeagueChannelEvent, (payload: LeagueBroadcastEnvelope) => void>> = {}
  for (const event of Object.keys(invalidatingHandlers(correctionsEventInvalidates, invalidate)) as LeagueChannelEvent[]) {
    handlers[event] = (payload) => {
      if (statCorrectionsEventEffect(event, payload, week) === 'refetch') invalidate()
    }
  }
  return handlers
}

/** The fetch + subscribe half — what a mounted corrections view (or matchup note) uses. */
export function useStatCorrectionsLive(leagueId: string | undefined, filters: StatCorrectionsFilters = {}) {
  const query = useStatCorrections(leagueId, filters)
  const queryClient = useQueryClient()
  const invalidate = () => {
    if (!leagueId) return
    void queryClient.invalidateQueries({ queryKey: statCorrectionsKeys.all(leagueId) })
  }
  const { connection } = useLeagueChannel(leagueId, statCorrectionsHandlers(filters.week, invalidate), {
    onJoin: invalidate,
    onDrop: invalidate,
  })
  return { ...query, connection }
}

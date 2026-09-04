'use client'

import { useQuery, useQueryClient } from '@tanstack/react-query'

import { sendLeagueAction } from '@/lib/leagues/api/client-fetch'
import type { ActivityFeed } from '@/lib/leagues/api/activity-service'

import { useLeagueChannel, type LeagueChannelHandlers } from './use-league-channel'
import { LEAGUE_CHANNEL_EVENTS, activityEventInvalidates } from './use-league-channel-ops'

/**
 * The league Activity feed — M4 task L.D4.2 (spec §15.3/§13.4; PROGRESS
 * D296/D298).
 *
 * READ: the `GET /api/leagues/[id]/activity` route (§15.3 prints it, so it
 * is a route rather than a direct RLS SELECT — the D92 rule cuts the other
 * way here because the feed MERGES two tables and pages over the union).
 *
 * LIVE: subscribed to `league:<id>` — this hook is the **F42 transactions
 * trigger's consumer** the task names. Freshness is D298's mechanism:
 * broadcast + **refetch on event**, never a cache patch. That is not
 * laziness — D296's payloads are column-selected DB-side (the trigger sends
 * type/teams/players, never claim data), so an event cannot reconstruct a
 * feed row and a patch would render a half-item. The event says "something
 * happened"; the route says what.
 *
 * `transactions` (117/L.D1.9) and `league_chat` (070, LIVE TODAY — the D97
 * in-transaction system posts that 111's Remix confirm and 112's
 * commissioner lineup edit write) are the two invalidating events; a score
 * tick (`matchups`) deliberately does NOT re-fetch this list. **The handler
 * map is DERIVED from that decision, not hand-listed beside it (R773):**
 * the map is `LEAGUE_CHANNEL_EVENTS` filtered through the pure
 * `activityEventInvalidates`, so the predicate SELECTS which events the feed
 * listens to instead of decorating handlers that only exist for the events
 * it would have admitted anyway. Widen the predicate and the feed really
 * does start refetching on score ticks; narrow it and it really does stop.
 *
 * Every confirmed (re)join refetches (§9.3's missed-broadcast recovery), so
 * an open feed heals itself across a reconnect without depending on the
 * events it missed.
 */

export type ActivityKindFilter = 'all' | 'transaction' | 'system'

export interface ActivityFilters {
  kind?: ActivityKindFilter
  /** `transactions.type` values; omit for every type. */
  type?: readonly string[]
  week?: number
  teamId?: string
  limit?: number
  /** Cursor half 1 — the boundary instant (`next_before`). */
  before?: string
  /** Cursor half 2 — the boundary item's id (`next_before_id`). Send BOTH
   *  halves for a next page: the instant alone drops every item that shares
   *  it (R770). */
  beforeId?: string
}

export const leagueActivityKeys = {
  /** Everything for one league — the invalidation target. */
  all: (leagueId: string) => ['league-activity', leagueId] as const,
  feed: (leagueId: string, filters: ActivityFilters) =>
    ['league-activity', leagueId, filters] as const,
}

/** Only the filters that are SET reach the query string: an absent filter is
 *  absent, never a default the server would have to un-apply. */
export function activitySearchParams(filters: ActivityFilters): string {
  const params = new URLSearchParams()
  if (filters.kind && filters.kind !== 'all') params.set('kind', filters.kind)
  if (filters.type && filters.type.length > 0) params.set('type', filters.type.join(','))
  if (filters.week !== undefined) params.set('week', String(filters.week))
  if (filters.teamId) params.set('team_id', filters.teamId)
  if (filters.limit !== undefined) params.set('limit', String(filters.limit))
  if (filters.before) params.set('before', filters.before)
  // The id half only travels with its instant — the service refuses a lone
  // `before_id` by name rather than paging as if no cursor were sent.
  if (filters.before && filters.beforeId) params.set('before_id', filters.beforeId)
  const query = params.toString()
  return query ? `?${query}` : ''
}

/** The fetch half. */
export function useLeagueActivity(leagueId: string | undefined, filters: ActivityFilters = {}) {
  return useQuery({
    queryKey: leagueActivityKeys.feed(leagueId ?? 'none', filters),
    enabled: Boolean(leagueId),
    queryFn: () =>
      sendLeagueAction<ActivityFeed>(
        `/api/leagues/${leagueId!}/activity${activitySearchParams(filters)}`,
      ),
  })
}

/**
 * The fetch + subscribe half — what a mounted feed uses.
 *
 * Returns the query plus the channel's `connection`, which the §16.5.4
 * required states render as the reconnecting banner. The subscription is
 * opened by `useLeagueChannel`, the ONE `league:<id>` channel (see its
 * header): L.D4.1's matchups/standings hooks join the SAME channel with
 * their own handlers rather than opening another (F233(a)).
 */
export function useLeagueActivityFeed(
  leagueId: string | undefined,
  filters: ActivityFilters = {},
) {
  const query = useLeagueActivity(leagueId, filters)
  const queryClient = useQueryClient()

  const invalidate = () => {
    if (!leagueId) return
    void queryClient.invalidateQueries({ queryKey: leagueActivityKeys.all(leagueId) })
  }

  // R773: the map is DERIVED from the pure decision, so the predicate is
  // load-bearing — an event it rejects gets no handler at all, and the spine
  // dispatches nothing for it. (Previously the two handlers were hand-listed
  // and each called the predicate on its own literal, a guard that could not
  // fail — D272(20)'s rule against a probe that cannot fail.)
  const handlers: LeagueChannelHandlers = {}
  for (const event of LEAGUE_CHANNEL_EVENTS.filter(activityEventInvalidates)) {
    handlers[event] = invalidate
  }

  const { connection } = useLeagueChannel(
    leagueId,
    handlers,
    {
      // §9.3: never depend on missed broadcasts — reconcile on every
      // confirmed (re)join, and refetch FIRST when a join fails.
      onJoin: invalidate,
      onDrop: invalidate,
    },
  )

  return { ...query, connection }
}

'use client'

import { useQuery, useQueryClient } from '@tanstack/react-query'

import { sendLeagueAction } from '@/lib/leagues/api/client-fetch'
import type { TradesDocument } from '@/lib/leagues/api/trades-service'

import { useLeagueChannel } from './use-league-channel'
import { invalidatingHandlers, tradesEventInvalidates } from './use-league-channel-ops'

/**
 * The league's trades — M5 task L.D3.6 (spec §15.3 `GET …/trades`, §15.6
 * `use-trades`; tasks-M5 §5 `useTrades`; PROGRESS D417, F450).
 *
 * READ over the route, never the tables directly: the route asserts
 * membership first (a non-member is a 403, never an empty list), joins the
 * names, computes the review / deferral countdowns at the server's clock
 * (`evaluated_at` + `ms_remaining` — §9.3: countdowns render from server
 * time) and attaches the league-vote COUNT (Q77 — never who voted).
 *
 * LIVE (`useTradesLive`): subscribed to `league:<id>` through the ONE spine,
 * refetching on the `trades` event (148 — every offer, answer, review,
 * execution, veto, reversal and E37 / E47 / deadline close is a `trades`
 * INSERT or status change) and on every confirmed (re)join (§9.3). Never
 * optimistic (§15.6: trades reflect the broadcast).
 *
 * F450: a VOTE is not broadcast (155 changes no `trades` row until the
 * veto), so while any trade in the document has voting OPEN the query
 * re-reads every `TRADE_TALLY_REFETCH_MS`; the voter's own vote re-reads it
 * at once (`useTradeAction`); focus re-reads it (React Query's default).
 * The count's words when the number is capped are L.D3.7's.
 *
 * `tradeKeys.all(leagueId)` is THE invalidation target for every trade verb.
 */
export const tradeKeys = {
  all: (leagueId: string) => ['league-trades', leagueId] as const,
  list: (leagueId: string, status: 'open' | 'closed' | 'all', teamId: string | null) =>
    ['league-trades', leagueId, status, teamId ?? 'any'] as const,
}

export interface UseTradesOptions {
  /** `open` (in flight), `closed` (history) or `all` (default). */
  status?: 'open' | 'closed' | 'all'
  /** Only trades this team is in (either side). */
  teamId?: string | null
}

export function tradesUrl(leagueId: string, options: UseTradesOptions = {}): string {
  const params = new URLSearchParams()
  if (options.status && options.status !== 'all') params.set('status', options.status)
  if (options.teamId) params.set('team_id', options.teamId)
  const qs = params.toString()
  return `/api/leagues/${leagueId}/trades${qs ? `?${qs}` : ''}`
}

/** How often the vote count is re-read while voting is open (F450). */
export const TRADE_TALLY_REFETCH_MS = 30_000

/** Pure: the refetch interval a trades document asks for — the tally timer
 *  while ANY trade's voting is open, else none. Exported for its pins. */
export function tradesRefetchInterval(doc: TradesDocument | undefined): number | false {
  return doc?.trades.some((t) => t.tally?.voting_open === true) ? TRADE_TALLY_REFETCH_MS : false
}

/** The fetch half. */
export function useTrades(leagueId: string | undefined, options: UseTradesOptions = {}) {
  const status = options.status ?? 'all'
  return useQuery({
    queryKey: tradeKeys.list(leagueId ?? 'none', status, options.teamId ?? null),
    enabled: Boolean(leagueId),
    queryFn: () => sendLeagueAction<TradesDocument>(tradesUrl(leagueId!, { ...options, status })),
    refetchInterval: (query) => tradesRefetchInterval(query.state.data),
  })
}

/**
 * The fetch + subscribe half — what a mounted trade center uses. Returns the
 * query plus the spine's `connection` for the §16.5.4 reconnecting banner.
 */
export function useTradesLive(leagueId: string | undefined, options: UseTradesOptions = {}) {
  const query = useTrades(leagueId, options)
  const queryClient = useQueryClient()

  const invalidate = () => {
    if (!leagueId) return
    void queryClient.invalidateQueries({ queryKey: tradeKeys.all(leagueId) })
  }

  const { connection } = useLeagueChannel(leagueId, invalidatingHandlers(tradesEventInvalidates, invalidate), {
    onJoin: invalidate,
    onDrop: invalidate,
  })

  return { ...query, connection }
}

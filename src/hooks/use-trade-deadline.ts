'use client'

import { useQuery } from '@tanstack/react-query'

import { LeagueActionError, sendLeagueAction } from '@/lib/leagues/api/client-fetch'
import type { TradeDeadlineView } from '@/lib/leagues/api/trades-service'

/**
 * The league's trade deadline — M5 task L.D3.12 (`GET …/trades/deadline` →
 * `trade_deadline`, migration 162; spec §13.3 Deadline / Q76; PROGRESS D426,
 * F452 closed).
 *
 * The instant is the SERVER's (151's `trade_deadline_internal`: week N+1's
 * start) and so is `passed` (judged at the database's now() — the clock the
 * propose / accept verbs refuse by). No client clock is read: the query
 * re-reads itself right after the deadline from the read's own
 * `ms_remaining` (a timer, not a clock), capped so a long-open tab still
 * catches a moved calendar.
 *
 * DEPLOY BEFORE PUSH: until 162 is pushed the route answers a named 503, and
 * this hook says `unavailable` — every caller then keeps today's behaviour
 * (the week-only line, the doors shown, the verb's refusal as the answer).
 */
export const tradeDeadlineKeys = {
  all: (leagueId: string) => ['league-trade-deadline', leagueId] as const,
}

export type TradeDeadlineState =
  | { state: 'known'; view: TradeDeadlineView }
  /** 162 not pushed yet (the named 503) — fall back to today's behaviour. */
  | { state: 'unavailable'; reason: string }

export function tradeDeadlineUrl(leagueId: string): string {
  return `/api/leagues/${leagueId}/trades/deadline`
}

export async function fetchTradeDeadline(leagueId: string): Promise<TradeDeadlineState> {
  try {
    return { state: 'known', view: await sendLeagueAction<TradeDeadlineView>(tradeDeadlineUrl(leagueId)) }
  } catch (error) {
    if (error instanceof LeagueActionError && error.status === 503) return { state: 'unavailable', reason: error.message }
    throw error
  }
}

/** The longest the deadline read waits before re-reading itself. */
export const TRADE_DEADLINE_MAX_REFETCH_MS = 15 * 60_000

/** Pure: re-read one second after the deadline (the server's own
 *  `ms_remaining`), never later than the cap; nothing to wait for once it
 *  has passed or when there is no instant. Exported for its pins. */
export function tradeDeadlineRefetchInterval(state: TradeDeadlineState | undefined): number | false {
  if (state?.state !== 'known') return false
  const { passed, ms_remaining } = state.view
  if (passed || ms_remaining === null) return false
  return Math.min(ms_remaining + 1_000, TRADE_DEADLINE_MAX_REFETCH_MS)
}

/** Pure: true ONLY when the server said the deadline has passed — loading,
 *  unavailable or an error keep today's behaviour (the verb still refuses). */
export function tradeDeadlinePassed(state: TradeDeadlineState | undefined | null): boolean {
  return state?.state === 'known' && state.view.passed
}

export function useTradeDeadline(leagueId: string | undefined) {
  return useQuery({
    queryKey: tradeDeadlineKeys.all(leagueId ?? 'none'),
    enabled: Boolean(leagueId),
    queryFn: () => fetchTradeDeadline(leagueId!),
    retry: false,
    refetchInterval: (query) => tradeDeadlineRefetchInterval(query.state.data),
  })
}

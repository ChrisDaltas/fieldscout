'use client'

import { useMutation, useQueryClient, type QueryClient, type UseMutationOptions } from '@tanstack/react-query'

import { jsonInit, sendLeagueAction } from '@/lib/leagues/api/client-fetch'
import type { CommishTradeOp, CommishTradeResult } from '@/lib/leagues/api/trades-service'

import { commishLogKeys } from './use-commish-log'
import { leagueMatchupKeys } from './use-matchups'
import { invalidateTradeMoved } from './use-trade-action'
import { tradeKeys } from './use-trades'

/**
 * The commissioner's trade tools — M5 task L.D3.6 (§15.4 `POST
 * …/commish/trade` → `commish_force_or_reverse_trade`, migration 156;
 * D416; tasks-M5 §5 `useCommishTrade`; PROGRESS F451's hook half).
 *
 * `op`: approve (a trade in review goes to the executor), veto, force (now,
 * past the review, the vote and the game-day lock — validity
 * still binds; an accepted trade only since 174 — reverse removed, D463). Reason
 * OPTIONAL (Q66). NOT optimistic (players and FAAB move — the response is
 * the truth), NOT retried, one `action_id` per `submit()`.
 *
 * On success AND error it re-reads the trades, every surface a trade moves
 * (rosters, pool, both teams' lineups, standings, the league detail, the
 * claims, activity), the audit log, and the matchups (a force in a
 * live week queues a re-score — 156 §2c, R1228). On error the trade may
 * have moved on, and nothing is lost by re-reading (a validity refusal rolls
 * back — D416(5) — so the lineups are re-read on success only).
 */

export interface CommishTradeInput {
  tradeId: string
  op: CommishTradeOp
  /** Optional (Q66). Blank is dropped before the wire. */
  reason?: string
}

export interface CommishTradeVariables {
  trade_id: string
  op: CommishTradeOp
  action_id: string
  reason?: string
}

export function commishTradeVariables(input: CommishTradeInput, actionId: string): CommishTradeVariables {
  return {
    trade_id: input.tradeId,
    op: input.op,
    ...(input.reason !== undefined && input.reason.trim() !== '' ? { reason: input.reason } : {}),
    action_id: actionId,
  }
}

export function commishTradeMutationOptions(
  queryClient: QueryClient,
  leagueId: string,
): UseMutationOptions<CommishTradeResult, Error, CommishTradeVariables> {
  const reread = (result?: CommishTradeResult) => {
    const trade = result?.trade as { proposer_team_id?: unknown; recipient_team_id?: unknown } | undefined
    // The two teams' lineups — named by the answer's trade (a refusal rolled
    // back, so an error moved no lineup).
    const teamIds = [trade?.proposer_team_id, trade?.recipient_team_id].filter((id): id is string => typeof id === 'string')
    void queryClient.invalidateQueries({ queryKey: tradeKeys.all(leagueId) })
    invalidateTradeMoved(queryClient, leagueId, teamIds)
    void queryClient.invalidateQueries({ queryKey: commishLogKeys.all(leagueId) })
    void queryClient.invalidateQueries({ queryKey: leagueMatchupKeys.all(leagueId) })
  }
  return {
    retry: false,
    mutationFn: (variables) =>
      sendLeagueAction<CommishTradeResult>(`/api/leagues/${leagueId}/commish/trade`, jsonInit('POST', variables)),
    onSuccess: (result) => reread(result),
    onError: () => reread(),
  }
}

export function useCommishTrade(leagueId: string) {
  const queryClient = useQueryClient()
  const mutation = useMutation(commishTradeMutationOptions(queryClient, leagueId))
  return {
    ...mutation,
    /** One action_id per submit (D68(1)); a new `submit` is a new id. */
    submit: (input: CommishTradeInput) => mutation.mutate(commishTradeVariables(input, crypto.randomUUID())),
    submitAsync: (input: CommishTradeInput) => mutation.mutateAsync(commishTradeVariables(input, crypto.randomUUID())),
  }
}

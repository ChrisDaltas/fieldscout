'use client'

import { useMutation, useQueryClient, type QueryClient, type UseMutationOptions } from '@tanstack/react-query'

import { jsonInit, sendLeagueAction } from '@/lib/leagues/api/client-fetch'

import { commishLogKeys } from './use-commish-log'
import { leagueActivityKeys } from './use-league-activity'
import { tradeKeys } from './use-trades'

/**
 * Propose a trade — M5 task L.D3.6 (§15.3 `POST …/trades` → `trade_propose`,
 * migrations 148 / 151; tasks-M5 §5).
 *
 * NOT optimistic (§15.6: never for trades — the server decides legality,
 * exclusivity, E36's drops and the deadline), NOT retried (`retry: false` —
 * an `action_id` is consumed by its submit), one `action_id` per `submit()`.
 * Re-reads the trades on success AND on error; a commissioner's proposal for
 * a team also writes an audit row and a system post, so those two feeds
 * re-read when the answer says `acted_as_commissioner`. A proposal moves
 * nothing (D386(9)), so no roster key is touched.
 */

/** One leg: a player, or whole-dollar FAAB, from one of the two teams. */
export type TradeLeg = { playerId: string; fromTeamId: string } | { faabAmount: number; fromTeamId: string }

export interface ProposeTradeInput {
  fromTeamId: string
  toTeamId: string
  legs: TradeLeg[]
  /** The proposer's drops so his roster fits (E36). */
  drops?: string[]
  note?: string
  /** Optional (Q66); stored only on the commissioner arm. */
  reason?: string
}

export type TradeLegVariables = { player_id: string; from_team_id: string } | { faab_amount: number; from_team_id: string }

export interface ProposeTradeVariables {
  from_team_id: string
  to_team_id: string
  items: TradeLegVariables[]
  drops?: string[]
  note?: string
  action_id: string
  reason?: string
}

/** The propose document (151's `trade_propose` result) — the fields a caller reads. */
export interface ProposeTradeResult {
  verb: 'trade_propose'
  action_id: string
  team_id: string
  trade: { id: string; status: string; [key: string]: unknown }
  summary: string
  rosters: unknown
  acted_as_commissioner: boolean
  commissioner_action_id: string | null
  [key: string]: unknown
}

export function tradeLegVariables(legs: readonly TradeLeg[]): TradeLegVariables[] {
  return legs.map((leg) =>
    'playerId' in leg ? { player_id: leg.playerId, from_team_id: leg.fromTeamId } : { faab_amount: leg.faabAmount, from_team_id: leg.fromTeamId },
  )
}

export function proposeTradeVariables(input: ProposeTradeInput, actionId: string): ProposeTradeVariables {
  return {
    from_team_id: input.fromTeamId,
    to_team_id: input.toTeamId,
    items: tradeLegVariables(input.legs),
    ...(input.drops && input.drops.length > 0 ? { drops: input.drops } : {}),
    ...(input.note !== undefined && input.note.trim() !== '' ? { note: input.note } : {}),
    ...(input.reason !== undefined && input.reason.trim() !== '' ? { reason: input.reason } : {}),
    action_id: actionId,
  }
}

export function proposeTradeMutationOptions(
  queryClient: QueryClient,
  leagueId: string,
): UseMutationOptions<ProposeTradeResult, Error, ProposeTradeVariables> {
  return {
    retry: false,
    mutationFn: (variables) => sendLeagueAction<ProposeTradeResult>(`/api/leagues/${leagueId}/trades`, jsonInit('POST', variables)),
    onSuccess: (result) => {
      void queryClient.invalidateQueries({ queryKey: tradeKeys.all(leagueId) })
      if (result.acted_as_commissioner) {
        void queryClient.invalidateQueries({ queryKey: leagueActivityKeys.all(leagueId) })
        void queryClient.invalidateQueries({ queryKey: commishLogKeys.all(leagueId) })
      }
    },
    onError: () => {
      void queryClient.invalidateQueries({ queryKey: tradeKeys.all(leagueId) })
    },
  }
}

export function useProposeTrade(leagueId: string) {
  const queryClient = useQueryClient()
  const mutation = useMutation(proposeTradeMutationOptions(queryClient, leagueId))
  return {
    ...mutation,
    /** One action_id per submit (D68(1)); a new `submit` is a new id. */
    submit: (input: ProposeTradeInput) => mutation.mutate(proposeTradeVariables(input, crypto.randomUUID())),
    submitAsync: (input: ProposeTradeInput) => mutation.mutateAsync(proposeTradeVariables(input, crypto.randomUUID())),
  }
}

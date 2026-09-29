'use client'

import { useMutation, useQueryClient, type QueryClient, type UseMutationOptions } from '@tanstack/react-query'

import { jsonInit, sendLeagueAction } from '@/lib/leagues/api/client-fetch'

import { commishLogKeys } from './use-commish-log'
import { leagueActivityKeys } from './use-league-activity'
import { leaguePoolKeys } from './use-league-pool'
import { leaguesKeys } from './use-leagues'
import { teamLineupKeys } from './use-lineup'
import { tradeLegVariables, type TradeLeg, type TradeLegVariables } from './use-propose-trade'
import { leagueRosterKeys } from './use-rosters'
import { leagueStandingsKeys } from './use-standings'
import { tradeKeys } from './use-trades'
import { waiverClaimKeys } from './use-waiver-claims'

/**
 * Answer or vote on one trade — M5 task L.D3.6 (§15.3 `PATCH …/trades/[tid]`
 * → `trade_respond` (151) for accept / reject / cancel / counter, and
 * `trade_vote` (155) for a league-vote review; tasks-M5 §5 `useTradeAction`).
 *
 * NOT optimistic (§15.6 — trades reflect the broadcast), NOT retried
 * (`retry: false`), one `action_id` per `submit()`. Re-reads:
 *   - the trades, on success AND on error (a refusal usually means the trade
 *     moved on — E37, the deadline, another tab);
 *   - when the answer carries an `execution` (an accept under review `none`
 *     runs the trade in the same transaction — complete, deferred or
 *     invalid), every surface a trade moves: rosters, the pool, both teams'
 *     lineups, standings + the league detail + the claims (FAAB legs change
 *     balances) and the activity feed;
 *   - the activity feed when a vote VETOED the trade (a system post);
 *   - the activity feed + audit log when the commissioner acted for a team.
 */

export type TradeActionInput =
  | { tradeId: string; op: 'accept'; drops?: string[]; reason?: string }
  | { tradeId: string; op: 'reject' | 'cancel'; reason?: string }
  | { tradeId: string; op: 'counter'; legs: TradeLeg[]; drops?: string[]; note?: string; reason?: string }
  | { tradeId: string; op: 'vote'; vote: 'veto' | 'approve' }

export type TradeActionBody =
  | { op: 'accept'; drops?: string[]; action_id: string; reason?: string }
  | { op: 'reject' | 'cancel'; action_id: string; reason?: string }
  | { op: 'counter'; items: TradeLegVariables[]; drops?: string[]; note?: string; action_id: string; reason?: string }
  | { op: 'vote'; vote: 'veto' | 'approve'; action_id: string }

export interface TradeActionVariables {
  tradeId: string
  body: TradeActionBody
}

/** The fields of 151's respond / 155's vote document a caller reads. */
export interface TradeActionResult {
  op: 'accept' | 'reject' | 'cancel' | 'counter' | 'vote'
  trade_id: string
  trade: { id: string; status: string; proposer_team_id: string; recipient_team_id: string; [key: string]: unknown }
  /** respond (accept under review `none`): the executor's answer. */
  execution?: { outcome?: string; [key: string]: unknown } | null
  /** respond: the commissioner acted for a team. */
  acted_as_commissioner?: boolean
  /** vote: `recorded` or `vetoed` (the vote that reached the number). */
  outcome?: string
  [key: string]: unknown
}

const reasonPart = (reason: string | undefined) => (reason !== undefined && reason.trim() !== '' ? { reason } : {})
const dropsPart = (drops: string[] | undefined) => (drops && drops.length > 0 ? { drops } : {})

export function tradeActionVariables(input: TradeActionInput, actionId: string): TradeActionVariables {
  switch (input.op) {
    case 'accept':
      return { tradeId: input.tradeId, body: { op: 'accept', ...dropsPart(input.drops), action_id: actionId, ...reasonPart(input.reason) } }
    case 'reject':
    case 'cancel':
      return { tradeId: input.tradeId, body: { op: input.op, action_id: actionId, ...reasonPart(input.reason) } }
    case 'counter':
      return {
        tradeId: input.tradeId,
        body: {
          op: 'counter',
          items: tradeLegVariables(input.legs),
          ...dropsPart(input.drops),
          ...(input.note !== undefined && input.note.trim() !== '' ? { note: input.note } : {}),
          action_id: actionId,
          ...reasonPart(input.reason),
        },
      }
    case 'vote':
      return { tradeId: input.tradeId, body: { op: 'vote', vote: input.vote, action_id: actionId } }
  }
}

/** Every surface an executed / reversed trade moves (shared with
 *  `useCommishTrade`). */
export function invalidateTradeMoved(queryClient: QueryClient, leagueId: string, teamIds: readonly string[]): void {
  void queryClient.invalidateQueries({ queryKey: leagueRosterKeys.all(leagueId) })
  void queryClient.invalidateQueries({ queryKey: leaguePoolKeys.all(leagueId) })
  for (const teamId of teamIds) void queryClient.invalidateQueries({ queryKey: teamLineupKeys.all(teamId) })
  void queryClient.invalidateQueries({ queryKey: leagueStandingsKeys.all(leagueId) })
  void queryClient.invalidateQueries({ queryKey: leaguesKeys.detail(leagueId) })
  void queryClient.invalidateQueries({ queryKey: waiverClaimKeys.all(leagueId) })
  void queryClient.invalidateQueries({ queryKey: leagueActivityKeys.all(leagueId) })
}

export function tradeActionMutationOptions(
  queryClient: QueryClient,
  leagueId: string,
): UseMutationOptions<TradeActionResult, Error, TradeActionVariables> {
  return {
    retry: false,
    mutationFn: ({ tradeId, body }) =>
      sendLeagueAction<TradeActionResult>(`/api/leagues/${leagueId}/trades/${tradeId}`, jsonInit('PATCH', body)),
    onSuccess: (result) => {
      void queryClient.invalidateQueries({ queryKey: tradeKeys.all(leagueId) })
      if (result.execution) {
        invalidateTradeMoved(queryClient, leagueId, [result.trade.proposer_team_id, result.trade.recipient_team_id])
      }
      if (result.op === 'vote' && result.outcome === 'vetoed') {
        void queryClient.invalidateQueries({ queryKey: leagueActivityKeys.all(leagueId) })
      }
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

export function useTradeAction(leagueId: string) {
  const queryClient = useQueryClient()
  const mutation = useMutation(tradeActionMutationOptions(queryClient, leagueId))
  return {
    ...mutation,
    /** One action_id per submit (D68(1)); a new `submit` is a new id. */
    submit: (input: TradeActionInput) => mutation.mutate(tradeActionVariables(input, crypto.randomUUID())),
    submitAsync: (input: TradeActionInput) => mutation.mutateAsync(tradeActionVariables(input, crypto.randomUUID())),
  }
}

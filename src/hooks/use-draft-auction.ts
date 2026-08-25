'use client'

import { useMutation, useQueryClient } from '@tanstack/react-query'

import { jsonInit, sendLeagueAction } from '@/lib/leagues/api/client-fetch'
import type { Draft } from '@/types/database'

import { draftKeys } from './use-draft'
import {
  bidRequest,
  nominateRequest,
  type AuctionRequest,
  type BidIntent,
} from './use-draft-auction-ops'
import { draftBidKeys } from './use-draft-bids'
import type { DraftBidRow } from './use-draft-bids-ops'

/**
 * Auction mutations — M3 task L.C2.1 (spec §15.2 nominate/bid rows, §15.6
 * "never optimistic for bids", §16.3 latency-resilient intent; D92: every
 * mutation is a route; F64/F65 discharged at this mint site).
 *
 * Shape: `use-draft-controls.ts` — request descriptors come from the PURE
 * builders in use-draft-auction-ops.ts; this file only fires them and
 * settles the caches.
 *
 * NEVER OPTIMISTIC (§15.6): neither hook touches a cache on mutate. The
 * room's truth is the ONE channel `useDraftRoom` already holds (D184 — the
 * `drafts` UPDATE carries `current_nomination`, the `draft_bids` INSERT is
 * the bid-button pulse, through the feed sink); these hooks open no
 * channel and do not re-subscribe. On settle they INVALIDATE the draft
 * detail and the bid feed (the §9.3 belt-and-braces reconcile — and on a
 * refusal the room is by definition stale: "outbid", "just went off the
 * board", so the refetch is exactly right). The refusal copy is the RPC's
 * product copy passed through the route verbatim; callers surface
 * `error.message` (a `LeagueActionError`) as-is — never paraphrased.
 *
 * ACTION IDS (D68(1), F65): each wrapper mints ONE fresh uuid per user
 * submit INSIDE the hook — `nominate(...)` for nominations, `placeBid(...)`
 * for bids — so a React Query retry replays server-side as E2 (same row,
 * same 2xx) instead of double-acting, and no id ever crosses from one verb
 * to the other (the RPC's replay lookup is verb-blind — D157(11) — which is
 * WHY the mint is per verb). Callers use the returned wrappers, never
 * `mutate` with a hand-built variables object.
 *
 * BUDGETS: not computed here for anything. `draft_team_budget` (084) is the
 * one authority, inside the RPCs; what the room DISPLAYS comes from the TS
 * mirror in `components/draft/auction-budget.ts` (display-only, parity-
 * pinned TS ≡ SQL) over the picks + `budget_adjustments` the channel
 * already carries (D134).
 */

/** The RPCs' §8.1 step-5 payload as the route returns it. */
export interface AuctionActionResponse {
  draft: Draft
  bid: DraftBidRow & { action_id: string | null; id: string }
}

function useAuctionMutation<TVars>(draftId: string, toRequest: (vars: TVars) => AuctionRequest) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (vars: TVars) => {
      const request = toRequest(vars)
      return sendLeagueAction<AuctionActionResponse>(request.path, jsonInit('POST', request.body))
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: draftKeys.detail(draftId) })
      void queryClient.invalidateQueries({ queryKey: draftBidKeys.feed(draftId) })
    },
  })
}

/**
 * POST …/draft/nominate (§8.6.2). `nominate(playerId, openingBid)` mints
 * this submit's action_id; the RPC validates turn / phase / availability /
 * the §8.6.7(a) opening ceiling and answers with the authoritative state.
 */
export function useNominate(leagueId: string | null, draftId: string) {
  const mutation = useAuctionMutation(
    draftId,
    (vars: { playerId: string; openingBid: number; actionId: string }) =>
      nominateRequest(leagueId, draftId, vars.playerId, vars.openingBid, vars.actionId),
  )
  return {
    ...mutation,
    nominate: (playerId: string, openingBid: number) =>
      mutation.mutate({ playerId, openingBid, actionId: crypto.randomUUID() }),
    nominateAsync: (playerId: string, openingBid: number) =>
      mutation.mutateAsync({ playerId, openingBid, actionId: crypto.randomUUID() }),
  }
}

/**
 * POST …/draft/bid (§8.6.3). `placeBid(intent)` takes the NOMINATION THE
 * ROOM IS LOOKING AT (`nominationSeq` + `playerId` — F64; the room reads
 * them off its `drafts` row: `current_pick_number` + `current_nomination
 * .player_id`) and the amount, and mints this submit's action_id. A stale
 * intent (the nomination moved on) is refused by the RPC with §16.3's
 * "just went off the board" — a friendly 400 the room should show as-is.
 */
export function usePlaceBid(leagueId: string | null, draftId: string) {
  const mutation = useAuctionMutation(draftId, (vars: { intent: BidIntent; actionId: string }) =>
    bidRequest(leagueId, draftId, vars.intent, vars.actionId),
  )
  return {
    ...mutation,
    placeBid: (intent: BidIntent) => mutation.mutate({ intent, actionId: crypto.randomUUID() }),
    placeBidAsync: (intent: BidIntent) =>
      mutation.mutateAsync({ intent, actionId: crypto.randomUUID() }),
  }
}

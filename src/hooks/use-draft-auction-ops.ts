/**
 * Auction-verb request descriptors — the PURE wiring between the auction
 * room's nominate/bid affordances (M3 tasks L.C3.1/L.C3.3) and the L.C2.1
 * routes (spec §15.2 nominate/bid rows; §8.6.2/§8.6.3). The colocated-ops
 * split of `use-draft-controls-ops.ts`: no client, no React, no entropy —
 * "which route, which body" is falsifiable without a socket.
 *
 * Doctrine carried (the two contracts the RPC routed to the mint site):
 *  - F64 — a bid ALWAYS names the nomination it was placed on. `bidRequest`
 *    cannot be built without `nominationSeq` + `playerId` (the room sends
 *    what IT is looking at); the route's Zod requires both; the service
 *    passes both to `draft_place_bid`, whose guard refuses a stale pair
 *    with §16.3's "just went off the board" copy.
 *  - F65 — action ids are minted PER VERB, never shared. Every body carries
 *    an `action_id` the HOOK minted for exactly this submit (D68(1) —
 *    entropy is injected there, never read here): `useNominate` mints for
 *    nominations, `usePlaceBid` mints for bids, and neither accepts a
 *    caller-supplied id that could have been another verb's.
 *  - every body targets the room's draft EXPLICITLY (`draft_id`) — the room
 *    knows its draft (a mock room sends the mock's id — D113(2)).
 */

import { draftVerbPath } from './use-draft-action-path'

export interface AuctionRequest {
  /** Route path (POST). */
  path: string
  body: Record<string, unknown>
}

/** What a bid names — the nomination the room is looking at, and the raise. */
export interface BidIntent {
  nominationSeq: number
  playerId: string
  amount: number
}

/** POST …/draft/nominate — `player_id` + `opening_bid` + the minted `action_id`. */
export function nominateRequest(
  leagueId: string | null,
  draftId: string,
  playerId: string,
  openingBid: number,
  actionId: string,
): AuctionRequest {
  return {
    path: draftVerbPath(leagueId, draftId, 'nominate'),
    body: { draft_id: draftId, player_id: playerId, opening_bid: openingBid, action_id: actionId },
  }
}

/** POST …/draft/bid — the nomination identity (F64) + `amount` + the minted
 *  `action_id`. There is deliberately no overload that omits the identity. */
export function bidRequest(
  leagueId: string | null,
  draftId: string,
  intent: BidIntent,
  actionId: string,
): AuctionRequest {
  return {
    path: draftVerbPath(leagueId, draftId, 'bid'),
    body: {
      draft_id: draftId,
      nomination_seq: intent.nominationSeq,
      player_id: intent.playerId,
      amount: intent.amount,
      action_id: actionId,
    },
  }
}

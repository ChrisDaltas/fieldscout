/**
 * Auction bot persona policies — M3 task L.C4.1 (delivery plan §4.2 "sniper
 * who bids at T-1s"; tasks-M3 §5 sim sketch; D100/D132). PURE seeded
 * policies, the personas.ts convention: every decision derives from the
 * persona, the visible state, and the rng stream — the runner supplies both
 * and performs the I/O (real service-layer calls through `nominatePlayer` /
 * `placeBid`, never direct DB writes).
 *
 * THE POLICIES NEVER DECIDE LEGALITY. Each one aims inside its own view of
 * `min(value, max_bid)` computed off the display mirror
 * (`components/draft/auction-budget.ts`), but the SQL validators are the
 * authority (§4.7): a policy that mis-aims simply collects a friendly
 * refusal, which the runner counts as expected traffic — except chaos,
 * whose OVER-MAX aim is deliberate and whose refusal is asserted.
 *
 * The value model is the D132 family shape — dollar value falls with ADP
 * rank, scales with the budget, seeded noise on top — deliberately NOT the
 * SQL CPU model (that one is 089/091's and is exercised by the mock arms);
 * the sim's job is human-shaped traffic through the human routes.
 */
import type { AuctionPersonaKind } from './sim-types'

/** The live market (D126: `current_nomination` non-NULL ⇒ bidding). */
export interface AuctionMarketView {
  playerId: string
  highBid: number
  /** TRUE when this seat already holds the high bid (never raise yourself). */
  seatHoldsHighBid: boolean
}

/** The seat's own budget view — the TS display mirror's numbers. */
export interface AuctionSeatView {
  maxBid: number
  openSlots: number
}

/**
 * Seeded per-player dollar value: rank-decayed share of the budget with
 * ±25% seeded noise. Rank 0 is worth ≈ budget/3 at a 15-slot roster and
 * proportionally more on the sim's compact rosters; deep ranks decay to $1.
 */
export function playerValue(
  adpRank: number,
  budget: number,
  rosterSlots: number,
  rng: () => number,
): number {
  const base = (budget / Math.max(2, rosterSlots)) * 2.2 * Math.exp(-adpRank / (rosterSlots * 3))
  const noisy = base * (0.75 + rng() * 0.5)
  return Math.max(1, Math.round(noisy))
}

export type BidDecision =
  | { kind: 'pass' }
  | {
      kind: 'raise'
      amount: number
      /** Chaos: submit twice with ONE action_id (E2 — both answer the same row). */
      doubleTap: boolean
      /** Chaos: send a PREVIOUS nomination_seq — the F64 stale-identity
       *  refusal ("just went off the board"); nothing may change. */
      staleIdentity: boolean
      /** Chaos: the amount is aimed ABOVE max_bid on purpose — the E5
       *  refusal is the assertion, and nothing may change. */
      expectOverMax: boolean
    }

/** How a persona answers a live market it does not lead. `value` is the
 *  seat's own seeded value for the nominated player. */
export function decideBid(
  persona: AuctionPersonaKind,
  market: AuctionMarketView,
  seat: AuctionSeatView,
  value: number,
  rng: () => number,
): BidDecision {
  if (market.seatHoldsHighBid) return { kind: 'pass' }
  if (seat.openSlots <= 0 || seat.maxBid < market.highBid + 1) return { kind: 'pass' }

  const willing = Math.min(value, seat.maxBid)
  const nibble = market.highBid + 1

  if (persona === 'afk') return { kind: 'pass' }

  if (persona === 'sniper') {
    // The sniper acts only when the runner STAGES the T-1s instant (a
    // service-role deadline rewind into the anti-snipe window); in the
    // ordinary window it lurks. The runner calls `decideSnipe` directly.
    return { kind: 'pass' }
  }

  if (persona === 'budget-hoarder') {
    // Hoards: engages ~40% of markets, values at a 40% discount, never jumps.
    if (rng() >= 0.4) return { kind: 'pass' }
    const discounted = Math.min(Math.max(1, Math.floor(value * 0.4)), seat.maxBid)
    if (nibble > discounted) return { kind: 'pass' }
    return { kind: 'raise', amount: nibble, doubleTap: false, staleIdentity: false, expectOverMax: false }
  }

  if (persona === 'chaos') {
    const roll = rng()
    if (roll < 0.25) {
      // Over-max on purpose: the E5 refusal is the point. Aimed above the
      // seat's own max so the SQL must refuse it whatever the market says.
      return {
        kind: 'raise',
        amount: seat.maxBid + 1 + Math.floor(rng() * 5),
        doubleTap: false,
        staleIdentity: false,
        expectOverMax: true,
      }
    }
    if (roll < 0.5) {
      // Stale identity: a legal-looking amount against a DEAD nomination —
      // the F64 "just went off the board" arm; the runner sends seq − 1.
      return { kind: 'raise', amount: nibble, doubleTap: false, staleIdentity: true, expectOverMax: false }
    }
    if (nibble > willing) return { kind: 'pass' }
    // The E2 double-tap: one action_id, two concurrent submits, one row.
    return { kind: 'raise', amount: nibble, doubleTap: true, staleIdentity: false, expectOverMax: false }
  }

  // value-bidder — both v2.13 textures: the $1 nibble and the jump within
  // value ("I'll pay $40 for him"), never above min(value, max_bid).
  if (nibble > willing) return { kind: 'pass' }
  const jump = rng() < 0.35 && willing > nibble
  return {
    kind: 'raise',
    amount: jump ? willing : nibble,
    doubleTap: false,
    staleIdentity: false,
    expectOverMax: false,
  }
}

/** The sniper's staged T-1s raise (runner rewound the deadline first): a
 *  minimum raise whenever it is legal — the assertion is the anti-snipe
 *  re-floor, not the sniper's taste. */
export function decideSnipe(market: AuctionMarketView, seat: AuctionSeatView): BidDecision {
  if (market.seatHoldsHighBid || seat.openSlots <= 0) return { kind: 'pass' }
  const nibble = market.highBid + 1
  if (nibble > seat.maxBid) return { kind: 'pass' }
  return { kind: 'raise', amount: nibble, doubleTap: false, staleIdentity: false, expectOverMax: false }
}

export type NominationDecision =
  | { kind: 'timeout' }
  | {
      kind: 'nominate'
      playerId: string
      openingBid: number
      /** Chaos: the SAME action_id submitted twice (E2 — one nomination). */
      doubleTap: boolean
    }

/**
 * The on-clock nomination. `floor` is the §8.6.2 nomination floor (the
 * reserve-derived $1/$0 — NEVER the bid increment); `available` is the
 * seat's pool view ADP-ascending. afk times out (the §8.6.2 system
 * nomination is the coverage); everyone else opens AT the floor most of the
 * time, occasionally higher within max bid (value-bidder price-setting).
 */
export function decideNomination(
  persona: AuctionPersonaKind,
  available: readonly string[],
  floor: 0 | 1,
  seat: AuctionSeatView,
  valueOf: (playerId: string) => number,
  rng: () => number,
): NominationDecision {
  if (persona === 'afk') return { kind: 'timeout' }
  if (available.length === 0) return { kind: 'timeout' }

  // Seeded reach 0..2 (the ADP_REACH convention) — hoarders nominate DEEP
  // (dump players they hope go cheap), everyone else near the top.
  const reach =
    persona === 'budget-hoarder'
      ? Math.min(3 + Math.floor(rng() * 5), available.length - 1)
      : Math.min(Math.floor(rng() * 3), available.length - 1)
  const playerId = available[reach]!

  let openingBid: number = floor
  if (persona === 'value-bidder' && rng() < 0.3) {
    // Open near half its own value — price-setting, still within max bid.
    openingBid = Math.min(Math.max(floor, Math.floor(valueOf(playerId) / 2)), Math.max(floor, seat.maxBid))
  }
  if (openingBid > seat.maxBid) openingBid = Math.min(floor, Math.max(0, seat.maxBid))

  return {
    kind: 'nominate',
    playerId,
    openingBid,
    doubleTap: persona === 'chaos',
  }
}

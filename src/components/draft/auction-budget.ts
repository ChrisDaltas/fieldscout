/**
 * Auction budget math — the DISPLAY-ONLY TS mirror of migration 084's
 * `draft_team_budget` (M3 task L.C2.1; spec §8.6.1/§8.6.8; tasks-M3
 * D127/§4.7 "TS budget math is display-only, pinned by a SQL-parity
 * fixture — the D90 pattern").
 *
 * §4.7 is the rule this file lives under: **the ONE budget authority is
 * SQL** — `draft_team_budget` (084), called inside `draft_nominate` /
 * `draft_place_bid` / the award / every commissioner edit under the
 * drafts-row lock, and REVOKED from `authenticated` on purpose. Nothing
 * here decides anything: no route, hook, or component may use these
 * numbers to admit or refuse a bid (the RPC's E5 copy is the refusal, with
 * the server's own numbers in it). These helpers exist for exactly one job:
 * rendering each team's remaining budget and max bid (§8.6.1 "each team
 * shows remaining budget and max bid") off the data the room ALREADY holds
 * — `draft_picks.price` (D134: on the wire since 088) and
 * `drafts.budget_adjustments` (D134) — without a round trip per paint.
 * Drift between this mirror and the SQL is a suite failure, not a
 * rendering quirk:
 *
 *  - `auction-budget.test.ts` pins pgTAP 033 §D's STORED-LITERAL goldens
 *    against this module — the same literals the SQL answers to (the
 *    fresh-start 200/15/186, the $50 buy → 150/14/137, the ignored undone
 *    $999 row, the ±adjustment rows, E25's $3-over-3-slots ⇒ $1, E27's
 *    complete roster ⇒ 0/0/0, C38's min_bid 0, the $50/min-3 reserve);
 *  - `auction-api-db.test.ts` (stack-backed) sweeps TS ≡ the REAL
 *    `draft_team_budget` for every franchise of a driven auction — real
 *    award rows, a planted undone row, planted ± adjustments and a planted
 *    complete roster — closing display ≡ truth end-to-end.
 *
 * Semantics mirrored from 084 (same formula, same defaults, same one
 * special case):
 *  - `remaining = auction_budget + budget_adjustments[team] − Σ price` over
 *    NON-undone picks (undo refunds by derivation — D131); `committed` is
 *    that Σ; `open_slots = total_rounds − count(non-undone picks)`
 *    (`total_rounds` IS the auction's per-team capacity — D91/D126);
 *  - `max_bid = remaining − (open_slots − 1) × min_bid` (§8.6.1), UNCLAMPED
 *    except for the ONE special case 084 has: a complete roster
 *    (`open_slots ≤ 0`) reads `max_bid 0` (E27 — a full team cannot bid).
 *    A negative max bid on an open roster is left VISIBLE, exactly as the
 *    SQL leaves it for `draft_auction_solvent` to see;
 *  - config defaults are 084's COALESCEs (budget 200, min bid 1 — §7.3.8);
 *  - where 084 RAISES (no/invalid `total_rounds`), the mirror returns null —
 *    render nothing, never guess (the draft-order.ts convention). The
 *    membership/retired-seat guards are the SQL's; a caller passes the
 *    franchises the room renders.
 */

import type { Json } from '@/types/database'

/** The slice of a pick row the derivation reads (the `DraftPickSummary`
 *  shape `use-draft.ts` caches — `price` rides the broadcast since 088). */
export interface BudgetPickRow {
  team_id: string
  price: number | null
  is_undone: boolean | null
}

/** 084's four columns, camel-cased. */
export interface TeamBudget {
  remaining: number
  openSlots: number
  maxBid: number
  committed: number
}

/** The drafts-row facts the derivation needs — read them off the cached
 *  `Draft` (`config`, `total_rounds`, `budget_adjustments`). */
export interface AuctionBudgetInputs {
  /** `drafts.config` (the D95 hydrated settings blob) — or the two knobs. */
  auctionBudget: number
  minBid: number
  /** `drafts.total_rounds` — the per-team roster capacity (D91/D126). */
  totalRounds: number | null
  /** `drafts.budget_adjustments` — `{ [team_id]: integer delta }` (D127). */
  budgetAdjustments: Json | null | undefined
}

/** 084's defaults: `COALESCE((config->>'auction_budget')::int, 200)` and
 *  `COALESCE((config->>'auction_min_bid')::int, 1)`.
 *
 *  Parity holds where the SQL is DEFINED — a missing or JSON-null knob falls
 *  to the default on both sides (`->>` yields NULL, COALESCE substitutes;
 *  measured: `coalesce(('{"a":null}'::jsonb->>'a')::int, 200)` → 200, and the
 *  same for `'{}'`). It does NOT hold for a MALFORMED knob (R424):
 *  `coalesce(('{"a":"abc"}'::jsonb->>'a')::int, 200)` RAISES **22P02**
 *  (`invalid input syntax for type integer: "abc"` — COALESCE never sees a
 *  value), while `intOrDefault` below (the shared reader, also behind
 *  `adjustmentFor`) falls to the default. The mirror is deliberately the more
 *  forgiving of the two: it paints a room, and a panel that throws is worse
 *  than one drawn off a default — but it is a DIVERGENCE, stated here rather
 *  than claimed away. Unreachable through the validated settings writes that
 *  produce `drafts.config` (§7.3.8's typed knobs), which is why it stays. */
export function auctionKnobsOf(config: Json | null | undefined): {
  auctionBudget: number
  minBid: number
} {
  const record = isRecord(config) ? config : {}
  return {
    auctionBudget: intOrDefault(record.auction_budget, 200),
    minBid: intOrDefault(record.auction_min_bid, 1),
  }
}

/** 084: `COALESCE((budget_adjustments->>team)::int, 0)`. */
export function adjustmentFor(budgetAdjustments: Json | null | undefined, teamId: string): number {
  if (!isRecord(budgetAdjustments)) return 0
  return intOrDefault(budgetAdjustments[teamId], 0)
}

/**
 * The mirror of `draft_team_budget(draft, team)`. `picks` is the draft's
 * whole pick list (undone rows included — they are filtered here exactly
 * as the SQL filters `is_undone = FALSE`); `teamId` selects the franchise.
 * Returns null where the SQL would raise for an underivable capacity.
 */
export function teamBudget(
  inputs: AuctionBudgetInputs,
  picks: readonly BudgetPickRow[],
  teamId: string,
): TeamBudget | null {
  const { totalRounds } = inputs
  if (totalRounds === null || !Number.isInteger(totalRounds) || totalRounds < 1) return null

  let committed = 0
  let filled = 0
  for (const pick of picks) {
    if (pick.team_id !== teamId || pick.is_undone === true) continue
    filled += 1
    committed += pick.price ?? 0
  }

  const remaining =
    inputs.auctionBudget + adjustmentFor(inputs.budgetAdjustments, teamId) - committed
  const openSlots = totalRounds - filled
  const maxBid = openSlots <= 0 ? 0 : remaining - (openSlots - 1) * inputs.minBid
  return { remaining, openSlots, maxBid, committed }
}

/** Every franchise's budget in one pass (§8.6.1's per-team rail). */
export function teamBudgets(
  inputs: AuctionBudgetInputs,
  picks: readonly BudgetPickRow[],
  teamIds: readonly string[],
): Map<string, TeamBudget | null> {
  const out = new Map<string, TeamBudget | null>()
  for (const teamId of teamIds) out.set(teamId, teamBudget(inputs, picks, teamId))
  return out
}

// ---------------------------------------------------------------------------
// The live nomination (D126 — phase is `current_nomination`'s NULLity)
// ---------------------------------------------------------------------------

/** 065:121's printed shape — what `draft_nominate` writes and every bid
 *  rewrites (085/089). */
export interface LiveNomination {
  player_id: string
  high_bid: number
  high_bidder_team_id: string
}

/** Structural read of `drafts.current_nomination`: null ⇒ NOMINATING phase;
 *  the object ⇒ BIDDING (D126). A malformed value reads as null (render the
 *  nominating state, never a half-parsed bid block). The room builds its
 *  `BidIntent` from this plus `drafts.current_pick_number` (the sequence
 *  number until the award — D157(2)) — the F64 identity a bid must name. */
export function readLiveNomination(value: Json | null | undefined): LiveNomination | null {
  if (!isRecord(value)) return null
  const playerId = value.player_id
  const highBid = value.high_bid
  const highBidder = value.high_bidder_team_id
  if (typeof playerId !== 'string' || playerId.length === 0) return null
  if (typeof highBid !== 'number' || !Number.isInteger(highBid)) return null
  if (typeof highBidder !== 'string' || highBidder.length === 0) return null
  return { player_id: playerId, high_bid: highBid, high_bidder_team_id: highBidder }
}

function isRecord(value: unknown): value is Record<string, Json | undefined> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function intOrDefault(value: unknown, fallback: number): number {
  if (typeof value === 'number' && Number.isInteger(value)) return value
  if (typeof value === 'string' && /^-?\d+$/.test(value.trim())) return Number.parseInt(value, 10)
  return fallback
}

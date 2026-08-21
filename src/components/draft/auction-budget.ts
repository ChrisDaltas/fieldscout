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
 *    complete roster ⇒ 0/0/0, and — 092/AP.1 — BOTH toggle states of
 *    `auction_zero_dollar_nominations` (reserve 1 and reserve 0);
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
 *  - `max_bid = remaining − (open_slots − 1) × reserve` (§8.6.1), UNCLAMPED
 *    except for the ONE special case 084 has: a complete roster
 *    (`open_slots ≤ 0`) reads `max_bid 0` (E27 — a full team cannot bid).
 *    A negative max bid on an open roster is left VISIBLE, exactly as the
 *    SQL leaves it for `draft_auction_solvent` to see;
 *  - config defaults are 084's COALESCE for the budget (200) and 092's
 *    `draft_auction_reserve` for the reserve (1 unless
 *    `auction_zero_dollar_nominations` is on — §7.3.8/§8.6.1);
 *  - where 084 RAISES (no/invalid `total_rounds`), the mirror returns null —
 *    render nothing, never guess (the draft-order.ts convention). The
 *    membership/retired-seat guards are the SQL's; a caller passes the
 *    franchises the room renders.
 */

import type { Json } from '@/types/database'
import { auctionReserve } from '@/lib/leagues/settings/league-settings'

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
  /** The §8.6.1 PER-SLOT RESERVE — 092's `draft_auction_reserve`, derived
   *  from `auction_zero_dollar_nominations` (1 off, 0 on). **Not** the bid
   *  increment, which is a fixed $1 (§8.6.3) and appears nowhere in this
   *  file's arithmetic. */
  reserve: 0 | 1
  /** `drafts.total_rounds` — the per-team roster capacity (D91/D126). */
  totalRounds: number | null
  /** `drafts.budget_adjustments` — `{ [team_id]: integer delta }` (D127). */
  budgetAdjustments: Json | null | undefined
}

/** 084's default for the budget, `COALESCE((config->>'auction_budget')::int, 200)`,
 *  and 092's `draft_auction_reserve(config)` for the reserve.
 *
 *  The reserve half has no such divergence: 092's helper is
 *  `COALESCE((config->>'auction_zero_dollar_nominations')::boolean, FALSE)`,
 *  and `boolOrDefault` below accepts exactly what PostgreSQL's `::boolean`
 *  accepts from a `->>` text (`true/false`, `t/f`, `yes/no`, `on/off`,
 *  `1/0`, case-insensitive, trimmed) — so a JSON `true`, the string
 *  `"true"` and the string `"1"` all read ON on both sides, and anything
 *  else falls to OFF where the SQL would raise 22P02. Same deliberate
 *  asymmetry, same reason.
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
  reserve: 0 | 1
} {
  const record = isRecord(config) ? config : {}
  return {
    auctionBudget: intOrDefault(record.auction_budget, 200),
    // THE ONE derivation (D198(1)) — `auctionReserve` is shared with the
    // settings validator; this function only turns the raw blob into the
    // boolean it takes.
    reserve: auctionReserve(boolOrDefault(record.auction_zero_dollar_nominations, false)),
  }
}

/** 084: `COALESCE((budget_adjustments->>team)::int, 0)`. */
export function adjustmentFor(budgetAdjustments: Json | null | undefined, teamId: string): number {
  if (!isRecord(budgetAdjustments)) return 0
  return intOrDefault(budgetAdjustments[teamId], 0)
}

/**
 * §8.6.1's max-bid formula, as ONE expression (ledger row **F95**, discharged
 * by AP.2).
 *
 * It was written out twice — here, inside `teamBudget`, and again in
 * `commish-auction-ops.ts`'s `budgetEditPreview`, which projects a
 * commissioner budget edit. Both are display-only mirrors of 084's
 * `draft_team_budget` and both already read the reserve through the ONE
 * derivation (`auctionReserve`, D198(1)), so this was never a second RESERVE
 * authority — it was the one place two copies of the FORMULA could drift.
 * AP.2's §8.6.9 predicate consumes this family, so a third copy appearing
 * beside two is exactly what F95 was filed to prevent.
 *
 * F95's suggested fix was to route `budgetEditPreview` THROUGH `teamBudget`
 * with a synthetic post-delta input (`totalRounds = openSlots + 1` and one
 * synthetic pick row). **R463 — the arithmetic, now actually run, rather than
 * described:** that route is CORRECT for an open roster (`openSlots 3` ⇒
 * `{10, 3, 8, 5}`) and, contrary to what this docblock first claimed, correct
 * for a COMPLETE one too — `openSlots 0` gives `totalRounds 1`, not `<= 0`, so
 * `teamBudget` returns a real `{98, 0, 0, 2}` with E27's `maxBid 0`. The ONLY
 * shape that returns null is an **overfull** roster (`openSlots -1` ⇒
 * `totalRounds 0`), which is engine corruption and unreachable. So the route
 * was rejected for a much weaker reason than first written, and the honest one
 * is this: sharing the expression meets F95's stated goal ("so one expression
 * serves both") with a smaller diff, no synthetic-input construction to keep
 * correct, and no behavioural change at all — while the synthetic route would
 * have carried a latent null on a shape nothing can currently produce.
 *
 * 084's ONE special case is here and nowhere else: a complete roster bids
 * nothing (E27). The formula is otherwise UNCLAMPED — a negative max bid on an
 * open roster stays visible, exactly as the SQL leaves it for
 * `draft_auction_solvent` to see.
 */
export function maxBidFor(remaining: number, openSlots: number, reserve: 0 | 1): number {
  return openSlots <= 0 ? 0 : remaining - (openSlots - 1) * reserve
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
  const maxBid = maxBidFor(remaining, openSlots, inputs.reserve)
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

/** PostgreSQL's `->>`-then-`::boolean` coercion, for the one knob that is a
 *  boolean. Accepts every literal `::boolean` accepts; anything else falls to
 *  the fallback (where the SQL would raise 22P02 — the same forgiving
 *  divergence `intOrDefault` documents above). */
function boolOrDefault(value: unknown, fallback: boolean): boolean {
  if (typeof value === 'boolean') return value
  if (typeof value === 'string') {
    const v = value.trim().toLowerCase()
    if (v === 'true' || v === 't' || v === 'yes' || v === 'y' || v === 'on' || v === '1') return true
    if (v === 'false' || v === 'f' || v === 'no' || v === 'n' || v === 'off' || v === '0') return false
  }
  return fallback
}

function intOrDefault(value: unknown, fallback: number): number {
  if (typeof value === 'number' && Number.isInteger(value)) return value
  if (typeof value === 'string' && /^-?\d+$/.test(value.trim())) return Number.parseInt(value, 10)
  return fallback
}

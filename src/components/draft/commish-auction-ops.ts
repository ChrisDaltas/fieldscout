/**
 * Auction commissioner-panel derivations — pure ops for the §8.7 auction
 * sections (M3 task L.C3.2; spec §8.7's v2.10 auction rows + C41's ruled
 * End-draft row; tasks-M3 D131/D141/D142/D143; E28).
 *
 * Everything here is DISPLAY-ONLY, in the §4.7 sense the room already works
 * under: the ONE budget authority is SQL (`draft_team_budget`, migration
 * 084), and `auction-budget.ts` is its parity-pinned TS mirror. These
 * helpers project what an edit WOULD do so the commissioner sees the
 * consequence before committing — they never admit or refuse anything. Every
 * refusal a commissioner actually meets is the RPC's, surfaced verbatim with
 * its own remedy copy (E28's three arms name the numbers and the way out).
 *
 * Pinned by `commish-auction-ops.test.ts`, which also reads the migration
 * chain: the pause-first RPC set, the gate's type-neutral predicate and the
 * refusal clause are cross-checked against the SQL at the chain HEAD, so the
 * disabled-state rule cannot drift away from the engine that enforces it.
 */

import { clampInt } from '@/utils/clamp-int'

import { teamBudget, type AuctionBudgetInputs, type TeamBudget } from './auction-budget'

// ---------------------------------------------------------------------------
// The auction clocks the room can edit mid-draft (§7.3.8 / 087's set_clock arm)
// ---------------------------------------------------------------------------

/**
 * §7.3.8's catalog ranges for the three auction clocks, as stored literals —
 * the SAME numbers League settings clamps its inputs to
 * (`settings-panel.tsx`, `clampInt(…, 10, 60, …)` and friends).
 *
 * R435 (M3 batch 14): the room's Clock form PRINTED these as labels and
 * enforced none of them — a `bid_seconds: 5` reached `drafts.config` through
 * the route, because `timerSecondsSchema` admits 0–86400 and 090's auction
 * arm only refuses negatives. A three-second bid clock makes an auction
 * unplayable, so the same clamp the settings editor has always applied is
 * applied here, in the payload builder. The route and the RPC stay exactly
 * as they are — they are the backstop, not the enforcement.
 */
export const AUCTION_TIMER_RANGES = {
  nominationSeconds: { min: 10, max: 120 },
  bidSeconds: { min: 10, max: 60 },
  antiSnipeSeconds: { min: 0, max: 15 },
} as const

/** The three clocks as `drafts.config` stores them (087's key names). */
export interface AuctionTimersStored {
  nomination: number
  bid: number
  antiSnipe: number
}

/** What the three boxes currently hold, as typed. */
export interface AuctionTimersTyped {
  nomination: string
  bid: string
  antiSnipe: string
}

export interface AuctionTimerPayload {
  nominationSeconds?: number
  bidSeconds?: number
  antiSnipeSeconds?: number
}

/**
 * The `draft_set_clock` auction payload: each box CLAMPED into its §7.3.8
 * range, and included only when the clamped value differs from what is
 * stored (087 reads an omitted key as "unchanged").
 *
 * Un-parseable or empty falls back to the STORED value — i.e. the field is
 * omitted — so a half-typed box never sends garbage, and a value outside the
 * range lands on the nearest bound rather than on the server.
 */
export function auctionTimerPayload(
  typed: AuctionTimersTyped,
  stored: AuctionTimersStored,
): AuctionTimerPayload {
  const one = (raw: string, range: { min: number; max: number }, current: number): number => {
    const trimmed = raw.trim()
    // Strict: only a plain integer counts. `clampInt`'s own parse would read
    // "12x" as 12; a box that cannot be read is "unchanged", never a guess.
    if (!/^-?\d+$/.test(trimmed)) return current
    return clampInt(trimmed, range.min, range.max, current)
  }

  const next = {
    nominationSeconds: one(typed.nomination, AUCTION_TIMER_RANGES.nominationSeconds, stored.nomination),
    bidSeconds: one(typed.bid, AUCTION_TIMER_RANGES.bidSeconds, stored.bid),
    antiSnipeSeconds: one(typed.antiSnipe, AUCTION_TIMER_RANGES.antiSnipeSeconds, stored.antiSnipe),
  }
  const current = {
    nominationSeconds: stored.nomination,
    bidSeconds: stored.bid,
    antiSnipeSeconds: stored.antiSnipe,
  }

  const payload: AuctionTimerPayload = {}
  for (const key of ['nominationSeconds', 'bidSeconds', 'antiSnipeSeconds'] as const) {
    if (next[key] !== current[key]) payload[key] = next[key]
  }
  return payload
}

// ---------------------------------------------------------------------------
// Who counts as a franchise (R436)
// ---------------------------------------------------------------------------

/**
 * The franchises the ENGINE counts. `draft_end` sums open slots over
 * `teams … WHERE t.league_id = … AND t.status <> 'retired'` (087), while
 * `GET /api/leagues/[id]` returns every team row with no status filter — so
 * anything the panel derives from the raw list (the End confirm's unfilled
 * count, the budget picker, Manual Edit's move targets) would disagree with
 * the engine the moment a franchise is retired.
 *
 * Latent today — nothing writes `'retired'` yet (`retire_franchise` is F1,
 * M4) — and pinned here so it stays impossible rather than merely unlikely.
 */
export const RETIRED_TEAM_STATUS = 'retired'

export function activeFranchises<T extends { status: string }>(teams: readonly T[]): T[] {
  return teams.filter((team) => team.status !== RETIRED_TEAM_STATUS)
}

// ---------------------------------------------------------------------------
// Budget editor (§8.7 "adjust a team's remaining budget"; E28's three arms)
// ---------------------------------------------------------------------------

/** Which E28-class floor a projected edit would breach, in the order 087
 *  checks them. `null` ⇒ nothing here predicts a refusal (the RPC still
 *  decides — it also re-derives against every other team). */
export type BudgetRefusalKind = 'below-committed' | 'below-floor' | 'below-high-bid' | null

export interface BudgetEditPreview {
  /** The team's budget as it stands (the mirror), or null when the draft
   *  carries no derivable capacity (`auction-budget.ts` — render nothing). */
  before: TeamBudget | null
  /** The same four numbers with the delta applied. Null with `before`. */
  after: TeamBudget | null
  refusal: BudgetRefusalKind
  /** One sentence for the projected refusal — team-neutral, because the
   *  team's name is the component's to render. Null when `refusal` is. */
  note: string | null
}

export interface BudgetEditInput {
  budget: TeamBudget | null
  /** The CUMULATIVE dollar delta (087 composes successive corrections into
   *  `drafts.budget_adjustments[team]`). 0 is refused by the RPC. */
  delta: number
  /** The §8.6.1 per-slot reserve (092's `draft_auction_reserve` — 1, or 0
   *  with `auction_zero_dollar_nominations` on). Never the bid increment. */
  reserve: 0 | 1
  /** The live high bid this team is currently holding, or null when it is
   *  not the high bidder (D131(4)'s arm 3 — a bid holds no money, but the
   *  award a tick away spends it). */
  highBidHeld: number | null
}

/**
 * Project a budget edit. Mirrors 084's arithmetic exactly (`remaining` moves
 * by the delta; `openSlots` and `committed` do not; `maxBid` re-derives, with
 * 084's one special case — a complete roster reads 0), then names which of
 * 087's three E28 arms the projection breaches.
 */
export function budgetEditPreview(input: BudgetEditInput): BudgetEditPreview {
  const before = input.budget
  if (!before) return { before: null, after: null, refusal: null, note: null }

  const remaining = before.remaining + input.delta
  const openSlots = before.openSlots
  const maxBid = openSlots <= 0 ? 0 : remaining - (openSlots - 1) * input.reserve
  const after: TeamBudget = { remaining, openSlots, maxBid, committed: before.committed }

  // Arm 1 — below committed spend. Kept ahead of arm 2 because the remedy
  // differs: money already spent comes back by reversing a won bid.
  if (remaining < 0) {
    return {
      before,
      after,
      refusal: 'below-committed',
      note: `That is $${-remaining} below the $${before.committed} this team has already spent — reverse a won bid instead, or make the adjustment smaller (E28).`,
    }
  }
  // Arm 2 — below the §8.6.8 solvency floor.
  const floor = openSlots * input.reserve
  if (remaining < floor) {
    return {
      before,
      after,
      refusal: 'below-floor',
      note: `That leaves $${remaining} for ${openSlots} open roster ${openSlots === 1 ? 'spot' : 'spots'} at a $${input.reserve} per-slot reserve — §8.6.8 needs at least $${floor}.`,
    }
  }
  // Arm 3 (D131(4)) — insolvent against the LIVE high bid this team holds.
  if (input.highBidHeld !== null && maxBid < input.highBidHeld) {
    return {
      before,
      after,
      refusal: 'below-high-bid',
      note: `This team is holding a $${input.highBidHeld} high bid and could no longer afford it (max bid would be $${maxBid}) — void the nomination or reverse a won bid first (E28).`,
    }
  }
  return { before, after, refusal: null, note: null }
}

// ---------------------------------------------------------------------------
// Manual Edit Mode's price re-entry (D142 — the re-entered amount IS the
// validation input; 087/090's priced reassign/move arms)
// ---------------------------------------------------------------------------

export type PriceEntryBlocker = 'empty' | 'not-a-number' | 'below-min' | 'over-max' | null

export interface PriceEntryModel {
  /** The league's price floor (§7.3.8) — the derived reserve, $1 or $0.
   *  090's `draft_move_player` / `draft_reassign_pick` refuse anything under
   *  it. Never the bid increment (§8.6.3). */
  min: number
  /** The RECEIVING team's max bid: what they can afford while still filling
   *  a legal roster (§8.6.8). Null when the mirror cannot derive it. */
  max: number | null
  /** The typed amount as an integer, or null when it is not one. */
  parsed: number | null
  blocker: PriceEntryBlocker
  /** The always-visible cap sentence (E28 prevented at the UI, exactly as
   *  the bid box prevents E5 — `auction-block-ops.ts`). */
  hint: string
}

/**
 * The cost re-entry box. Same posture as the bid box: the cap exists to
 * PREVENT the refusal, and the server refuses independently with its own
 * numbers if an over-cap amount ever reaches it.
 */
export function priceEntry(input: {
  raw: string
  /** The price floor a re-entered pick must clear AND the per-slot reserve
   *  the hint names — 090's `draft_reassign_pick` / `draft_move_player` use
   *  the one derived number for both (092/AP.1; D198(1)). */
  reserve: 0 | 1
  receivingBudget: TeamBudget | null
}): PriceEntryModel {
  const max = input.receivingBudget ? input.receivingBudget.maxBid : null
  const hint =
    max === null
      ? `At least $${input.reserve}.`
      : input.reserve === 0
        ? `$0–$${max} — this league allows $0 nominations, so nothing is held back per roster spot.`
        : `$${input.reserve}–$${max} — the receiving team keeps $${input.reserve} per remaining roster spot.`

  const trimmed = input.raw.trim()
  if (trimmed === '') {
    return { min: input.reserve, max, parsed: null, blocker: 'empty', hint }
  }
  if (!/^\d+$/.test(trimmed)) {
    return { min: input.reserve, max, parsed: null, blocker: 'not-a-number', hint }
  }
  const parsed = Number.parseInt(trimmed, 10)
  if (parsed < input.reserve) {
    return { min: input.reserve, max, parsed, blocker: 'below-min', hint }
  }
  if (max !== null && parsed > max) {
    return { min: input.reserve, max, parsed, blocker: 'over-max', hint }
  }
  return { min: input.reserve, max, parsed, blocker: null, hint }
}

// ---------------------------------------------------------------------------
// End draft (C41 RULED end-as-is — spec v2.10.1 §8.7)
// ---------------------------------------------------------------------------

/** The word a commissioner types to arm End draft — the Reset section's
 *  hard-confirm idiom (§8.7: "Hard confirm … cannot be silent"), with its
 *  own word so a half-typed RESET can never fire the terminal control. */
export const END_CONFIRM_WORD = 'END'

/**
 * Roster spots that stay unfilled if the draft ends right now — the number
 * `draft_end` itself counts (`SUM(open_slots)` over every non-retired
 * franchise, through the one budget family), derived here for the confirm
 * dialog so it lists a true consequence rather than a plausible one.
 *
 * Returns null when the mirror cannot derive a capacity for some franchise
 * (087 would raise) — the dialog then says the spots are unfilled without
 * claiming a count, because a wrong number in a terminal confirm is worse
 * than no number (CLAUDE.md's loud-failure rule, applied to copy).
 */
export function unfilledSlotsAtEnd(
  inputs: AuctionBudgetInputs,
  picks: Parameters<typeof teamBudget>[1],
  teamIds: readonly string[],
): number | null {
  let total = 0
  for (const teamId of teamIds) {
    const budget = teamBudget(inputs, picks, teamId)
    if (!budget) return null
    total += Math.max(0, budget.openSlots)
  }
  return total
}

/** The §8.7 consequence list, verbatim from the ruling (C41 / spec v2.10.1)
 *  with the derived count folded into the first clause. */
export function endDraftConsequences(unfilled: number | null): readonly string[] {
  return [
    unfilled === null
      ? 'Unfilled roster spots stay empty.'
      : `${unfilled} roster ${unfilled === 1 ? 'spot stays' : 'spots stay'} unfilled.`,
    'Drafted players keep their prices.',
    'The league moves to in-season.',
    'Free agency fills the gaps.',
  ]
}

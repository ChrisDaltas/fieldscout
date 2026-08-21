/**
 * Golden pins for the budget mirror (M3 task L.C2.1; §4.7/D127 — the D90
 * parity pattern's LITERAL half). Every expected tuple below is copied
 * from pgTAP `033_auction_start_budgets.sql` §D/§E as a STORED LITERAL —
 * the same goldens the SQL `draft_team_budget` answers to — so the twins
 * cannot drift together silently. The stack-backed half (TS ≡ the real RPC
 * over a driven auction) is `auction-api-db.test.ts`'s parity sweep.
 *
 * Break probe (the task DoD): skew the mirror (drop the `− 1` in the
 * max-bid formula) — the max-bid pins here go RED alongside the parity
 * sweep's.
 */
import { describe, expect, it } from 'vitest'

import {
  adjustmentFor,
  auctionKnobsOf,
  readLiveNomination,
  teamBudget,
  teamBudgets,
  type BudgetPickRow,
} from './auction-budget'

const T1 = 'c5000000-0000-4000-8000-00aa00000001'
const T2 = 'c5000000-0000-4000-8000-00aa00000002'

/** 033's 12-team $200 / 15-slot league, reserve 1 ($0 nominations OFF — the
 *  §7.3.8 default). 092/AP.1 renamed the knob from `minBid` to `reserve` and
 *  derived it from `auction_zero_dollar_nominations`; every literal below is
 *  UNCHANGED at the default, which is the parity claim. */
const LA = { auctionBudget: 200, reserve: 1 as const, totalRounds: 15, budgetAdjustments: {} }

const pick = (team: string, price: number | null, undone = false): BudgetPickRow => ({
  team_id: team,
  price,
  is_undone: undone,
})

describe('teamBudget ≡ pgTAP 033 §D goldens (stored literals)', () => {
  it('GOLDEN 12-team $200/min-1: remaining 200, open 15, max_bid 186 (200 − 14×1), committed 0', () => {
    expect(teamBudget(LA, [], T1)).toEqual({
      remaining: 200,
      openSlots: 15,
      maxBid: 186,
      committed: 0,
    })
  })

  it('after a $50 buy: 150 / 14 / 137 (150 − 13×1) / 50', () => {
    expect(teamBudget(LA, [pick(T1, 50)], T1)).toEqual({
      remaining: 150,
      openSlots: 14,
      maxBid: 137,
      committed: 50,
    })
  })

  it('…an IS_UNDONE $999 row changes NOTHING — undo refunds by derivation (D127/D131)', () => {
    expect(teamBudget(LA, [pick(T1, 50), pick(T1, 999, true)], T1)).toEqual({
      remaining: 150,
      openSlots: 14,
      maxBid: 137,
      committed: 50,
    })
  })

  it('a −$20 adjustment lands in remaining and max_bid: 130 / 14 / 117 / 50; +$25: 175 / 14 / 162 / 50', () => {
    const picks = [pick(T1, 50), pick(T1, 999, true)]
    expect(teamBudget({ ...LA, budgetAdjustments: { [T1]: -20 } }, picks, T1)).toEqual({
      remaining: 130,
      openSlots: 14,
      maxBid: 117,
      committed: 50,
    })
    expect(teamBudget({ ...LA, budgetAdjustments: { [T1]: 25 } }, picks, T1)).toEqual({
      remaining: 175,
      openSlots: 14,
      maxBid: 162,
      committed: 50,
    })
  })

  it('…a per-team adjustment is PER TEAM: team 2 still reads the untouched 200/186', () => {
    const budgets = teamBudgets(
      { ...LA, budgetAdjustments: { [T1]: 25 } },
      [pick(T1, 50)],
      [T1, T2],
    )
    expect(budgets.get(T2)).toEqual({ remaining: 200, openSlots: 15, maxBid: 186, committed: 0 })
    expect(budgets.get(T1)?.remaining).toBe(175)
  })

  it('an insolvent state stays VISIBLE: remaining 0 over 14 open slots reads max_bid −13 (unclamped)', () => {
    // 033: (0, 14, −13) — the formula is not rounded away on an open roster.
    expect(teamBudget(LA, [pick(T1, 200)], T1)).toMatchObject({
      remaining: 0,
      openSlots: 14,
      maxBid: -13,
    })
  })

  it('E25 GOLDEN (§8.6.7(d)): $3 across 3 open slots ⇒ max_bid $1; one dollar less ⇒ $0', () => {
    const le = { auctionBudget: 3, reserve: 1 as const, totalRounds: 3, budgetAdjustments: {} }
    expect(teamBudget(le, [], T2)).toEqual({ remaining: 3, openSlots: 3, maxBid: 1, committed: 0 })
    expect(teamBudget({ ...le, budgetAdjustments: { [T2]: -1 } }, [], T2)).toEqual({
      remaining: 2,
      openSlots: 3,
      maxBid: 0,
      committed: 0,
    })
  })

  it('E27: a COMPLETE roster reads open_slots 0 and max_bid 0 — the ONE special case (a full team cannot bid)', () => {
    const le = { auctionBudget: 3, reserve: 1 as const, totalRounds: 3, budgetAdjustments: {} }
    expect(teamBudget(le, [pick(T1, 1), pick(T1, 1), pick(T1, 1)], T1)).toEqual({
      remaining: 0,
      openSlots: 0,
      maxBid: 0,
      committed: 3,
    })
  })

  // 092/AP.1 — C38's substance, RE-POINTED at the toggle rather than deleted
  // (D198(3)). The vehicle (a 0–5 `auction_min_bid` field) is retired; the
  // finding it pinned — a $0 reserve makes the whole remaining budget bidable
  // — is now spec law at §8.6.1/§7.3.8 and is pinned here at reserve 0.
  // These two pins are the TS half of pgTAP 040 §B's stored literals.
  it('$0 NOMINATIONS ON (reserve 0) GOLDEN: the whole remaining budget is bidable (200 − 14×0 = 200)', () => {
    expect(teamBudget({ ...LA, reserve: 0 }, [], T1)).toMatchObject({
      remaining: 200,
      openSlots: 15,
      maxBid: 200,
    })
  })

  it('D146 BOUNDARY, one unit either side of the toggle: reserve 1 ⇒ 186, reserve 0 ⇒ 200, and the gap is exactly (open−1)×1 = 14', () => {
    const off = teamBudget({ ...LA, reserve: 1 }, [], T1)
    const on = teamBudget({ ...LA, reserve: 0 }, [], T1)
    expect(off?.maxBid).toBe(186)
    expect(on?.maxBid).toBe(200)
    expect((on?.maxBid ?? 0) - (off?.maxBid ?? 0)).toBe(14)
  })

  it('D146 BOUNDARY at the LAST slot: with ONE slot open the reserve term vanishes and both toggle states agree at 200', () => {
    // (open_slots − 1) × reserve is 0 whichever the reserve is, so this is
    // the one shape where the toggle CANNOT show — a pin that would stay
    // green under any reserve, kept as the negative control for the two above.
    const one = { ...LA, totalRounds: 1 }
    expect(teamBudget({ ...one, reserve: 1 }, [], T1)?.maxBid).toBe(200)
    expect(teamBudget({ ...one, reserve: 0 }, [], T1)?.maxBid).toBe(200)
  })

  it('E25 at reserve 0: $3 across 3 open slots is the WHOLE $3 — nothing is held back (§8.6.8 stops binding)', () => {
    const le = { auctionBudget: 3, reserve: 0 as const, totalRounds: 3, budgetAdjustments: {} }
    expect(teamBudget(le, [], T2)).toEqual({ remaining: 3, openSlots: 3, maxBid: 3, committed: 0 })
  })

  it('a NULL-price row (a snake-shaped pick) counts a slot and no money — SUM ignores NULL, COUNT does not', () => {
    expect(teamBudget(LA, [pick(T1, null)], T1)).toEqual({
      remaining: 200,
      openSlots: 14,
      maxBid: 187,
      committed: 0,
    })
  })

  it('where 084 RAISES (no capacity) the mirror returns null — render nothing, never guess', () => {
    expect(teamBudget({ ...LA, totalRounds: null }, [], T1)).toBeNull()
    expect(teamBudget({ ...LA, totalRounds: 0 }, [], T1)).toBeNull()
  })
})

describe('the drafts-row readers (084 COALESCE defaults; 065:121 nomination shape)', () => {
  it('auctionKnobsOf: 084/092 defaults (200 / reserve 1) when absent; the stored knobs when present', () => {
    expect(auctionKnobsOf(null)).toEqual({ auctionBudget: 200, reserve: 1 })
    expect(auctionKnobsOf({})).toEqual({ auctionBudget: 200, reserve: 1 })
    expect(auctionKnobsOf({ auction_budget: 50, auction_zero_dollar_nominations: true })).toEqual({
      auctionBudget: 50,
      reserve: 0,
    })
    expect(auctionKnobsOf({ auction_budget: '300', auction_zero_dollar_nominations: false })).toEqual({
      auctionBudget: 300,
      reserve: 1,
    })
  })

  it('auctionKnobsOf ≡ 092 draft_auction_reserve: every `::boolean` literal reads ON, everything else falls to OFF', () => {
    // `COALESCE((config->>'auction_zero_dollar_nominations')::boolean, FALSE)`
    // — `->>` yields text, so a JSON `true`, the string "true" and the string
    // "1" are all TRUE in Postgres. Anything else falls to the default here
    // (where the SQL would raise 22P02), the same deliberate asymmetry
    // `intOrDefault` carries for the budget.
    for (const on of [true, 'true', 'TRUE', ' t ', 'yes', 'on', '1']) {
      expect(auctionKnobsOf({ auction_zero_dollar_nominations: on }).reserve).toBe(0)
    }
    for (const off of [false, 'false', 'f', 'no', 'off', '0', null, 'abc', 2, {}]) {
      expect(auctionKnobsOf({ auction_zero_dollar_nominations: off }).reserve).toBe(1)
    }
    // The RETIRED key is inert: a stale blob cannot resurrect the old floor.
    expect(auctionKnobsOf({ auction_min_bid: 0 }).reserve).toBe(1)
  })

  it('adjustmentFor: 0 when absent / malformed; the integer delta when present', () => {
    expect(adjustmentFor(null, T1)).toBe(0)
    expect(adjustmentFor({}, T1)).toBe(0)
    expect(adjustmentFor({ [T1]: -20 }, T1)).toBe(-20)
    expect(adjustmentFor({ [T1]: -20 }, T2)).toBe(0)
    expect(adjustmentFor([1, 2], T1)).toBe(0)
  })

  it('readLiveNomination: NULL ⇒ nominating; the printed object ⇒ bidding; anything half-formed ⇒ null', () => {
    expect(readLiveNomination(null)).toBeNull()
    expect(readLiveNomination({ player_id: 'p1', high_bid: 7, high_bidder_team_id: T2 })).toEqual({
      player_id: 'p1',
      high_bid: 7,
      high_bidder_team_id: T2,
    })
    expect(
      readLiveNomination({ player_id: 'p1', high_bid: '7', high_bidder_team_id: T2 }),
    ).toBeNull()
    expect(readLiveNomination({ player_id: '', high_bid: 7, high_bidder_team_id: T2 })).toBeNull()
    expect(readLiveNomination({ player_id: 'p1', high_bid: 7 })).toBeNull()
    expect(readLiveNomination('bidding')).toBeNull()
  })
})

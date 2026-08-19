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

/** 033's 12-team $200 / min-bid 1 / 15-slot league. */
const LA = { auctionBudget: 200, minBid: 1, totalRounds: 15, budgetAdjustments: {} }

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
    const le = { auctionBudget: 3, minBid: 1, totalRounds: 3, budgetAdjustments: {} }
    expect(teamBudget(le, [], T2)).toEqual({ remaining: 3, openSlots: 3, maxBid: 1, committed: 0 })
    expect(teamBudget({ ...le, budgetAdjustments: { [T2]: -1 } }, [], T2)).toEqual({
      remaining: 2,
      openSlots: 3,
      maxBid: 0,
      committed: 0,
    })
  })

  it('E27: a COMPLETE roster reads open_slots 0 and max_bid 0 — the ONE special case (a full team cannot bid)', () => {
    const le = { auctionBudget: 3, minBid: 1, totalRounds: 3, budgetAdjustments: {} }
    expect(teamBudget(le, [pick(T1, 1), pick(T1, 1), pick(T1, 1)], T1)).toEqual({
      remaining: 0,
      openSlots: 0,
      maxBid: 0,
      committed: 3,
    })
  })

  it('C38 GOLDEN: at min_bid 0 the whole remaining budget is bidable (200 − 14×0 = 200)', () => {
    expect(teamBudget({ ...LA, minBid: 0 }, [], T1)).toMatchObject({
      remaining: 200,
      openSlots: 15,
      maxBid: 200,
    })
  })

  it('GOLDEN $50/min-3: max_bid 8 (50 − 14×3) — the reserve keeps the other fourteen slots affordable', () => {
    expect(
      teamBudget({ auctionBudget: 50, minBid: 3, totalRounds: 15, budgetAdjustments: {} }, [], T1),
    ).toMatchObject({ remaining: 50, openSlots: 15, maxBid: 8 })
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
  it('auctionKnobsOf: 084 defaults (200 / 1) when absent; the stored knobs when present (number or numeric string)', () => {
    expect(auctionKnobsOf(null)).toEqual({ auctionBudget: 200, minBid: 1 })
    expect(auctionKnobsOf({})).toEqual({ auctionBudget: 200, minBid: 1 })
    expect(auctionKnobsOf({ auction_budget: 50, auction_min_bid: 0 })).toEqual({
      auctionBudget: 50,
      minBid: 0,
    })
    expect(auctionKnobsOf({ auction_budget: '300', auction_min_bid: '2' })).toEqual({
      auctionBudget: 300,
      minBid: 2,
    })
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

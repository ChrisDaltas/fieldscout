/**
 * auction-solvency-property.test.ts — L.C4.1 item 3(a): THE solvency
 * property test's PURE layer (delivery plan §4.1 "max-bid & solvency";
 * spec §8.6.1/§8.6.7/§8.6.8; tasks-M3 D127/D131(3)/§4.7).
 *
 * fast-check over the display mirror (`auction-budget.ts` — the pinned TS
 * twin of migration 092's `draft_team_budget`): the ALGEBRA that makes the
 * engine's §8.6.8 guarantee true is proven as properties over randomized
 * inputs, in BOTH reserve columns (092's `auction_zero_dollar_nominations`
 * toggle — reserve $1 OFF / $0 ON), rather than at a handful of goldens:
 *
 *   1. conservation — `committed + remaining = budget + adjustment`, always;
 *   2. the §8.6.1 formula + E27 — `max_bid = remaining − (open_slots − 1) ×
 *      reserve`, with a complete roster reading 0 flat;
 *   3. award monotonicity — a legal award (price ≥ the reserve floor) never
 *      RAISES a max bid;
 *   4. THE AWARD LEMMA — solvent ∧ `reserve ≤ price ≤ max_bid` ⇒ solvent
 *      after the award. This is the §8.6.8 induction step: it is WHY
 *      admitting only `amount ≤ max_bid` keeps every reachable state
 *      solvent;
 *   5. the D146 ONE-UNIT boundary — at reserve $1, an award at exactly
 *      `max_bid + 1` from a boundary-solvent state is INSOLVENT by exactly
 *      one dollar. The pin set contains the case that is false by one unit
 *      of the thing compared, as a property rather than a fixture;
 *   6. undo preservation (D131(3)) — undoing any legal-priced pick of a
 *      solvent team leaves it solvent (refund ≥ the slot it re-opens);
 *   7. the reserve relation — `max_bid` at reserve 0 ≥ at reserve 1
 *      (the toggle only ever loosens, §8.6.8's "stops binding");
 *   8. `teamBudget` ≡ `maxBidFor` — one formula, no drift between the two
 *      exported forms (the F95 lesson).
 *
 * TS ≡ SQL parity is NOT this file's (a unit test cannot reach the stack):
 * the stored-literal goldens live in `auction-budget.test.ts`, the driven
 * per-franchise sweep in `auction-api-db.test.ts`, and L.C4.1's randomized
 * command-level parity in `auction-solvency-property-db.test.ts` (the DB
 * layer) plus the sim's per-league `auction-budget-parity` invariant.
 *
 * SEED: fixed literal (replayable in CI); override with FC_SEED=<n> to
 * replay a counterexample — fast-check prints the failing seed/path itself
 * on any red. A found counterexample is a FINDING (file it), never a
 * generator constraint to be massaged away.
 */
import fc from 'fast-check'
import { describe, expect, it } from 'vitest'

import {
  maxBidFor,
  teamBudget,
  type AuctionBudgetInputs,
  type BudgetPickRow,
} from './auction-budget'

const SEED = process.env.FC_SEED !== undefined ? Number(process.env.FC_SEED) : 20260825
const NUM_RUNS = process.env.FC_RUNS !== undefined ? Number(process.env.FC_RUNS) : 500
const FC = { seed: SEED, numRuns: NUM_RUNS, verbose: true } as const

const TEAM = 'team-under-test'
const OTHER = 'someone-else'

interface Scenario {
  inputs: AuctionBudgetInputs
  picks: BudgetPickRow[]
  adjustment: number
}

/** A randomized franchise state: budget/reserve/capacity plus a pick list
 *  that includes NOISE (other teams' rows, undone rows) the derivation must
 *  filter — exactly what the SQL filters. Prices here are UNCONSTRAINED
 *  (0..1000): the raw-state properties must hold on garbage too. */
const scenarioArb: fc.Arbitrary<Scenario> = fc
  .record({
    budget: fc.integer({ min: 50, max: 1000 }),
    reserve: fc.constantFrom<0 | 1>(0, 1),
    totalRounds: fc.integer({ min: 1, max: 16 }),
    adjustment: fc.integer({ min: -300, max: 300 }),
    ownPicks: fc.array(
      fc.record({
        price: fc.integer({ min: 0, max: 1000 }),
        is_undone: fc.boolean(),
      }),
      { maxLength: 16 },
    ),
    noisePicks: fc.array(
      fc.record({
        price: fc.integer({ min: 0, max: 1000 }),
        is_undone: fc.boolean(),
      }),
      { maxLength: 8 },
    ),
  })
  .map(({ budget, reserve, totalRounds, adjustment, ownPicks, noisePicks }) => ({
    inputs: {
      auctionBudget: budget,
      reserve,
      totalRounds,
      budgetAdjustments: { [TEAM]: adjustment },
    },
    picks: [
      ...ownPicks.map((p) => ({ team_id: TEAM, ...p })),
      ...noisePicks.map((p) => ({ team_id: OTHER, ...p })),
    ],
    adjustment,
  }))

function derived(s: Scenario) {
  const b = teamBudget(s.inputs, s.picks, TEAM)
  expect(b).not.toBeNull()
  return b!
}

describe('auction solvency — the pure property layer (L.C4.1 3a)', () => {
  it('1. conservation: committed + remaining = budget + adjustment, always', () => {
    fc.assert(
      fc.property(scenarioArb, (s) => {
        const b = derived(s)
        expect(b.committed + b.remaining).toBe(s.inputs.auctionBudget + s.adjustment)
      }),
      FC,
    )
  })

  it('2. the §8.6.1 formula + E27: max_bid = remaining − (open−1)×reserve; complete roster bids 0', () => {
    fc.assert(
      fc.property(scenarioArb, (s) => {
        const b = derived(s)
        const live = s.picks.filter((p) => p.team_id === TEAM && p.is_undone !== true)
        expect(b.openSlots).toBe(s.inputs.totalRounds! - live.length)
        if (b.openSlots <= 0) expect(b.maxBid).toBe(0)
        else expect(b.maxBid).toBe(b.remaining - (b.openSlots - 1) * s.inputs.reserve)
      }),
      FC,
    )
  })

  it('3. award monotonicity: a legal-priced award never raises an OPEN roster’s max bid', () => {
    // Scoped honestly: while the roster stays open (open_slots' ≥ 1) the
    // formula is monotone. The one exception is E27's clamp — a FINAL award
    // from an already-insolvent raw state (negative unclamped max bid, a
    // state the engine never reaches but this generator can write) snaps to
    // the clamp's 0, which is ABOVE the negative it replaced. The clamp
    // case is asserted for what it is instead of being averaged away —
    // found by this very property's first run (seed 20260825, path 36:…),
    // scoped rather than silenced.
    fc.assert(
      fc.property(
        scenarioArb,
        fc.integer({ min: 0, max: 1000 }),
        (s, rawPrice) => {
          const before = derived(s)
          fc.pre(before.openSlots >= 1)
          const price = Math.max(s.inputs.reserve, rawPrice) // floor-legal
          const after = teamBudget(
            s.inputs,
            [...s.picks, { team_id: TEAM, price, is_undone: false }],
            TEAM,
          )!
          if (after.openSlots >= 1) expect(after.maxBid).toBeLessThanOrEqual(before.maxBid)
          else expect(after.maxBid).toBe(0) // E27: a complete roster bids nothing
        },
      ),
      FC,
    )
  })

  it('4. THE AWARD LEMMA (§8.6.8 induction step): solvent ∧ reserve ≤ price ≤ max_bid ⇒ solvent after', () => {
    fc.assert(
      fc.property(scenarioArb, fc.integer({ min: 0, max: 1000 }), (s, seedPrice) => {
        const before = derived(s)
        fc.pre(before.openSlots >= 1)
        fc.pre(before.remaining >= before.openSlots * s.inputs.reserve) // solvent
        fc.pre(before.maxBid >= s.inputs.reserve) // some legal price exists
        const price =
          s.inputs.reserve + (seedPrice % (before.maxBid - s.inputs.reserve + 1))
        const after = teamBudget(
          s.inputs,
          [...s.picks, { team_id: TEAM, price, is_undone: false }],
          TEAM,
        )!
        expect(after.remaining).toBeGreaterThanOrEqual(after.openSlots * s.inputs.reserve)
      }),
      FC,
    )
  })

  it('5. the D146 one-unit boundary: at reserve 1, max_bid + 1 from boundary-solvency is insolvent by EXACTLY $1', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 16 }),
        fc.integer({ min: 0, max: 300 }),
        (openSlots, headroom) => {
          // Construct boundary solvency directly: remaining = open×1 + headroom.
          // Award at max_bid + 1 ⇒ remaining' = (open−1) + headroom − (max_bid
          // − remaining) − 1 … algebra collapses to open'×reserve − 1: check it.
          const reserve = 1 as const
          const remaining = openSlots * reserve + headroom
          const maxBid = maxBidFor(remaining, openSlots, reserve)
          const price = maxBid + 1
          const remainingAfter = remaining - price
          const openAfter = openSlots - 1
          expect(remainingAfter).toBe(openAfter * reserve - 1) // one unit short, exactly
          expect(remainingAfter).toBeLessThan(openAfter * reserve)
          // …and at price = maxBid exactly, solvency holds with EQUALITY:
          expect(remaining - maxBid).toBe(openAfter * reserve)
        },
      ),
      FC,
    )
  })

  it('6. undo preservation (D131(3)): undoing a legal-priced pick of a solvent team keeps it solvent', () => {
    fc.assert(
      fc.property(scenarioArb, fc.nat(), (s, pickIndex) => {
        // Legalize the board: every live own price ≥ the reserve floor.
        const picks = s.picks.map((p) =>
          p.team_id === TEAM && p.is_undone !== true
            ? { ...p, price: Math.max(s.inputs.reserve, p.price ?? 0) }
            : p,
        )
        const liveIdx = picks
          .map((p, i) => ({ p, i }))
          .filter(({ p }) => p.team_id === TEAM && p.is_undone !== true)
        fc.pre(liveIdx.length > 0)
        const before = teamBudget(s.inputs, picks, TEAM)!
        fc.pre(before.remaining >= before.openSlots * s.inputs.reserve) // solvent
        const target = liveIdx[pickIndex % liveIdx.length]!.i
        const undone = picks.map((p, i) => (i === target ? { ...p, is_undone: true } : p))
        const after = teamBudget(s.inputs, undone, TEAM)!
        expect(after.remaining).toBeGreaterThanOrEqual(after.openSlots * s.inputs.reserve)
        // The refund is exact — conservation carries through the undo:
        expect(after.remaining - before.remaining).toBe(picks[target]!.price ?? 0)
        expect(after.openSlots - before.openSlots).toBe(1)
      }),
      FC,
    )
  })

  it('7. the reserve relation: the $0 toggle only ever LOOSENS (max_bid₀ ≥ max_bid₁)', () => {
    fc.assert(
      fc.property(scenarioArb, (s) => {
        const b = derived(s)
        fc.pre(b.openSlots >= 1)
        expect(maxBidFor(b.remaining, b.openSlots, 0)).toBeGreaterThanOrEqual(
          maxBidFor(b.remaining, b.openSlots, 1),
        )
      }),
      FC,
    )
  })

  it('8. one formula: teamBudget.maxBid ≡ maxBidFor (the F95 no-drift pin, property-shaped)', () => {
    fc.assert(
      fc.property(scenarioArb, (s) => {
        const b = derived(s)
        expect(b.maxBid).toBe(maxBidFor(b.remaining, b.openSlots, s.inputs.reserve))
      }),
      FC,
    )
  })
})

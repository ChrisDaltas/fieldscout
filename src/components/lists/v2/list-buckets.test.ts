import { describe, expect, it } from 'vitest'

import type { ListPlayerWithPlayer } from '@/hooks/use-lists'

import { budgetShare, buildBuckets } from './list-buckets'

/**
 * Pins the two decisions in `list-buckets.ts` that are easy to "simplify" back
 * into being wrong:
 *
 * 1. **Tier/round membership is stored, cost/budget membership is computed.**
 *    The screenshots corrected the plan on this (see the module header); a
 *    later reader who only has plan D4's "nothing is computed" in front of them
 *    would reasonably delete the arithmetic.
 * 2. **Rounds is empty until LV.1.5 widens the tier CHECK**, and that is the
 *    designed state rather than a bug. When LV.1.5 lands, the `r1` case here
 *    starts passing real data and this test says so.
 */

const NO_LABELS: Readonly<Record<string, string>> = Object.freeze(Object.create(null))

function entry(
  id: string,
  overrides: { tier?: string | null; cost?: number | null } = {},
): ListPlayerWithPlayer {
  return {
    id,
    list_id: 'l1',
    player_id: `p-${id}`,
    position: Number(id),
    tier: overrides.tier ?? null,
    added_at: null,
    notes: null,
    overall_rank: null,
    rank_in_tier: null,
    slot: null,
    updated_at: null,
    player: {
      id: `p-${id}`,
      full_name: `Player ${id}`,
      position: 'WR',
      team: 'NYG',
      headshot_url: null,
      status: null,
      auction_value: overrides.cost ?? null,
    },
    stats: null,
  } as unknown as ListPlayerWithPlayer
}

describe('buildBuckets', () => {
  it('ranked is one unlabelled bucket in array order', () => {
    const entries = [entry('1'), entry('2'), entry('3')]
    const buckets = buildBuckets({ org: 'rank', entries, bandLabels: NO_LABELS, budget: 200 })

    expect(buckets).toHaveLength(1)
    expect(buckets[0].label).toBeNull()
    expect(buckets[0].entries.map((e) => e.id)).toEqual(['1', '2', '3'])
  })

  it('tiers group on the stored S–F value and show the value alone', () => {
    const entries = [
      entry('1', { tier: 'A' }),
      entry('2', { tier: 'S' }),
      entry('3', { tier: 'A' }),
    ]
    const buckets = buildBuckets({ org: 'tier', entries, bandLabels: NO_LABELS, budget: 200 })

    // S before A, and the header never repeats the word "Tier".
    expect(buckets.map((b) => b.label)).toEqual(['S', 'A'])
    expect(buckets[1].entries.map((e) => e.id)).toEqual(['1', '3'])
  })

  it('an entirely unbucketed list renders one bare section, not "Ungrouped"', () => {
    const buckets = buildBuckets({
      org: 'tier',
      entries: [entry('1'), entry('2')],
      bandLabels: NO_LABELS,
      budget: 200,
    })

    expect(buckets).toHaveLength(1)
    expect(buckets[0].label).toBeNull()
  })

  it('mixed bucketing keeps the leftovers in a trailing Ungrouped section', () => {
    const buckets = buildBuckets({
      org: 'tier',
      entries: [entry('1', { tier: 'S' }), entry('2')],
      bandLabels: NO_LABELS,
      budget: 200,
    })

    expect(buckets.map((b) => b.label)).toEqual(['S', 'Ungrouped'])
  })

  it('rounds read r1…rN out of the same tier column — empty until LV.1.5', () => {
    // What every row in the database looks like today: the live
    // `list_players_tier_check` cannot hold a round key.
    const today = buildBuckets({
      org: 'round',
      entries: [entry('1', { tier: 'S' }), entry('2', { tier: 'A' })],
      bandLabels: NO_LABELS,
      budget: 200,
    })
    expect(today.map((b) => b.label)).toEqual([null])

    // What LV.1.5 opens, without another line of UI work.
    const afterLv15 = buildBuckets({
      org: 'round',
      entries: [entry('1', { tier: 'r2' }), entry('2', { tier: 'r1' }), entry('3', { tier: 'r10' })],
      bandLabels: NO_LABELS,
      budget: 200,
    })
    // Numeric order, not lexical — 'r10' must not sort between 'r1' and 'r2'.
    expect(afterLv15.map((b) => b.label)).toEqual(['1', '2', '10'])
  })

  it('cost bands are computed from the auction price and keep empty bands', () => {
    const entries = [
      entry('1', { cost: 63 }),
      entry('2', { cost: 40 }),
      entry('3', { cost: 39 }),
      entry('4', { cost: 9 }),
      entry('5'),
    ]
    const buckets = buildBuckets({ org: 'cost', entries, bandLabels: NO_LABELS, budget: 200 })

    expect(buckets.map((b) => b.label)).toEqual([
      '$40 and up',
      '$25 – $39',
      '$10 – $24',
      'Under $10',
      'No auction value',
    ])
    // Boundaries are inclusive at the bottom: $40 belongs to "$40 and up".
    expect(buckets[0].entries.map((e) => e.id)).toEqual(['1', '2'])
    expect(buckets[0].meta).toBe('$103')
    // The band with nobody in it still renders, with a $0 total.
    expect(buckets[2].entries).toHaveLength(0)
    expect(buckets[2].meta).toBe('$0')
    // A player with no price is never silently filed into "Under $10".
    expect(buckets[4].entries.map((e) => e.id)).toEqual(['5'])
  })

  it('a renamed cost band keeps its threshold', () => {
    const buckets = buildBuckets({
      org: 'cost',
      entries: [entry('1', { cost: 63 })],
      bandLabels: { c1: 'Stars' },
      budget: 200,
    })

    expect(buckets[0].label).toBe('Stars')
    expect(buckets[0].entries.map((e) => e.id)).toEqual(['1'])
  })

  it('budget bands drop the empty ones and keep their own ramp colour', () => {
    const entries = [entry('1', { cost: 63 }), entry('2', { cost: 4 })]
    const buckets = buildBuckets({ org: 'budget', entries, bandLabels: NO_LABELS, budget: 200 })

    expect(buckets.map((b) => b.label)).toEqual(['Over 20% of budget', 'Under 5%'])
    // "Under 5%" is the fourth band, so it keeps tier-4 even though the two
    // bands above it were dropped.
    expect(buckets[1].className).toContain('tier-4')
  })
})

describe('budgetShare', () => {
  it('is a whole percent of the session budget, and null when unpriced', () => {
    expect(budgetShare(entry('1', { cost: 63 }), 200)).toBe(32)
    expect(budgetShare(entry('2', { cost: 40 }), 200)).toBe(20)
    expect(budgetShare(entry('3'), 200)).toBeNull()
  })

  it('never divides by zero', () => {
    expect(budgetShare(entry('1', { cost: 10 }), 0)).toBe(1000)
  })
})

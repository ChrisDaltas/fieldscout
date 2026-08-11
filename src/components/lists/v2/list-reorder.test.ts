import { describe, expect, it } from 'vitest'

import type { ListPlayerWithPlayer } from '@/hooks/use-lists'

import {
  bucketDrop,
  bucketZoneLabel,
  buildBuckets,
  canReorder,
  nextBucket,
  type Bucket,
} from './list-buckets'
import { dropTargetKey, planDrop, positionsFor, type DropTarget } from './list-reorder'

/**
 * LV.4 — what a drop means.
 *
 * The gap model is verified in a browser (it is pixels); this pins the part that
 * decides what gets written, and specifically the four things that would look
 * fine on screen while being wrong:
 *
 * 1. The slot index is a *slot*, not a row — dropping below the last player has
 *    to be reachable, and dragging downward inside one bucket has to account for
 *    the row leaving its old place first (the classic off-by-one).
 * 2. A drop that changes nothing sends nothing. An HTTP 200 for a request that
 *    moved no rows is exactly the "nothing happened means it worked" trap.
 * 3. Bucket membership and array order are two writes, and a move can imply
 *    either, both, or neither.
 * 4. Sections that cannot be written say why. **Round buckets became writable at
 *    LV.1.5**, which widened `list_players_tier_check`; cost/budget bands are
 *    computed from auction value and can never be assigned by hand, so they
 *    still refuse with their reason.
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

/** One unlabelled section, the shape a ranked list renders. */
function ranked(ids: string[]): Bucket[] {
  return buildBuckets({
    org: 'rank',
    entries: ids.map((id) => entry(id)),
    bandLabels: NO_LABELS,
    budget: 200,
  })
}

function slot(bucketKey: string, index: number): DropTarget {
  return { kind: 'slot', bucketKey, index }
}

describe('planDrop — within one section', () => {
  const buckets = ranked(['1', '2', '3', '4'])

  it('moves a row up to the slot it was dropped in', () => {
    // #4 released on the top half of #2 → slot 1.
    const plan = planDrop({ buckets, entryId: '4', target: slot('all', 1), tier: undefined })
    expect(plan?.order).toEqual(['p-1', 'p-4', 'p-2', 'p-3'])
    expect(plan?.tier).toBeNull()
  })

  it('accounts for the dragged row leaving its own place when moving down', () => {
    // #1 released on the bottom half of #3 → slot 3. Removing #1 first shifts
    // that slot up by one, so it lands *after* #3, not after #4.
    const plan = planDrop({ buckets, entryId: '1', target: slot('all', 3), tier: undefined })
    expect(plan?.order).toEqual(['p-2', 'p-3', 'p-1', 'p-4'])
  })

  it('can reach the slot after the last player', () => {
    const plan = planDrop({ buckets, entryId: '2', target: slot('all', 4), tier: undefined })
    expect(plan?.order).toEqual(['p-1', 'p-3', 'p-4', 'p-2'])
  })

  it('sends nothing when the row is dropped back where it started', () => {
    expect(planDrop({ buckets, entryId: '2', target: slot('all', 1), tier: undefined })).toBeNull()
    // The slot on the other side of itself is the same position.
    expect(planDrop({ buckets, entryId: '2', target: slot('all', 2), tier: undefined })).toBeNull()
  })

  it('numbers positions from 1, naming every player', () => {
    expect(positionsFor(['p-1', 'p-2'])).toEqual([
      { playerId: 'p-1', position: 1 },
      { playerId: 'p-2', position: 2 },
    ])
  })
})

describe('planDrop — across sections', () => {
  // S: 1, 2   A: 3   (array order 1,2,3)
  const buckets = buildBuckets({
    org: 'tier',
    entries: [entry('1', { tier: 'S' }), entry('2', { tier: 'S' }), entry('3', { tier: 'A' })],
    bandLabels: NO_LABELS,
    budget: 200,
  })

  it('writes the new bucket and keeps its members contiguous', () => {
    const plan = planDrop({ buckets, entryId: '1', target: slot('A', 0), tier: 'A' })
    expect(plan?.tier).toEqual({ playerId: 'p-1', tier: 'A' })
    expect(plan?.order).toEqual(['p-2', 'p-1', 'p-3'])
  })

  it('writes the bucket even when the flattened order is unchanged', () => {
    // #2 is already last in S and goes to the head of A: same flat order,
    // different bucket. Skipping the tier write here would silently do nothing.
    const plan = planDrop({ buckets, entryId: '2', target: slot('A', 0), tier: 'A' })
    expect(plan?.order).toBeNull()
    expect(plan?.tier).toEqual({ playerId: 'p-2', tier: 'A' })
  })

  it('a drop on a section header appends to that section', () => {
    const plan = planDrop({
      buckets,
      entryId: '1',
      target: { kind: 'bucket', bucketKey: 'A' },
      tier: 'A',
    })
    expect(plan?.tier).toEqual({ playerId: 'p-1', tier: 'A' })
    expect(plan?.order).toEqual(['p-2', 'p-3', 'p-1'])
  })

  it('the Ungrouped section clears the stored bucket', () => {
    const mixed = buildBuckets({
      org: 'tier',
      entries: [entry('1', { tier: 'S' }), entry('2')],
      bandLabels: NO_LABELS,
      budget: 200,
    })
    const plan = planDrop({
      buckets: mixed,
      entryId: '1',
      target: { kind: 'bucket', bucketKey: 'ungrouped' },
      tier: null,
    })
    expect(plan?.tier).toEqual({ playerId: 'p-1', tier: null })
  })

  it('the "start tier N" zone assigns only — it invents no order', () => {
    const plan = planDrop({
      buckets,
      entryId: '3',
      target: { kind: 'new', tier: 'B' },
      tier: 'B',
    })
    expect(plan).toEqual({ order: null, tier: { playerId: 'p-3', tier: 'B' } })
  })

  it('leaves the stored bucket alone where the grouping does not own it', () => {
    // Ranked lists: one section, so a move is never a bucket change.
    const plan = planDrop({
      buckets: ranked(['1', '2']),
      entryId: '2',
      target: slot('all', 0),
      tier: undefined,
    })
    expect(plan?.tier).toBeNull()
  })
})

describe('which sections accept a drop', () => {
  it('offers reordering only where the order is the array order', () => {
    expect(canReorder('rank')).toBe(true)
    expect(canReorder('tier')).toBe(true)
    expect(canReorder('round')).toBe(true)
    // Cost and budget re-sort by auction value on every render, so a hand
    // ordering would be discarded the moment React re-rendered.
    expect(canReorder('cost')).toBe(false)
    expect(canReorder('budget')).toBe(false)
  })

  it('writes the round key itself, now that LV.1.5 has widened the CHECK', () => {
    expect(bucketDrop('round', 'r3')).toEqual({ ok: true, tier: 'r3' })
    expect(bucketDrop('round', 'r1')).toEqual({ ok: true, tier: 'r1' })
    expect(bucketDrop('round', 'r30')).toEqual({ ok: true, tier: 'r30' })
    // Ungrouped clears the bucket in round mode exactly as in tier mode.
    expect(bucketDrop('round', 'ungrouped')).toEqual({ ok: true, tier: null })
    // The key arrives from a DOM attribute, so it is re-checked rather than
    // trusted: anything outside the vocabulary leaves `tier` alone rather than
    // becoming a 23514 the route returns as a 500.
    expect(bucketDrop('round', 'r31')).toEqual({ ok: true, tier: undefined })
    expect(bucketDrop('round', 'r0')).toEqual({ ok: true, tier: undefined })
    expect(bucketDrop('round', 'S')).toEqual({ ok: true, tier: undefined })
  })

  it('refuses computed bands, with the reason', () => {
    const drop = bucketDrop('cost', 'c1')
    expect(drop.ok).toBe(false)
    if (!drop.ok) expect(drop.reason).toMatch(/auction value/)
  })

  it('accepts the six tier letters and nothing else', () => {
    expect(bucketDrop('tier', 'S')).toEqual({ ok: true, tier: 'S' })
    expect(bucketDrop('tier', 'F')).toEqual({ ok: true, tier: 'F' })
    // A key that is not a tier letter leaves `tier` alone rather than writing it.
    expect(bucketDrop('tier', 'r1')).toEqual({ ok: true, tier: undefined })
    expect(bucketDrop('rank', 'all')).toEqual({ ok: true, tier: undefined })
  })

  it('offers a new bucket in tier AND round mode, while any are free', () => {
    const some = buildBuckets({
      org: 'tier',
      entries: [entry('1', { tier: 'S' })],
      bandLabels: NO_LABELS,
      budget: 200,
    })
    expect(nextBucket('tier', some)).toBe('A')
    // Groupings that own no stored value have no zone at all.
    expect(nextBucket('rank', ranked(['1']))).toBeNull()
    expect(nextBucket('cost', some)).toBeNull()
    expect(nextBucket('budget', some)).toBeNull()

    const all = buildBuckets({
      org: 'tier',
      entries: ['S', 'A', 'B', 'C', 'D', 'F'].map((tier, index) =>
        entry(String(index + 1), { tier }),
      ),
      bandLabels: NO_LABELS,
      budget: 200,
    })
    expect(nextBucket('tier', all)).toBeNull()
  })

  it('round mode fills the first gap, and runs out at r30', () => {
    // An empty round list starts at r1, not at "the round after the last one".
    expect(nextBucket('round', buildBuckets({
      org: 'round', entries: [entry('1')], bandLabels: NO_LABELS, budget: 200,
    }))).toBe('r1')

    // r1 and r3 in use → the zone offers r2, the first hole. `buildBuckets`
    // renders sections in numeric order, so this also pins that the search is
    // over the used SET rather than over the last rendered section.
    expect(nextBucket('round', buildBuckets({
      org: 'round',
      entries: [entry('1', { tier: 'r3' }), entry('2', { tier: 'r1' })],
      bandLabels: NO_LABELS,
      budget: 200,
    }))).toBe('r2')

    const everyRound = Array.from({ length: 30 }, (_, i) =>
      entry(String(i + 1), { tier: `r${i + 1}` }),
    )
    expect(nextBucket('round', buildBuckets({
      org: 'round', entries: everyRound, bandLabels: NO_LABELS, budget: 200,
    }))).toBeNull()
  })

  it('the zone says tier or round, never the wrong noun', () => {
    expect(bucketZoneLabel('tier', 'A')).toBe('start tier A')
    expect(bucketZoneLabel('round', 'r4')).toBe('start round 4')
    expect(bucketZoneLabel('round', 'r30')).toBe('start round 30')
  })
})

describe('dropTargetKey', () => {
  it('distinguishes every target, so state updates once per slot change', () => {
    const keys = [
      dropTargetKey(null),
      dropTargetKey(slot('all', 0)),
      dropTargetKey(slot('all', 1)),
      dropTargetKey(slot('S', 0)),
      dropTargetKey({ kind: 'bucket', bucketKey: 'S' }),
      dropTargetKey({ kind: 'new', tier: 'S' }),
    ]
    expect(new Set(keys).size).toBe(keys.length)
    // Same slot, different object: the hook must read this as "no change".
    expect(dropTargetKey(slot('all', 2))).toBe(dropTargetKey(slot('all', 2)))
  })
})

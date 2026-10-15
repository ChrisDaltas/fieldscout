import { describe, expect, it } from 'vitest'

import type { ListPlayerWithPlayer } from '@/hooks/use-lists'

import {
  autoTierItems,
  breaks,
  editorItems,
  fillScores,
  lastTierLetter,
  moveItem,
  planCommit,
  playersLabel,
  shortName,
  trailingMarkers,
  updatedLabel,
  youTubeId,
  type EdItem,
} from './lists-model'

function entry(n: number, tier: string | null = null, proj: number | null = null): ListPlayerWithPlayer {
  return {
    id: `e${n}`,
    list_id: 'l1',
    player_id: `p${n}`,
    position: n,
    overall_rank: n,
    tier,
    notes: null,
    slot: null,
    rank_in_tier: null,
    added_at: null,
    updated_at: null,
    player: { id: `p${n}`, full_name: `Player ${n}`, position: 'WR', team: 'BUF', headshot_url: null, status: null },
    stats: { current_pts: 0, current_games: 0, last_pts: 0, last_games: 0, projected_pts: proj },
  } as ListPlayerWithPlayer
}

const ids = (items: EdItem[]) => items.map((item) => (item.t === 'p' ? item.entry.player_id : item.t))

describe('copy formats', () => {
  it('singular player', () => {
    expect(playersLabel(1)).toBe('1 player')
    expect(playersLabel(0)).toBe('0 players')
  })
  it('short names', () => {
    expect(shortName('Josh Allen')).toBe('J. Allen')
    expect(shortName('Amon-Ra St. Brown')).toBe('A. St. Brown')
    expect(shortName('A.J. Brown')).toBe('A. Brown')
    expect(shortName('Broncos D/ST')).toBe('Broncos D/ST')
    expect(shortName('Denver Broncos', 'DEF')).toBe('Denver Broncos')
  })
  it('updated label', () => {
    const now = Date.UTC(2026, 9, 15, 12)
    expect(updatedLabel(new Date(now - 20_000).toISOString(), now)).toBe('just now')
    expect(updatedLabel(new Date(now - 3 * 3_600_000).toISOString(), now)).toBe('3h ago')
    expect(updatedLabel(new Date(now - 2 * 86_400_000).toISOString(), now)).toBe('2d ago')
  })
})

describe('youTubeId', () => {
  it('accepts YouTube links', () => {
    expect(youTubeId('https://www.youtube.com/watch?v=dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ')
    expect(youTubeId('youtu.be/dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ')
    expect(youTubeId('https://youtube.com/shorts/dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ')
    expect(youTubeId('https://www.youtube.com/live/dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ')
  })
  it('rejects other hosts and junk', () => {
    expect(youTubeId('https://example.com/?v=abcdefghijk')).toBeNull()
    expect(youTubeId('https://vimeo.com/123456')).toBeNull()
    expect(youTubeId('')).toBeNull()
  })
})

describe('editor items', () => {
  it('untiered lists are players in order', () => {
    expect(ids(editorItems([entry(2), entry(1)], false, 0))).toEqual(['p1', 'p2'])
  })
  it('tiered lists put a tier line between letter buckets, then Ungrouped, then pending lines', () => {
    const items = editorItems([entry(1, 'S'), entry(2, 'A'), entry(3, 'S'), entry(4, null)], true, 1)
    expect(ids(items)).toEqual(['p1', 'p3', 'tier', 'p2', 'ungrouped', 'p4', 'tier'])
    expect(trailingMarkers(items)).toBe(1)
  })
  it('a list with no letters is one tier', () => {
    expect(ids(editorItems([entry(1), entry(2)], true, 0))).toEqual(['p1', 'p2'])
  })
})

describe('planCommit', () => {
  it('a drag writes the new order only when it changed', () => {
    const stored = [entry(1), entry(2), entry(3)]
    const items = editorItems(stored, false, 0)
    expect(planCommit(items, stored, false)).toEqual({ order: null, tiers: [] })
    const moved = moveItem(items, 0, 2)
    expect(planCommit(moved, stored, false)).toEqual({ order: ['p2', 'p3', 'p1'], tiers: [] })
  })

  it('dropping a pending tier line splits the list into S and A', () => {
    const stored = [entry(1), entry(2), entry(3)]
    const items = editorItems(stored, true, 1)
    const next = moveItem(items, 3, 2) // the line goes above p3
    const plan = planCommit(next, stored, true)
    expect(plan.order).toBeNull()
    expect(plan.tiers).toEqual([
      { playerId: 'p1', tier: 'S' },
      { playerId: 'p2', tier: 'S' },
      { playerId: 'p3', tier: 'A' },
    ])
  })

  it('merging the only line puts everyone in Tier 1 (S)', () => {
    const stored = [entry(1, 'S'), entry(2, 'A')]
    const items = editorItems(stored, true, 0)
    const merged = items.filter((item) => item.t !== 'tier')
    expect(planCommit(merged, stored, true).tiers).toEqual([{ playerId: 'p2', tier: 'S' }])
  })

  it('a plain reorder inside one lettered tier writes no tiers', () => {
    const stored = [entry(1, 'S'), entry(2, 'S'), entry(3, 'S')]
    const items = editorItems(stored, true, 0)
    expect(planCommit(moveItem(items, 0, 2), stored, true)).toEqual({ order: ['p2', 'p3', 'p1'], tiers: [] })
  })

  it('never overwrites a round key in a single-tier arrangement', () => {
    const stored = [entry(1, 'r3'), entry(2)]
    const items = editorItems(stored, true, 0)
    expect(planCommit(moveItem(items, 0, 1), stored, true).tiers).toEqual([])
  })

  it('compacts letters past an empty tier', () => {
    const stored = [entry(1, 'S'), entry(2, 'C')]
    const items = editorItems(stored, true, 0)
    expect(planCommit(items, stored, true).tiers).toEqual([{ playerId: 'p2', tier: 'A' }])
  })
})

describe('auto tiers', () => {
  it('breaks on big gaps, at least two per tier', () => {
    expect(breaks([30, 29, 28, 20, 19, 18])).toEqual([3])
    expect(breaks([10, 9])).toEqual([])
    expect(breaks([1, 2, 3, 4])).toEqual([])
  })
  it('fills missing projections so they add no gap', () => {
    expect(fillScores([null, 10, null, 8])).toEqual([10, 10, 10, 8])
    expect(fillScores([null, null])).toBeNull()
  })
  it('rebuilds the lines from projections in the current order', () => {
    const stored = [entry(1, null, 30), entry(2, null, 29), entry(3, null, 28), entry(4, null, 20), entry(5, null, 19)]
    const next = autoTierItems(editorItems(stored, true, 0))
    expect(next && ids(next)).toEqual(['p1', 'p2', 'p3', 'tier', 'p4', 'p5'])
  })
  it('applies nothing when no gap clears the rule', () => {
    // An order running against the projections, and an even spread.
    const unsorted = [entry(1, 'S', 10), entry(2, 'A', 20), entry(3, 'B', 30), entry(4, 'B', 40)]
    expect(autoTierItems(editorItems(unsorted, true, 0))).toBeNull()
    const even = [entry(1, null, 30), entry(2, null, 29), entry(3, null, 28), entry(4, null, 27)]
    expect(autoTierItems(editorItems(even, true, 0))).toBeNull()
  })
  it('new players join the last tier', () => {
    expect(lastTierLetter([entry(1, 'S'), entry(2, 'B')])).toBe('B')
    expect(lastTierLetter([entry(1)])).toBeNull()
  })
})

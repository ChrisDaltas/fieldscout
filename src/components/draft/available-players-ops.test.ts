import { describe, expect, it } from 'vitest'

import {
  bigBoardRankById,
  decoratePool,
  draftedIdSet,
  subtractDrafted,
  type PoolPlayer,
} from './available-players-ops'
import {
  appendId,
  deriveQueueView,
  orderedIdsForSave,
  removeId,
  reorderIds,
} from './my-queue-ops'

/**
 * available-players-ops + my-queue-ops pins (M2 task L.B3.2) — the C26
 * by-player_id subtraction made falsifiable (shared-name discriminator),
 * plus E17's queue greying/auto-removal derivations.
 */

function player(id: string, full_name: string, over?: Partial<PoolPlayer>): PoolPlayer {
  return {
    id,
    full_name,
    position: 'QB',
    team: 'BUF',
    adp: null,
    headshot_url: null,
    status: 'Active',
    ...over,
  }
}

describe('C26 — drafted subtraction is by player_id, never by name', () => {
  it('two players SHARING a full name: drafting one leaves the other available (the C26 discriminator)', () => {
    // The exact failure best-available-card shipped with: name-keyed
    // subtraction vanishes both Josh Allens when either is picked.
    const pool = [player('qb-buf', 'Josh Allen'), player('lb-was', 'Josh Allen', { position: 'DEF' })]
    const drafted = draftedIdSet([{ player_id: 'qb-buf', is_undone: false }])
    const available = subtractDrafted(pool, drafted)
    expect(available.map((p) => p.id)).toEqual(['lb-was'])
  })

  it('an UNDONE pick is not drafted — the player is back in the pool (E4)', () => {
    const drafted = draftedIdSet([
      { player_id: 'p1', is_undone: true },
      { player_id: 'p2', is_undone: false },
      { player_id: 'p3', is_undone: null },
    ])
    expect(drafted.has('p1')).toBe(false)
    expect(drafted.has('p2')).toBe(true)
    expect(drafted.has('p3')).toBe(true) // null = not undone (065 default)
  })

  it('decoratePool joins my Big Board ranks by id; absent players carry null', () => {
    const ranks = bigBoardRankById([
      { player_id: 'p2' },
      { player_id: 'p1' },
      { player_id: 'p2' }, // duplicate keeps the FIRST (best) rank
    ])
    const rows = decoratePool([player('p1', 'A'), player('p3', 'B')], ranks)
    expect(rows[0].bigBoardRank).toBe(2)
    expect(rows[1].bigBoardRank).toBeNull()
    expect(ranks.get('p2')).toBe(1)
  })
})

describe('my-queue ops (E17 + §15.6)', () => {
  const rows = [
    { player_id: 'p1', rank: 1 },
    { player_id: 'p2', rank: 2 },
    { player_id: 'p3', rank: 3 },
  ]

  it('deriveQueueView greys drafted entries; orderedIdsForSave drops them (auto-remove via whole-queue replace)', () => {
    const view = deriveQueueView(rows, new Set(['p2']))
    expect(view.map((r) => r.drafted)).toEqual([false, true, false])
    expect(orderedIdsForSave(view)).toEqual(['p1', 'p3'])
  })

  it('reorderIds moves active to over; unknown ids are a no-op', () => {
    expect(reorderIds(['p1', 'p2', 'p3'], 'p3', 'p1')).toEqual(['p3', 'p1', 'p2'])
    expect(reorderIds(['p1', 'p2', 'p3'], 'p1', 'p2')).toEqual(['p2', 'p1', 'p3'])
    expect(reorderIds(['p1', 'p2'], 'nope', 'p1')).toEqual(['p1', 'p2'])
  })

  it('appendId dedupes; removeId is exact', () => {
    expect(appendId(['p1'], 'p2')).toEqual(['p1', 'p2'])
    expect(appendId(['p1'], 'p1')).toEqual(['p1'])
    expect(removeId(['p1', 'p2'], 'p1')).toEqual(['p2'])
    expect(removeId(['p1'], 'nope')).toEqual(['p1'])
  })
})

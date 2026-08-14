import { describe, expect, it } from 'vitest'

import {
  bigBoardRankById,
  decorateOverlay,
  decoratePool,
  draftedIdSet,
  onlyOnListRows,
  overlayMaps,
  poolLoadPending,
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

// ---------------------------------------------------------------------------
// §8.9 list overlay (M2 task L.B4.2)
// ---------------------------------------------------------------------------

describe('list overlay on the pool (§8.9; L.B4.2)', () => {
  const LIST_ROWS = [
    { player_id: 'p2', tier: 'A' },
    { player_id: 'p9', tier: 'A' },
    { player_id: 'p1', tier: 'B' },
    { player_id: 'p1', tier: 'C' }, // duplicate id: first occurrence wins
  ]

  it('overlayMaps ranks by the given (canonical) order, first occurrence wins', () => {
    const maps = overlayMaps(LIST_ROWS)
    expect(maps.rankById.get('p2')).toBe(1)
    expect(maps.rankById.get('p1')).toBe(3)
    expect(maps.tierById.get('p1')).toBe('B')
  })

  it('decorateOverlay annotates matching rows and leaves the rest null (the rank/tier COLUMN, not a filter)', () => {
    const maps = overlayMaps(LIST_ROWS)
    const rows = decorateOverlay(
      [player('p1', 'One'), player('p5', 'Five')].map((p) => ({ ...p, bigBoardRank: null })),
      maps,
    )
    expect(rows[0]).toMatchObject({ listRank: 3, listTier: 'B' })
    expect(rows[1]).toMatchObject({ listRank: null, listTier: null })
  })

  it('onlyOnListRows builds FROM the list (window-independent), keeps list order, drops drafted (E17)', () => {
    const identity = new Map(
      [
        player('p1', 'Alpha One', { adp: 44.5 }),
        player('p2', 'Bravo Two'),
        player('p9', 'Charlie Nine'),
      ].map((p) => [p.id, p]),
    )
    const rows = onlyOnListRows(LIST_ROWS, identity, new Set(['p9']), '', '')
    // p2 first (rank 1), p9 drafted out, p1 once (dupe collapsed).
    expect(rows.map((r) => r.id)).toEqual(['p2', 'p1'])
    expect(rows[1]?.adp).toBe(44.5)
  })

  it('onlyOnListRows narrows by search and position client-side, and skips identities not yet loaded', () => {
    const identity = new Map([
      ['p1', player('p1', 'Alpha One', { position: 'RB' })],
      ['p2', player('p2', 'Bravo Two', { position: 'WR' })],
    ])
    expect(onlyOnListRows(LIST_ROWS, identity, new Set(), '', 'RB').map((r) => r.id)).toEqual([
      'p1',
    ])
    expect(
      onlyOnListRows(LIST_ROWS, identity, new Set(), 'bravo', '').map((r) => r.id),
    ).toEqual(['p2'])
    // p9 has no identity row yet — skipped, never guessed.
    expect(onlyOnListRows(LIST_ROWS, identity, new Set(), '', '').map((r) => r.id)).toEqual([
      'p2',
      'p1',
    ])
  })

  it('an EMPTY list in only-mode is SETTLED, never pending — the disabled identity query reports isPending forever, and the empty state must be reachable (R283)', () => {
    // The R283 shape: 0-player attached list, rows loaded — the identity
    // query is disabled (enabled: ids.length > 0) so its eternal isPending
    // must NOT gate; the empty state renders instead of eternal skeletons.
    expect(
      poolLoadPending({
        onlyMode: true,
        poolPending: false,
        overlayRowsPending: false,
        overlayListSize: 0,
        identityPending: true,
      }),
    ).toBe(false)
    // A NON-empty list's identity pending is real and still gates.
    expect(
      poolLoadPending({
        onlyMode: true,
        poolPending: false,
        overlayRowsPending: false,
        overlayListSize: 2,
        identityPending: true,
      }),
    ).toBe(true)
    // The list read itself still gates while loading.
    expect(
      poolLoadPending({
        onlyMode: true,
        poolPending: false,
        overlayRowsPending: true,
        overlayListSize: 0,
        identityPending: true,
      }),
    ).toBe(true)
    // Off only-mode: the window pool's own pending, nothing else.
    expect(
      poolLoadPending({
        onlyMode: false,
        poolPending: true,
        overlayRowsPending: false,
        overlayListSize: 0,
        identityPending: false,
      }),
    ).toBe(true)
    expect(
      poolLoadPending({
        onlyMode: false,
        poolPending: false,
        overlayRowsPending: false,
        overlayListSize: 2,
        identityPending: true,
      }),
    ).toBe(false)
  })
})

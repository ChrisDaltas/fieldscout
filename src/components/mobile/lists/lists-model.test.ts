import { describe, expect, it } from 'vitest'

import type { ListPlayerWithPlayer } from '@/hooks/use-lists'
import type { PoolPlayer } from '@/hooks/use-mobile-lists-pool'

import {
  addToDraft,
  arrangeDraft,
  autoTierItems,
  breaks,
  draftChanged,
  draftItems,
  draftOf,
  editorItems,
  fillScores,
  lastTierLetter,
  landedPlan,
  moveItem,
  planCommit,
  planIsEmpty,
  planParts,
  planSave,
  playersLabel,
  removeFromDraft,
  saveFailureNote,
  setDraftMode,
  shortName,
  trailingMarkers,
  updatedLabel,
  youTubeId,
  type EdItem,
  type StoredList,
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

// =============================================================================
// The editor's draft (gap list #16, Chris 2026-10-15)
// =============================================================================

const stored = (players: ListPlayerWithPlayer[], ranking_mode = 'rank_and_tier', title = 'My list'): StoredList => ({
  title,
  ranking_mode,
  players,
})

const pool = (n: number): PoolPlayer => ({
  id: `p${n}`,
  full_name: `Player ${n}`,
  position: 'WR',
  team: 'KC',
  headshot_url: null,
  status: null,
  projected_pts: 150,
  current_pts: 40,
  current_games: 4,
})

describe('the editor draft', () => {
  it('starts equal to the list: nothing to write', () => {
    const list = stored([entry(1, 'S'), entry(2, 'A'), entry(3, null)])
    expect(planIsEmpty(planSave(draftOf(list), list))).toBe(true)
  })

  it('a drag changes the draft, not the list, and plans the order + tier writes', () => {
    const list = stored([entry(1, 'S'), entry(2, 'S'), entry(3, 'A')])
    const draft = draftOf(list)
    const items = draftItems(draft) // p1 p2 | p3
    const next = arrangeDraft(draft, moveItem(items, 0, 3)) // p1 below p3 → Tier 2
    expect(list.players.map((e) => e.tier)).toEqual(['S', 'S', 'A']) // untouched
    expect(ids(draftItems(next))).toEqual(['p2', 'tier', 'p3', 'p1'])
    const plan = planSave(next, list)
    expect(plan.order).toEqual(['p2', 'p3', 'p1'])
    expect(plan.tiers).toEqual([{ playerId: 'p1', tier: 'A' }])
    expect(plan.add).toEqual([])
    expect(plan.remove).toEqual([])
  })

  it('a pending tier line alone is nothing to save', () => {
    const list = stored([entry(1), entry(2)])
    const draft = { ...draftOf(list), pending: 1 }
    expect(ids(draftItems(draft))).toEqual(['p1', 'p2', 'tier'])
    expect(planIsEmpty(planSave(draft, list))).toBe(true)
  })

  it('adds go to the end, into the last tier; the bulk add appends so no reorder', () => {
    const list = stored([entry(1, 'S'), entry(2, 'A')])
    const draft = addToDraft(draftOf(list), pool(9), 'l1')
    expect(draft.entries.at(-1)).toMatchObject({ player_id: 'p9', tier: 'A', position: 3 })
    expect(addToDraft(draft, pool(9), 'l1')).toBe(draft) // never twice
    expect(planSave(draft, list)).toEqual({
      fields: {},
      remove: [],
      add: ['p9'],
      tiers: [{ playerId: 'p9', tier: 'A' }],
      order: null,
    })
  })

  it('an added player dragged up is ordered by the reorder after the add', () => {
    const list = stored([entry(1), entry(2)], 'ranked')
    const draft = addToDraft(draftOf(list), pool(9), 'l1')
    const next = arrangeDraft(draft, moveItem(draftItems(draft), 2, 0))
    const plan = planSave(next, list)
    expect(plan.add).toEqual(['p9'])
    expect(plan.order).toEqual(['p9', 'p1', 'p2'])
    expect(plan.tiers).toEqual([])
  })

  it('removals keep the rest in order (no reorder)', () => {
    const list = stored([entry(1), entry(2), entry(3)], 'ranked')
    const draft = removeFromDraft(draftOf(list), 'p2')
    expect(planSave(draft, list)).toEqual({ fields: {}, remove: ['p2'], add: [], tiers: [], order: null })
  })

  it('Ranked / Tiers and the name are list fields; leaving tiers drops pending lines', () => {
    const list = stored([entry(1)], 'rank_and_tier')
    const draft = setDraftMode({ ...draftOf(list), pending: 2, title: '  Renamed  ' }, 'ranked')
    expect(draft.pending).toBe(0)
    expect(planSave(draft, list).fields).toEqual({ title: 'Renamed', ranking_mode: 'ranked' })
    // An empty name is not a change (the input puts the saved one back).
    expect(planSave({ ...draft, title: '   ' }, list).fields).toEqual({ ranking_mode: 'ranked' })
  })

  it('a re-read after a partial save leaves only what is still unsaved', () => {
    const list = stored([entry(1, 'S'), entry(2, 'S')])
    const added = addToDraft(draftOf(list), pool(9), 'l1')
    // Add p9, then drop a tier line under p1: p1 | p2 p9.
    const items = draftItems(added)
    const draft = arrangeDraft(added, [items[0], { t: 'tier', id: 'pending-0', pending: true }, ...items.slice(1)])
    const attempted = planSave(draft, list)
    expect(attempted.add).toEqual(['p9'])
    expect(attempted.tiers).toEqual([
      { playerId: 'p2', tier: 'A' },
      { playerId: 'p9', tier: 'A' },
    ])
    // The add landed (stored with no tier), the tier writes did not.
    const after = stored([entry(1, 'S'), entry(2, 'S'), { ...entry(9), player_id: 'p9', position: 3 }])
    const remaining = planSave(draft, after)
    expect(remaining.add).toEqual([])
    expect(remaining.tiers).toHaveLength(2)
    expect(planParts(landedPlan(attempted, remaining))).toEqual(['1 added player'])
    expect(saveFailureNote('Could not set a tier: boom', attempted, remaining)).toBe(
      'Could not set a tier: boom Saved: 1 added player. Not saved: tiers for 2 players.',
    )
  })

  it('plans only the user’s changes onto a list that changed elsewhere', () => {
    const opened = stored([entry(1, 'S'), entry(2, 'S'), entry(3, 'S')])
    const start = draftOf(opened)
    // The user drops a tier line above p3: p1 p2 | p3 (p3 → A).
    const items = draftItems(start)
    const draft = arrangeDraft(start, [...items.slice(0, 2), { t: 'tier', id: 'pending-0', pending: true }, items[2]])
    expect(draft.base).toBe(start.base) // edits keep the base
    expect(draftChanged(draft)).toBe(true)
    // Elsewhere: p3 removed, p4 added, the list renamed.
    const now = stored([entry(1, 'S'), entry(2, 'S'), { ...entry(4, 'S'), position: 4 }], 'rank_and_tier', 'Renamed elsewhere')
    expect(planSave(draft, now)).toEqual({ fields: {}, remove: [], add: [], tiers: [], order: null })
    // With no edits, a changed list is not a change of the user's.
    expect(draftChanged(start)).toBe(false)
    expect(planIsEmpty(planSave(start, now))).toBe(true)
  })

  it('says so when nothing saved, or when what saved could not be checked', () => {
    expect(saveFailureNote('Offline.', null, null)).toBe('Offline. Nothing was saved.')
    const plan = planSave(removeFromDraft(draftOf(stored([entry(1)])), 'p1'), stored([entry(1)]))
    expect(saveFailureNote('Could not remove a player: no.', plan, plan)).toBe(
      'Could not remove a player: no. Nothing was saved. Not saved: 1 removed player.',
    )
    expect(saveFailureNote('Could not save the order: no.', plan, null)).toContain('couldn’t be checked')
  })
})

/**
 * Tiers without numbers (Chris, 2026-10-15; migration 191): Ranked and Tiers
 * are independent, so a draft can be tiered with Ranked off (`tier_only`).
 */
describe('the editor draft: tiers without numbers', () => {
  it('a tier-only list draws its tier lines in the editor', () => {
    const list = stored([entry(1, 'S'), entry(2, 'S'), entry(3, 'A')], 'tier_only')
    expect(ids(draftItems(draftOf(list)))).toEqual(['p1', 'p2', 'tier', 'p3'])
  })

  it('a drag re-letters tiers on a tier-only list, as on a numbered one', () => {
    const list = stored([entry(1, 'S'), entry(2, 'S'), entry(3, 'A')], 'tier_only')
    const draft = draftOf(list)
    const next = arrangeDraft(draft, moveItem(draftItems(draft), 0, 3)) // p1 below p3 → Tier 2
    const plan = planSave(next, list)
    expect(plan.order).toEqual(['p2', 'p3', 'p1'])
    expect(plan.tiers).toEqual([{ playerId: 'p1', tier: 'A' }])
  })

  it('players added to a tier-only list join its last tier', () => {
    const list = stored([entry(1, 'S'), entry(2, 'A')], 'tier_only')
    expect(addToDraft(draftOf(list), pool(9), 'l1').entries.at(-1)).toMatchObject({ tier: 'A' })
  })

  it('turning Ranked off keeps the tiers (and any pending tier line); it saves as tier_only', () => {
    const list = stored([entry(1, 'S')], 'rank_and_tier')
    const draft = setDraftMode({ ...draftOf(list), pending: 1 }, 'tier_only')
    expect(draft.pending).toBe(1)
    expect(ids(draftItems(draft))).toEqual(['p1', 'tier'])
    expect(planSave(draft, list).fields).toEqual({ ranking_mode: 'tier_only' })
    expect(planParts(planSave(draft, list))).toEqual(['Ranked / Tiers'])
  })

  it('turning Tiers off a tier-only list leaves a plain list and drops pending lines', () => {
    const list = stored([entry(1, 'S')], 'tier_only')
    const draft = setDraftMode({ ...draftOf(list), pending: 2 }, 'unranked')
    expect(draft.pending).toBe(0)
    expect(planSave(draft, list).fields).toEqual({ ranking_mode: 'unranked' })
  })

  it('a refused tier-only save is reported as not saved, with the server’s reason', () => {
    const list = stored([entry(1, 'S')], 'rank_and_tier')
    const plan = planSave(setDraftMode(draftOf(list), 'tier_only'), list)
    expect(
      saveFailureNote(
        'Could not save the name or Ranked / Tiers: Tiers without numbers is coming in the next update.',
        plan,
        plan,
      ),
    ).toBe(
      'Could not save the name or Ranked / Tiers: Tiers without numbers is coming in the next update. Nothing was saved. Not saved: Ranked / Tiers.',
    )
  })
})

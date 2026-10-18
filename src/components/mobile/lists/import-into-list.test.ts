/**
 * FieldScout Mobile — Import a ranking (gap list §3 #5; lr-lists §2.6 / §3
 * "Import sheet"): the draft after an import, the option lines and the
 * toast, and what the sheet offers from the user's rankings and lists.
 */
import { describe, expect, it } from 'vitest'

import type { ListPlayerWithPlayer, ListWithTags } from '@/hooks/use-lists'
import type { MyRankingBoards } from '@/hooks/use-mobile-rankings-boards'

import { importSourceOf, listImportOptions, rankingImportOptions } from './import-sources'
import {
  draftChanged,
  draftItems,
  draftOf,
  groupName,
  importCounts,
  importIntoDraft,
  importOptionLine,
  importToast,
  planSave,
  type EdItem,
  type ListDraft,
} from './lists-model'

function entry(
  n: number,
  opts: { tier?: string | null; pos?: string; list?: string; at?: number; notes?: string | null } = {},
): ListPlayerWithPlayer {
  const list = opts.list ?? 'l1'
  return {
    id: `${list}-e${n}`,
    list_id: list,
    player_id: `p${n}`,
    position: opts.at ?? n,
    overall_rank: opts.at ?? n,
    tier: opts.tier ?? null,
    notes: opts.notes ?? null,
    slot: null,
    rank_in_tier: null,
    added_at: null,
    updated_at: null,
    player: { id: `p${n}`, full_name: `Player ${n}`, position: opts.pos ?? 'WR', team: 'BUF', headshot_url: null, status: null },
    stats: { current_pts: n * 10, current_games: 4, last_pts: 0, last_games: 0, projected_pts: 100 - n },
  } as ListPlayerWithPlayer
}

const draftFor = (players: ListPlayerWithPlayer[], mode = 'ranked'): ListDraft =>
  draftOf({ title: 'My list', ranking_mode: mode, players })

/** The draft as the editor draws it: player ids and "|" for a tier line. */
const shape = (draft: ListDraft) =>
  draftItems(draft)
    .map((item: EdItem) => (item.t === 'p' ? item.entry.player_id : item.t === 'tier' ? '|' : 'U'))
    .join(' ')

const opts = { listId: 'l1', positionFilter: null, sourceTiers: false }

describe('importIntoDraft', () => {
  it('an empty list takes the source in its order; Ranked on, no lone Tier 1', () => {
    const draft = draftFor([], 'unranked')
    const { draft: next, counts } = importIntoDraft(draft, [entry(3, { list: 'src', at: 1 }), entry(1, { list: 'src', at: 2 })], opts)
    expect(counts).toEqual({ fits: 2, fresh: 2, inList: 0, outside: 0 })
    expect(shape(next)).toBe('p3 p1')
    expect(next.mode).toBe('ranked')
    // New, local entries for this list: not the source's rows, no notes.
    expect(next.entries.every((e) => e.list_id === 'l1' && e.id.startsWith('draft-') && e.notes === null)).toBe(true)
    // Their season figures come along (the rows' Pts / Avg, Auto tiers).
    expect(next.entries[0].stats?.current_pts).toBe(30)
  })

  it('after the list’s own players, the import starts a new tier (Ranked + Tiers on)', () => {
    const draft = draftFor([entry(1), entry(2)])
    const { draft: next } = importIntoDraft(draft, [entry(5, { list: 'src' }), entry(6, { list: 'src' })], opts)
    expect(shape(next)).toBe('p1 p2 | p5 p6')
    expect(next.mode).toBe('rank_and_tier')
    expect(next.entries.map((e) => [e.player_id, e.tier, e.position])).toEqual([
      ['p1', 'S', 1],
      ['p2', 'S', 2],
      ['p5', 'A', 3],
      ['p6', 'A', 4],
    ])
  })

  it('a tiered source keeps its tiers, after the list’s own', () => {
    const draft = draftFor([entry(1, { tier: 'S' }), entry(2, { tier: 'A' })], 'rank_and_tier')
    const source = [
      entry(5, { list: 'src', tier: 'S' }),
      entry(6, { list: 'src', tier: 'S' }),
      entry(7, { list: 'src', tier: 'A' }),
    ]
    const { draft: next } = importIntoDraft(draft, source, { ...opts, sourceTiers: true })
    expect(shape(next)).toBe('p1 | p2 | p5 p6 | p7')
    expect(next.entries.map((e) => e.tier)).toEqual(['S', 'A', 'B', 'B', 'C'])
  })

  it('a source showing no tiers comes in as one run even if its rows hold letters', () => {
    const { draft: next } = importIntoDraft(
      draftFor([]),
      [entry(5, { list: 'src', tier: 'S' }), entry(6, { list: 'src', tier: 'B' })],
      opts,
    )
    expect(shape(next)).toBe('p5 p6')
  })

  it('each player once: anyone already in the list is skipped, and leaves no empty tier', () => {
    const draft = draftFor([entry(1), entry(2)])
    const source = [
      entry(1, { list: 'src', tier: 'S' }),
      entry(2, { list: 'src', tier: 'A' }),
      entry(5, { list: 'src', tier: 'B' }),
    ]
    const { draft: next, counts } = importIntoDraft(draft, source, { ...opts, sourceTiers: true })
    expect(counts).toEqual({ fits: 3, fresh: 1, inList: 2, outside: 0 })
    // The source's first two tiers held only skipped players: one line, not three.
    expect(shape(next)).toBe('p1 p2 | p5')
  })

  it('players outside the list’s position group are skipped', () => {
    const draft = draftFor([entry(1, { pos: 'QB' })])
    const source = [entry(5, { list: 'src', pos: 'QB' }), entry(6, { list: 'src', pos: 'RB' })]
    const { draft: next, counts } = importIntoDraft(draft, source, { ...opts, positionFilter: 'QB' })
    expect(counts).toEqual({ fits: 1, fresh: 1, inList: 0, outside: 1 })
    expect(shape(next)).toBe('p1 | p5')
  })

  it('nothing new: the draft is returned unchanged (no "Added 0", no empty tier)', () => {
    const draft = draftFor([entry(1), entry(2)])
    const { draft: next, counts } = importIntoDraft(draft, [entry(2, { list: 'src' })], opts)
    expect(counts.fresh).toBe(0)
    expect(next).toBe(draft)
    expect(draftChanged(next)).toBe(false)
  })

  it('a tier line the user left at the end is the separator — not a second, empty tier', () => {
    const draft: ListDraft = { ...draftFor([entry(1)], 'rank_and_tier'), pending: 1 }
    const { draft: next } = importIntoDraft(draft, [entry(5, { list: 'src' })], opts)
    expect(shape(next)).toBe('p1 | p5')
    expect(next.pending).toBe(0)
  })

  it('tier lines left with no one above them don’t lead the list', () => {
    const draft: ListDraft = { ...draftFor([], 'rank_and_tier'), pending: 2 }
    const { draft: next } = importIntoDraft(draft, [entry(5, { list: 'src' }), entry(6, { list: 'src' })], opts)
    expect(shape(next)).toBe('p5 p6')
  })

  it('a big board keeps its grouping (lockMode)', () => {
    const draft = draftFor([entry(1)], 'ranked')
    const { draft: next } = importIntoDraft(draft, [entry(5, { list: 'src' })], { ...opts, lockMode: true })
    expect(next.mode).toBe('ranked')
    expect(shape(next)).toBe('p1 p5')
  })

  it('a tier-only list gets its numbers too, as the design’s import does', () => {
    const draft = draftFor([entry(1, { tier: 'S' })], 'tier_only')
    const { draft: next } = importIntoDraft(draft, [entry(5, { list: 'src' })], opts)
    expect(next.mode).toBe('rank_and_tier')
  })

  it('more than six tiers: the last ones merge (S–F)', () => {
    const draft = draftFor([entry(1)])
    const letters = ['S', 'A', 'B', 'C', 'D', 'E', 'F']
    const source = letters.map((tier, i) => entry(10 + i, { list: 'src', tier }))
    const { draft: next } = importIntoDraft(draft, source, { ...opts, sourceTiers: true })
    expect(new Set(next.entries.map((e) => e.tier)).size).toBe(6)
    expect(next.entries.slice(-3).map((e) => e.tier)).toEqual(['F', 'F', 'F'])
  })

  it('Update writes the import as additions, tiers and Ranked / Tiers', () => {
    const draft = draftFor([entry(1)])
    const { draft: next } = importIntoDraft(draft, [entry(5, { list: 'src' }), entry(6, { list: 'src' })], opts)
    const plan = planSave(next, next.base)
    expect(plan.add).toEqual(['p5', 'p6'])
    expect(plan.fields.ranking_mode).toBe('rank_and_tier')
    expect(plan.tiers).toEqual([
      { playerId: 'p1', tier: 'S' },
      { playerId: 'p5', tier: 'A' },
      { playerId: 'p6', tier: 'A' },
    ])
    expect(plan.order).toBeNull()
  })
})

describe('import counts, option lines and the toast', () => {
  const picks = [
    { player_id: 'p1', position: 'QB' },
    { player_id: 'p2', position: 'QB' },
    { player_id: 'p3', position: 'RB' },
    { player_id: 'p2', position: 'QB' },
  ]

  it('counts each player once, against the list and its group', () => {
    expect(importCounts(picks, new Set(['p1']), null)).toEqual({ fits: 3, fresh: 2, inList: 1, outside: 0 })
    expect(importCounts(picks, new Set(['p1']), 'QB')).toEqual({ fits: 2, fresh: 1, inList: 1, outside: 1 })
    expect(importCounts(picks, new Set(), 'FLEX')).toEqual({ fits: 1, fresh: 1, inList: 0, outside: 2 })
  })

  it('group names', () => {
    expect(groupName(null)).toBeNull()
    expect(groupName('QB')).toBe('QB')
    expect(groupName('DEF')).toBe('D/ST')
    expect(groupName('FLEX')).toBe('RB, WR or TE')
  })

  it('the design’s line when nothing is skipped; the skip when some are; can’t tap when none would come', () => {
    const none = { fits: 15, fresh: 15, inList: 0, outside: 0 }
    expect(importOptionLine(none, 15, 'Published', null)).toEqual({ sub: '15 players · Published', disabled: false })
    expect(importOptionLine({ fits: 12, fresh: 8, inList: 4, outside: 3 }, 15, 'Published', 'QB')).toEqual({
      sub: '12 players · 4 already in this list',
      disabled: false,
    })
    expect(importOptionLine({ fits: 4, fresh: 0, inList: 4, outside: 0 }, 4, null, null)).toEqual({
      sub: 'All already in this list',
      disabled: true,
    })
    expect(importOptionLine({ fits: 0, fresh: 0, inList: 0, outside: 3 }, 3, null, 'QB')).toEqual({
      sub: 'No QB players',
      disabled: true,
    })
    // Still loading who's on it: its own count, tappable.
    expect(importOptionLine(null, 9, '3 tiers', null)).toEqual({ sub: '9 players · 3 tiers', disabled: false })
  })

  it('the toast names what came in and what was skipped', () => {
    expect(importToast({ fits: 12, fresh: 12, inList: 0, outside: 0 }, 'ranking', null)).toEqual({
      title: 'Added 12 players from your ranking',
    })
    expect(importToast({ fits: 9, fresh: 1, inList: 8, outside: 2 }, 'list', 'QB')).toEqual({
      title: 'Added 1 player from your list',
      description: 'Skipped 8 already in this list and 2 that aren’t QB.',
    })
    expect(importToast({ fits: 3, fresh: 2, inList: 0, outside: 1 }, 'list', 'FLEX').description).toBe(
      'Skipped 1 that isn’t RB, WR or TE.',
    )
    expect(importToast({ fits: 4, fresh: 0, inList: 4, outside: 0 }, 'list', null)).toEqual({
      title: 'Everyone in that list is already in this list',
    })
    expect(importToast({ fits: 0, fresh: 0, inList: 0, outside: 2 }, 'ranking', 'TE')).toEqual({
      title: 'No TE players in that ranking',
    })
  })
})

describe('what the sheet offers', () => {
  const head = (n: number, position: string) => ({
    list_id: 'b',
    player_id: `p${n}`,
    position: n,
    updated_at: null,
    added_at: null,
    player: { id: `p${n}`, full_name: `Player ${n}`, position, team: 'BUF', headshot_url: null },
  })
  const boards: MyRankingBoards = {
    season: { listId: 'season', week: 0, players: [head(1, 'QB'), head(2, 'RB'), head(3, 'QB')] },
    weeks: [
      { listId: 'w4', week: 4, players: [head(4, 'WR')] },
      { listId: 'w6', week: 6, players: [head(5, 'DEF'), head(6, 'TE')] },
    ],
  }

  it('rankings: one per position on each board, season first then the latest week', () => {
    const options = rankingImportOptions(boards, 5, null)
    expect(options.map((o) => o.label)).toEqual([
      'Rest of season · QB',
      'Rest of season · RB',
      'Week 6 · TE',
      'Week 6 · D/ST',
      'Week 4 · WR',
    ])
    expect(options[0]).toMatchObject({ kind: 'ranking', listId: 'season', pos: 'QB', total: 2, extra: 'Published' })
    expect(options[0].picks?.map((p) => p.player_id)).toEqual(['p1', 'p3'])
    // A played week is Finalized.
    expect(options[4].extra).toBe('Finalized')
    // Before the season: Pre-draft.
    expect(rankingImportOptions(boards, 0, null)[0].label).toBe('Pre-draft · QB')
  })

  it('rankings: only the positions the list’s group takes', () => {
    expect(rankingImportOptions(boards, 5, 'QB').map((o) => o.label)).toEqual(['Rest of season · QB'])
    expect(rankingImportOptions(boards, 5, 'FLEX').map((o) => o.label)).toEqual([
      'Rest of season · RB',
      'Week 6 · TE',
      'Week 4 · WR',
    ])
  })

  const summary = (id: string, extra: Partial<ListWithTags> = {}) =>
    ({
      id,
      title: `List ${id}`,
      player_count: 3,
      ranking_mode: 'ranked',
      is_favorites: false,
      is_big_board: false,
      owner: null,
      ...extra,
    }) as unknown as ListWithTags

  it('lists: the user’s others, Favorites first — not this one, not a saved one, not an empty one', () => {
    const lists = [
      summary('l1'),
      summary('a'),
      summary('fav', { is_favorites: true }),
      summary('theirs', { owner: { username: 'kelly', avatar_url: null } }),
      summary('empty', { player_count: 0 }),
    ]
    expect(listImportOptions(lists, undefined, 'l1').map((o) => o.listId)).toEqual(['fav', 'a'])
  })

  it('lists: a tiered list says how many tiers; who’s on it once known', () => {
    const players = new Map([
      [
        't',
        [
          { player_id: 'p1', position: 'QB', tier: 'S' },
          { player_id: 'p2', position: 'QB', tier: 'A' },
          { player_id: 'p3', position: 'QB', tier: 'B' },
        ],
      ],
    ])
    const [option] = listImportOptions([summary('t', { ranking_mode: 'rank_and_tier' })], players, 'l1')
    expect(option).toMatchObject({ kind: 'list', total: 3, extra: '3 tiers', pos: null })
    expect(option.picks?.map((p) => p.player_id)).toEqual(['p1', 'p2', 'p3'])
    // While loading: no picks yet, the list's own count.
    expect(listImportOptions([summary('t')], undefined, 'l1')[0]).toMatchObject({ picks: null, total: 3, extra: null })
  })

  it('the players an option brings in: a ranking’s position only, with no tiers; a list as it shows', () => {
    const players = [entry(1, { pos: 'QB' }), entry(2, { pos: 'RB' }), entry(3, { pos: 'QB' })]
    const ranking = importSourceOf({ kind: 'ranking', pos: 'QB' }, players, 'ranked')
    expect(ranking.entries.map((e) => e.player_id)).toEqual(['p1', 'p3'])
    expect(ranking.sourceTiers).toBe(false)
    expect(importSourceOf({ kind: 'list', pos: null }, players, 'rank_and_tier').sourceTiers).toBe(true)
    expect(importSourceOf({ kind: 'list', pos: null }, players, 'ranked').sourceTiers).toBe(false)
  })
})

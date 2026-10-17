/**
 * FieldScout Mobile — the list tools in a list's ⋯ sheet (gap list §3 #3).
 * Pins what each tool offers and draws: the groupings a phone offers (none
 * that would change nothing), the sections each grouping makes from
 * desktop's buckets (no player ever dropped), the drafted / notes counts, and
 * the Side by side URL and button.
 */
import { describe, expect, it } from 'vitest'

import type { ListPlayerWithPlayer } from '@/hooks/use-lists'

import {
  MAX_COMPARE,
  compareButtonLabel,
  compareHref,
  compareIdsOf,
  draftedCount,
  groupOptions,
  groupSections,
  hasPrices,
  hasRounds,
  leftLabel,
  noteOf,
  notesCount,
  notesLabel,
  resolveGroup,
} from './list-tools'

function entry(
  n: number,
  extra: { tier?: string | null; cost?: number | null; notes?: string | null } = {},
): ListPlayerWithPlayer {
  return {
    id: `e${n}`,
    list_id: 'l1',
    player_id: `p${n}`,
    position: n,
    overall_rank: n,
    tier: extra.tier ?? null,
    notes: extra.notes ?? null,
    slot: null,
    rank_in_tier: null,
    added_at: null,
    updated_at: null,
    player: {
      id: `p${n}`,
      full_name: `Player ${n}`,
      position: 'WR',
      team: 'BUF',
      headshot_url: null,
      status: null,
      auction_value: extra.cost ?? null,
    },
    stats: null,
  } as unknown as ListPlayerWithPlayer
}

const ids = (options: ReturnType<typeof groupOptions>) => options.map((option) => option.id)
const names = (sections: ReturnType<typeof groupSections>) =>
  sections.map((section) => [section.label, section.entries.map((e) => e.player_id)])

describe('Group by — what a phone offers', () => {
  const plain = [entry(1), entry(2)]

  it('a plain ranked list: only the flat grouping, named Ranked', () => {
    const options = groupOptions({ ranking_mode: 'ranked', players: plain })
    expect(ids(options)).toEqual(['rank'])
    expect(options[0]!.label).toBe('Ranked')
  })

  it('a list without numbers names the flat grouping Unranked (one numbering rule)', () => {
    expect(groupOptions({ ranking_mode: 'unranked', players: plain })[0]!.label).toBe('Unranked')
    expect(groupOptions({ ranking_mode: 'tier_only', players: plain })[0]!.label).toBe('Unranked')
  })

  it('Tiers only while the Tiers switch is on', () => {
    expect(ids(groupOptions({ ranking_mode: 'rank_and_tier', players: plain }))).toEqual(['rank', 'tier'])
    expect(ids(groupOptions({ ranking_mode: 'tier_only', players: plain }))).toEqual(['rank', 'tier'])
    expect(ids(groupOptions({ ranking_mode: 'ranked', players: [entry(1, { tier: 'S' })] }))).toEqual(['rank'])
  })

  it('Rounds only once a player sits in a round', () => {
    const rounds = [entry(1, { tier: 'r1' }), entry(2)]
    expect(hasRounds(rounds)).toBe(true)
    expect(hasRounds([entry(1, { tier: 'S' })])).toBe(false)
    expect(ids(groupOptions({ ranking_mode: 'ranked', players: rounds }))).toEqual(['rank', 'round'])
  })

  it('Avg cost and Budget % only once a player has an auction price', () => {
    const priced = [entry(1, { cost: 30 }), entry(2)]
    expect(hasPrices(priced)).toBe(true)
    expect(hasPrices(plain)).toBe(false)
    expect(ids(groupOptions({ ranking_mode: 'ranked', players: priced }))).toEqual(['rank', 'cost', 'budget'])
  })

  it('resolveGroup: the session pick when offered, else the list’s own', () => {
    const tiered = { ranking_mode: 'rank_and_tier', players: [entry(1, { tier: 'S', cost: 20 })] }
    expect(resolveGroup(null, tiered)).toBe('tier')
    expect(resolveGroup('cost', tiered)).toBe('cost')
    expect(resolveGroup('rank', tiered)).toBe('rank')
    // A pick this list doesn't offer falls back to the list's own grouping.
    expect(resolveGroup('round', tiered)).toBe('tier')
    expect(resolveGroup('tier', { ranking_mode: 'ranked', players: [entry(1)] })).toBe('rank')
    expect(resolveGroup('budget', { ranking_mode: 'ranked', players: [entry(1)] })).toBe('rank')
  })
})

describe('Group by — the sections', () => {
  it('flat: one headerless section in list order', () => {
    const sections = groupSections([entry(2), entry(1)], 'rank', 200)
    expect(names(sections)).toEqual([[null, ['p1', 'p2']]])
  })

  it('tiers: Tier 1, Tier 2… in tier order, Ungrouped last and neutral', () => {
    const sections = groupSections([entry(1, { tier: 'A' }), entry(2, { tier: 'S' }), entry(3)], 'tier', 200)
    expect(names(sections)).toEqual([
      ['Tier 1', ['p2']],
      ['Tier 2', ['p1']],
      ['Ungrouped', ['p3']],
    ])
    expect(sections.map((s) => s.colorIndex)).toEqual([0, 1, -1])
  })

  it('rounds: "Round N" headings in round order, unassigned players under Ungrouped', () => {
    const sections = groupSections(
      [entry(1, { tier: 'r2' }), entry(2, { tier: 'r1' }), entry(3, { tier: 'r10' }), entry(4)],
      'round',
      200,
    )
    expect(names(sections)).toEqual([
      ['Round 1', ['p2']],
      ['Round 2', ['p1']],
      ['Round 10', ['p3']],
      ['Ungrouped', ['p4']],
    ])
  })

  it('avg cost: desktop’s price bands with their spend, empty bands left out, unpriced kept', () => {
    const sections = groupSections(
      [entry(1, { cost: 12 }), entry(2, { cost: 55 }), entry(3, { cost: 41 }), entry(4)],
      'cost',
      200,
    )
    expect(names(sections)).toEqual([
      ['$40 and up', ['p2', 'p3']],
      ['$10 – $24', ['p1']],
      ['No auction value', ['p4']],
    ])
    expect(sections.map((s) => s.meta)).toEqual(['$96', '$12', '$0'])
    expect(sections.map((s) => s.colorIndex)).toEqual([0, 1, -1])
  })

  it('budget %: bands of the budget, and no player is dropped for having no price', () => {
    const sections = groupSections([entry(1, { cost: 50 }), entry(2, { cost: 8 }), entry(3)], 'budget', 200)
    expect(names(sections)).toEqual([
      ['Over 20% of budget', ['p1']],
      ['Under 5%', ['p2']],
      ['No auction value', ['p3']],
    ])
    const players = sections.flatMap((s) => s.entries.map((e) => e.player_id)).sort()
    expect(players).toEqual(['p1', 'p2', 'p3'])
    // The budget moves the bands.
    expect(groupSections([entry(1, { cost: 50 })], 'budget', 1000)[0]!.label).toBe('5–10%')
  })
})

describe('drafted and notes', () => {
  const players = [entry(1, { notes: '  Elite floor  ' }), entry(2, { notes: '   ' }), entry(3)]

  it('counts only this list’s players among the marks', () => {
    expect(draftedCount(players, new Set(['p1', 'p3', 'p-elsewhere']))).toBe(2)
    expect(leftLabel(players, new Set(['p1']))).toBe('2 of 3 left')
  })

  it('a blank note is no note', () => {
    expect(noteOf(players[0]!)).toBe('Elite floor')
    expect(noteOf(players[1]!)).toBeNull()
    expect(notesCount(players)).toBe(1)
    expect(notesLabel(1)).toBe('1 note')
    expect(notesLabel(3)).toBe('3 notes')
  })
})

describe('Side by side', () => {
  it('the URL round-trips, deduped and capped', () => {
    expect(compareHref(['a', 'b'])).toBe('/app/lists?compare=a,b')
    expect(compareIdsOf('a,b')).toEqual(['a', 'b'])
    expect(compareIdsOf(' a ,a,,b')).toEqual(['a', 'b'])
    expect(compareIdsOf(null)).toEqual([])
    expect(compareIdsOf('1,2,3,4,5,6,7,8')).toHaveLength(MAX_COMPARE)
  })

  it('the button names what it opens, and what is missing until it can', () => {
    expect(compareButtonLabel(1, true)).toBe('Pick a list to compare')
    expect(compareButtonLabel(1, false)).toBe('Pick at least 2 lists')
    expect(compareButtonLabel(3, true)).toBe('Show 3 lists side by side')
  })
})

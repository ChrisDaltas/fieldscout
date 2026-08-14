/**
 * attach-list-ops pins — M2 task L.B4.2 (spec §7.4; PROGRESS D122). Pure
 * derivations for the attach modal: picker ordering, the recorded
 * smart-suggestion heuristic (scoring-system match, Big Board fallback,
 * honest null), from-list league ordering, toast copy.
 */
import { describe, expect, it } from 'vitest'

import type { MyDraftList } from '@/hooks/use-league-lists'

import {
  attachCandidates,
  attachSuggestion,
  attachedToastLine,
  leagueOptions,
} from './attach-list-ops'

function list(overrides: Partial<MyDraftList> & { id: string }): MyDraftList {
  return {
    title: overrides.id,
    position_filter: null,
    player_count: 10,
    is_private: true,
    is_big_board: false,
    scoring_system_id: null,
    updated_at: '2026-08-01T00:00:00+00:00',
    ...overrides,
  }
}

const BOARD = list({ id: 'board', is_big_board: true, updated_at: '2026-07-01T00:00:00+00:00' })
const OLD = list({ id: 'old', updated_at: '2026-07-10T00:00:00+00:00' })
const NEW = list({ id: 'new', updated_at: '2026-08-10T00:00:00+00:00' })
const PPR_OLD = list({
  id: 'ppr-old',
  scoring_system_id: 'sys-ppr',
  updated_at: '2026-07-05T00:00:00+00:00',
})
const PPR_NEW = list({
  id: 'ppr-new',
  scoring_system_id: 'sys-ppr',
  updated_at: '2026-08-05T00:00:00+00:00',
})

describe('attachCandidates (§7.4 league-side picker)', () => {
  it('puts the Big Board first, then most recently updated; attached rows stay listed but flagged', () => {
    const rows = attachCandidates([OLD, NEW, BOARD], new Set([OLD.id]))
    expect(rows.map((r) => r.id)).toEqual(['board', 'new', 'old'])
    expect(rows.map((r) => r.attached)).toEqual([false, false, true])
  })
})

describe('attachSuggestion (the recorded §7.4 heuristic)', () => {
  it('suggests the NEWEST unattached scoring-system match', () => {
    const got = attachSuggestion([PPR_OLD, PPR_NEW, NEW, BOARD], 'sys-ppr', new Set())
    expect(got?.id).toBe('ppr-new')
  })

  it('skips attached matches (a one-tap for something already attached is noise)', () => {
    const got = attachSuggestion([PPR_OLD, PPR_NEW, BOARD], 'sys-ppr', new Set([PPR_NEW.id]))
    expect(got?.id).toBe('ppr-old')
  })

  it('falls back to the unattached Big Board when nothing matches the scoring system', () => {
    const got = attachSuggestion([NEW, OLD, BOARD], 'sys-other', new Set())
    expect(got?.id).toBe('board')
  })

  it('a NULL league scoring system never matches null list systems — Big Board fallback, not a false format match', () => {
    const got = attachSuggestion([NEW, OLD, BOARD], null, new Set())
    expect(got?.id).toBe('board')
  })

  it('returns null when even the Big Board is attached (no banner beats a baseless one)', () => {
    const got = attachSuggestion([BOARD], null, new Set([BOARD.id]))
    expect(got).toBeNull()
  })
})

describe('leagueOptions (from-list side)', () => {
  it('orders by draft relevance — drafting, scheduled, setup, then post-draft — and flags attached', () => {
    const rows = leagueOptions(
      [
        { id: 'a', name: 'Alpha', status: 'in_season' },
        { id: 'b', name: 'Bravo', status: 'scheduled' },
        { id: 'c', name: 'Charlie', status: 'drafting' },
        { id: 'd', name: 'Delta', status: 'setup' },
      ],
      new Set(['b']),
    )
    expect(rows.map((r) => r.id)).toEqual(['c', 'b', 'd', 'a'])
    expect(rows.find((r) => r.id === 'b')?.attached).toBe(true)
  })
})

describe('attachedToastLine', () => {
  it('names the flags that were set, and only those', () => {
    expect(attachedToastLine('My Guys', 'Sunday Legends', true, false)).toBe(
      '“My Guys” is attached to Sunday Legends — your primary board.',
    )
    expect(attachedToastLine('My Guys', 'Sunday Legends', true, true)).toBe(
      '“My Guys” is attached to Sunday Legends — your primary board, shared with the league.',
    )
    expect(attachedToastLine('My Guys', 'Sunday Legends', false, false)).toBe(
      '“My Guys” is attached to Sunday Legends.',
    )
  })
})

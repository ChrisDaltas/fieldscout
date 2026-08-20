/**
 * my-lists-panel-ops pins — M2 task L.B4.2 (spec §8.9; PROGRESS D122).
 * Panel row derivation (mine → shared → Big Board, primary first, the R130
 * belt, big-board dedupe), the §8.9 best-available-from-board helper, and
 * the load-into-queue toast lines.
 */
import { describe, expect, it } from 'vitest'

import type { LeagueListWithList } from '@/lib/leagues/api/league-lists-service'

import {
  bestAvailableFromBoard,
  deriveListsPanelRows,
  fromListToastLine,
} from './my-lists-panel-ops'

const ME = 'user-me'
const OTHER = 'user-other'

function attachment(
  overrides: Partial<LeagueListWithList> & { id: string; list_id: string; owner_id: string },
): LeagueListWithList {
  return {
    league_id: 'league-1',
    is_primary_board: false,
    shared_with_league: false,
    created_at: '2026-08-01T00:00:00+00:00',
    lists: {
      id: overrides.list_id,
      owner_id: overrides.owner_id,
      title: `title-${overrides.list_id}`,
      description: null,
      position_filter: null,
      player_count: 5,
      is_private: true,
      is_big_board: false,
      updated_at: null,
    },
    ...overrides,
  } as LeagueListWithList
}

const USERNAMES = new Map([[OTHER, 'rival_gm']])
const BOARD = { id: 'list-board', title: 'My Big Board', player_count: 40 }

describe('deriveListsPanelRows (§8.9 panel contents)', () => {
  it('orders mine (primary first) → shared → the Big Board default row', () => {
    const rows = deriveListsPanelRows(
      [
        attachment({ id: 'a1', list_id: 'list-a', owner_id: ME }),
        attachment({ id: 'a2', list_id: 'list-b', owner_id: ME, is_primary_board: true }),
        attachment({ id: 'a3', list_id: 'list-c', owner_id: OTHER, shared_with_league: true }),
      ],
      ME,
      BOARD,
      USERNAMES,
    )
    expect(rows.map((r) => r.key)).toEqual(['a2', 'a1', 'a3', 'big-board'])
    expect(rows[0]?.isPrimary).toBe(true)
    expect(rows[2]?.ownerLabel).toBe('@rival_gm')
    expect(rows[3]).toMatchObject({ isBigBoard: true, attached: false, leagueListId: null })
  })

  it('an ATTACHED Big Board is flagged on its attachment row, never duplicated', () => {
    const rows = deriveListsPanelRows(
      [attachment({ id: 'a9', list_id: BOARD.id, owner_id: ME })],
      ME,
      BOARD,
      USERNAMES,
    )
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ key: 'a9', isBigBoard: true, attached: true })
  })

  it('R130 belt: a null-embed row renders dangling for its OWNER and not at all for anyone else', () => {
    const dangling = attachment({
      id: 'a4',
      list_id: 'list-gone',
      owner_id: ME,
      shared_with_league: true,
    })
    dangling.lists = null

    const mineView = deriveListsPanelRows([dangling], ME, null, USERNAMES)
    expect(mineView).toHaveLength(1)
    expect(mineView[0]).toMatchObject({
      dangling: true,
      title: 'List no longer available',
    })

    const theirView = deriveListsPanelRows([dangling], OTHER, null, USERNAMES)
    expect(theirView).toHaveLength(0)
  })

  it('a member with an unknown user id still gets an honest owner label', () => {
    const rows = deriveListsPanelRows(
      [attachment({ id: 'a5', list_id: 'list-d', owner_id: 'user-ghost', shared_with_league: true })],
      ME,
      null,
      USERNAMES,
    )
    expect(rows[0]?.ownerLabel).toBe('League member')
  })
})

describe('bestAvailableFromBoard (§8.9 helper)', () => {
  it('returns the first NOT-drafted player in board order (E17: recomputes as picks land)', () => {
    expect(bestAvailableFromBoard(['p1', 'p2', 'p3'], new Set(['p1']))).toBe('p2')
    expect(bestAvailableFromBoard(['p1', 'p2', 'p3'], new Set())).toBe('p1')
  })

  it('returns null on an exhausted board — the helper disappears, never guesses', () => {
    expect(bestAvailableFromBoard(['p1', 'p2'], new Set(['p1', 'p2']))).toBeNull()
    expect(bestAvailableFromBoard([], new Set())).toBeNull()
  })
})

describe('fromListToastLine (the D113(5) response made human)', () => {
  it('replace names the load; append names the addition; skips itemize', () => {
    expect(fromListToastLine('replace', { added: 8, skipped_drafted: 2 })).toBe(
      'Targets loaded — 8 players (2 already drafted skipped).',
    )
    expect(
      fromListToastLine('append', { added: 1, skipped_drafted: 0, skipped_queued: 3 }),
    ).toBe('1 player added to your Targets (3 already targeted skipped).')
    expect(fromListToastLine('replace', { added: 5, skipped_drafted: 0 })).toBe(
      'Targets loaded — 5 players.',
    )
  })
})

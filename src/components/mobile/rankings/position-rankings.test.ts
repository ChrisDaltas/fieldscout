/**
 * One ranking per position on each board — the derivation My rankings'
 * cards, Profile's ranking rows and Home's Rankings count share (gap list
 * §3 #22).
 */
import { describe, expect, it } from 'vitest'

import type { BoardPlayerLite, MyRankingBoards } from '@/hooks/use-mobile-rankings-boards'

import { positionRankings } from './position-rankings'

function row(listId: string, n: number, pos: string, stamp: string | null, added: string | null = null): BoardPlayerLite {
  return {
    list_id: listId,
    player_id: `${listId}-${n}`,
    position: n,
    updated_at: stamp,
    added_at: added,
    player: { id: `${listId}-${n}`, full_name: `Player ${n}`, position: pos, team: 'KC', headshot_url: null },
  }
}

const BOARDS: MyRankingBoards = {
  season: {
    listId: 'season',
    week: 0,
    players: [
      row('season', 1, 'RB', '2026-10-10T12:00:00Z'),
      row('season', 2, 'QB', '2026-10-01T12:00:00Z'),
      row('season', 3, 'RB', '2026-10-12T12:00:00Z'),
      row('season', 4, 'DEF', null, '2026-09-01T12:00:00Z'),
      // Not a ranked position.
      row('season', 5, 'OL', '2026-10-14T12:00:00Z'),
    ],
    scoringFormat: 'ppr',
  },
  weeks: [
    { listId: 'w6', week: 6, players: [row('w6', 1, 'WR', '2026-10-13T12:00:00Z')], scoringFormat: null },
    { listId: 'w5', week: 5, players: [row('w5', 1, 'QB', '2026-10-05T12:00:00Z')] },
    // An empty board holds no ranking; a week outside 1–18 is none either.
    { listId: 'w7', week: 7, players: [] },
    { listId: 'w19', week: 19, players: [row('w19', 1, 'QB', '2026-10-14T12:00:00Z')] },
  ],
}

describe('positionRankings', () => {
  const all = positionRankings(BOARDS)

  it('one per position on each board: season first, then weeks in order, positions in the app’s order', () => {
    expect(all.map((r) => r.key)).toEqual(['season-QB', 'season-RB', 'season-DST', 'w5-QB', 'w6-WR'])
  })

  it('each keeps its own players in board order and its own latest save', () => {
    const rb = all.find((r) => r.key === 'season-RB')!
    expect(rb.rows.map((r) => r.player_id)).toEqual(['season-1', 'season-3'])
    expect(rb.savedAt).toBe('2026-10-12T12:00:00Z')
    expect(all.find((r) => r.key === 'season-QB')!.savedAt).toBe('2026-10-01T12:00:00Z')
    // Never reordered: when it was added.
    expect(all.find((r) => r.key === 'season-DST')!.savedAt).toBe('2026-09-01T12:00:00Z')
  })

  it('carries the scoring the editor opens it on: the board’s saved one, else Half PPR', () => {
    expect(all.find((r) => r.key === 'season-RB')!.scoring).toBe('ppr')
    expect(all.find((r) => r.key === 'w6-WR')!.scoring).toBe('half')
    // Before migration 190 the board carries none at all.
    expect(all.find((r) => r.key === 'w5-QB')!.scoring).toBe('half')
  })

  it('no boards, no rankings', () => {
    expect(positionRankings({ season: null, weeks: [] })).toEqual([])
  })
})

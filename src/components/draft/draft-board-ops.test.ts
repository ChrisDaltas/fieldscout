import { describe, expect, it } from 'vitest'

import {
  buildBoardModel,
  nextPickNumberForTeam,
  parseDraftOrder,
  pickLabel,
  recentPicks,
  type BoardPickInput,
} from './draft-board-ops'

/**
 * draft-board-ops.test.ts — the board grid's D90 split, pinned (M2 task
 * L.B3.2): made cells render the ROW's truth, open cells the order math,
 * on-clock only what the drafts row names, undone numbers reopen (E4).
 */

const T = ['tA', 'tB', 'tC', 'tD'] as const

function pick(pick_number: number, team_id: string, player_id: string, over?: Partial<BoardPickInput>): BoardPickInput {
  return { pick_number, team_id, player_id, is_auto: false, is_undone: false, ...over }
}

describe('buildBoardModel', () => {
  it('lays a 4-team snake board: rows × slots complete, snake rows placed right-to-left', () => {
    const model = buildBoardModel({
      order: T,
      totalRounds: 3,
      draftType: 'snake',
      snakeReversal: false,
      picks: [],
      currentPickNumber: 1,
    })
    expect(model.rows).toHaveLength(3)
    expect(model.rows.every((row) => row.length === 4)).toBe(true)
    // Round 1 forward: slot 0 holds pick 1 … slot 3 holds pick 4.
    expect(model.rows[0].map((c) => c.pickNumber)).toEqual([1, 2, 3, 4])
    // Round 2 reversed: slot 0 holds pick 8 … slot 3 holds pick 5.
    expect(model.rows[1].map((c) => c.pickNumber)).toEqual([8, 7, 6, 5])
    // Every open cell carries its D90-predicted owner (column == team).
    expect(model.rows[1].map((c) => c.teamId)).toEqual(['tA', 'tB', 'tC', 'tD'])
    expect(model.rows[0][0].isOnClock).toBe(true)
    expect(model.rows.flat().filter((c) => c.isOnClock)).toHaveLength(1)
  })

  it('made cells render the ROW truth — a reassigned pick shows its actual team, not the predicted slot owner', () => {
    const model = buildBoardModel({
      order: T,
      totalRounds: 2,
      draftType: 'snake',
      snakeReversal: false,
      picks: [pick(1, 'tA', 'p1'), pick(2, 'tD', 'p2')], // pick 2 was reassigned tB → tD
      currentPickNumber: 3,
    })
    const cell2 = model.rows[0][1]
    expect(cell2.playerId).toBe('p2')
    expect(cell2.teamId).toBe('tD') // the row wins (D90) — NOT slot owner tB
    expect(model.rows[0][2].teamId).toBe('tC') // open cell: math still labels it
  })

  it('an undone pick reopens its cell (E4) and the re-pick lands as made again', () => {
    const undone = pick(2, 'tB', 'p2', { is_undone: true })
    const open = buildBoardModel({
      order: T,
      totalRounds: 1,
      draftType: 'snake',
      snakeReversal: false,
      picks: [pick(1, 'tA', 'p1'), undone],
      currentPickNumber: 2,
    })
    expect(open.rows[0][1].playerId).toBeNull()
    expect(open.rows[0][1].isOnClock).toBe(true)

    const repicked = buildBoardModel({
      order: T,
      totalRounds: 1,
      draftType: 'snake',
      snakeReversal: false,
      picks: [pick(1, 'tA', 'p1'), undone, pick(2, 'tB', 'p9')],
      currentPickNumber: 3,
    })
    expect(repicked.rows[0][1].playerId).toBe('p9')
  })

  it('empty order or missing rounds ⇒ an empty model (the degraded arm renders the flat pick list)', () => {
    expect(
      buildBoardModel({
        order: [],
        totalRounds: 15,
        draftType: 'snake',
        snakeReversal: false,
        picks: [],
        currentPickNumber: null,
      }).rows,
    ).toEqual([])
    expect(
      buildBoardModel({
        order: T,
        totalRounds: null,
        draftType: 'snake',
        snakeReversal: false,
        picks: [],
        currentPickNumber: null,
      }).rows,
    ).toEqual([])
  })
})

describe('parseDraftOrder / recentPicks / pickLabel', () => {
  it('parseDraftOrder keeps strings only and answers [] for non-arrays', () => {
    expect(parseDraftOrder(['a', 'b'])).toEqual(['a', 'b'])
    expect(parseDraftOrder(['a', 7, null, 'b'])).toEqual(['a', 'b'])
    expect(parseDraftOrder('a')).toEqual([])
    expect(parseDraftOrder(null)).toEqual([])
  })

  it('recentPicks: newest first, undone excluded, bounded', () => {
    const picks = [
      pick(1, 'tA', 'p1'),
      pick(2, 'tB', 'p2', { is_undone: true }),
      pick(3, 'tC', 'p3'),
      pick(4, 'tD', 'p4'),
    ]
    expect(recentPicks(picks, 2).map((p) => p.pick_number)).toEqual([4, 3])
    expect(recentPicks(picks, 10).map((p) => p.pick_number)).toEqual([4, 3, 1])
  })

  it('pickLabel: round.slot-in-round', () => {
    expect(pickLabel(1, 12)).toBe('1.01')
    expect(pickLabel(13, 12)).toBe('2.01')
    expect(pickLabel(24, 12)).toBe('2.12')
    expect(pickLabel(5, 0)).toBe('5')
  })

  it('nextPickNumberForTeam: snake turn math from the current pick; null past the board or without a seat', () => {
    // 4-team snake: tB owns picks 2, 7, 10, 15, …
    expect(nextPickNumberForTeam(T, 'snake', false, 3, 4, 'tB')).toBe(7)
    expect(nextPickNumberForTeam(T, 'snake', false, 7, 4, 'tB')).toBe(7) // on the clock now
    expect(nextPickNumberForTeam(T, 'snake', false, 16, 4, 'tB')).toBeNull() // board over
    expect(nextPickNumberForTeam(T, 'snake', false, 3, 4, null)).toBeNull() // no seat
    expect(nextPickNumberForTeam([], 'snake', false, 3, 4, 'tB')).toBeNull()
  })
})

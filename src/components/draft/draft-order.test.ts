import { describe, expect, it } from 'vitest'

import { roundForPick, slotIndexForPick, teamForPick } from './draft-order'

/**
 * draft-order.test.ts — the D90 display-math golden pins (M2 task L.B3.2).
 *
 * The expected tables below are STORED LITERALS copied from pgTAP 020 §C
 * (C1/C2/C3 — the stored-literal pick→team tables the SQL helper
 * `draft_team_for_pick` is pinned against, expressed as 1-based round-1 slot
 * numbers). Both implementations answer to the SAME literals, so neither
 * twin can drift alone NOR can they drift together without the suite going
 * red (the falsifiability floor, tasks-M2 §4.3). The live TS ≡ SQL sweep
 * across every size × mode is `draft-order-parity-db.test.ts` (stack-backed).
 */

/** order = slot n ↦ team id `t<n>` (1-based, mirroring 020's …0001-…0012). */
function orderOfSize(n: number): string[] {
  return Array.from({ length: n }, (_, i) => `t${String(i + 1).padStart(2, '0')}`)
}

function slotTable(
  picks: number,
  order: readonly string[],
  draftType: 'snake' | 'linear',
  reversal: boolean,
): number[] {
  return Array.from({ length: picks }, (_, i) => {
    const team = teamForPick(i + 1, order, draftType, reversal)
    return team === null ? 0 : Number(team.slice(1))
  })
}

describe('draft-order (D90 display math) — pgTAP 020 §C stored literals', () => {
  it('C1: 8-team snake no-reversal, rounds 1–4 (fwd/rev/fwd/rev)', () => {
    // prettier-ignore
    const expected = [
      1, 2, 3, 4, 5, 6, 7, 8,
      8, 7, 6, 5, 4, 3, 2, 1,
      1, 2, 3, 4, 5, 6, 7, 8,
      8, 7, 6, 5, 4, 3, 2, 1,
    ]
    expect(slotTable(32, orderOfSize(8), 'snake', false)).toEqual(expected)
  })

  it('C2: 12-team 3RR, rounds 1–4 (fwd/rev/REV-flip/fwd)', () => {
    // prettier-ignore
    const expected = [
       1,  2,  3,  4,  5,  6,  7,  8,  9, 10, 11, 12,
      12, 11, 10,  9,  8,  7,  6,  5,  4,  3,  2,  1,
      12, 11, 10,  9,  8,  7,  6,  5,  4,  3,  2,  1,
       1,  2,  3,  4,  5,  6,  7,  8,  9, 10, 11, 12,
    ]
    expect(slotTable(48, orderOfSize(12), 'snake', true)).toEqual(expected)
  })

  it('C3: linear 8-team, rounds 1–4 (same order every round)', () => {
    // prettier-ignore
    const expected = [
      1, 2, 3, 4, 5, 6, 7, 8,
      1, 2, 3, 4, 5, 6, 7, 8,
      1, 2, 3, 4, 5, 6, 7, 8,
      1, 2, 3, 4, 5, 6, 7, 8,
    ]
    expect(slotTable(32, orderOfSize(8), 'linear', false)).toEqual(expected)
  })

  it('mirrors the SQL guards: empty order / pick < 1 answer null, never a guess', () => {
    expect(teamForPick(1, [], 'snake', false)).toBeNull()
    expect(teamForPick(0, orderOfSize(8), 'snake', false)).toBeNull()
    expect(teamForPick(-3, orderOfSize(8), 'linear', false)).toBeNull()
    expect(slotIndexForPick(1, 0, 'snake', false)).toBeNull()
  })

  it('roundForPick: kept verbatim from mock-draft.ts + the guard arm', () => {
    expect(roundForPick(1, 8)).toBe(1)
    expect(roundForPick(8, 8)).toBe(1)
    expect(roundForPick(9, 8)).toBe(2)
    expect(roundForPick(120, 8)).toBe(15)
    expect(roundForPick(0, 8)).toBe(0)
    expect(roundForPick(5, 0)).toBe(0)
  })

  it('3RR keeps inverted parity DEEP into the draft (round 15 rev, round 16 fwd — not a rounds-1–4 artifact)', () => {
    const order = orderOfSize(8)
    // Round 15 (odd, ≥ 3 with reversal ⇒ NOT forward): pick 113 = slot 8.
    expect(teamForPick(113, order, 'snake', true)).toBe('t08')
    expect(teamForPick(120, order, 'snake', true)).toBe('t01')
    // Round 16 (even ⇒ forward under 3RR): pick 121 = slot 1.
    expect(teamForPick(121, order, 'snake', true)).toBe('t01')
    expect(teamForPick(128, order, 'snake', true)).toBe('t08')
    // Plain snake at the same depth: round 15 odd ⇒ forward.
    expect(teamForPick(113, order, 'snake', false)).toBe('t01')
    expect(teamForPick(121, order, 'snake', false)).toBe('t08')
  })
})

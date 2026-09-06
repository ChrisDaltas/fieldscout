/**
 * standings-service.test.ts — the PURE half of the standings route (M4 task
 * L.D4.1; ledger **F247(b)**): 117 renders `points_for` / `points_against`
 * as JSON `0` for a team with no rows and `35.00` otherwise, and the route
 * refuses to trust the scale — every figure is coerced and asserted finite.
 * The live half (the RPC's 42501 → 403 for a non-member, the document over
 * the wire with both scales planted) is `inseason-reads-api-db.test.ts`.
 */
import { describe, expect, it } from 'vitest'

import { normalizeStandingsRow } from './standings-service'

const base = {
  rank: 1,
  team_id: 't1',
  name: 'One',
  wins: 2,
  losses: 0,
  ties: 0,
  games: 2,
  weeks: 2,
  h2h_record: { wins: 2, losses: 0, ties: 0 },
  median_record: { wins: 0, losses: 0, ties: 0 },
  second_record: { wins: 0, losses: 0, ties: 0 },
  separated_by: null,
}

describe('normalizeStandingsRow — the F247(b) scale, not trusted', () => {
  it('the no-rows shape (`0`) and the summed shape (`35.00`) both come out as the same kind of number', () => {
    const empty = normalizeStandingsRow({ ...base, win_pct: 0, points_for: 0, points_against: 0 })
    const summed = normalizeStandingsRow({ ...base, win_pct: 1.0, points_for: 35.0, points_against: 21.5 })
    expect(empty.points_for).toBe(0)
    expect(summed.points_for).toBe(35)
    expect(summed.points_against).toBe(21.5)
    expect(typeof empty.points_for).toBe(typeof summed.points_for)
    // A renderer may format without a guard:
    expect(empty.points_for.toFixed(2)).toBe('0.00')
    expect(summed.points_for.toFixed(2)).toBe('35.00')
  })

  it('a STRING-rendered scale (a future numeric → text change on the SQL side) is coerced, not passed through', () => {
    const row = normalizeStandingsRow({ ...base, win_pct: '0.5000', points_for: '35.00', points_against: '0' })
    expect(row.win_pct).toBe(0.5)
    expect(row.points_for).toBe(35)
    expect(row.points_against).toBe(0)
  })

  it('a figure that is not a finite number REFUSES the document by name (rule 10)', () => {
    expect(() => normalizeStandingsRow({ ...base, win_pct: 1, points_for: null, points_against: 0 })).toThrow(
      /points_for for team t1 is not a finite number \(null\) — F247\(b\)/,
    )
    expect(() => normalizeStandingsRow({ ...base, win_pct: 'abc', points_for: 1, points_against: 0 })).toThrow(
      /win_pct/,
    )
    expect(() => normalizeStandingsRow({ ...base, win_pct: 1, points_for: 1, points_against: undefined })).toThrow(
      /points_against/,
    )
  })

  it('everything else on the row rides through untouched', () => {
    const row = normalizeStandingsRow({ ...base, win_pct: 1, points_for: 1, points_against: 0, separated_by: 'points_for' })
    expect(row.separated_by).toBe('points_for')
    expect(row.h2h_record).toStrictEqual({ wins: 2, losses: 0, ties: 0 })
    expect(row.name).toBe('One')
  })
})

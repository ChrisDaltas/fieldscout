/**
 * reingest-weeks.test.ts — the pure edges of the past-week re-ingest tool
 * (M6A L.E1.26 fix round, R1149): the week spec, the target guard, the
 * not-started refusal at its boundary instant. The DB path is pinned over
 * the real stack in `reingest-weeks-db.test.ts`.
 */
import { describe, expect, it } from 'vitest'

import { confirmTarget, parseWeeks, refusalFor } from './reingest-weeks'

describe('parseWeeks', () => {
  it('ranges, lists and mixes → ascending unique weeks', () => {
    expect(parseWeeks('1-3')).toEqual([1, 2, 3])
    expect(parseWeeks('2,1,2')).toEqual([1, 2])
    expect(parseWeeks('1-2,4')).toEqual([1, 2, 4])
    expect(parseWeeks('18')).toEqual([18])
  })

  it('refuses anything else by name', () => {
    for (const bad of ['', '0', '19', '3-1', 'a', '1-', '1..3']) expect(() => parseWeeks(bad), bad).toThrow(/Invalid --weeks/)
  })
})

describe('confirmTarget — the CLI names the host it will write to (R1149)', () => {
  it('passes only on an exact host match', () => {
    expect(confirmTarget('http://127.0.0.1:54321', '127.0.0.1:54321')).toBe('127.0.0.1:54321')
    expect(confirmTarget('https://abc.supabase.co', 'abc.supabase.co')).toBe('abc.supabase.co')
  })

  it('without the flag it prints the target and refuses; a mismatch refuses', () => {
    expect(() => confirmTarget('https://abc.supabase.co', undefined)).toThrow('target is abc.supabase.co — re-run with --confirm-target abc.supabase.co')
    expect(() => confirmTarget('https://abc.supabase.co', '127.0.0.1:54321')).toThrow(/does not match the target abc\.supabase\.co/)
    expect(() => confirmTarget('http://127.0.0.1:54321', '127.0.0.1')).toThrow(/does not match/)
    expect(() => confirmTarget('not a url', 'x')).toThrow(/not a URL/)
  })
})

describe('refusalFor — a week that has not started is refused (boundary instants)', () => {
  const KICK = '2026-09-10T00:20:00.000Z'
  const rows = new Map([
    [1, { week: 1, first_kickoff_at: KICK, last_game_ends_at: '2026-09-15T07:00:00.000Z' }],
    [2, { week: 2, first_kickoff_at: null, last_game_ends_at: null }],
  ])

  it('the first kickoff AT now is started; one millisecond before it is not', () => {
    expect(refusalFor([1], rows, new Date(KICK))).toBeNull()
    expect(refusalFor([1], rows, new Date(new Date(KICK).getTime() - 1))).toMatch(/week 1: first kickoff .* is after now — not started/)
  })

  it('no kickoff recorded, or no calendar row, refuses — every offending week named', () => {
    const msg = refusalFor([1, 2, 3], rows, new Date('2026-09-20T00:00:00Z'))
    expect(msg).toMatch(/week 2: no game has a recorded kickoff/)
    expect(msg).toMatch(/week 3: no nfl_weeks row/)
    expect(msg).not.toMatch(/week 1/)
    expect(msg).toMatch(/Nothing was polled or written\.$/)
  })
})

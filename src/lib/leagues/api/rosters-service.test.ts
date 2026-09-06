/**
 * rosters-service.test.ts — the PURE half of the rosters route (M4 task
 * L.D4.1; ledger **F241(d)**): the three shapes §12.19 defines for
 * `league_player_pool.locked_until` become a renderable view, and anything
 * else is a THROWN error rather than a silently-unlocked row. The live half
 * (membership gate, the join, a planted `'infinity'` row over the wire) is
 * `inseason-reads-api-db.test.ts`.
 */
import { describe, expect, it } from 'vitest'

import { POSTGREST_ROW_CAP, assertBelowPostgrestCap } from './inseason-reads'
import { POOL_LOCK_INFINITY, gameLockView } from './rosters-service'

describe('gameLockView — §12.19\'s locked_until, normalised (F241(d))', () => {
  it('NULL (and an absent pool row) = not locked', () => {
    expect(gameLockView(null)).toStrictEqual({ state: 'unlocked', until: null })
    expect(gameLockView(undefined)).toStrictEqual({ state: 'unlocked', until: null })
  })

  it("the literal 'infinity' = locked and the release NOT YET RECORDED — never new Date('infinity')", () => {
    expect(POOL_LOCK_INFINITY).toBe('infinity')
    expect(gameLockView('infinity')).toStrictEqual({ state: 'locked_release_unrecorded', until: null })
    // The failure this prevents:
    expect(Number.isNaN(new Date('infinity').getTime())).toBe(true)
  })

  it('an instant = locked until it, carried VERBATIM (the UI compares with its own clock)', () => {
    const until = '2099-09-14T03:30:00+00:00'
    expect(gameLockView(until)).toStrictEqual({ state: 'locked_until', until })
  })

  it('anything else THROWS by name — a value §12.19 does not define is never rendered unlocked', () => {
    expect(() => gameLockView('-infinity')).toThrow(/neither NULL, an instant nor 'infinity'/)
    expect(() => gameLockView('yesterday')).toThrow(/"yesterday"/)
    expect(() => gameLockView('')).toThrow()
  })
})

describe('assertBelowPostgrestCap — a read that reaches the cap cannot claim completeness (CLAUDE.md)', () => {
  it('999 rows pass; 1000 refuse by name', () => {
    expect(POSTGREST_ROW_CAP).toBe(1000)
    expect(assertBelowPostgrestCap(new Array(999).fill(0), 'league_rosters')).toBeNull()
    const refused = assertBelowPostgrestCap(new Array(1000).fill(0), 'league_rosters')
    expect(refused?.status).toBe(500)
    expect(JSON.stringify(refused?.body)).toContain('league_rosters: 1000 rows reached the PostgREST cap')
  })
})

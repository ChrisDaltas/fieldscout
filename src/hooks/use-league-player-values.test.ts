/**
 * projectionForTotal — how one player's projection counts toward a team's
 * projected total (Chris 2026-11-18: "none of the matchups are showing the
 * projected totals" — one bye / IR / out starter blanked every team).
 */
import { describe, expect, it } from 'vitest'

import { lineupProjectedTotal } from '@/components/leagues/my-team-ops'

import { projectionForTotal } from './use-league-player-values'

describe('projectionForTotal', () => {
  it('a projected player counts his projection, a real 0.00 included', () => {
    expect(projectionForTotal({ projected_points: 12.4, projected_missing: null })).toBe(12.4)
    expect(projectionForTotal({ projected_points: 0, projected_missing: null })).toBe(0)
  })

  it('a player with no line this week (bye, IR, out) counts 0', () => {
    expect(projectionForTotal({ projected_points: null, projected_missing: 'no_line' })).toBe(0)
  })

  it('a stale line or a missing value row (incl. while loading) stays unknown', () => {
    expect(projectionForTotal({ projected_points: null, projected_missing: 'stale_line' })).toBeNull()
    expect(projectionForTotal(undefined)).toBeNull()
  })

  it('a lineup with a bye starter shows a total; one with an unloaded starter shows the dash', () => {
    const values = new Map([
      ['qb', { projected_points: 20.5, projected_missing: null }],
      ['rb', { projected_points: 11, projected_missing: null }],
      ['wr-bye', { projected_points: null, projected_missing: 'no_line' }],
    ])
    const of = (id: string) => projectionForTotal(values.get(id))
    expect(lineupProjectedTotal({ QB: 'qb', RB: 'rb', WR: 'wr-bye' }, [], of)).toBe(31.5)
    expect(lineupProjectedTotal({ QB: 'qb', RB: 'rb', WR: 'unknown' }, [], of)).toBeNull()
  })
})

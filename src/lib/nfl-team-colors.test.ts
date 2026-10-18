/**
 * The NFL team colour table against the design (gap list §4 item 5): every
 * headshot ring, team tile and player header paints a team's `primary`, so
 * the table must match the handoff's team colour map (`TC` in FSHeadshot /
 * "FieldScout Mobile", copied into docs/design/mobile/lr-frame.md and
 * m-players.md). Seattle used to be Action Green (a lime ring); the design
 * draws College Navy.
 */
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { MHeadshot } from '@/components/mobile/ui/m-headshot'

import { getTeamColors, NFL_TEAM_COLORS } from './nfl-team-colors'

/** The handoff's `TC`, verbatim (its WSH alias aside — the app's data says WAS). */
const DESIGN_TC: Record<string, string> = {
  ARI: '#97233F', ATL: '#A71930', BAL: '#241773', BUF: '#00338D',
  CAR: '#0085CA', CHI: '#0B162A', CIN: '#FB4F14', CLE: '#FF3C00',
  DAL: '#003594', DEN: '#FB4F14', DET: '#0076B6', GB: '#203731',
  HOU: '#03202F', IND: '#002C5F', JAX: '#006778', KC: '#E31837',
  LV: '#000000', LAC: '#0080C6', LAR: '#003594', MIA: '#008E97',
  MIN: '#4F2683', NE: '#002244', NO: '#D3BC8D', NYG: '#0B2265',
  NYJ: '#125740', PHI: '#004C54', PIT: '#FFB612', SF: '#AA0000',
  SEA: '#002244', TB: '#D50A0A', TEN: '#4B92DB', WAS: '#5A1414',
}

describe('NFL team colours', () => {
  it('covers the same 32 teams as the design', () => {
    expect(Object.keys(NFL_TEAM_COLORS).sort()).toEqual(Object.keys(DESIGN_TC).sort())
  })

  it("paints every team's ring in the design's colour", () => {
    const primaries = Object.fromEntries(Object.entries(NFL_TEAM_COLORS).map(([team, c]) => [team, c.primary.toUpperCase()]))
    expect(primaries).toEqual(DESIGN_TC)
  })

  it('makes Seattle College Navy, with Action Green kept as its second colour', () => {
    expect(getTeamColors('SEA')).toEqual({ primary: '#002244', secondary: '#69BE28' })
    expect(getTeamColors('sea').primary).toBe('#002244')
  })
})

describe('the headshot ring', () => {
  const ring = (team: string | null) =>
    renderToStaticMarkup(createElement(MHeadshot, { player: { id: 'p1', full_name: 'Test Player', team, position: 'WR' } }))

  it('rings a Seahawk in navy, not lime', () => {
    const html = ring('SEA')
    expect(html).toContain('0 0 0 3px #002244')
    expect(html).not.toContain('#69BE28')
  })

  it('leaves a team the design already matched as it was', () => {
    expect(ring('PIT')).toContain('0 0 0 3px #FFB612')
  })

  it('draws no ring for a free agent', () => {
    expect(ring(null)).not.toContain('0 0 0 3px')
  })
})

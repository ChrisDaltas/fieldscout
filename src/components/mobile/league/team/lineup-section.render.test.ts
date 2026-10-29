/**
 * lineup-section.render.test.ts — the Team view's Starters header (handoff
 * League › Team §2.3 item 4: "Week 5 · Proj {projTotal}") over a real
 * render. One rule for a lineup's projected total on every phone surface —
 * the Match card's (`lineupProjection`): a number only when every filled
 * starter has a projection, else "–" — so the header never reads a partial
 * sum, and never "Proj 0.00" while the projections load, after their read
 * failed, or for an empty lineup (audit match-team-1).
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import type { TeamLineupRow } from '@/hooks/use-lineup'
import type { RosterPlayer } from '@/lib/leagues/api/rosters-service'
import { defaultsForTeamCount } from '@/lib/leagues/settings/league-settings'

import { LineupSection } from './lineup-section'
import type { RowStats } from './lineup-rows'

const settings = defaultsForTeamCount(8).roster_settings

function p(id: string, full_name: string, position: string, nfl_team: string): RosterPlayer {
  return {
    player_id: id,
    full_name,
    position,
    nfl_team,
    status: 'Active',
    bye_week: null,
    slot_key: null,
    acquisition_type: null,
    acquisition_cost: null,
    ir_placed_week: null,
    ir_lock_until_week: null,
    acquired_at: null,
    pool_state: 'rostered',
    game_lock: { state: 'unlocked', until: null },
  }
}

const ROSTER = [p('qb', 'Drake Maye', 'QB', 'NE'), p('rb', 'Christian McCaffrey', 'RB', 'SF'), p('wr', 'Jaxon Smith-Njigba', 'WR', 'SEA')]

const LINEUP: TeamLineupRow = {
  id: 'l1',
  team_id: 'team-them',
  season: 2099,
  week: 5,
  slot_map: { 'qb:0': 'qb', 'rb:0': 'rb', 'wr:0': 'wr' },
  starters: [],
  bench: [],
  locked_at: null,
  edited_by_commish: false,
  set_at: null,
}

const stats = (proj: Record<string, number>): RowStats => ({
  proj: (id) => proj[id] ?? null,
  points: () => null,
  game: () => ({ kind: 'unknown' }),
  oprk: () => null,
  headshot: () => null,
  gameHref: () => null,
})

function header(proj: Record<string, number>, stored: TeamLineupRow | null = LINEUP): string {
  const html = renderToStaticMarkup(
    createElement(
      QueryClientProvider,
      { client: new QueryClient() },
      createElement(LineupSection, {
        variant: 'view',
        leagueId: 'league-1',
        teamId: 'team-them',
        week: 5,
        settings,
        roster: ROSTER,
        stored,
        currentWeek: 5,
        editability: { state: 'open' },
        canEdit: false,
        overrideMode: false,
        isCommish: false,
        onOverrideMode: () => {},
        stats: stats(proj),
        keptName: () => null,
      }),
    ),
  )
  return /data-view-proj="true">([\s\S]*?)<\/span>/.exec(html)?.[1]?.replace(/<!-- -->/g, '') ?? ''
}

describe('Team view header — "Week N · Proj …" (the Match card’s rule)', () => {
  it('every starter projected → the sum, two decimals', () => {
    expect(header({ qb: 18.4, rb: 16.2, wr: 14.9 })).toBe('Week 5 · Proj 49.50')
  })

  it('a starter without a projection → "–", never the partial sum', () => {
    expect(header({ qb: 18.4, rb: 16.2 })).toBe('Week 5 · Proj –')
  })

  it('projections loading or failed (nobody has one yet) → "–", never "0.00"', () => {
    expect(header({})).toBe('Week 5 · Proj –')
  })

  it('an empty lineup → "–", never "0.00"', () => {
    expect(header({ qb: 18.4 }, { ...LINEUP, slot_map: {} })).toBe('Week 5 · Proj –')
    expect(header({ qb: 18.4 }, null)).toBe('Week 5 · Proj –')
  })

  it('a kept (dropped-after-he-played) starter is a filled seat', () => {
    const kept = { ...LINEUP, slot_map: { ...LINEUP.slot_map, 'te:0': 'gone' } }
    expect(header({ qb: 18.4, rb: 16.2, wr: 14.9 }, kept)).toBe('Week 5 · Proj –')
    expect(header({ qb: 18.4, rb: 16.2, wr: 14.9, gone: 3 }, kept)).toBe('Week 5 · Proj 52.50')
  })
})

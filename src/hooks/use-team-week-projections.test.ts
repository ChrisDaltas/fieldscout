/**
 * use-team-week-projections.test.ts — the hook's own pins (PR #588 review,
 * R1807 / R1808; PROGRESS D845, D846). Rendered with `renderToStaticMarkup`
 * over a pre-seeded React Query cache (fetches are effects, so the cache IS
 * the data — the render-test rig the league suites use).
 *
 * R1808: WEEK SEPARATION. One team, two started weeks, a different lineup
 * and different projections in each: each week's lookup returns that week's
 * own total. A week-blind lookup (one map for every week) reds this file.
 * R1807: a week with no unscored team reads nothing — no projections query,
 * no lineup query.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { leaguePlayerValueKeys, type LeaguePlayerValue } from './use-league-player-values'
import { teamLineupKeys, type TeamLineupRow } from './use-lineup'
import { useTeamProjectionsByWeek, useTeamWeekProjections } from './use-team-week-projections'

const LEAGUE = 'league-1'
const SEASON = 2099
const TEAM = 'team-a'
const IR = [{ key: 'ir1' }]

function client(): QueryClient {
  return new QueryClient({ defaultOptions: { queries: { retry: false, retryOnMount: false } } })
}

function lineup(week: number, slot_map: Record<string, string>): TeamLineupRow {
  return { id: `l-${week}`, team_id: TEAM, season: SEASON, week, slot_map, starters: [], bench: [], locked_at: null, edited_by_commish: false, set_at: null }
}

function values(rows: Record<string, number>): LeaguePlayerValue[] {
  return Object.entries(rows).map(([player_id, projected_points]) => ({ player_id, projected_points, projected_missing: null, season_points: null, season_games: 0 }))
}

/** Week 8 (final): QB-A 20 + RB-A 10 (+ IR 99, never counted) = 30.
 *  Week 9 (live): QB-B 25 + RB-B 12.5 = 37.5. The same player ids carry
 *  DIFFERENT projections in the two weeks, so a lookup that read the wrong
 *  week's values or lineup can't land on the right number by accident. */
function seedTwoWeeks(qc: QueryClient) {
  qc.setQueryData(teamLineupKeys.week(TEAM, 8), lineup(8, { 'qb:0': 'qb-a', 'rb:0': 'rb-a', 'ir1:0': 'ir-x' }))
  qc.setQueryData(teamLineupKeys.week(TEAM, 9), lineup(9, { 'qb:0': 'qb-b', 'rb:0': 'rb-b' }))
  qc.setQueryData(leaguePlayerValueKeys.week(LEAGUE, SEASON, 8), values({ 'qb-a': 20, 'rb-a': 10, 'ir-x': 99, 'qb-b': 1, 'rb-b': 1 }))
  qc.setQueryData(leaguePlayerValueKeys.week(LEAGUE, SEASON, 9), values({ 'qb-a': 2, 'rb-a': 2, 'qb-b': 25, 'rb-b': 12.5 }))
}

function ByWeek({ weeks }: { weeks: Array<{ week: number; status: string; teamIds: string[] }> }) {
  const projectedOf = useTeamProjectionsByWeek({ leagueId: LEAGUE, season: SEASON, weeks, irSlots: IR })
  return createElement('p', null, [8, 9, 10].map((w) => `${w}:${projectedOf(w, TEAM)}`).join('|'))
}

function OneWeek({ week, status, teamIds }: { week: number; status: string; teamIds: string[] }) {
  const projectedOf = useTeamWeekProjections({ leagueId: LEAGUE, season: SEASON, week, weekStatus: status, teamIds, irSlots: IR })
  return createElement('p', null, `${projectedOf(TEAM)}`)
}

function render(qc: QueryClient, el: React.ReactElement): string {
  return renderToStaticMarkup(createElement(QueryClientProvider, { client: qc }, el))
}

describe('useTeamProjectionsByWeek — each started week reads its own lineup and projections (R1808)', () => {
  it('two started weeks, the same team: week 8 shows 30, week 9 shows 37.5; a week not asked for is null', () => {
    const qc = client()
    seedTwoWeeks(qc)
    const html = render(
      qc,
      createElement(ByWeek, {
        weeks: [
          { week: 8, status: 'final', teamIds: [TEAM] },
          { week: 9, status: 'live', teamIds: [TEAM] },
        ],
      }),
    )
    expect(html).toBe('<p>8:30|9:37.5|10:null</p>')
  })

  it('the one-week wrapper reads the week it is given', () => {
    const qc = client()
    seedTwoWeeks(qc)
    expect(render(qc, createElement(OneWeek, { week: 8, status: 'correction_window', teamIds: [TEAM] }))).toBe('<p>30</p>')
    expect(render(qc, createElement(OneWeek, { week: 9, status: 'live', teamIds: [TEAM] }))).toBe('<p>37.5</p>')
  })

  it('an upcoming week reads nothing and shows nothing', () => {
    const qc = client()
    seedTwoWeeks(qc)
    expect(render(qc, createElement(OneWeek, { week: 9, status: 'upcoming', teamIds: [TEAM] }))).toBe('<p>null</p>')
  })
})

describe('R1807 — a week with every side scored reads nothing', () => {
  it('no team listed ⇒ no projections query and no lineup query is even created', () => {
    const qc = client()
    render(qc, createElement(OneWeek, { week: 8, status: 'final', teamIds: [] }))
    expect(qc.getQueryCache().findAll({ queryKey: ['league-player-values'] })).toEqual([])
    expect(qc.getQueryCache().getAll()).toEqual([])
  })

  it('one unscored team ⇒ one projections query and exactly that team’s lineup query', () => {
    const qc = client()
    render(qc, createElement(OneWeek, { week: 8, status: 'final', teamIds: [TEAM] }))
    expect(qc.getQueryCache().findAll({ queryKey: ['league-player-values'] })).toHaveLength(1)
    expect(qc.getQueryCache().getAll()).toHaveLength(2)
  })
})

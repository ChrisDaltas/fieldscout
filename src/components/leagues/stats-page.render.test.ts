/**
 * League Stats (League UX batch 5) — the head-to-head math over stored
 * results, and the page over real renders (the matchup-view rig: the React
 * Query cache pre-seeded, `useAuth` / the league room mocked at the edge).
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

import type { LeagueDetail } from '@/hooks/use-league'
import { leaguesKeys } from '@/hooks/use-leagues'
import { scheduleKeys, type LeagueSchedule } from '@/hooks/use-schedule'
import { defaultsForTeamCount } from '@/lib/leagues/settings/league-settings'

import { StatsPage } from './stats-page'
import { NO_GAMES_COPY, TOTAL_POINTS_COPY, headToHead, overall, recordText } from './stats-page-ops'
import { NAMES, SCHEDULE, matchup } from './standings-schedule.fixtures'

vi.mock('@/hooks/use-auth', () => ({
  useAuth: () => ({ user: { id: 'user-me' }, profile: { username: 'me' } }),
}))
vi.mock('@/hooks/use-league-channel', () => ({
  useLeagueChannel: vi.fn(() => ({ connection: 'live' })),
}))

describe('headToHead — stored results only, never a partial sum', () => {
  it('counts only games with a stored result; a live or upcoming game is not counted', () => {
    // SCHEDULE: week 1 final (t1 beat t2 120.5–99; t3/t4 tied 80–80, overridden), week 2 live, week 3 upcoming.
    const t1 = headToHead(SCHEDULE.matchups, 't1', NAMES)
    expect(t1).toEqual([{ opponentId: 't2', opponentName: 'Bravo', wins: 1, losses: 0, ties: 0, games: 1, pointsFor: 120.5, pointsAgainst: 99 }])
    expect(headToHead(SCHEDULE.matchups, 't2', NAMES)[0]).toMatchObject({ wins: 0, losses: 1, pointsFor: 99, pointsAgainst: 120.5 })
    expect(recordText(headToHead(SCHEDULE.matchups, 't3', NAMES)[0])).toBe('0–0–1')
  })

  it('sums across games and rounds; a counted game with no stored score makes the total “—”, not a partial', () => {
    const games = [
      matchup({ id: 'a', week: 1, home_team_id: 't1', away_team_id: 't2', home_score: 100.1, away_score: 90.2, result: 'home' }),
      matchup({ id: 'b', week: 5, home_team_id: 't2', away_team_id: 't1', home_score: 110, away_score: 95.35, result: 'home' }),
      matchup({ id: 'c', week: 9, home_team_id: 't1', away_team_id: 't2', round_type: 'playoff', home_score: 88, away_score: 80, result: 'home' }),
      matchup({ id: 'd', week: 2, home_team_id: 't1', away_team_id: 't3', home_score: null, away_score: null, result: 'away', is_overridden: true }),
    ]
    const rows = headToHead(games, 't1', NAMES)
    expect(rows.map((r) => [r.opponentName, recordText(r), r.pointsFor, r.pointsAgainst])).toEqual([
      ['Bravo', '2–1', 283.45, 280.2],
      ['Charlie', '0–1', null, null],
    ])
    expect(overall(rows)).toEqual({ wins: 2, losses: 2, ties: 0, games: 4, pointsFor: null, pointsAgainst: null })
  })
})

// ---------------------------------------------------------------------------
// The page
// ---------------------------------------------------------------------------

const LEAGUE = 'league-1'

function detailWith(over: Partial<LeagueDetail['settings']> = {}): LeagueDetail {
  return {
    league: { id: LEAGUE, name: 'Stats League', avatar_url: null, description: null, season: 2099, status: 'in_season', owner_id: 'user-me', scoring_system_id: null, invite_code: null, invite_slug: null, max_teams: 4, created_at: null, updated_at: null, champion_team_id: null },
    settings: { ...defaultsForTeamCount(8), ...over },
    members: [{ id: 'm1', user_id: 'user-me', team_id: 't1', role: 'manager', is_placeholder: false, is_autodraft: false, joined_at: null, profiles: null }],
    teams: [...NAMES.entries()].map(([id, name]) => ({ id, name, owner_id: 'user-me', status: 'active', created_at: null })),
    my_role: 'manager',
    active_draft: null,
  } as LeagueDetail
}

function render(detail: LeagueDetail, schedule: LeagueSchedule): string {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, retryOnMount: false } } })
  qc.setQueryData(leaguesKeys.detail(LEAGUE), detail)
  qc.setQueryData(scheduleKeys.all(LEAGUE), schedule)
  return renderToStaticMarkup(createElement(QueryClientProvider, { client: qc }, createElement(StatsPage, { leagueId: LEAGUE })))
    .replace(/&#x27;/g, "'")
    .replace(/&amp;/g, '&')
}

describe('the Stats page', () => {
  it('opens on the viewer’s team: one row per opponent played, the record and the stored points, an all-opponents line', () => {
    const html = render(detailWith(), SCHEDULE)
    expect(html).toContain('data-h2h="t1"')
    expect(html).toContain('data-h2h-row="t2"')
    expect(html).not.toContain('data-h2h-row="t3"')
    expect(html).toMatch(/data-h2h-record="[^"]*">1–0</)
    expect(html).toContain('>120.50<')
    expect(html).toContain('>99.00<')
    expect(html).toContain('data-h2h-total')
    // The opponent is a door to his team page.
    expect(html).toContain('href="/app/leagues/league-1/team/t2"')
    // And Standings is one tap away.
    expect(html).toContain('href="/app/leagues/league-1/standings"')
  })

  it('before any game is scored: says so — never an empty table or 0–0 rows', () => {
    const fresh = { ...SCHEDULE, matchups: SCHEDULE.matchups.map((m) => ({ ...m, result: null, home_score: null, away_score: null })) }
    const html = render(detailWith(), fresh)
    expect(html).toContain(NO_GAMES_COPY)
    expect(html).not.toContain('data-h2h-row')
  })

  it('a total-points league has no head-to-head — the page says so', () => {
    const html = render(detailWith({ schedule_mode: 'total_points', playoff_teams: 0 }), SCHEDULE)
    expect(html).toContain(TOTAL_POINTS_COPY)
    expect(html).not.toContain('data-h2h=')
  })
})

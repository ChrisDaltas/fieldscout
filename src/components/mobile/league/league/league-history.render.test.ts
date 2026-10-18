/**
 * League Menu › League history on the phone (gap list §3 #16; handoff
 * m-community G4): the season chip, the team's Record / Points for / Points
 * against cards and its head-to-head against every other team — rendered
 * from seeded queries (`renderToStaticMarkup`; effects don't run), the same
 * reads as the desktop Stats page (`useLeague` → `useScheduleLive`).
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { matchup } from '@/components/leagues/standings-schedule.fixtures'
import { NO_GAMES_COPY, SEASON_ONLY_COPY, TOTAL_POINTS_COPY } from '@/components/leagues/stats-page-ops'
import type { LeagueDetail } from '@/hooks/use-league'
import { leaguesKeys } from '@/hooks/use-leagues'
import { scheduleKeys, type LeagueSchedule } from '@/hooks/use-schedule'
import { defaultsForTeamCount } from '@/lib/leagues/settings/league-settings'

import { MobileLeagueHistory } from './league-history-screen'

const search = { value: '' }
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), back: vi.fn(), replace: vi.fn() }),
  usePathname: () => '/app/leagues/league-1/stats',
  useSearchParams: () => new URLSearchParams(search.value),
}))
vi.mock('@/hooks/use-auth', () => ({
  useAuth: () => ({ user: { id: 'user-me' }, profile: { username: 'dalton' }, isLoading: false }),
}))
vi.mock('@/hooks/use-league-channel', () => ({
  useLeagueChannel: vi.fn(() => ({ connection: 'live' })),
}))

const LEAGUE = 'league-1'
const ME = 'team-me'
const T2 = 'team-2'
const T3 = 'team-3'
const T4 = 'team-4'

function detailWith(over: Partial<LeagueDetail['settings']> = {}, members?: LeagueDetail['members']): LeagueDetail {
  return {
    league: {
      id: LEAGUE,
      name: 'Sunday Funday League',
      avatar_url: null,
      description: null,
      season: 2099,
      status: 'in_season',
      owner_id: 'user-them',
      scoring_system_id: null,
      invite_code: null,
      invite_slug: null,
      max_teams: 4,
      created_at: null,
      updated_at: null,
      champion_team_id: null,
    },
    settings: { ...defaultsForTeamCount(8), ...over },
    members: members ?? [
      { id: 'm1', user_id: 'user-me', team_id: ME, role: 'manager', is_placeholder: false, is_autodraft: false, joined_at: null, profiles: { username: 'dalton', avatar_url: null } },
      { id: 'm2', user_id: 'user-2', team_id: T2, role: 'manager', is_placeholder: false, is_autodraft: false, joined_at: null, profiles: { username: 'marcus', avatar_url: null } },
    ],
    // League order: Gurus, then yours, then Elite, then Lions.
    teams: [
      { id: T2, name: 'Gridiron Gurus', owner_id: 'user-2', status: 'active', created_at: '2099-01-01T00:00:00Z' },
      { id: ME, name: 'Touchdown Tacos', owner_id: 'user-me', status: 'active', created_at: '2099-01-02T00:00:00Z' },
      { id: T3, name: 'End Zone Elite', owner_id: 'user-3', status: 'active', created_at: '2099-01-03T00:00:00Z' },
      { id: T4, name: 'Leo’s Lions', owner_id: 'user-4', status: 'active', created_at: '2099-01-04T00:00:00Z' },
    ],
    my_role: 'manager',
    active_draft: null,
  }
}

const SCHEDULE: LeagueSchedule = {
  weeks: [],
  matchups: [
    // You beat the Gurus, lost to Elite, then beat the Gurus again.
    matchup({ id: 'a', week: 1, home_team_id: ME, away_team_id: T2, status: 'final', home_score: 120.25, away_score: 99.5, result: 'home' }),
    matchup({ id: 'b', week: 2, home_team_id: T3, away_team_id: ME, status: 'final', home_score: 130.4, away_score: 101.36, result: 'home' }),
    matchup({ id: 'c', week: 3, home_team_id: T2, away_team_id: ME, status: 'final', home_score: 90, away_score: 95.45, result: 'away' }),
    // The Lions game is still being played: no result yet.
    matchup({ id: 'd', week: 4, home_team_id: ME, away_team_id: T4, status: 'live', home_score: 50, away_score: 61, result: null }),
    // Elite beat the Gurus.
    matchup({ id: 'e', week: 1, home_team_id: T3, away_team_id: T4, status: 'final', home_score: 111, away_score: 100, result: 'home' }),
  ],
  median_results: [],
}

const unescape = (html: string) => html.replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, '&')

function render(detail: LeagueDetail, schedule: LeagueSchedule | 'error'): string {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, retryOnMount: false } } })
  qc.setQueryData(leaguesKeys.detail(LEAGUE), detail)
  if (schedule === 'error') {
    const query = qc.getQueryCache().build(qc, { queryKey: scheduleKeys.all(LEAGUE) })
    query.setState({ status: 'error', error: new Error('boom'), fetchStatus: 'idle', data: undefined, dataUpdatedAt: 0 })
  } else qc.setQueryData(scheduleKeys.all(LEAGUE), schedule)
  return unescape(renderToStaticMarkup(createElement(QueryClientProvider, { client: qc }, createElement(MobileLeagueHistory, { leagueId: LEAGUE }))))
}

/** The head-to-head rows, in order, as [team, W-L, PF, PA]. */
function rowsOf(html: string): Array<[string, string, string, string]> {
  return [...html.matchAll(/data-h2h-row="[^"]+">(.*?)<\/li>/g)].map((m) => {
    const name = /text-\[13px\] font-semibold text-m-t1">([^<]+)</.exec(m[1])?.[1] ?? ''
    const rec = /data-h2h-record="[^"]*">([^<]+)</.exec(m[1])?.[1] ?? ''
    const pf = /data-h2h-pf="[^"]*">([^<]+)</.exec(m[1])?.[1] ?? ''
    const pa = /data-h2h-pa="[^"]*">([^<]+)</.exec(m[1])?.[1] ?? ''
    return [name, rec, pf, pa]
  })
}

function kpi(html: string, label: string): string[] {
  const m = new RegExp(`data-history-kpi="${label}">(.*?)</div>`).exec(html)
  return m ? [...m[1].matchAll(/>([^<>]+)</g)].map((t) => t[1]) : []
}

beforeEach(() => {
  search.value = ''
})

describe('the League history screen', () => {
  it('draws the handoff’s page: blue Back, "League history", the season chip on', () => {
    const html = render(detailWith(), SCHEDULE)
    expect(html).toMatch(/<button[^>]*aria-label="Back"[^>]*class="[^"]*text-accent[^"]*"[^>]*data-league-page-back/)
    expect(html).toContain('>League history</h1>')
    expect(html).toMatch(/data-history-seasons="true">.*?aria-pressed="true" class="[^"]*bg-m-ink text-white[^"]*">2099</)
  })

  it('opens on your team: Record, Points for and Points against from the stored results', () => {
    const html = render(detailWith(), SCHEDULE)
    expect(kpi(html, 'Record')).toEqual(['Record', '2-1', '2099 season'])
    expect(kpi(html, 'Points for')).toEqual(['Points for', '317.1', '105.7 per game'])
    expect(kpi(html, 'Points against')).toEqual(['Points against', '319.9', '106.6 per game'])
    // The design's Start/sit accuracy needs data the app doesn't keep.
    expect(html).not.toContain('Start/sit')
    expect(html).toContain(SEASON_ONLY_COPY)
  })

  it('lists every other team in league order — one not played yet reads 0-0 — with the record coloured by who leads', () => {
    const html = render(detailWith(), SCHEDULE)
    expect(html).toContain('>Head to head</h2>')
    expect(html).toMatch(/<span>Opponent<\/span><span class="text-right">W-L<\/span><span class="text-right">PF<\/span><span class="text-right">PA<\/span>/)
    expect(rowsOf(html)).toEqual([
      ['Gridiron Gurus', '2-0', '215.7', '189.5'],
      ['End Zone Elite', '0-1', '101.4', '130.4'],
      // The live game isn't a result.
      ['Leo’s Lions', '0-0', '—', '—'],
    ])
    expect(html).toMatch(/data-h2h-row="team-2">.*?text-m-green" data-h2h-record/)
    expect(html).toMatch(/data-h2h-row="team-3">.*?text-m-red" data-h2h-record/)
    expect(html).toMatch(/data-h2h-row="team-4">.*?text-m-t1" data-h2h-record/)
  })

  it('each row opens that team; its @manager opens their profile, and an unseated team says so', () => {
    const html = render(detailWith(), SCHEDULE)
    expect(html).toMatch(/data-h2h-row="team-2"><a [^>]*href="\/app\/leagues\/league-1\/team\/team-2"/)
    expect(html).toMatch(/data-h2h-row="team-2">.*?data-username-link="marcus"[^>]*>@marcus</)
    expect(html).toMatch(/data-h2h-row="team-3">.*?>No manager</)
  })

  it('has a chip for every team — yours first and in blue — to open another team’s history', () => {
    const html = render(detailWith(), SCHEDULE)
    const chips = [...html.matchAll(/<button[^>]*aria-pressed="(true|false)"([^>]*)><span class="truncate">([^<]+)<\/span><\/button>/g)].map((m) => [
      m[3],
      m[1],
      /data-mine/.test(m[2]),
    ])
    expect(chips).toEqual([
      ['Touchdown Tacos', 'true', true],
      ['Gridiron Gurus', 'false', false],
      ['End Zone Elite', 'false', false],
      ['Leo’s Lions', 'false', false],
    ])
  })

  it('?team= opens that team’s history, where your team is a row in blue', () => {
    search.value = 'team=team-3'
    const html = render(detailWith(), SCHEDULE)
    expect(html).toMatch(/aria-pressed="true"[^>]*><span class="truncate">End Zone Elite</)
    expect(kpi(html, 'Record')[1]).toBe('2-0')
    expect(rowsOf(html)).toEqual([
      ['Gridiron Gurus', '0-0', '—', '—'],
      ['Touchdown Tacos', '1-0', '130.4', '101.4'],
      ['Leo’s Lions', '1-0', '111.0', '100.0'],
    ])
    expect(html).toMatch(/data-h2h-row="team-me">.*?data-team-avatar="team-me"/)
    expect(html).toMatch(/class="[^"]*bg-accent[^"]*"[^>]*data-team-avatar="team-me"/)
  })

  it('a viewer with no team opens the first team in league order', () => {
    const html = render(detailWith({}, []), SCHEDULE)
    expect(html).toMatch(/aria-pressed="true"[^>]*><span class="truncate">Gridiron Gurus</)
    expect(html).not.toContain('data-mine')
  })

  it('before any game has a result: says so — no cards, no 0-0 table', () => {
    const fresh = { ...SCHEDULE, matchups: SCHEDULE.matchups.map((m) => ({ ...m, status: 'scheduled', result: null, home_score: null, away_score: null })) }
    const html = render(detailWith(), fresh)
    expect(html).toContain(NO_GAMES_COPY)
    expect(html).not.toContain('data-history-kpis')
    expect(html).not.toContain('data-h2h-row')
  })

  it('a total-points league has no head-to-head — the page says so', () => {
    const html = render(detailWith({ schedule_mode: 'total_points', playoff_teams: 0 }), SCHEDULE)
    expect(html).toContain(TOTAL_POINTS_COPY)
    expect(html).not.toContain('data-history-teams')
    expect(html).not.toContain('data-h2h-row')
  })

  it('a failed read says so with Try again — never an empty history', () => {
    const html = render(detailWith(), 'error')
    expect(html).toMatch(/role="alert".*Couldn’t load the results\..*Try again/)
    expect(html).not.toContain(NO_GAMES_COPY)
  })
})

/**
 * League Menu › Schedule on the phone (gap list §4 item 107) — rendered from
 * seeded queries (`renderToStaticMarkup`; effects don't run), the same reads
 * as desktop's `ScheduleView` (`useLeague` → `useScheduleLive`). The fixture
 * season: weeks 1–3 regular, week 4 a playoff week with no rows yet; week 1
 * final (a win, an adjusted tie, the median), week 2 live (one open score),
 * week 3 upcoming with two second-opponent games.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { commishMatchupHref } from '@/components/leagues/activity-page-ops'
import { NO_LADDER_COPY } from '@/components/leagues/league-home-season-ops'
import { OVERRIDDEN_LABEL, PLAYOFF_ROUND_PENDING_COPY } from '@/components/leagues/matchup-view-ops'
import { REASON_HINT_COPY, scheduleConsoleHref } from '@/components/leagues/schedule-view-ops'
import { NAMES, SCHEDULE } from '@/components/leagues/standings-schedule.fixtures'
import { STALE_LEAGUE_COPY } from '@/components/leagues/status-banners'
import type { LeagueDetail } from '@/hooks/use-league'
import { useLeagueChannel } from '@/hooks/use-league-channel'
import { leaguesKeys } from '@/hooks/use-leagues'
import { scheduleKeys, type LeagueSchedule } from '@/hooks/use-schedule'
import { defaultsForTeamCount } from '@/lib/leagues/settings/league-settings'

import { SCHEDULE_DOOR_NOTE, SCHEDULE_DOOR_TITLE, TOTAL_POINTS_SCHEDULE_COPY } from './schedule-ops'
import { MobileSchedule } from './schedule-screen'

const search = { value: '' }
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), back: vi.fn(), replace: vi.fn() }),
  usePathname: () => '/app/leagues/league-1/schedule',
  useSearchParams: () => new URLSearchParams(search.value),
}))
vi.mock('@/hooks/use-auth', () => ({
  useAuth: () => ({ user: { id: 'user-me' }, profile: { username: 'dalton' }, isLoading: false }),
}))
vi.mock('@/hooks/use-league-channel', () => ({
  useLeagueChannel: vi.fn(() => ({ connection: 'live' })),
}))

const LEAGUE = 'league-1'

function detailWith(over: { role?: LeagueDetail['my_role']; settings?: Partial<LeagueDetail['settings']> } = {}): LeagueDetail {
  const team = (id: string, i: number) => ({ id, name: NAMES.get(id)!, owner_id: `user-${id}`, status: 'active', created_at: `2099-01-0${i + 1}T00:00:00Z` })
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
    settings: { ...defaultsForTeamCount(8), regular_season_weeks: 3, ...over.settings },
    members: [
      // You manage Charlie — the third team in league order.
      { id: 'm1', user_id: 'user-me', team_id: 't3', role: 'manager', is_placeholder: false, is_autodraft: false, joined_at: null, profiles: { username: 'dalton', avatar_url: null } },
    ],
    teams: ['t1', 't2', 't3', 't4'].map(team),
    my_role: over.role ?? 'manager',
    active_draft: null,
  }
}

const unescape = (html: string) => html.replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, '&')

function render(detail: LeagueDetail, schedule: LeagueSchedule | 'error' | { stale: LeagueSchedule }): string {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, retryOnMount: false } } })
  qc.setQueryData(leaguesKeys.detail(LEAGUE), detail)
  if (schedule === 'error' || 'stale' in schedule) {
    const query = qc.getQueryCache().build(qc, { queryKey: scheduleKeys.all(LEAGUE) })
    const data = schedule === 'error' ? undefined : schedule.stale
    query.setState({ status: 'error', error: new Error('boom'), fetchStatus: 'idle', data, dataUpdatedAt: data ? 1 : 0 })
  } else qc.setQueryData(scheduleKeys.all(LEAGUE), schedule)
  return unescape(renderToStaticMarkup(createElement(QueryClientProvider, { client: qc }, createElement(MobileSchedule, { leagueId: LEAGUE }))))
}

/** One week's card markup. */
function weekCard(html: string, week: number): string {
  return new RegExp(`<section aria-label="Week ${week}"[^>]*>(.*?)</section>`).exec(html)?.[1] ?? ''
}

/** A game row's lines as [name, score] pairs, top first. */
function rowSides(html: string, id: string): Array<[string, string]> {
  const li = new RegExp(`<li[^>]*data-matchup="${id}"[^>]*>(.*?)</li>`).exec(html)?.[1] ?? ''
  return [...li.matchAll(/truncate text-\[14px\][^"]*">([^<]+)<\/span><span[^>]*data-score="true">([^<]+)</g)].map((m) => [m[1]!, m[2]!])
}

beforeEach(() => {
  search.value = ''
  vi.mocked(useLeagueChannel).mockReturnValue({ connection: 'live', degraded: false })
})

/** The sticky header's markup (bar, chips, status lines) — everything
 *  before the scrolling list. */
function stickyHeader(html: string): string {
  return /<div class="sticky top-0[^"]*">(.*?)<div[^>]*data-schedule-screen/.exec(html)?.[1] ?? ''
}

/** The scrolling list's markup. */
function list(html: string): string {
  return html.slice(html.indexOf('data-schedule-screen'))
}

describe('the Schedule screen', () => {
  it('is a phone page: blue Back and the "Schedule" title', () => {
    const html = render(detailWith(), SCHEDULE)
    expect(html).toMatch(/<button[^>]*aria-label="Back"[^>]*class="[^"]*text-accent[^"]*"[^>]*data-page-back/)
    expect(html).toContain('>Schedule</h1>')
    expect(html).toContain('data-schedule-screen')
  })

  it('offers a chip per team under the bar: All teams on, yours first and blue', () => {
    const html = render(detailWith(), SCHEDULE)
    const chips = /data-schedule-teams="true">(.*?)<\/div>/.exec(html)?.[1] ?? ''
    expect([...chips.matchAll(/<button[^>]*>(?:<span[^>]*>)?([^<]+)</g)].map((m) => m[1])).toEqual(['All teams', 'Charlie', 'Alpha', 'Bravo', 'Delta'])
    expect(chips).toMatch(/aria-pressed="true"[^>]*>All teams</)
    expect(chips).toMatch(/aria-pressed="false" data-mine="true" class="[^"]*text-accent/)
  })

  it('draws a card per week: its status, the median, Current and Playoffs tags', () => {
    const html = render(detailWith(), SCHEDULE)
    expect([...html.matchAll(/<section aria-label="Week (\d+)"/g)].map((m) => m[1])).toEqual(['1', '2', '3', '4'])
    expect(weekCard(html, 1)).toContain('data-week-badge="final"')
    expect(weekCard(html, 1)).toMatch(/League median <span[^>]*>101\.50</)
    expect(weekCard(html, 2)).toContain('data-week-badge="live"')
    expect(weekCard(html, 2)).toContain('>Current</span>')
    expect(weekCard(html, 1)).not.toContain('>Current</span>')
    expect(weekCard(html, 4)).toContain('>Playoffs</span>')
    expect(weekCard(html, 4)).toContain(PLAYOFF_ROUND_PENDING_COPY)
    expect(html).toContain('4 weeks · 3 regular season · 1 playoff')
  })

  it('shows each game’s stored scores, your game first with you on top — drawn like the rest, no tint', () => {
    const html = render(detailWith(), SCHEDULE)
    // Week 1: your game (Charlie's adjusted tie) leads, then Alpha's win.
    const w1 = weekCard(html, 1)
    expect([...w1.matchAll(/data-matchup="([^"]+)"/g)].map((m) => m[1])).toEqual(['m2', 'm1'])
    expect(rowSides(html, 'm2')).toEqual([
      ['Charlie', '80.00'],
      ['Delta', '80.00'],
    ])
    // The handoff draws no "you" tint (m-league §2.2, §2.3): your game's row
    // has exactly the classes of every other row.
    expect(w1).toMatch(/<li class="relative flex flex-col gap-0\.5 px-3\.5 py-2" data-matchup="m2" data-mine="true"/)
    expect(w1).toMatch(/<li class="relative flex flex-col gap-0\.5 px-3\.5 py-2" data-matchup="m1"/)
    expect(html).not.toMatch(/\bbg-m-gb2?\b/)
    // The loser's score is greyed; the winner's is not.
    expect(rowSides(html, 'm1')).toEqual([
      ['Alpha', '120.50'],
      ['Bravo', '99.00'],
    ])
    expect(w1).toMatch(/text-m-t1" data-score="true">120\.50/)
    expect(w1).toMatch(/text-m-t3"[^>]*data-score="true">99\.00/)
    // Live: an open score is "pending"; upcoming: a dash.
    expect(rowSides(html, 'm3')).toEqual([
      ['Charlie', 'pending'],
      ['Alpha', '40.25'],
    ])
    expect(rowSides(html, 'm5')).toEqual([
      ['Alpha', '—'],
      ['Delta', '—'],
    ])
  })

  it('a game opens on the Match tab; a tie and an adjusted game say so, the ✸ opening the commissioner log', () => {
    const html = render(detailWith(), SCHEDULE)
    expect(html).toMatch(/<a aria-label="Week 1: Alpha vs Bravo" class="absolute inset-0[^"]*" data-matchup-door="true" href="\/app\/leagues\/league-1\/matchup\/m1">/)
    const tie = /<li[^>]*data-matchup="m2"[^>]*>(.*?)<\/li>/.exec(html)?.[1] ?? ''
    expect(tie).toContain('>Tie</span>')
    expect(tie).toContain(`href="${commishMatchupHref(LEAGUE, 1, 't3')}"`)
    expect(tie).toContain(`>${OVERRIDDEN_LABEL}</a>`)
    // The ✸ sits above the row's own door.
    expect(tie).toMatch(/class="relative z-\[1\][^"]*"[^>]*data-overridden/)
  })

  it('second-opponent games sit in their own group, each side a door to that team', () => {
    const html = render(detailWith(), SCHEDULE)
    const group = /data-second-opponents="true">(.*?)<\/ul><\/div>/.exec(weekCard(html, 3))?.[1] ?? ''
    expect(group).toContain('Second opponents')
    expect([...group.matchAll(/data-matchup="([^"]+)"/g)].map((m) => m[1])).toEqual(['m8', 'm7'])
    expect(group).not.toContain('data-matchup-door')
    expect(group).toContain('data-team-door="true" href="/app/leagues/league-1/team/t1"')
    expect(group).toContain('data-team-door="true" href="/app/leagues/league-1/team/t3"')
  })

  it('a team’s chip (?team=) keeps only its games, the team on top', () => {
    search.value = '?team=t2'
    const html = render(detailWith(), SCHEDULE)
    expect(html).toMatch(/aria-pressed="true"[^>]*><span class="truncate">Bravo</)
    expect([...html.matchAll(/data-matchup="([^"]+)"/g)].map((m) => m[1])).toEqual(['m1', 'm4', 'm6', 'm7'])
    expect(rowSides(html, 'm1')).toEqual([
      ['Bravo', '99.00'],
      ['Alpha', '120.50'],
    ])
    // Only their game against you (Charlie) is marked yours.
    expect([...html.matchAll(/data-matchup="([^"]+)" data-mine="true"/g)].map((m) => m[1])).toEqual(['m6'])
  })

  it('an address naming no team of this league shows every team', () => {
    search.value = '?team=elsewhere'
    const html = render(detailWith(), SCHEDULE)
    expect(html).toMatch(/aria-pressed="true"[^>]*>All teams</)
    expect([...html.matchAll(/data-matchup="/g)]).toHaveLength(8)
  })

  it('a commissioner gets one door to the console’s Schedule section, with the started-season hint', () => {
    const commish = render(detailWith({ role: 'commissioner' }), SCHEDULE)
    expect(commish).toContain(`href="${scheduleConsoleHref(LEAGUE)}"`)
    expect(commish).toContain(SCHEDULE_DOOR_TITLE)
    expect(commish).toContain(REASON_HINT_COPY)
    const before = render(detailWith({ role: 'co_commissioner' }), { ...SCHEDULE, weeks: SCHEDULE.weeks.map((w) => ({ ...w, status: 'upcoming' })) })
    expect(before).toContain(SCHEDULE_DOOR_NOTE)
    expect(before).not.toContain(REASON_HINT_COPY)
    // A manager sees no commissioner control.
    const member = render(detailWith(), SCHEDULE)
    expect(member).not.toContain('data-schedule-commish')
    expect(member).not.toContain(SCHEDULE_DOOR_TITLE)
  })

  it('before the draft says there is no schedule yet — no chips, no cards, no door to change it', () => {
    const html = render(detailWith({ role: 'commissioner' }), { weeks: [], matchups: [], median_results: [] })
    expect(html).toContain(NO_LADDER_COPY)
    expect(html).not.toContain('data-schedule-teams')
    expect(html).not.toContain('<section')
    expect(html).not.toContain('data-schedule-commish')
  })

  it('a total-points league says once that it has no matchups, and lists its weeks', () => {
    const html = render(detailWith({ settings: { schedule_mode: 'total_points' } }), { ...SCHEDULE, matchups: [] })
    expect(html).toContain(TOTAL_POINTS_SCHEDULE_COPY)
    expect(html.split(TOTAL_POINTS_SCHEDULE_COPY)).toHaveLength(2)
    expect(html).not.toContain('data-schedule-teams')
    expect([...html.matchAll(/<section aria-label="Week/g)]).toHaveLength(4)
    expect(html).not.toContain('data-week-note')
  })

  it('a failed read says so with Try again — never an empty season', () => {
    const html = render(detailWith(), 'error')
    expect(html).toMatch(/role="alert"[^>]*>.*Couldn’t load the schedule\..*Try again/)
    expect(html).not.toContain(NO_LADDER_COPY)
  })

  it('a failed refetch keeps the cards on screen behind the not-refreshing line', () => {
    const html = render(detailWith(), { stale: SCHEDULE })
    expect(html).toContain(STALE_LEAGUE_COPY)
    expect([...html.matchAll(/<section aria-label="Week/g)]).toHaveLength(4)
  })

  it('the reconnecting and not-refreshing lines sit in the sticky header under the chips — in view at the current week, not atop the list', () => {
    vi.mocked(useLeagueChannel).mockReturnValue({ connection: 'reconnecting', degraded: false })
    const html = render(detailWith({ role: 'commissioner' }), { stale: SCHEDULE })
    const header = stickyHeader(html)
    const status = /data-schedule-status="true">(.*?)<\/div>/.exec(header)?.[1] ?? ''
    expect(status).toContain('Reconnecting — syncing this league…')
    expect(status).toContain(STALE_LEAGUE_COPY)
    // Under the chip row, not above it.
    expect(header.indexOf('data-schedule-teams')).toBeGreaterThan(-1)
    expect(header.indexOf('data-schedule-status')).toBeGreaterThan(header.indexOf('data-schedule-teams'))
    // Not in the scrolling list (which leads with the commissioner door).
    expect(list(html)).not.toContain('Reconnecting')
    expect(list(html)).not.toContain(STALE_LEAGUE_COPY)
    // The list opts out of scroll anchoring, so a line appearing pushes the
    // cards down with the header instead of the header sliding over the
    // current week's title.
    expect(html).toMatch(/class="[^"]*\[overflow-anchor:none\][^"]*" data-schedule-screen/)
    // A healthy page shows neither.
    vi.mocked(useLeagueChannel).mockReturnValue({ connection: 'live', degraded: false })
    expect(render(detailWith(), SCHEDULE)).not.toContain('data-schedule-status')
  })

  it('rests flat: no shadow anywhere on the page', () => {
    const html = render(detailWith({ role: 'commissioner' }), SCHEDULE)
    expect(html).not.toMatch(/\bshadow-/)
  })
})

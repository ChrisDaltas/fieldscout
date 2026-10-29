/**
 * trades-mobile.render.test.ts — the mobile Team view, Trade offer and trade
 * builder over REAL renders (the static-render rig: the React Query cache is
 * the data). The full-screen overlay frame portals after mount, which a
 * static render never reaches, so it is rendered inline here; everything
 * inside it is the real component. Pins the handoff's copy and structure
 * (m-team.md §2.3–2.6) on the app's trade reads and rules.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createElement, Fragment, type ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

import { auctionPoolKeys } from '@/hooks/use-draft-pool'
import type { LeagueDetail } from '@/hooks/use-league'
import { leaguesKeys, type MyLeagueRow } from '@/hooks/use-leagues'
import { teamLineupKeys } from '@/hooks/use-lineup'
import { leagueRosterKeys } from '@/hooks/use-rosters'
import { scheduleKeys, type LeagueSchedule } from '@/hooks/use-schedule'
import { leagueStandingsKeys } from '@/hooks/use-standings'
import { tradeDeadlineKeys } from '@/hooks/use-trade-deadline'
import { tradeKeys } from '@/hooks/use-trades'
import type { LeagueRosters, RosterPlayer } from '@/lib/leagues/api/rosters-service'
import type { LeagueStandings } from '@/lib/leagues/api/standings-service'
import type { TradeView, TradesDocument } from '@/lib/leagues/api/trades-service'
import { defaultsForTeamCount } from '@/lib/leagues/settings/league-settings'

import { DEADLINE_PASSED_TITLE, NOT_IN_SEASON_TRADE_COPY, TRADES_AFTER_SEASON_COPY, tradesClosedReason } from '@/components/leagues/trades-ops'
import { TeamView } from '@/components/mobile/league/team/team-view'

import { TradeBuilderOverlay } from './trade-builder-overlay'
import { TradeDetailOverlay } from './trade-detail-overlay'

vi.mock('@/hooks/use-auth', () => ({
  useAuth: () => ({ user: { id: 'user-me' }, profile: { username: 'dalton' }, isLoading: false }),
}))
vi.mock('@/hooks/use-league-channel', () => ({
  useLeagueChannel: vi.fn(() => ({ connection: 'live' })),
}))
// Who's online (gap list §3 #25): the presence store is filled by the
// session's PresenceHost over a live socket, which a static render never has —
// so the read is stubbed with a set the test controls; the team lookup is the
// real one.
const presence = vi.hoisted(() => ({ online: new Set<string>() }))
vi.mock('@/hooks/use-online', async (importActual) => {
  const actual = await importActual<typeof import('@/hooks/use-online')>()
  return {
    ...actual,
    useIsOnline: (id: string | null | undefined) => !!id && presence.online.has(id),
    useOnlineUserIds: () => presence.online,
    useTeamOnline: (members: Parameters<typeof actual.teamOnlineLookup>[0] | null | undefined) =>
      actual.teamOnlineLookup(members ?? [], presence.online),
  }
})
vi.mock('next/navigation', () => ({
  useRouter: () => ({ back: vi.fn(), push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => '/app/leagues/league-1/team/x',
}))
// The words a tap on a dimmed Propose trade toasts: a static render never
// clicks, so the real helper is wrapped to read what the view asked it.
vi.mock('@/components/leagues/trades-ops', async (importActual) => {
  const actual = await importActual<typeof import('@/components/leagues/trades-ops')>()
  return { ...actual, tradesClosedReason: vi.fn(actual.tradesClosedReason) }
})
vi.mock('./m-overlay', async (importActual) => {
  const actual = await importActual<typeof import('./m-overlay')>()
  return {
    ...actual,
    MOverlay: ({ children, label }: { children: ReactNode; label: string }) => createElement('div', { 'data-m-overlay': label }, children),
  }
})

const LEAGUE = 'league-1'
const ME = 'aaaaaaaa-0000-4000-8000-000000000001'
const THEM = 'aaaaaaaa-0000-4000-8000-000000000002'
const settings = defaultsForTeamCount(8)

const detail: LeagueDetail = {
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
    max_teams: 8,
    created_at: null,
    updated_at: null,
    champion_team_id: null,
  },
  settings,
  members: [
    { id: 'm1', user_id: 'user-me', team_id: ME, role: 'manager', is_placeholder: false, is_autodraft: false, joined_at: null, profiles: { username: 'dalton', avatar_url: null } },
    { id: 'm2', user_id: 'user-them', team_id: THEM, role: 'commissioner', is_placeholder: false, is_autodraft: false, joined_at: null, profiles: { username: 'marcus', avatar_url: null } },
  ],
  teams: [
    { id: ME, name: 'Touchdown Tacos', owner_id: 'user-me', status: 'active', created_at: '2099-01-01T00:00:00Z' },
    { id: THEM, name: 'Gridiron Gurus', owner_id: 'user-them', status: 'active', created_at: '2099-01-02T00:00:00Z' },
  ],
  my_role: 'manager',
  active_draft: null,
}

function p(id: string, full_name: string, position: string, nfl_team: string): RosterPlayer {
  return {
    player_id: id,
    full_name,
    position,
    nfl_team,
    status: 'Active',
    bye_week: 9,
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

const ROSTERS: LeagueRosters = {
  league_id: LEAGUE,
  season: 2099,
  teams: [
    { team_id: ME, name: 'Touchdown Tacos', owner_id: 'user-me', status: 'active', manager_user_id: 'user-me', autopilot: false, faab_balance: null, waiver_priority: null, roster: [p('conner', 'James Conner', 'RB', 'ARI'), p('sanders', 'Shedeur Sanders', 'QB', 'CLE')] },
    { team_id: THEM, name: 'Gridiron Gurus', owner_id: 'user-them', status: 'active', manager_user_id: 'user-them', autopilot: false, faab_balance: null, waiver_priority: null, roster: [p('mooney', 'Darnell Mooney', 'WR', 'ATL'), p('allen', 'Josh Allen', 'QB', 'BUF')] },
  ],
}

const SCHEDULE: LeagueSchedule = {
  weeks: [{ id: 'w5', season: 2099, week: 5, status: 'live', finalized_at: null, median_score: null }],
  matchups: [
    { id: 'm4', season: 2099, week: 4, round_type: 'regular', status: 'final', home_team_id: THEM, away_team_id: ME, home_score: 100, away_score: 90, result: 'home', is_overridden: false },
    { id: 'm3', season: 2099, week: 3, round_type: 'regular', status: 'final', home_team_id: ME, away_team_id: THEM, home_score: 80, away_score: 99, result: 'away', is_overridden: false },
  ],
}

const OFFER: TradeView = {
  id: 'trade-1',
  status: 'proposed',
  status_reason: null,
  in_flight: true,
  proposer: { team_id: THEM, name: 'Gridiron Gurus' },
  recipient: { team_id: ME, name: 'Touchdown Tacos' },
  note: null,
  countered_from: null,
  created_at: '2099-10-15T11:52:00Z',
  accepted_at: null,
  resolved_at: null,
  items: [
    { from_team_id: THEM, to_team_id: ME, player: { player_id: 'mooney', full_name: 'Darnell Mooney', position: 'WR', nfl_team: 'ATL' }, faab_amount: null },
    { from_team_id: ME, to_team_id: THEM, player: { player_id: 'conner', full_name: 'James Conner', position: 'RB', nfl_team: 'ARI' }, faab_amount: null },
  ],
  drops: [],
  review: null,
  deferred: null,
  tally: null,
}

function tradesDoc(trades: TradeView[]): TradesDocument {
  return {
    league_id: LEAGUE,
    status: 'all',
    team_id: null,
    viewer: { team_id: ME, is_commissioner: false },
    settings: { trade_review: 'commissioner', trade_review_period_hours: 24, trade_deadline_week: 10, trade_lock_behavior: 'defer', allow_faab_in_trades: false, allow_future_considerations: false },
    evaluated_at: '2099-10-15T12:00:00Z',
    trades,
  }
}

const standing = (team_id: string, rank: number, wins: number, losses: number, pf: number) => ({
  rank,
  team_id,
  name: team_id,
  wins,
  losses,
  ties: 0,
  games: wins + losses,
  win_pct: 0,
  points_for: pf,
  points_against: 0,
  weeks: wins + losses,
  median_record: { wins: 0, losses: 0, ties: 0 },
  second_record: { wins: 0, losses: 0, ties: 0 },
  separated_by: null,
  faab_balance: null,
  waiver_priority: null,
})

function seeded(): QueryClient {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, retryOnMount: false } } })
  qc.setQueryData(leagueRosterKeys.all(LEAGUE), ROSTERS)
  qc.setQueryData(scheduleKeys.all(LEAGUE), SCHEDULE)
  qc.setQueryData(teamLineupKeys.week(THEM, 5), { id: 'l', team_id: THEM, season: 2099, week: 5, slot_map: { 'qb:0': 'allen', 'wr:0': 'mooney' }, starters: [], bench: [], locked_at: null, edited_by_commish: false, set_at: null })
  qc.setQueryData(leagueStandingsKeys.all(LEAGUE), { standings: [standing(THEM, 1, 8, 0, 407.62), standing(ME, 11, 2, 6, 353.86)] } as unknown as LeagueStandings)
  qc.setQueryData(tradeDeadlineKeys.all(LEAGUE), {
    state: 'known',
    view: { league_id: LEAGUE, deadline_week: 10, deadline_at: '2099-11-10T00:00:00Z', why: 'next_week_starts', label: null, passed: false, ms_remaining: 1, evaluated_at: '2099-10-15T12:00:00Z' },
  })
  qc.setQueryData(tradeKeys.list(LEAGUE, 'all', null), tradesDoc([OFFER]))
  return qc
}

function render(qc: QueryClient, element: React.ReactElement): string {
  const html = renderToStaticMarkup(createElement(QueryClientProvider, { client: qc }, createElement(Fragment, null, element)))
  return html.replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, '&')
}

describe('Team view (another team)', () => {
  const html = render(seeded(), createElement(TeamView, { leagueId: LEAGUE, teamId: THEM, detail }))

  it('identity, @manager · league, and the four stat tiles from real reads', () => {
    expect(html).toContain('Gridiron Gurus')
    expect(html).toContain('@marcus')
    expect(html).toContain('Sunday Funday League')
    expect(html).toContain('8-0')
    expect(html).toContain('1st')
    expect(html).toContain('407.62')
    // Streak from the decided weeks, newest first: week 4 won, week 3 won.
    expect(html).toContain('W2')
    for (const label of ['Record', 'Rank', 'Points for', 'Streak']) expect(html).toContain(label)
  })

  it('offers Propose trade (a managed team, in season, before the deadline); no Message (direct messages have no backend)', () => {
    expect(html).toContain('Propose trade')
    expect(html).not.toContain('Message')
  })

  it('See all opens League transactions filtered to this team', () => {
    expect(html).toContain(`href="/app/leagues/${LEAGUE}/activity/transactions?team=${THEM}"`)
  })

  it('starters with "Week N · Proj", bench and Recent moves', () => {
    expect(html).toMatch(/Week 5 · Proj/)
    expect(html).toContain('Josh Allen')
    expect(html).toContain('Bench')
    expect(html).toContain('Recent moves')
    expect(html).toContain('See all')
  })
})

describe('Team view — Propose trade while trades are closed (item #7, match-team-2)', () => {
  /** The Propose trade button's opening tag, or null when it isn't offered. */
  const proposeTag = (html: string) => html.match(/<button[^>]*data-propose-trade[^>]*>/)?.[0] ?? null
  const view = (qc: QueryClient, d: LeagueDetail = detail, teamId = THEM) => render(qc, createElement(TeamView, { leagueId: LEAGUE, teamId, detail: d }))
  const withStatus = (status: string): LeagueDetail => ({ ...detail, league: { ...detail.league, status } })
  const pastDeadline = () => {
    const qc = seeded()
    qc.setQueryData(tradeDeadlineKeys.all(LEAGUE), {
      state: 'known',
      view: { league_id: LEAGUE, deadline_week: 10, deadline_at: '2099-11-10T00:00:00Z', why: 'next_week_starts', label: null, passed: true, ms_remaining: 0, evaluated_at: '2099-11-12T12:00:00Z' },
    })
    return qc
  }

  it('open (in season, before the deadline): a live button — not dimmed, not aria-disabled', () => {
    const tag = proposeTag(view(seeded()))
    expect(tag).not.toBeNull()
    expect(tag).not.toContain('aria-disabled')
    expect(tag).not.toContain('opacity-40')
  })

  /** What a tap on the button would say — the view's last ask of the helper. */
  const tapSays = () => vi.mocked(tradesClosedReason).mock.results.at(-1)?.value as string | null | undefined

  it('past the deadline: still there, dimmed and aria-disabled (a tap says why) — never gone', () => {
    const html = view(pastDeadline())
    const tag = proposeTag(html)
    expect(tag).not.toBeNull()
    expect(tag).toContain('aria-disabled="true"')
    expect(tag).toContain('opacity-40')
    expect(html).toContain('Propose trade')
    expect(tapSays()).toBe(DEADLINE_PASSED_TITLE)
  })

  it('before the season starts: dimmed, and a tap says when trades open', () => {
    for (const status of ['setup', 'scheduled', 'drafting']) {
      const tag = proposeTag(view(seeded(), withStatus(status)))
      expect(tag, status).not.toBeNull()
      expect(tag, status).toContain('aria-disabled="true"')
      expect(tag, status).toContain('opacity-40')
      expect(tapSays(), status).toBe(NOT_IN_SEASON_TRADE_COPY)
    }
  })

  it('once the season is over: dimmed, and a tap says the season is over — not "Trades open once the season starts"', () => {
    const tag = proposeTag(view(seeded(), withStatus('complete')))
    expect(tag).not.toBeNull()
    expect(tag).toContain('aria-disabled="true"')
    expect(tag).toContain('opacity-40')
    expect(tapSays()).toBe(TRADES_AFTER_SEASON_COPY)
    // …even when the deadline read says passed too.
    view(pastDeadline(), withStatus('complete'))
    expect(tapSays()).toBe(TRADES_AFTER_SEASON_COPY)
  })

  it('the playoffs are in season: open', () => {
    expect(proposeTag(view(seeded(), withStatus('playoffs')))).not.toContain('aria-disabled')
  })

  it('never offered where it can never apply: a team with no manager, or a viewer with no team', () => {
    const unmanaged = seeded()
    unmanaged.setQueryData(leagueRosterKeys.all(LEAGUE), { ...ROSTERS, teams: ROSTERS.teams.map((t) => (t.team_id === THEM ? { ...t, manager_user_id: null } : t)) })
    expect(proposeTag(view(unmanaged))).toBeNull()
    const noSeat: LeagueDetail = { ...detail, members: detail.members.filter((m) => m.user_id !== 'user-me') }
    expect(proposeTag(view(seeded(), noSeat))).toBeNull()
    // …and not even dimmed when trades are closed too.
    expect(proposeTag(view(pastDeadline(), noSeat))).toBeNull()
  })

  it('never offered on your own team', () => {
    expect(proposeTag(view(seeded(), detail, ME))).toBeNull()
    expect(proposeTag(view(pastDeadline(), detail, ME))).toBeNull()
  })
})

describe("Team view — who's online (gap list §3 #25)", () => {
  it('the manager online: the green dot on the team avatar and "Active now · @marcus · league"', () => {
    presence.online = new Set(['user-them'])
    let html: string
    try {
      html = render(seeded(), createElement(TeamView, { leagueId: LEAGUE, teamId: THEM, detail }))
    } finally {
      presence.online = new Set()
    }
    expect(html).toMatch(/class="[^"]*\bsize-4\b[^"]*" data-online-dot/)
    expect(html).toMatch(/<span data-active-now="true">Active now · <\/span>.*@marcus/)
    expect(html).toContain('Sunday Funday League')
  })

  it('offline: no dot and no "Active now"', () => {
    const html = render(seeded(), createElement(TeamView, { leagueId: LEAGUE, teamId: THEM, detail }))
    expect(html).not.toContain('data-online-dot')
    expect(html).not.toContain('Active now')
  })
})

describe('Trade offer (incoming, pending)', () => {
  const html = render(seeded(), createElement(TradeDetailOverlay, { leagueId: LEAGUE, detail, tradeId: 'trade-1', onClose: () => {}, onCounter: () => {} }))

  it('title, "Sent to you 8m", my side first with Pending, theirs Sent offer', () => {
    expect(html).toContain('Trade offer')
    expect(html).toContain('Sent to you 8m')
    expect(html.indexOf('@dalton')).toBeLessThan(html.indexOf('@marcus'))
    expect(html).toContain('Pending')
    expect(html).toContain('Sent offer')
  })

  it('Receives / Sends mirror each other', () => {
    expect(html).toContain('Receives')
    expect(html).toContain('Sends')
    expect(html).toContain('D. Mooney')
    expect(html).toContain('J. Conner')
  })

  it('the incoming footer: Decline · Counter · Accept, and the screenshot toggle', () => {
    expect(html).toContain('data-trade-op="reject"')
    expect(html).toContain('data-trade-op="counter"')
    expect(html).toContain('data-trade-op="accept"')
    expect(html).toContain('Hide usernames for screenshots')
  })
})

describe('Trade offer — the league tag is the size and scoring (item #8, match-team-3)', () => {
  /** The top bar's league tag: the avatar tile's initials, then the format. */
  const tag = (qc: QueryClient) => {
    const html = render(qc, createElement(TradeDetailOverlay, { leagueId: LEAGUE, detail, tradeId: 'trade-1', onClose: () => {}, onCounter: () => {} }))
    return html.match(/<span class="flex size-5[^"]*">SF<\/span>([^<]*)<\/span>/)?.[1] ?? null
  }
  const myLeague = (team_count: number): MyLeagueRow => ({
    id: LEAGUE, name: 'Sunday Funday League', avatar_url: null, season: 2099, status: 'in_season', team_count, created_at: null, my_role: 'manager', my_team_id: ME,
  })
  const withScoring = (rules: unknown, teamCount?: number) => {
    const qc = seeded()
    qc.setQueryData(auctionPoolKeys.scoring(LEAGUE), rules)
    if (teamCount !== undefined) qc.setQueryData(leaguesKeys.all, [myLeague(teamCount)])
    return qc
  }

  it('"12-team standard" — the league\'s size and scoring, like the Switch league sheet — never the season', () => {
    expect(tag(withScoring({ receptions: 0 }, 12))).toBe('12-team standard')
    expect(tag(withScoring({ receptions: 1 }, 12))).toBe('12-team PPR')
    expect(tag(withScoring({ receptions: 0.5 }, 10))).toBe('10-team half PPR')
    expect(tag(withScoring({ receptions: 0 }, 12))).not.toContain('2099')
  })

  it('before My leagues has loaded, the size is the league\'s own team count', () => {
    expect(tag(withScoring({ receptions: 1 }))).toBe(`${detail.teams.length}-team PPR`)
  })

  it('scoring that can\'t be read leaves the word out ("12-team") rather than guessing — and still no season', () => {
    expect(tag(withScoring(null, 12))).toBe('12-team')
    expect(tag(seeded())).toBe(`${detail.teams.length}-team`)
  })
})

describe('Propose a trade (pick step)', () => {
  const html = render(seeded(), createElement(TradeBuilderOverlay, { leagueId: LEAGUE, detail, mode: 'propose', initialTo: THEM, initialGet: ['mooney'], onClose: () => {} }))

  it('the instruction, the opponent chips (teams with a manager) and both heads', () => {
    expect(html).toContain('Propose a trade')
    expect(html).toContain('Pick players from both rosters')
    expect(html).toMatch(/aria-pressed="true"[^>]*>.*Gridiron Gurus/)
    expect(html).toContain('2-6 · 11th')
    expect(html).toContain('8-0 · 1st')
  })

  it('the left head is always your team in the accent blue (even when yours isn’t the oldest team)', () => {
    const newer = { ...detail, teams: [...detail.teams].reverse() }
    const out = render(seeded(), createElement(TradeBuilderOverlay, { leagueId: LEAGUE, detail: newer, mode: 'propose', initialTo: THEM, initialGet: [], onClose: () => {} }))
    expect(out).toMatch(new RegExp(`class="[^"]*bg-accent[^"]*"[^>]*data-team-avatar="${ME}"`))
    expect(out).not.toMatch(new RegExp(`class="[^"]*bg-accent[^"]*"[^>]*data-team-avatar="${THEM}"`))
  })

  it('roster tiles sorted QB first, the door’s player picked, and the not-ready footer', () => {
    const mine = html.indexOf('S. Sanders')
    expect(mine).toBeGreaterThan(-1)
    expect(mine).toBeLessThan(html.indexOf('J. Conner'))
    expect(html).toMatch(/data-trade-tile="mooney"[^>]*/)
    expect(html).toContain('Trade proposal')
    expect(html).toContain('Pick players on both sides')
    expect(html).toContain('data-view-proposal="not-ready"')
  })
})

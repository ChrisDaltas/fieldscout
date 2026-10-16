/**
 * The mobile League › League tab over REAL renders (the desktop render-test
 * rig: `renderToStaticMarkup` with the React Query cache pre-seeded —
 * fetches are effects, so the cache IS the data). Pins the handoff's
 * structure (m-league.md §2.1–§2.6) over the app's stored documents, and the
 * honesty rules: no invented win probability or rank movement.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { LeagueDetail } from '@/hooks/use-league'
import { leagueActivityKeys } from '@/hooks/use-league-activity'
import { mockDraftKeys } from '@/hooks/use-mock-drafts'
import { statCorrectionsKeys } from '@/hooks/use-stat-corrections'
import { waiverClaimKeys } from '@/hooks/use-waiver-claims'
import { leagueChatKeys } from '@/hooks/use-league-chat'
import { leaguesKeys } from '@/hooks/use-leagues'
import { teamLineupKeys } from '@/hooks/use-lineup'
import { leagueMatchupKeys } from '@/hooks/use-matchups'
import { scheduleKeys, type LeagueSchedule } from '@/hooks/use-schedule'
import { leagueStandingsKeys } from '@/hooks/use-standings'
import { statsDegradedKeys } from '@/hooks/use-stats-degraded'
import type { ActivityItem } from '@/lib/leagues/api/activity-service'
import type { WeekMatchups } from '@/lib/leagues/api/matchups-service'
import type { LeagueStandings, StandingsRow } from '@/lib/leagues/api/standings-service'
import { defaultsForTeamCount } from '@/lib/leagues/settings/league-settings'
import type { LiveScoringFlags } from '@/lib/sync/ingest-flags'

import { ActivitySubscreenRoute } from './activity-subscreens'
import { MobileLeagueTab } from './league-tab'
import { useLeagueTabStore } from './league-tab-store'
import { TransactionsScreen } from './transactions-screen'

vi.mock('@/hooks/use-auth', () => ({
  useAuth: () => ({ user: { id: 'user-me' }, profile: { username: 'dalton' }, isLoading: false }),
}))
vi.mock('@/hooks/use-league-channel', () => ({
  useLeagueChannel: vi.fn(() => ({ connection: 'live' })),
}))
vi.mock('@/hooks/use-notifications', () => ({
  useNotifications: () => ({ data: { unreadCount: 3 } }),
}))
vi.mock('next/navigation', () => ({
  usePathname: () => '/app/leagues/league-1',
  useRouter: () => ({ push: vi.fn(), back: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}))

const LEAGUE = 'league-1'
const ME = 'aaaaaaaa-0000-4000-8000-000000000001'
const OPP = 'aaaaaaaa-0000-4000-8000-000000000002'
const T3 = 'aaaaaaaa-0000-4000-8000-000000000003'
const T4 = 'aaaaaaaa-0000-4000-8000-000000000004'
const NAMES = new Map([
  [ME, 'Touchdown Tacos'],
  [OPP, 'Gridiron Gurus'],
  [T3, 'Charlie'],
  [T4, 'Delta'],
])

function detail(over: Partial<LeagueDetail['settings']> = {}): LeagueDetail {
  return {
    league: {
      id: LEAGUE,
      name: 'Sunday Funday League',
      avatar_url: null,
      description: null,
      season: 2099,
      status: 'in_season',
      owner_id: 'user-x',
      scoring_system_id: null,
      invite_code: null,
      invite_slug: null,
      max_teams: 4,
      created_at: null,
      updated_at: null,
      champion_team_id: null,
    },
    settings: { ...defaultsForTeamCount(8), regular_season_weeks: 3, playoff_teams: 2, median_game: true, waiver_type: 'faab', ...over },
    members: [
      { id: 'm1', user_id: 'user-me', team_id: ME, role: 'manager', is_placeholder: false, is_autodraft: false, joined_at: null, profiles: { username: 'dalton', avatar_url: null } },
      { id: 'm2', user_id: 'user-opp', team_id: OPP, role: 'manager', is_placeholder: false, is_autodraft: false, joined_at: null, profiles: { username: 'marcus', avatar_url: null } },
    ],
    teams: [...NAMES.entries()].map(([id, name]) => ({ id, name, owner_id: 'user-x', status: 'active', created_at: null })),
    my_role: 'manager',
    active_draft: null,
  }
}

const SCHEDULE: LeagueSchedule = {
  weeks: [
    { id: 'w1', season: 2099, week: 1, status: 'final', finalized_at: null, median_score: null },
    { id: 'w2', season: 2099, week: 2, status: 'live', finalized_at: null, median_score: null },
  ],
  matchups: [
    { id: 'm1A', season: 2099, week: 1, round_type: 'regular', status: 'final', home_team_id: OPP, away_team_id: ME, home_score: 90, away_score: 80, result: 'home', is_overridden: false },
    { id: 'm1B', season: 2099, week: 1, round_type: 'regular', status: 'final', home_team_id: T3, away_team_id: T4, home_score: 70, away_score: 75, result: 'away', is_overridden: false },
  ],
}

const WEEK: WeekMatchups = {
  league_id: LEAGUE,
  season: 2099,
  week: 2,
  schedule_mode: 'h2h',
  league_week: { status: 'live', median_score: null, finalized_at: null },
  teams: [...NAMES.entries()].map(([id, name]) => ({ id, name, status: 'active' })),
  matchups: [
    { id: 'mA', season: 2099, week: 2, round_type: 'regular', status: 'live', home_team_id: T3, away_team_id: T4, home_score: null, away_score: 12.25, result: null, is_overridden: false, updated_at: null },
    { id: 'mB', season: 2099, week: 2, round_type: 'regular', status: 'live', home_team_id: OPP, away_team_id: ME, home_score: 16.4, away_score: 39.7, result: null, is_overridden: false, updated_at: null },
  ],
  results: [],
}

function row(team: string, rank: number, w: number, l: number, faab: number, prio: number, pf: number): StandingsRow {
  const rec = { wins: 0, losses: 0, ties: 0 }
  return {
    rank,
    team_id: team,
    name: NAMES.get(team)!,
    wins: w,
    losses: l,
    ties: 0,
    games: w + l,
    win_pct: w / Math.max(1, w + l),
    points_for: pf,
    points_against: pf - 5,
    weeks: w + l,
    h2h_record: rec,
    median_record: rec,
    second_record: rec,
    separated_by: null,
    faab_balance: faab,
    waiver_priority: prio,
  }
}

/** The chain 117 returns for the default tiebreak order in an h2h league. */
const DEFAULT_CHAIN = [
  { entry: 'win_pct', status: 'applied', reason: null },
  { entry: 'points_for', status: 'applied', reason: null },
  { entry: 'head_to_head', status: 'applied', reason: 'clean_two_team_ties_only' },
  { entry: 'points_against', status: 'applied', reason: null },
  { entry: 'division_record', status: 'inert', reason: 'divisions_pinned_at_1' },
  { entry: 'coin_flip', status: 'applied', reason: null },
]

const STANDINGS: LeagueStandings = {
  league_id: LEAGUE,
  season: 2099,
  schedule_mode: 'h2h',
  regular_season: { first_week: 1, last_week: 3 },
  weeks_final: 1,
  chain: DEFAULT_CHAIN,
  chain_appended: [],
  coin_flip_seed: '',
  coin_flip_seed_source: '',
  skipped: [],
  pa_gaps: [],
  standings: [row(OPP, 1, 1, 0, 103, 4, 90), row(T4, 2, 1, 0, 99, 3, 75), row(T3, 3, 0, 1, 149, 2, 70), row(ME, 4, 0, 1, 64, 1, 80)],
  reason: null,
  projected: false,
  weeks_projected: 0,
}

const FLAG_OK = {
  degraded: false,
  stall: { stalled: false, reasons: [], rows: 0, oldest_enqueued_at: null, last_ingest_at: null },
} as unknown as LiveScoringFlags

const FEED: ActivityItem[] = [
  {
    kind: 'transaction',
    id: 'tx1',
    created_at: '2099-10-11T19:06:00.000Z',
    type: 'waiver_claim',
    status: 'complete',
    week: 2,
    team_id: ME,
    actor_id: null,
    action_id: null,
    payload: { add: { player_id: 'p1', name: 'Kendrick Bourne', position: 'WR', nfl_team: 'ARI' }, faab_bid: 11, faab_before: 75 },
    commish_action_id: null,
  },
]

function render(
  element: React.ReactElement,
  settings: Partial<LeagueDetail['settings']> = {},
  seed?: (qc: QueryClient) => void,
  league: Partial<LeagueDetail> = {},
): string {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, retryOnMount: false } } })
  qc.setQueryData(leaguesKeys.detail(LEAGUE), { ...detail(settings), ...league })
  qc.setQueryData(scheduleKeys.all(LEAGUE), SCHEDULE)
  qc.setQueryData(leagueMatchupKeys.week(LEAGUE, 2), WEEK)
  qc.setQueryData(leagueStandingsKeys.all(LEAGUE), STANDINGS)
  qc.setQueryData(statsDegradedKeys.flag(), FLAG_OK)
  qc.setQueryData(teamLineupKeys.week(ME, 2), null)
  qc.setQueryData(leagueChatKeys.board(LEAGUE), [])
  for (const streams of [[{}], [{ teamId: ME }]]) {
    qc.setQueryData([...leagueActivityKeys.all(LEAGUE), 'mobile', streams], { pages: [{ items: FEED, next: null }], pageParams: [[{ cursor: null, done: false }]] })
  }
  qc.setQueryData(['players-by-ids', ['p1']], [])
  seed?.(qc)
  const html = renderToStaticMarkup(createElement(QueryClientProvider, { client: qc }, element))
  return html.replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, '&')
}

beforeEach(() => {
  useLeagueTabStore.setState({ segments: {}, filters: {} })
})

describe('League tab — header and segmented control', () => {
  const html = render(createElement(MobileLeagueTab, { leagueId: LEAGUE, segment: null }))

  it('carries the league header: Home, the league name, search / notifications / messages', () => {
    expect(html).toContain('aria-label="Home"')
    expect(html).toContain('>Sunday Funday League<')
    expect(html).toContain('aria-label="Search"')
  })

  it('three segments, Matchups on by default, pill track', () => {
    const segs = html.match(/aria-pressed="(true|false)"[^>]*>(Matchups|Standings|Activity)</g) ?? []
    expect(segs).toHaveLength(3)
    expect(segs[0]).toContain('aria-pressed="true"')
    const track = html.match(/<div role="group" aria-label="League" class="([^"]+)"/)?.[1] ?? ''
    expect(track.split(' ')).toEqual(expect.arrayContaining(['rounded-pill', 'bg-m-b2', 'p-[3px]', 'gap-0']))
  })
})

describe('League › Matchups', () => {
  const html = render(createElement(MobileLeagueTab, { leagueId: LEAGUE, segment: 'matchups' }))

  it('the median card shows only when the league plays the median game, pending until stored', () => {
    expect(html).toContain('data-median-card')
    expect(html).toContain('League median')
    expect(html).toContain('Beat the median to win an extra matchup this week.')
    const off = render(createElement(MobileLeagueTab, { leagueId: LEAGUE, segment: 'matchups' }), { median_game: false })
    expect(off).not.toContain('data-median-card')
  })

  it('your matchup first (you on the left, even as the away team), each card a door to the Match tab, stored scores and records', () => {
    expect(html.indexOf('data-matchup="mB"')).toBeLessThan(html.indexOf('data-matchup="mA"'))
    const card = html.slice(html.indexOf('data-matchup="mB"'), html.indexOf('data-matchup="mA"'))
    expect(card.indexOf('Touchdown Tacos')).toBeLessThan(card.indexOf('Gridiron Gurus'))
    expect(html).toContain('href="/app/leagues/league-1/matchup/mB"')
    expect(html).toContain('39.70')
    expect(html).toContain('16.40')
    expect(html).toContain('pending')
    expect(html).toContain('0-1')
    expect(html).toContain('1-0')
  })

  it('invents no win probability', () => {
    expect(html).not.toMatch(/\d+%/)
  })

  it('keeps the league-home cards the design does not draw', () => {
    expect(html).toContain('data-your-team')
    expect(html).toContain('Set lineup')
    expect(html).toContain('data-message-board')
    expect(html).toContain('data-draft-doors')
  })
})

describe('League › Standings', () => {
  const html = render(createElement(MobileLeagueTab, { leagueId: LEAGUE, segment: 'standings' }))

  it('the header row and the server’s order', () => {
    expect(html).toMatch(/>Rank<.*>Team<.*>Waiver<.*>PF<.*>PA</)
    const order = [...html.matchAll(/data-standings-row="([^"]+)"/g)].map((m) => m[1])
    expect(order).toEqual([OPP, T4, T3, ME])
  })

  it('FAAB (priority), PF, record · streak · @manager — the manager a profile door', () => {
    expect(html).toContain('$103 (4)')
    expect(html).toContain('90.00')
    expect(html).toContain('▲1W')
    expect(html).toContain('▼1L')
    expect(html).toContain('@marcus')
  })

  it('the 2px blue line under the last playoff seed, and the note says how many', () => {
    const rows = html.match(/<li[^>]*data-standings-row[^>]*>/g) ?? []
    expect(rows[1]).toContain('border-b-2 border-accent')
    expect(rows.filter((r) => r.includes('border-b-2')).length).toBe(1)
    expect(html).toContain('Top 2 make the playoffs. Line marks the cutoff.')
  })

  it('every row opens the team', () => {
    expect(html).toContain(`href="/app/leagues/league-1/team/${OPP}"`)
  })

  // Gap list #40 (Chris, 2026-10-15).
  it('Points Against on every row, under points for (one column — the team name keeps its width); no Win %', () => {
    const opp = html.slice(html.indexOf(`data-standings-row="${OPP}"`))
    expect(opp).toMatch(/data-pf="true">90\.00<\/span><span class="[^"]*" data-pa="true">85\.00</)
    expect(html).toMatch(/>PF<\/span><span>PA<\/span>/)
    expect(html).toContain('grid-cols-[30px_minmax(0,1fr)_64px_50px]')
    expect(html).not.toMatch(/Win %|win_pct|\.500/)
  })

  it('the vs-median record shows in a league that plays the median game; the 2nd-opponent record only where that game is played', () => {
    expect(html).toContain('data-extra-records')
    expect(html).toContain('vs median 0-0')
    expect(html).not.toContain('2nd opp')
    const both = render(createElement(MobileLeagueTab, { leagueId: LEAGUE, segment: 'standings' }), { second_opponent: true })
    // Each record its own unbreakable piece in a wrapping line — on a narrow
    // phone the 2nd-opponent record drops under the median one, never cut.
    const extras = both.match(/<span class="([^"]*)" data-extra-records="true">(.*?)<\/span><\/span><\/span>/)
    expect(extras?.[1].split(' ')).toEqual(expect.arrayContaining(['flex', 'flex-wrap']))
    expect(extras?.[1]).not.toMatch(/truncate|whitespace-nowrap/)
    expect(extras?.[2]).toMatch(/<span class="whitespace-nowrap" data-extra-record="true">vs median 0-0<\/span><span class="whitespace-nowrap" data-extra-record="true">· 2nd opp 0-0/)
    const neither = render(createElement(MobileLeagueTab, { leagueId: LEAGUE, segment: 'standings' }), { median_game: false })
    expect(neither).not.toContain('data-extra-records')
  })

  it('one line says how ties are broken, from the league’s own order (the read’s chain)', () => {
    expect(html).toContain('Ties go to most points for, then head-to-head (two-team ties), then most points against, then a coin flip.')
    // The chain the read returns wins over the stored setting when they disagree.
    const custom = render(
      createElement(MobileLeagueTab, { leagueId: LEAGUE, segment: 'standings' }),
      { tiebreakers: ['win_pct', 'points_for', 'head_to_head', 'points_against', 'division_record', 'coin_flip'] },
      (qc) =>
        qc.setQueryData(leagueStandingsKeys.all(LEAGUE), {
          ...STANDINGS,
          chain: [
            { entry: 'win_pct', status: 'applied', reason: null },
            { entry: 'points_against', status: 'applied', reason: null },
            { entry: 'coin_flip', status: 'applied', reason: null },
            { entry: 'points_for', status: 'applied', reason: null },
          ],
        }),
    )
    expect(custom).toContain('data-tiebreak-note')
    expect(custom).toContain('Ties go to most points against, then a coin flip.')
    expect(custom).not.toContain('Ties go to most points for')
  })

  it('a read without a chain falls back to the stored setting, completed the way 117 completes it', () => {
    const fallback = render(
      createElement(MobileLeagueTab, { leagueId: LEAGUE, segment: 'standings' }),
      { tiebreakers: ['win_pct', 'points_against'] },
      (qc) => qc.setQueryData(leagueStandingsKeys.all(LEAGUE), { ...STANDINGS, chain: [] }),
    )
    expect(fallback).toContain('Ties go to most points against, then most points for, then head-to-head (two-team ties), then a coin flip.')
  })

  it('the streak is the shared count (gap list #39): the stored final result of each week', () => {
    const t3 = html.slice(html.indexOf(`data-standings-row="${T3}"`))
    expect(t3).toMatch(/text-negative-strong" data-streak="▼1L">▼1L</)
    const t4 = html.slice(html.indexOf(`data-standings-row="${T4}"`))
    expect(t4).toMatch(/text-positive-strong" data-streak="▲1W">▲1W</)
  })
})

describe('League › Activity and Transactions', () => {
  it('Activity: the Filter pill, then the transaction rows', () => {
    const html = render(createElement(MobileLeagueTab, { leagueId: LEAGUE, segment: 'activity' }))
    expect(html).toContain('>Filter<')
    expect(html).toContain('data-tx-row="tx1"')
    expect(html).toContain('>Waiver<')
    expect(html).toContain('$11 bid')
    expect(html).toContain('K. Bourne')
    expect(html).toContain('WR · ARI')
    expect(html).toContain('>Added<')
    expect(html).toContain('Commissioner log')
  })

  it('Transactions: the close ×, the title, the Activity heading', () => {
    const html = render(createElement(TransactionsScreen, { leagueId: LEAGUE, mine: false, team: null }))
    expect(html).toContain('aria-label="Close"')
    expect(html).toContain('League transactions')
    expect(html).toContain('>Activity<')
    const mine = render(createElement(TransactionsScreen, { leagueId: LEAGUE, mine: true, team: null }))
    expect(mine).toContain('My moves')
  })
})

// ---------------------------------------------------------------------------
// Review fixes (2026-10-15)
// ---------------------------------------------------------------------------

/** A trade OPP proposed and ME received: Wright to ME, Dotson to OPP. */
const TRADE: ActivityItem = {
  kind: 'transaction',
  id: 'trade1',
  created_at: '2099-10-10T19:06:00.000Z',
  type: 'trade',
  status: 'complete',
  week: 2,
  team_id: OPP,
  actor_id: null,
  action_id: null,
  payload: {
    proposer_team_id: OPP,
    recipient_team_id: ME,
    players: [
      { player_id: 'p7', name: 'Jaylen Wright', from_team_id: OPP, to_team_id: ME },
      { player_id: 'p8', name: 'Jahan Dotson', from_team_id: ME, to_team_id: OPP },
    ],
  },
  commish_action_id: null,
}
const OWN = ['add', 'drop', 'add_drop', 'waiver_claim']
const SHARED = ['trade', 'commissioner_move']
const seedFeed = (streams: unknown[], items: ActivityItem[]) => (qc: QueryClient) =>
  qc.setQueryData([...leagueActivityKeys.all(LEAGUE), 'mobile', streams], { pages: [{ items, next: null }], pageParams: [streams.map(() => ({ cursor: null, done: false }))] })

describe('League › Standings — what the app’s standings page has, kept', () => {
  it('the ✸ beside a commissioner-adjusted team opens the log for that team, with the legend', () => {
    const html = render(createElement(MobileLeagueTab, { leagueId: LEAGUE, segment: 'standings' }), {}, (qc) =>
      qc.setQueryData(scheduleKeys.all(LEAGUE), { ...SCHEDULE, matchups: SCHEDULE.matchups.map((m) => (m.id === 'm1A' ? { ...m, is_overridden: true } : m)) }),
    )
    expect(html).toContain(`href="/app/leagues/league-1/activity/commissioner?team=${OPP}"`)
    expect(html).toContain(`href="/app/leagues/league-1/activity/commissioner?team=${ME}"`)
    expect(html).not.toContain(`activity/commissioner?team=${T3}`)
    expect(html).toContain('data-overridden-legend')
  })

  it('no ✸ and no legend when nothing was adjusted; the Final | Projected switch and the weeks counted', () => {
    const html = render(createElement(MobileLeagueTab, { leagueId: LEAGUE, segment: 'standings' }))
    expect(html).not.toContain('data-overridden-legend')
    expect(html).toMatch(/aria-pressed="true"[^>]*>Final</)
    expect(html).toMatch(/aria-pressed="false"[^>]*>Projected</)
    expect(html).toMatch(/>1<\/span> week final/)
  })
})

describe('Transactions — trades, managers and My moves', () => {
  it('a trade names the other manager as a profile door, in Added / Dropped words', () => {
    const html = render(createElement(MobileLeagueTab, { leagueId: LEAGUE, segment: 'activity' }), {}, seedFeed([{}], [TRADE]))
    const row = html.slice(html.indexOf('data-tx-row="trade1"'))
    // League-wide, the side that started it (OPP): Dotson in, Wright out.
    expect(row).toContain('data-username-link="marcus"')
    expect(row).toContain('Trade with <a')
    expect(row).toContain('data-username-link="dalton"')
    expect(row).not.toContain('>Traded<')
  })

  it('My moves lists a trade you RECEIVED, told from your side, and your pending claims with Cancel', () => {
    const html = render(createElement(TransactionsScreen, { leagueId: LEAGUE, mine: true, team: null }), {}, (qc) => {
      seedFeed([{ type: OWN, teamId: ME }, { type: SHARED, parties: [ME] }], [TRADE])(qc)
      qc.setQueryData(['players-by-ids', ['p7', 'p8']], [])
      qc.setQueryData(waiverClaimKeys.team(LEAGUE, null, 'pending'), {
        league_id: LEAGUE,
        team_id: ME,
        status: 'pending',
        waiver_type: 'faab',
        faab_budget: 100,
        faab_min_bid: 0,
        faab_balance: 60,
        waiver_priority: 1,
        claims: [
          {
            id: 'c1',
            team_id: ME,
            add: { player_id: 'p9', full_name: 'Ray Davis', position: 'RB', nfl_team: 'BUF' },
            drop: null,
            faab_bid: 7,
            claim_order: 1,
            status: 'pending',
            result_reason: null,
            process_at: null,
            processed_at: null,
            created_at: '2099-10-10T19:06:00.000Z',
            created_by: 'user-me',
            cancelled_at: null,
          },
        ],
      })
      qc.setQueryData(['players-by-ids', ['p9']], [])
    })
    expect(html).toContain('data-tx-row="trade1"')
    const row = html.slice(html.indexOf('data-tx-row="trade1"'))
    // Your side: Wright came in (Added), Dotson went out (Dropped); the trade with marcus.
    expect(row.indexOf('J. Wright')).toBeLessThan(row.indexOf('>Added<'))
    expect(row).toContain('>Dropped<')
    expect(row).toContain('data-username-link="marcus"')
    expect(html).toContain('data-pending-claims')
    expect(html).toContain('$7 bid')
    expect(html).toContain('>Cancel<')
  })
})

describe('Commissioner log and Stat corrections — their own full screens', () => {
  it('Stat corrections is the mobile list, not the desktop card', () => {
    const html = render(
      createElement(ActivitySubscreenRoute, { leagueId: LEAGUE, initial: { tab: 'corrections', week: null, team: null, entry: null } }),
      {},
      (qc) =>
        qc.setQueryData(statCorrectionsKeys.list(LEAGUE, {}), {
          pages: [{ state: 'known', page: { items: [], has_more: false, next_before: null, note: 'No stat correction has changed a score in this league yet.' } }],
          pageParams: [null],
        }),
    )
    expect(html).toContain('>Stat corrections<')
    // Back goes to where you came from (Chris #27) — a button, not a fixed link.
    expect(html).toMatch(/<button type="button" aria-label="Back"[^>]*data-subscreen-back/)
    expect(html).not.toContain('Back to activity')
    expect(html).toContain('data-mobile-corrections')
    expect(html).not.toContain('data-corrections-view')
    expect(html).toContain('No stat correction has changed a score in this league yet.')
  })
})

describe('Before the draft — the app’s pieces in the mobile language', () => {
  it('the managers card: seats, the claimed count, the door to Members — no desktop card', () => {
    const html = render(createElement(MobileLeagueTab, { leagueId: LEAGUE, segment: 'matchups' }), {}, (qc) => {
      qc.setQueryData(mockDraftKeys.list(LEAGUE), { active: [], recaps: [] })
    }, { league: { ...detail().league, status: 'setup' } })
    expect(html).toContain('data-managers-card')
    expect(html).toMatch(/2 \/ \d+ claimed/)
    expect(html).toContain('href="/app/leagues/league-1/members"')
    expect(html).toContain('data-username-link="marcus"')
    expect(html).toContain('Add a draft list')
    expect(html).not.toContain('rounded-xl border border-n-4')
  })
})

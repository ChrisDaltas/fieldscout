/**
 * The Home league card's red dot (ruling #14) rendered over seeded query
 * caches — the same keys the league screens read: on, with its spoken
 * reason, when something in the league needs you; off otherwise; never on a
 * pre-draft card, which reads nothing; nothing read while the leagues release
 * is off.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

vi.mock('next/navigation', () => ({
  usePathname: () => '/app',
  useRouter: () => ({ push: () => {}, replace: () => {}, refresh: () => {}, back: () => {} }),
}))
vi.mock('@/lib/supabase/client', () => ({
  createBrowserClient: () => ({
    auth: { getSession: async () => ({ data: { session: null } }), onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => {} } } }) },
    from: () => ({}),
    channel: () => ({ on: () => ({}), subscribe: () => ({}) }),
    removeChannel: () => {},
  }),
}))
const flags = vi.hoisted(() => ({ leagues: true, mockDrafts: true, personas: false, messages: false, weeklyRanks: true, startOrSit: true }))
vi.mock('@/lib/feature-flags', () => ({ featureFlags: flags }))

import { leaguesKeys } from '@/hooks/use-leagues'
import { teamLineupKeys } from '@/hooks/use-lineup'
import { leagueRosterKeys } from '@/hooks/use-rosters'
import { scheduleKeys } from '@/hooks/use-schedule'
import { tradeKeys } from '@/hooks/use-trades'

import { HomeMatchups, LeagueCard } from './home-matchups'

const L = (id: string, status: string, team: string) => ({
  id,
  name: `League ${id}`,
  avatar_url: null,
  season: 2026,
  status,
  team_count: 10,
  created_at: null,
  my_role: 'manager',
  my_team_id: team,
})
const LEAGUES = [L('A', 'in_season', 'a1'), L('B', 'in_season', 'b1'), L('C', 'setup', 'c1')]

const SETTINGS = {
  starting_slots: [
    { key: 'qb', label: 'QB', eligible: ['QB'], count: 1 },
    { key: 'rb', label: 'RB', eligible: ['RB'], count: 1 },
  ],
  bench: 2,
  ir_slots: [],
  swap_spots: 0,
}
const IR_SETTINGS = { ...SETTINGS, ir_slots: [{ key: 'ir1', type: 'unrestricted', eligible_designations: ['OUT', 'IR'] }] }
const player = (id: string, position: string, status = 'Active', over: Record<string, unknown> = {}) => ({
  player_id: id,
  full_name: id,
  position,
  nfl_team: 'KC',
  status,
  bye_week: 10,
  slot_key: null,
  acquisition_type: null,
  acquisition_cost: null,
  ir_placed_week: null,
  ir_lock_until_week: null,
  acquired_at: null,
  pool_state: 'rostered',
  game_lock: { state: 'unlocked', until: null },
  ...over,
})
const WEEKS = [
  { id: 'w4', season: 2026, week: 4, status: 'final', finalized_at: null, median_score: null },
  { id: 'w5', season: 2026, week: 5, status: 'live', finalized_at: null, median_score: null },
]

function seedLeague(qc: QueryClient, id: string, team: string, opts: { outStarter: boolean; offerToMe: boolean; healthyInIr?: boolean }) {
  qc.setQueryData(scheduleKeys.all(id), { weeks: WEEKS, matchups: [] })
  qc.setQueryData(leaguesKeys.detail(id), {
    league: { id, status: 'in_season', season: 2026 },
    settings: { roster_settings: opts.healthyInIr ? IR_SETTINGS : SETTINGS },
    members: [{ team_id: `${id}2`, user_id: 'u2', profiles: { username: 'marcus', avatar_url: null } }],
    teams: [
      { id: team, name: 'Mine' },
      { id: `${id}2`, name: 'Theirs' },
    ],
    my_role: 'manager',
  })
  qc.setQueryData(leagueRosterKeys.all(id), {
    league_id: id,
    season: 2026,
    teams: [
      {
        team_id: team,
        name: 'Mine',
        roster: [
          player(`${id}-qb`, 'QB'),
          player(`${id}-rb`, 'RB', opts.outStarter ? 'Out' : 'Active'),
          // A healthy player left in the IR spot (placed in week 3).
          ...(opts.healthyInIr ? [player(`${id}-wr`, 'WR', 'Active', { slot_key: 'ir1:0', ir_placed_week: 3 })] : []),
        ],
      },
    ],
  })
  qc.setQueryData(teamLineupKeys.week(team, 5), { slot_map: { 'qb:0': `${id}-qb`, 'rb:0': `${id}-rb` }, starters: [], bench: [] })
  qc.setQueryData(tradeKeys.list(id, 'all', null), {
    viewer: { team_id: team },
    evaluated_at: '2026-10-15T12:00:00Z',
    trades: opts.offerToMe
      ? [
          {
            id: `${id}-t`,
            status: 'proposed',
            status_reason: null,
            created_at: '2026-10-15T11:00:00Z',
            proposer: { team_id: `${id}2`, name: 'Theirs' },
            recipient: { team_id: team, name: 'Mine' },
            items: [],
          },
        ]
      : [],
  })
}

function seeded() {
  const qc = new QueryClient()
  qc.setQueryData(['leagues'], LEAGUES)
  qc.setQueryData(['mobile-team-games', 2026, 5], [
    { id: 'g1', home_team: 'KC', away_team: 'DEN', kickoff_at: '2026-10-11T17:00:00Z', status: 'scheduled', home_score: null, away_score: null, quarter: null, game_clock: null },
  ])
  seedLeague(qc, 'A', 'a1', { outStarter: true, offerToMe: true })
  seedLeague(qc, 'B', 'b1', { outStarter: false, offerToMe: false })
  // Pre-draft C (status 'setup' on the Home list): its cache holds everything
  // that would light A's dot — a waiting offer and an Out starter — so only
  // the pre-draft rule keeps the dot off, and the reads below show the hook
  // never touched it.
  seedLeague(qc, 'C', 'c1', { outStarter: true, offerToMe: true })
  return qc
}

/** The keys one league's dot reads (the league screens' own). */
const alertKeys = (id: string, team: string) => [
  scheduleKeys.all(id),
  leaguesKeys.detail(id),
  leagueRosterKeys.all(id),
  teamLineupKeys.week(team, 5),
  tradeKeys.list(id, 'all', null),
]

/** Whether a hook read this key during the render: a query a hook observes
 *  carries that hook's queryFn; a seeded key nobody read has none. */
const wasRead = (qc: QueryClient, key: readonly unknown[]) =>
  qc.getQueryCache().find({ queryKey: key, exact: true })?.options.queryFn !== undefined

const render = (qc: QueryClient = seeded()) =>
  renderToStaticMarkup(createElement(QueryClientProvider, { client: qc }, createElement(HomeMatchups)))
    .replace(/&#x27;/g, "'")
    .replace(/&amp;/g, '&')

/** One card's markup, from its opening tag to its close. */
const card = (html: string, id: string) => {
  const from = html.indexOf(`data-league-card="${id}"`)
  return from < 0 ? '' : html.slice(from, html.indexOf('</a>', from))
}

describe('Home league card red dot (ruling #14)', () => {
  it('lights when something needs you, and says what', () => {
    const a = card(render(), 'A')
    expect(a).toContain('data-league-alert')
    expect(a).toContain('bg-negative-strong')
    expect(a).toContain('Needs your attention: a trade offer is waiting for your answer and a starter is out')
  })

  it('stays off when nothing needs you, and on a pre-draft card', () => {
    const html = render()
    expect(card(html, 'B')).not.toBe('')
    expect(card(html, 'B')).not.toContain('data-league-alert')
    expect(card(html, 'C')).toContain('Pre-draft')
    expect(card(html, 'C')).not.toContain('data-league-alert')
  })

  it('reads nothing for a pre-draft league', () => {
    const qc = seeded()
    render(qc)
    // The check sees a read: every key of in-season A was read…
    expect(alertKeys('A', 'a1').map((k) => wasRead(qc, k))).toEqual([true, true, true, true, true])
    // …and none of pre-draft C's, though all of them sit in the cache. The
    // one exception is the league detail: the card itself reads it for the
    // draft time on its pill (gap list §3 #20), not for the dot.
    expect(alertKeys('C', 'c1').map((k) => wasRead(qc, k))).toEqual([false, true, false, false, false])
  })

  it('lights for a healthy player left in your IR spot — on Home and on the Leagues tab — with no read of its own', () => {
    const qc = seeded()
    const D = L('D', 'in_season', 'd1')
    qc.setQueryData(['leagues'], [...LEAGUES, D])
    seedLeague(qc, 'D', 'd1', { outStarter: false, offerToMe: false, healthyInIr: true })
    const d = card(render(qc), 'D')
    expect(d).toContain('data-league-alert')
    expect(d).toContain('Needs your attention: you have an ineligible player in your IR spot')
    // The same reads as every other reason: nothing new is fetched for it.
    expect(alertKeys('D', 'd1').map((k) => wasRead(qc, k))).toEqual([true, true, true, true, true])
    // The Leagues tab's card is the same card (variant "leagues").
    const onLeagues = renderToStaticMarkup(
      createElement(QueryClientProvider, { client: qc }, createElement(LeagueCard, { league: D, index: 3, variant: 'leagues' })),
    ).replace(/&#x27;/g, "'")
    expect(onLeagues).toContain('data-league-alert')
    expect(onLeagues).toContain('Needs your attention: you have an ineligible player in your IR spot')
  })

  it('reads nothing while the leagues release is off', () => {
    flags.leagues = false
    try {
      expect(render()).not.toContain('data-league-alert')
    } finally {
      flags.leagues = true
    }
  })
})

/**
 * The FieldScout Mobile player profile (m-pprofile) rendered against seeded
 * caches — header, strip, tabs and each tab body — with the leagues release
 * gated off and on.
 */
import * as DialogPrimitive from '@radix-ui/react-dialog'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createElement, type ReactElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const flags = vi.hoisted(() => ({ leagues: false, messages: false }))
vi.mock('@/lib/feature-flags', () => ({ featureFlags: flags }))
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

import type { LeagueDetail } from '@/hooks/use-league'
import { leaguesKeys, type MyLeagueRow } from '@/hooks/use-leagues'
import type { ProfileStatLine } from '@/hooks/use-mobile-pprofile-stat-lines'
import type { PlayerStatsPlayer, PlayerStatsResponse } from '@/hooks/use-player-stats'
import { AUTH_SESSION_KEY } from '@/hooks/use-auth'
import { draftQueueKeys } from '@/hooks/use-draft-queue'
import type { CoreStatsPayload } from '@/lib/players/core-stats-ops'

import { ProfileLoaded } from './mobile-player-profile'
import { HistoryTab, GameLogTab, TeamTab } from './profile-stats-tabs'
import { LeaguesTab, QueueButton } from './profile-leagues'

const html = (el: ReactElement, qc: QueryClient) =>
  renderToStaticMarkup(createElement(QueryClientProvider, { client: qc }, createElement(DialogPrimitive.Root, { open: true }, el)))
    .replace(/&#x27;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')

const player: PlayerStatsPlayer = {
  id: 'p1',
  full_name: 'Bijan Robinson',
  position: 'RB',
  team: 'ATL',
  headshot_url: null,
  status: 'Questionable',
  jersey_number: 7,
  height: '72',
  weight: 220,
  birth_date: '2002-01-30',
  college: null,
  experience_years: 3,
  bye_week: 5,
  draft_year: null,
  draft_round: null,
  draft_pick: null,
  adp: 3,
  sos: null,
  auction_value: null,
  injury_body_part: 'Ankle',
  injury_notes: null,
  injury_start_date: null,
  practice_participation: null,
}

const season = { season: 2026, gamesPlayed: 4, totals: {} as never, fantasy: { ppr: 0, standard: 0 } }
const data: PlayerStatsResponse = { player, seasons: { current: season, last: { ...season, season: 2025 }, projection: season }, gameLog: [] }

const core: CoreStatsPayload = {
  basis: { kind: 'system', system: 'espn_standard' },
  season: 2026,
  // The NFL calendar's week: his bye (week 5), between week 4 and week 6.
  week: 5,
  total_points: 55,
  games: 4,
  avg_points: 13.75,
  projected_points: 15.2,
  pos_rank: 24,
  overall_rank: 60,
  weekly: [
    { week: 4, points: 14.4, proj: 12.1 },
    { week: 6, points: null, proj: 15.25 },
  ],
  box: { games: 4, totals: { rush_attempts: 64, rush_yards: 300, rush_tds: 2, targets: 12, receptions: 10 } },
  usage: { snap_pct: 72.5, target_share: null },
}

const games = [
  { week: 4, home_team: 'LV', away_team: 'ATL', kickoff_at: '2026-10-04T17:00:00Z', status: 'final' },
  { week: 6, home_team: 'ATL', away_team: 'PHI', kickoff_at: '2026-10-18T17:00:00Z', status: 'scheduled' },
]
const lines: ProfileStatLine[] = [
  { season: 2026, week: 4, is_live: false, rush_attempts: 16, rush_yards: 80, rush_tds: 1, receptions: 3, receiving_yards: 17, targets: 4, receiving_tds: 0 },
  { season: 2025, week: 1, is_live: false, rush_attempts: 10, rush_yards: 50, rush_tds: 0 },
]

function seeded(): QueryClient {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } })
  qc.setQueryData(['player-core-stats', 'p1', 'espn_standard'], core)
  qc.setQueryData(['player-core-stats', 'p1', 'ppr'], { ...core, basis: { kind: 'system', system: 'ppr' }, pos_rank: 11 })
  qc.setQueryData(['nfl-team-schedule', 2026, 'ATL'], games)
  qc.setQueryData(['defense-splits', 2026], [])
  qc.setQueryData(['mobile-pprofile-stat-lines', 'p1', 2026], lines)
  qc.setQueryData(['mobile-pprofile-depth-chart', 'ATL'], [
    { id: 'p1', full_name: 'Bijan Robinson', first_name: 'Bijan', last_name: 'Robinson', position: 'RB', birth_date: '2002-01-30', depth_chart_position: 'RB', depth_chart_order: 1 },
  ])
  qc.setQueryData(leaguesKeys.all, [])
  return qc
}

const target = { playerId: 'p1', leagueId: null, listContext: null }

describe('mobile player profile — leagues gated off', () => {
  beforeEach(() => {
    flags.leagues = false
  })

  it('team-coloured header: close, + List, injury pill, name, team line, bio', () => {
    const out = html(createElement(ProfileLoaded, { data, target, onClose: () => {} }), seeded())
    expect(out).toContain('background:#A71930')
    expect(out).toContain('data-profile-close')
    expect(out).toContain('>List</button>')
    expect(out).not.toContain('data-profile-action')
    expect(out).toMatch(/data-profile-status[^>]*>Questionable</)
    expect(out).toContain('Bijan Robinson')
    expect(out).toContain('ATL · #7')
    expect(out).toMatch(/Age \d+ · 6'0" · 220 lb · 4th season/)
  })

  it('strip: rank, avg, season pts, bye — and the tabs without the league ones', () => {
    const out = html(createElement(ProfileLoaded, { data, target, onClose: () => {} }), seeded())
    for (const s of ['#24', 'RB rank', '13.8', 'Avg pts', '55.0', '2026 pts', 'Bye week']) expect(out).toContain(s)
    expect(out).not.toContain('Rost')
    const tabs = [...out.matchAll(/data-profile-tab="(\w+)"/g)].map((m) => m[1])
    expect(tabs).toEqual(['summary', 'log', 'team', 'history'])
    expect(out).toMatch(/aria-selected="true"[^>]*data-profile-tab="summary"/)
  })

  it('tabs pattern: one tab stop, the selected tab controls the panel that names it', () => {
    const out = html(createElement(ProfileLoaded, { data, target, onClose: () => {} }), seeded())
    const selected = out.match(/role="tab" aria-selected="true" id="([^"]+)" aria-controls="([^"]+)" tabindex="0"/)
    expect(selected).not.toBeNull()
    const [, tabId, panelId] = selected!
    expect(out).toContain(`id="${panelId}" role="tabpanel" aria-labelledby="${tabId}"`)
    expect([...out.matchAll(/role="tab" aria-selected="false" id="[^"]+" tabindex="-1"/g)]).toHaveLength(3)
  })

  it('summary: key stats tiles and the game cards; no ownership row, no news', () => {
    const out = html(createElement(ProfileLoaded, { data, target, onClose: () => {} }), seeded())
    expect(out).not.toContain('data-profile-ownership')
    expect(out).toContain('Key stats')
    expect(out).toContain('RB · 2026')
    expect(out).toContain('data-key-stat="snap_pct"')
    expect(out).toContain('Games and projections')
    expect(out).toMatch(/data-game-week="4"[\s\S]*?Points[\s\S]*?14\.4[\s\S]*?16 car 80 yds · 3 rec 17 yds/)
    // His bye falls between the last game played and the next one: it is this week.
    expect(out).toMatch(/data-game-week="5" data-current="true"[\s\S]*?Bye week/)
    expect(out).toMatch(/data-game-week="6"[\s\S]*?Projected[\s\S]*?15\.3[\s\S]*?Kickoff/)
    expect(out).not.toContain('Recent news')
  })

  it('game log: season chips and the grouped table', () => {
    const qc = seeded()
    const out = html(
      createElement(GameLogTab, {
        player,
        season: 2026,
        year: 2026,
        onYear: () => {},
        choice: { kind: 'system', system: 'espn_standard' },
        core,
        schedule: [],
        lines,
        linesState: 'ready',
      }),
      qc,
    )
    expect([...out.matchAll(/aria-pressed="(true|false)"[^>]*>(\d{4})</g)].map((m) => [m[2], m[1]])).toEqual([
      ['2026', 'true'],
      ['2025', 'false'],
    ])
    expect(out).toContain('Fantasy')
    expect(out).toContain('Rushing')
    expect(out).toContain('Receiving')
    expect(out).toContain('data-table-row="4"')
    expect(out).toContain('14.40')
  })

  it('history: career rows without the transactions section; team tab depth chart', () => {
    const qc = seeded()
    const hist = html(
      createElement(HistoryTab, { player, season: 2026, choice: { kind: 'system', system: 'espn_standard' }, core, lines, linesState: 'ready', movesLeagueIds: null }),
      qc,
    )
    expect(hist).not.toContain('>Transactions<')
    expect(hist).toContain('Career')
    expect(hist).toContain('data-table-row="2026"')
    expect(hist).toContain('data-table-row="2025"')
    // Position rank [Std, PPR]: this season's from the two preset reads, tinted.
    expect(hist).toContain('Position rank')
    expect(hist).toMatch(/data-table-row="2026"[\s\S]*?bg-m-gr text-m-tr[^>]*>55\.0<[\s\S]*?bg-m-gr text-m-tr[^>]*>24<[\s\S]*?bg-m-gg text-m-tg[^>]*>11</)
    const team = html(createElement(TeamTab, { player }), qc)
    expect(team).toContain('Depth chart · ATL')
    expect(team).toContain('data-depth-slot="RB"')
    expect(team).toMatch(/text-accent[^>]*>Robinson</)
  })
})

describe('mobile player profile — leagues on', () => {
  beforeEach(() => {
    flags.leagues = true
  })

  const league: MyLeagueRow = {
    id: 'L1',
    name: 'Sunday Funday League',
    avatar_url: null,
    season: 2026,
    status: 'in_season',
    team_count: 12,
    created_at: null,
    my_role: 'member',
    my_team_id: 't1',
  }
  const detail = {
    league: { id: 'L1', name: 'Sunday Funday League', status: 'in_season', season: 2026 },
    settings: { draft: { time_zone: null, draft_scheduled_at: null }, roster_settings: { starting_slots: [{ key: 'rb', count: 2 }], bench: 5, ir_slots: [], swap_spots: 0 }, waiver_type: 'rolling', faab_min_bid: 0 },
    members: [{ id: 'm1', user_id: 'u1', team_id: 't1', role: 'member', is_placeholder: false, is_autodraft: false, joined_at: null, profiles: { username: 'dalton', avatar_url: null } }],
    teams: [{ id: 't1', name: 'Touchdown Tacos', owner_id: 'u1', status: 'active', created_at: null }],
    my_role: 'member',
    active_draft: null,
    waiver_window: null,
    waivers_live: true,
  } as unknown as LeagueDetail
  const rosterPlayer = {
    player_id: 'p1',
    full_name: 'Bijan Robinson',
    position: 'RB',
    nfl_team: 'ATL',
    status: null,
    bye_week: 5,
    slot_key: 'rb',
    acquisition_type: 'draft',
    acquisition_cost: null,
    ir_placed_week: null,
    ir_lock_until_week: null,
    acquired_at: null,
    pool_state: 'rostered',
    game_lock: { state: 'unlocked', until: null },
  }

  function inLeague(): QueryClient {
    const qc = seeded()
    qc.setQueryData(leaguesKeys.all, [league])
    qc.setQueryData(leaguesKeys.detail('L1'), detail)
    qc.setQueryData(['league-rosters', 'L1'], {
      league_id: 'L1',
      season: 2026,
      teams: [{ team_id: 't1', name: 'Touchdown Tacos', owner_id: 'u1', status: 'active', manager_user_id: 'u1', autopilot: false, faab_balance: null, waiver_priority: 1, roster: [rosterPlayer] }],
    })
    qc.setQueryData(['league-pool', 'L1'], [])
    qc.setQueryData(['league-trade-deadline', 'L1'], { state: 'known', view: { passed: false, ms_remaining: null } })
    qc.setQueryData(AUTH_SESSION_KEY, { user: { id: 'u1' } })
    qc.setQueryData(['player-core-stats', 'p1', 'league:L1'], core)
    return qc
  }

  it('in his league: the Drop pill, the ownership row and the league tabs', () => {
    const out = html(createElement(ProfileLoaded, { data, target: { ...target, leagueId: 'L1' }, onClose: () => {} }), inLeague())
    expect(out).toMatch(/data-profile-action="mine"[^>]*>Drop</)
    expect(out).toContain('data-profile-ownership')
    expect(out).toContain('Touchdown Tacos · your team')
    const tabs = [...out.matchAll(/data-profile-tab="(\w+)"/g)].map((m) => m[1])
    expect(tabs).toEqual(['summary', 'log', 'leagues', 'tx', 'team', 'history'])
  })

  it('leagues tab: his row in each league', () => {
    const qc = inLeague()
    const out = html(
      createElement(LeaguesTab, {
        player,
        pool: { id: 'p1', full_name: 'Bijan Robinson', position: 'RB', team: 'ATL', adp: 3, headshot_url: null, status: null },
        leagues: [league],
        pending: false,
        error: false,
        onMove: () => {},
        onTrade: () => {},
      }),
      qc,
    )
    expect(out).toContain('data-profile-league-row="L1"')
    expect(out).toContain('On your team · Touchdown Tacos')
    expect(out).toContain('>SF<')
  })

  it('another team’s player: the header offers Propose trade (the builder opens over the profile)', () => {
    const qc = inLeague()
    qc.setQueryData(['league-rosters', 'L1'], {
      league_id: 'L1',
      season: 2026,
      teams: [
        { team_id: 't1', name: 'Touchdown Tacos', owner_id: 'u1', status: 'active', manager_user_id: 'u1', autopilot: false, faab_balance: null, waiver_priority: 1, roster: [] },
        { team_id: 't2', name: 'Gridiron Gurus', owner_id: 'u2', status: 'active', manager_user_id: 'u2', autopilot: false, faab_balance: null, waiver_priority: 2, roster: [rosterPlayer] },
      ],
    })
    const out = html(createElement(ProfileLoaded, { data, target: { ...target, leagueId: 'L1' }, onClose: () => {} }), qc)
    expect(out).toMatch(/data-profile-action="theirs"[^>]*>Propose trade</)
  })

  it('a draft seat’s Queue: the header pill, then "In your queue" once he is in it', () => {
    // (The seat reaches the profile through the profile store, which a
    // server render cannot seed — the pill itself is checked here.)
    const qc = inLeague()
    qc.setQueryData(draftQueueKeys.queue('d1', 't1'), [])
    const props = { leagueId: 'L1', leagueName: 'Sunday Funday League', draftId: 'd1', teamId: 't1', playerId: 'p1', variant: 'header' as const }
    expect(html(createElement(QueueButton, props), qc)).toMatch(/data-profile-queue="header"[^>]*>Add to queue</)
    qc.setQueryData(draftQueueKeys.queue('d1', 't1'), [{ player_id: 'p1', rank: 1 }])
    expect(html(createElement(QueueButton, props), qc)).toMatch(/disabled=""[^>]*data-profile-queue="header"[^>]*>In your queue</)
    // No read yet: the pill waits rather than treating the queue as empty.
    expect(html(createElement(QueueButton, { ...props, draftId: 'd2' }), qc)).toMatch(/disabled=""[^>]*>Add to queue</)
  })
})

/**
 * FieldScout Mobile Players tabs over real static renders (the desktop
 * players-page rig: `renderToStaticMarkup` with the React Query cache
 * pre-seeded, auth / channel / router mocked at the module edge).
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { PoolPlayer } from '@/components/draft/available-players-ops'
import { NO_SEAT_COPY } from '@/components/leagues/players-page-ops'
import type { LeagueDetail } from '@/hooks/use-league'
import { leaguePoolKeys, type PoolRow } from '@/hooks/use-league-pool'
import { leaguesKeys } from '@/hooks/use-leagues'
import type { ResearchPool } from '@/hooks/use-mobile-players-data'
import { LEAGUE_DEFAULTS, RESEARCH_DEFAULTS, useMobilePlayersUI } from '@/hooks/use-mobile-players-ui'
import { poolValueKeys } from '@/hooks/use-pool-values'
import { leagueRosterKeys } from '@/hooks/use-rosters'
import { scheduleKeys } from '@/hooks/use-schedule'
import type { LeagueRosters, RosterPlayer } from '@/lib/leagues/api/rosters-service'
import { defaultsForTeamCount } from '@/lib/leagues/settings/league-settings'

import { LeaguePlayersScreen } from './league-players-screen'
import { sumLines } from './players-ops'
import { ResearchPlayersScreen } from './research-players-screen'

let viewer = 'user-manager'
vi.mock('@/hooks/use-auth', () => ({
  useAuth: () => ({ user: { id: viewer }, profile: null }),
}))
vi.mock('@/hooks/use-league-channel', () => ({
  useLeagueChannel: vi.fn(() => ({ connection: 'live' })),
}))
// A static render reads a Zustand store's INITIAL state (its server
// snapshot); read the live state instead so a test can set the filters.
vi.mock('@/hooks/use-mobile-players-ui', async (importOriginal) => {
  const mod = await importOriginal<typeof import('@/hooks/use-mobile-players-ui')>()
  const store = mod.useMobilePlayersUI
  const hook = Object.assign(<T,>(selector: (s: ReturnType<typeof store.getState>) => T) => selector(store.getState()), store)
  return { ...mod, useMobilePlayersUI: hook }
})
vi.mock('next/navigation', () => ({
  usePathname: () => '/app/leagues/league-1/players',
  useRouter: () => ({ push: () => {}, replace: () => {}, refresh: () => {}, back: () => {} }),
}))

const LEAGUE = 'league-1'
const MINE = 'team-mine'
const OTHER = 'team-other'

const detail: LeagueDetail = {
  league: {
    id: LEAGUE,
    name: 'Sunday Funday League',
    avatar_url: null,
    description: null,
    season: 2099,
    status: 'in_season',
    owner_id: 'user-commish',
    scoring_system_id: null,
    invite_code: null,
    invite_slug: null,
    max_teams: 8,
    created_at: null,
    updated_at: null,
    champion_team_id: null,
  },
  settings: defaultsForTeamCount(8),
  members: [
    { id: 'm1', user_id: 'user-manager', team_id: MINE, role: 'manager', is_placeholder: false, is_autodraft: false, joined_at: null, profiles: { username: 'dalton', avatar_url: null } },
    { id: 'm2', user_id: 'user-other', team_id: OTHER, role: 'manager', is_placeholder: false, is_autodraft: false, joined_at: null, profiles: { username: 'marcus', avatar_url: null } },
  ],
  teams: [
    { id: MINE, name: 'My Team', owner_id: 'user-manager', status: 'active', created_at: null },
    { id: OTHER, name: 'Their Team', owner_id: 'user-other', status: 'active', created_at: null },
  ],
  my_role: 'manager',
  active_draft: null,
}

function rp(id: string, name: string): RosterPlayer {
  return {
    player_id: id,
    full_name: name,
    position: 'WR',
    nfl_team: 'KC',
    status: 'Active',
    bye_week: null,
    slot_key: 'bn',
    acquisition_type: null,
    acquisition_cost: null,
    ir_placed_week: null,
    ir_lock_until_week: null,
    acquired_at: null,
    pool_state: 'rostered',
    game_lock: { state: 'unlocked', until: null },
  }
}
const rosters: LeagueRosters = {
  league_id: LEAGUE,
  season: 2099,
  teams: [
    { team_id: MINE, name: 'My Team', owner_id: 'user-manager', status: 'active', manager_user_id: 'user-manager', autopilot: false, faab_balance: 100, waiver_priority: 1, roster: [rp('mine', 'Mine Guy')] },
    { team_id: OTHER, name: 'Their Team', owner_id: 'user-other', status: 'active', manager_user_id: 'user-other', autopilot: false, faab_balance: 100, waiver_priority: 2, roster: [rp('theirs', 'Theirs Guy')] },
  ],
}
const pool: PoolRow[] = [
  { player_id: 'fa-open', state: 'free_agent', waivers_until: null, game_lock: { state: 'unlocked', until: null } },
  { player_id: 'fa-locked', state: 'locked_in_game', waivers_until: null, game_lock: { state: 'locked_until', until: '2099-09-15T04:00:00.000Z' } },
  { player_id: 'fa-waivers', state: 'on_waivers', waivers_until: '2099-09-16T07:00:00.000Z', game_lock: { state: 'unlocked', until: null } },
]
function pp(id: string, name: string, position: string, adp: number, status = 'Active'): PoolPlayer {
  return { id, full_name: name, position, team: 'KC', adp, headshot_url: null, status }
}
const windowPlayers: PoolPlayer[] = [
  pp('fa-open', 'Jordan Open', 'QB', 10, 'Questionable'),
  pp('fa-locked', 'Lock Ed', 'RB', 20),
  pp('fa-waivers', 'Wavy Waiver', 'WR', 30),
  pp('mine', 'Mine Guy', 'WR', 40),
  pp('theirs', 'Theirs Guy', 'WR', 50),
]
const rosteredPlayers = windowPlayers.filter((p) => p.id === 'mine' || p.id === 'theirs')

function render(qc: QueryClient, element: React.ReactElement): string {
  return renderToStaticMarkup(createElement(QueryClientProvider, { client: qc }, element))
    .replace(/&#x27;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
}

function seedLeague(over: { detail?: LeagueDetail } = {}): QueryClient {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, retryOnMount: false } } })
  qc.setQueryData(leaguesKeys.detail(LEAGUE), over.detail ?? detail)
  qc.setQueryData(leagueRosterKeys.all(LEAGUE), rosters)
  qc.setQueryData(leaguePoolKeys.all(LEAGUE), pool)
  qc.setQueryData(scheduleKeys.all(LEAGUE), {
    weeks: [4, 5, 6].map((week) => ({ id: `w${week}`, season: 2099, week, status: week === 5 ? 'live' : week < 5 ? 'final' : 'upcoming', finalized_at: null, median_score: null })),
    matchups: [],
  })
  // The browse window's key: positions, NFL team, the searched name.
  qc.setQueryData(['mobile-players-window', '', '', ''], windowPlayers)
  qc.setQueryData(['mobile-players-by-ids', ['mine', 'theirs']], rosteredPlayers)
  // Every on-waivers player is read by id (whatever his ADP).
  qc.setQueryData(['mobile-players-by-ids', ['fa-waivers']], windowPlayers.filter((p) => p.id === 'fa-waivers'))
  const avail = ['fa-locked', 'fa-open', 'fa-waivers'].join(',')
  qc.setQueryData(poolValueKeys.window(LEAGUE, 5, avail), {
    league_id: LEAGUE,
    season: 2099,
    week: 5,
    unknown_players: [],
    values: [
      { player_id: 'fa-open', projected_points: 22.4, projected_missing: null, season_points: 60, season_games: 4 },
      { player_id: 'fa-locked', projected_points: 9.1, projected_missing: null, season_points: 30, season_games: 4 },
      { player_id: 'fa-waivers', projected_points: null, projected_missing: 'no_line', season_points: null, season_games: 0 },
    ],
  })
  // Week 5's points come from the season-to-date read at week 6 (Tot).
  qc.setQueryData(poolValueKeys.window(LEAGUE, 6, avail), {
    league_id: LEAGUE,
    season: 2099,
    week: 6,
    unknown_players: [],
    values: [
      { player_id: 'fa-open', projected_points: null, projected_missing: 'no_line', season_points: 81.5, season_games: 5 },
      { player_id: 'fa-locked', projected_points: null, projected_missing: 'no_line', season_points: 30, season_games: 4 },
      { player_id: 'fa-waivers', projected_points: null, projected_missing: 'no_line', season_points: null, season_games: 0 },
    ],
  })
  // This week's box lines (the default columns show Tot yds / Rush att / Tgt).
  qc.setQueryData(
    ['mobile-player-lines', { season: 2099, week: 5 }, ['fa-locked', 'fa-open', 'fa-waivers']],
    sumLines([{ player_id: 'fa-locked', rush_attempts: 14, rush_yards: 61 }]),
  )
  // Season usage (the default columns show Snap% / TgtSh).
  qc.setQueryData(['mobile-player-usage', 2099, ['fa-locked', 'fa-open', 'fa-waivers']], new Map([['fa-locked', { snap: 61, tshare: 9 }]]))
  return qc
}

afterEach(() => {
  viewer = 'user-manager'
  useMobilePlayersUI.setState({ league: LEAGUE_DEFAULTS, research: RESEARCH_DEFAULTS })
})

describe('League › Players (mobile)', () => {
  it('opens on Available, this week, sorted by Proj — the pills, the title and count', () => {
    const html = render(seedLeague(), createElement(LeaguePlayersScreen, { leagueId: LEAGUE }))
    expect(html).toContain('Sunday Funday League')
    expect(html).toMatch(/data-pill="status"[^>]*>Available/)
    expect(html).toMatch(/data-pill="per"[^>]*>Week 5/)
    expect(html).toMatch(/data-pill="pos"[^>]*>Position/)
    expect(html).toMatch(/data-pill="team"[^>]*>Teams/)
    expect(html).toContain('data-players-count="true">3</span>')
    // Available = unowned only; Proj sorts high to low, a missing Proj last.
    const order = [...html.matchAll(/data-player-row="([^"]+)"/g)].map((m) => m[1])
    expect(order).toEqual(['fa-open', 'fa-locked', 'fa-waivers'])
    expect(html).toContain('22.4')
    // Tot for Week 5 = season to date at week 6 minus at week 5; no game = "–".
    expect(html).toContain('>21.5</span>')
    expect(html).toContain('J. Open')
    expect(html).toMatch(/J\. Open<\/button>.*?>Q</)
  })

  it('each row offers the app’s own door: + for a free agent, W for waivers, a closed + on a locked player', () => {
    const html = render(seedLeague(), createElement(LeaguePlayersScreen, { leagueId: LEAGUE }))
    const row = (id: string) => html.slice(html.indexOf(`data-player-row="${id}"`), html.indexOf('data-player-row=', html.indexOf(`data-player-row="${id}"`) + 20))
    expect(row('fa-open')).toContain('data-action="add"')
    expect(row('fa-open')).not.toContain('data-closed')
    expect(row('fa-waivers')).toContain('data-action="claim"')
    expect(row('fa-waivers')).toContain('>W</span>')
    expect(row('fa-waivers')).toContain('Waivers · ')
    expect(row('fa-locked')).toContain('data-closed="true"')
  })

  it('All players adds the rostered rows: Drop on mine, Trade on theirs with the manager’s @handle', () => {
    useMobilePlayersUI.setState({ league: { ...LEAGUE_DEFAULTS, status: 'all' } })
    const qc = seedLeague()
    const all = ['fa-locked', 'fa-open', 'fa-waivers', 'mine', 'theirs']
    qc.setQueryData(poolValueKeys.window(LEAGUE, 5, all.join(',')), { league_id: LEAGUE, season: 2099, week: 5, unknown_players: [], values: [] })
    qc.setQueryData(poolValueKeys.window(LEAGUE, 6, all.join(',')), { league_id: LEAGUE, season: 2099, week: 6, unknown_players: [], values: [] })
    qc.setQueryData(['mobile-player-lines', { season: 2099, week: 5 }, all], new Map())
    qc.setQueryData(['mobile-player-usage', 2099, all], new Map())
    const html = render(qc, createElement(LeaguePlayersScreen, { leagueId: LEAGUE }))
    const row = (id: string) => html.slice(html.indexOf(`data-player-row="${id}"`), html.indexOf('</div></div>', html.indexOf(`data-player-row="${id}"`)))
    expect(row('mine')).toContain('data-action="drop"')
    expect(row('mine')).toContain('Your team')
    expect(row('theirs')).toContain('data-action="trade"')
    expect(row('theirs')).toContain('data-username-link="marcus"')
  })

  it('a viewer with no team sees no action column and says why', () => {
    viewer = 'user-stranger'
    const html = render(seedLeague(), createElement(LeaguePlayersScreen, { leagueId: LEAGUE }))
    expect(html).toContain(NO_SEAT_COPY)
    expect(html).not.toContain('data-action=')
  })

  it('Sheet view: the locked Player column, group bands, the blue sort header', () => {
    useMobilePlayersUI.setState({ league: { ...LEAGUE_DEFAULTS, view: 'sheet' } })
    const html = render(seedLeague(), createElement(LeaguePlayersScreen, { leagueId: LEAGUE }))
    expect(html).toContain('data-players-view="sheet"')
    expect(html).toContain('>Player</div>')
    expect(html).toContain('>Fantasy</div>')
    expect(html).toMatch(/aria-label="Projected points, sorted high to low" class="[^"]*text-accent/)
  })

  it('Waivers lists every player on waivers — one outside the ADP window too', () => {
    useMobilePlayersUI.setState({ league: { ...LEAGUE_DEFAULTS, status: 'w', cols: ['oprk'], sort: 'oprk' } })
    const qc = seedLeague()
    qc.setQueryData(leaguePoolKeys.all(LEAGUE), [
      ...pool,
      { player_id: 'deep-waiver', state: 'on_waivers', waivers_until: '2099-09-16T07:00:00.000Z', game_lock: { state: 'unlocked', until: null } },
    ])
    qc.setQueryData(['mobile-players-by-ids', ['deep-waiver', 'fa-waivers']], [pp('deep-waiver', 'Deep Cut', 'TE', 900), windowPlayers[2]!])
    const html = render(qc, createElement(LeaguePlayersScreen, { leagueId: LEAGUE }))
    const order = [...html.matchAll(/data-player-row="([^"]+)"/g)].map((m) => m[1])
    expect(order).toEqual(['fa-waivers', 'deep-waiver'])
    // A complete set: no "+" on the count.
    expect(html).toContain('data-players-count="true">2</span>')
  })

  it('a failed schedule read is said, with a retry — not left as blank columns', () => {
    const qc = seedLeague()
    qc.removeQueries({ queryKey: scheduleKeys.all(LEAGUE) })
    const query = qc.getQueryCache().build(qc, { queryKey: scheduleKeys.all(LEAGUE) })
    query.setState({ status: 'error', error: new Error('boom'), fetchStatus: 'idle' })
    const html = render(qc, createElement(LeaguePlayersScreen, { leagueId: LEAGUE }))
    expect(html).toContain('Couldn’t load the league’s schedule')
    expect(html).toContain('Try again')
  })

  it('Trending: Home’s risers, my own players left out, each with Proj and its door', () => {
    const qc = seedLeague()
    const builder = (id: string, name: string, projected: number, last: number) => ({
      id,
      full_name: name,
      position: 'WR',
      team: 'KC',
      headshot_url: null,
      status: 'Active',
      current_pts: 0,
      current_games: 0,
      last_pts: last,
      last_games: 17,
      projected_pts: projected,
    })
    qc.setQueryData(['home', 'players', 'ppr'], {
      players: [builder('fa-open', 'Jordan Open', 250, 200), builder('mine', 'Mine Guy', 300, 100), builder('theirs', 'Theirs Guy', 220, 190)],
    })
    qc.setQueryData(poolValueKeys.window(LEAGUE, 5, ['fa-open', 'theirs'].join(',')), {
      league_id: LEAGUE,
      season: 2099,
      week: 5,
      unknown_players: [],
      values: [
        { player_id: 'fa-open', projected_points: 22.4, projected_missing: null, season_points: 60, season_games: 4 },
        { player_id: 'theirs', projected_points: null, projected_missing: 'no_line', season_points: null, season_games: 0 },
      ],
    })
    const html = render(qc, createElement(LeaguePlayersScreen, { leagueId: LEAGUE }))
    const tiles = [...html.matchAll(/data-trend-tile="([^"]+)"/g)].map((m) => m[1])
    expect(tiles).toEqual(['fa-open', 'theirs'])
    const tile = (id: string) => html.slice(html.indexOf(`data-trend-tile="${id}"`), html.indexOf('</section>', html.indexOf(`data-trend-tile="${id}"`)))
    expect(tile('fa-open')).toContain('+50.0</span> vs last yr')
    expect(tile('fa-open')).toContain('Proj 22.4')
    expect(tile('fa-open')).toMatch(/data-action="add"[^>]*>Add</)
    expect(tile('theirs')).toMatch(/data-action="trade"[^>]*>Trade</)
  })

  it('an empty filter says so', () => {
    useMobilePlayersUI.setState({ league: { ...LEAGUE_DEFAULTS, status: 'w', pos: 'K' } })
    const qc = seedLeague()
    qc.setQueryData(['mobile-players-window', 'K', '', ''], [])
    const html = render(qc, createElement(LeaguePlayersScreen, { leagueId: LEAGUE }))
    expect(html).toContain('No players match these filters')
  })
})

/** Gap list §4 item 13: the league Players tab's search — the quick way to a
 *  deep free agent, searched server-side over the whole pool. The stats
 *  columns are trimmed to OPRK so a test seeds only the player reads. */
describe('League › Players search (mobile)', () => {
  const lean = { cols: ['oprk' as const], sort: 'oprk' as const }
  const order = (html: string) => [...html.matchAll(/data-player-row="([^"]+)"/g)].map((m) => m[1])
  /** `n` window rows named "Player a<i>", ADP order. */
  const many = (n: number) => Array.from({ length: n }, (_, i) => pp(`p${String(i).padStart(3, '0')}`, `Player a${i}`, 'WR', 100 + i))

  it('sits above the pills, empty until typed — no clear button, Trending shown', () => {
    const html = render(seedLeague(), createElement(LeaguePlayersScreen, { leagueId: LEAGUE }))
    expect(html).toMatch(/<form role="search"[^>]*>.*?placeholder="Search players" aria-label="Search players"[^>]*value=""/)
    expect(html.indexOf('data-players-search')).toBeLessThan(html.indexOf('data-pill="status"'))
    expect(html).not.toContain('aria-label="Clear search"')
    expect(html).toContain('Trending')
  })

  it('a typed name reads the server’s search — a deep free agent the browse window never loads', () => {
    useMobilePlayersUI.setState({ league: { ...LEAGUE_DEFAULTS, ...lean, query: 'Deep' } })
    const qc = seedLeague()
    // The server answers the name over the whole pool (ADP 700 — far past
    // the 300-row browse window).
    qc.setQueryData(['mobile-players-window', '', '', 'Deep'], [pp('deep-fa', 'Deep Free', 'WR', 700)])
    const html = render(qc, createElement(LeaguePlayersScreen, { leagueId: LEAGUE }))
    expect(html).toContain('value="Deep"')
    expect(html).toContain('aria-label="Clear search"')
    // The on-waivers player (read by id) doesn't match, so only the search's row.
    expect(order(html)).toEqual(['deep-fa'])
    expect(html).toContain('data-players-count="true">1</span>')
    // Looking for someone in particular: no Trending above the result.
    expect(html).not.toContain('Trending')
  })

  it('the complete by-id sets are matched by the same rule (Waivers)', () => {
    useMobilePlayersUI.setState({ league: { ...LEAGUE_DEFAULTS, ...lean, status: 'w', query: 'wavy' } })
    const html = render(seedLeague(), createElement(LeaguePlayersScreen, { leagueId: LEAGUE }))
    expect(order(html)).toEqual(['fa-waivers'])

    useMobilePlayersUI.setState({ league: { ...LEAGUE_DEFAULTS, ...lean, status: 'w', query: 'nobody' } })
    const none = render(seedLeague(), createElement(LeaguePlayersScreen, { leagueId: LEAGUE }))
    expect(none).toContain('No players on waivers match “nobody”')
    // Nothing else matches either — no way out to offer.
    expect(none).not.toContain('data-players-empty-action')
  })

  it('a match the status pill hides is said, with "Show all players"', () => {
    useMobilePlayersUI.setState({ league: { ...LEAGUE_DEFAULTS, ...lean, query: 'mine' } })
    const qc = seedLeague()
    qc.setQueryData(['mobile-players-window', '', '', 'mine'], [pp('mine', 'Mine Guy', 'WR', 40)])
    const html = render(qc, createElement(LeaguePlayersScreen, { leagueId: LEAGUE }))
    expect(order(html)).toEqual([])
    expect(html).toContain('No available players match “mine”')
    expect(html).toMatch(/data-players-empty-action="true">Show all players</)
  })

  it('a search that fills the window says so — never a silent cap', () => {
    useMobilePlayersUI.setState({ league: { ...LEAGUE_DEFAULTS, ...lean, status: 'fa', query: 'a' } })
    const qc = seedLeague()
    qc.setQueryData(['mobile-players-window', '', '', 'a'], many(300))
    const html = render(qc, createElement(LeaguePlayersScreen, { leagueId: LEAGUE }))
    expect(html).toContain('Lots of players match — showing the top 300 by ADP. Keep typing to narrow it.')
    expect(html).toContain('data-players-count="true">300+</span>')
  })

  it('the browse window’s cap is said at the end of the list', () => {
    useMobilePlayersUI.setState({ league: { ...LEAGUE_DEFAULTS, ...lean, status: 'fa' } })
    const qc = seedLeague()
    const window = many(300)
    qc.setQueryData(['mobile-players-window', '', '', ''], window)
    // All but 10 are on a roster, so every free agent fits on one page.
    qc.setQueryData(leagueRosterKeys.all(LEAGUE), {
      ...rosters,
      teams: [rosters.teams[0]!, { ...rosters.teams[1]!, roster: window.slice(10).map((p) => rp(p.id, p.full_name)) }],
    })
    const html = render(qc, createElement(LeaguePlayersScreen, { leagueId: LEAGUE }))
    expect(order(html)).toHaveLength(10)
    expect(html).toContain('That’s the top 300 by ADP. Search to find anyone else.')
    // A search isn't capped by this — the note is the browse window's.
    expect(html).not.toContain('Lots of players match')
  })
})

describe('account Players tab (mobile research)', () => {
  const researchPool: ResearchPool = {
    season: { current: 2099, last: 2098 },
    players: [
      {
        id: 'r1',
        full_name: 'Bijan Robinson',
        position: 'RB',
        team: 'ATL',
        headshot_url: null,
        status: 'Active',
        depth_chart_order: 1,
        depth_chart_position: 'RB',
        current_pts: 120.5,
        current_games: 6,
        last_pts: 300,
        last_games: 17,
        projected_pts: 310.2,
        stats_current: { rush_yards: 540, rush_attempts: 100, receptions: 20, targets: 26, receiving_yards: 180 },
        stats_last: {},
      },
      {
        id: 'r2',
        full_name: 'Some Kicker',
        position: 'K',
        team: 'KC',
        headshot_url: null,
        status: 'Active',
        depth_chart_order: null,
        depth_chart_position: null,
        current_pts: 50,
        current_games: 6,
        last_pts: 140,
        last_games: 17,
        projected_pts: 140,
        stats_current: { fg_made: 12 },
        stats_last: {},
      },
    ],
  }

  it('lists the pool with ranks, stats and the add-to-list door — no league actions', () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false, retryOnMount: false } } })
    qc.setQueryData(['mobile-research-pool', 'ppr'], researchPool)
    const html = render(qc, createElement(ResearchPlayersScreen, {}))
    expect(html).toContain('>Players</h1>')
    // Its search lives behind the header's magnifier, not above the pills.
    expect(html).not.toContain('data-players-search')
    expect(html).toMatch(/data-pill="scoring"[^>]*>PPR/)
    expect(html).toMatch(/data-pill="season"[^>]*>2099/)
    expect(html).toContain('data-players-count="true">2</span>')
    expect(html).toContain('B. Robinson')
    expect(html).toContain('RB1 · 6 games in 2099')
    expect(html).toContain('aria-label="Add Bijan Robinson to a list"')
    expect(html).not.toContain('data-action=')
    // The favourites star waits for the favourites set (the server toggles).
    expect(html).toMatch(/disabled="" aria-pressed="false" aria-label="Save Bijan Robinson to favorites"/)
    // Position rank over the whole pool; the kicker has no rushing line.
    expect(html).toContain('>RB1</span>')
    expect(html).toContain('>720</span>')
    expect(html).toContain('>100</span>')
  })

  it('stars a favourite from the favourites set, and never guesses a season year', () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false, retryOnMount: false } } })
    qc.setQueryData(['mobile-research-pool', 'ppr'], researchPool)
    qc.setQueryData(['favorites', 'player-set'], new Set(['r1']))
    const html = render(qc, createElement(ResearchPlayersScreen, {}))
    expect(html).toMatch(/aria-pressed="true" aria-label="Remove Bijan Robinson from favorites"/)
    expect(html).toMatch(/aria-pressed="false" aria-label="Save Some Kicker to favorites"/)

    const pending = new QueryClient({ defaultOptions: { queries: { retry: false, retryOnMount: false } } })
    const loading = render(pending, createElement(ResearchPlayersScreen, {}))
    expect(loading).toMatch(/data-pill="season"[^>]*>This season/)
    expect(loading).not.toMatch(/data-pill="season"[^>]*>20\d\d/)
  })
})

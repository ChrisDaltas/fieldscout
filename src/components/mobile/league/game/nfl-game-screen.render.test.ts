/**
 * The NFL game screen on the phone (gap list §3 #17; handoff m-match §2.3
 * single game, Box score) over a real render with the React Query cache
 * seeded (`renderToStaticMarkup` — effects don't run, so the cache IS the
 * data): your matchup's stored scores in the bar, the week's games in the
 * picker with this one ringed, the game header, and the box's player groups.
 * Pins what is left out for want of data (gap list §2): Play by play, the
 * Team stats table, the win bar.
 */
import { keepPreviousData, QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

import type { LeagueDetail } from '@/hooks/use-league'
import { leaguesKeys } from '@/hooks/use-leagues'
import { leagueMatchupKeys } from '@/hooks/use-matchups'
import type { MobileWeekGame } from '@/hooks/use-mobile-team-games'
import { nflGameBoxKeys, nflGameBoxQuery, type NflGameBox } from '@/hooks/use-nfl-game-box'
import type { WeekMatchups } from '@/lib/leagues/api/matchups-service'
import { defaultsForTeamCount } from '@/lib/leagues/settings/league-settings'

import { NflGameRouteScreen, NflGameScreen } from './nfl-game-screen'

const route = vi.hoisted(() => ({ params: { gameId: 'g-cin-mia' } as Record<string, string> }))
vi.mock('next/navigation', () => ({
  usePathname: () => '/app/leagues/league-1/games/g-cin-mia',
  useRouter: () => ({ push: vi.fn(), back: vi.fn(), replace: vi.fn() }),
  useParams: () => route.params,
}))
vi.mock('@/hooks/use-auth', () => ({
  useAuth: () => ({ user: { id: 'user-me' }, profile: { username: 'dalton' } }),
}))
vi.mock('@/hooks/use-league-channel', () => ({
  useLeagueChannel: vi.fn(() => ({ connection: 'live' })),
}))
// The last game's answer kept on screen while the picked one reads (what
// `keepPreviousData` does; a static render has no earlier observer to keep).
const kept = vi.hoisted(() => ({ from: null as string | null }))
vi.mock('@/hooks/use-nfl-game-box', async (importActual) => {
  const actual = await importActual<typeof import('@/hooks/use-nfl-game-box')>()
  return {
    ...actual,
    useNflGameBox: (gameId: string) => {
      if (!kept.from) return actual.useNflGameBox(gameId)
      return { ...actual.useNflGameBox(kept.from), isPlaceholderData: true }
    },
  }
})

const LEAGUE = 'league-1'
const ME = 'aaaaaaaa-0000-4000-8000-000000000001'
const OPP = 'aaaaaaaa-0000-4000-8000-000000000002'

const DETAIL: LeagueDetail = {
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
  settings: defaultsForTeamCount(8),
  members: [
    { id: 'm1', user_id: 'user-me', team_id: ME, role: 'manager', is_placeholder: false, is_autodraft: false, joined_at: null, profiles: { username: 'dalton', avatar_url: null } },
    { id: 'm2', user_id: 'user-opp', team_id: OPP, role: 'manager', is_placeholder: false, is_autodraft: false, joined_at: null, profiles: { username: 'marcus', avatar_url: null } },
  ],
  teams: [
    { id: ME, name: 'Touchdown Tacos', owner_id: 'user-me', status: 'active', created_at: null },
    { id: OPP, name: 'Gridiron Gurus', owner_id: 'user-opp', status: 'active', created_at: null },
  ],
  my_role: 'manager',
  active_draft: null,
}

const WEEK: WeekMatchups = {
  league_id: LEAGUE,
  season: 2099,
  week: 5,
  schedule_mode: 'h2h',
  league_week: { status: 'live', median_score: null, finalized_at: null },
  teams: [
    { id: ME, name: 'Touchdown Tacos', status: 'active' },
    { id: OPP, name: 'Gridiron Gurus', status: 'active' },
  ],
  // You are the away team: the bar still puts you on the left.
  matchups: [{ id: 'mB', season: 2099, week: 5, round_type: 'regular', status: 'live', home_team_id: OPP, away_team_id: ME, home_score: 16.4, away_score: 39.7, result: null, is_overridden: false, updated_at: null }],
  results: [],
}

const GAME = {
  id: 'g-cin-mia',
  season: 2099,
  week: 5,
  away_team: 'CIN',
  home_team: 'MIA',
  kickoff_at: '2099-10-11T17:00:00Z',
  status: 'live',
  away_score: 28,
  home_score: 18,
  quarter: 4,
  game_clock: '2:19',
}

const BOX: NflGameBox = {
  game: GAME,
  players: [
    { id: 'burrow', full_name: 'Joe Burrow', position: 'QB', team: 'CIN' },
    { id: 'tua', full_name: 'Tua Tagovailoa', position: 'QB', team: 'MIA' },
    { id: 'chase', full_name: "Ja'Marr Chase", position: 'WR', team: 'CIN' },
  ],
  lines: [
    { player_id: 'burrow', game_id: null, pass_completions: 24, pass_attempts: 31, pass_yards: 288, pass_tds: 2, interceptions: 0 },
    { player_id: 'tua', game_id: null, pass_completions: 19, pass_attempts: 28, pass_yards: 201, pass_tds: 1, interceptions: 1 },
    { player_id: 'chase', game_id: null, receptions: 9, targets: 11, receiving_yards: 132, receiving_tds: 1 },
  ],
}

const WEEK_GAMES: MobileWeekGame[] = [
  { id: 'g-min-no', away_team: 'MIN', home_team: 'NO', kickoff_at: '2099-10-11T17:00:00Z', status: 'final', away_score: 23, home_score: 13, quarter: null, game_clock: null },
  { id: 'g-cin-mia', away_team: 'CIN', home_team: 'MIA', kickoff_at: '2099-10-11T17:00:00Z', status: 'live', away_score: 28, home_score: 18, quarter: 4, game_clock: '2:19' },
  { id: 'g-chi-gb', away_team: 'CHI', home_team: 'GB', kickoff_at: '2099-10-11T20:25:00Z', status: 'scheduled', away_score: 0, home_score: 0, quarter: null, game_clock: null },
]

const unescape = (html: string) => html.replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, '&')

function render({ box = BOX as NflGameBox | 'error', weekGames = WEEK_GAMES, week = WEEK as WeekMatchups | null, detail = DETAIL, gameId = 'g-cin-mia' } = {}): string {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, retryOnMount: false } } })
  if (box === 'error') {
    const query = qc.getQueryCache().build(qc, { queryKey: nflGameBoxKeys.game('g-cin-mia') })
    query.setState({ status: 'error', error: new Error('boom'), fetchStatus: 'idle', data: undefined, dataUpdatedAt: 0 })
  } else qc.setQueryData(nflGameBoxKeys.game('g-cin-mia'), box)
  qc.setQueryData(['mobile-team-games', 2099, 5], weekGames)
  qc.setQueryData(leaguesKeys.detail(LEAGUE), detail)
  if (week) qc.setQueryData(leagueMatchupKeys.week(LEAGUE, 5), week)
  return unescape(renderToStaticMarkup(createElement(QueryClientProvider, { client: qc }, createElement(NflGameScreen, { leagueId: LEAGUE, gameId }))))
}

/** The rows of one group as [name, …cells]. */
function groupRows(html: string, key: string): string[][] {
  const group = new RegExp(`data-box-group="${key}">([\\s\\S]*?)</section>`).exec(html)?.[1] ?? ''
  return [...group.matchAll(/data-box-row="[^"]+">([\s\S]*?)<\/button>/g)].map((m) => [...m[1]!.matchAll(/>([^<>]+)</g)].map((t) => t[1]!))
}

describe('the NFL game screen', () => {
  const html = render()

  it('the bar holds your matchup’s stored scores, yours on the left', () => {
    const strip = /data-match-strip="mB">([\s\S]*?)<\/div><\/div><\/div>/.exec(html)?.[0] ?? ''
    expect(strip).toContain('Touchdown Tacos')
    expect(strip.indexOf('Touchdown Tacos')).toBeLessThan(strip.indexOf('Gridiron Gurus'))
    expect(strip).toContain('>39.70<')
    expect(strip).toContain('>16.40<')
  })

  it('the picker shows every game of the week, this one ringed', () => {
    expect([...html.matchAll(/data-picker-game="([^"]+)"/g)].map((m) => m[1])).toEqual(['g-min-no', 'g-cin-mia', 'g-chi-gb'])
    expect(html).toMatch(/aria-pressed="true" class="[^"]*ring-accent[^"]*" data-picker-game="g-cin-mia"/)
    expect(html).toMatch(/aria-pressed="false" class="[^"]*bg-m-b1[^"]*" data-picker-game="g-min-no"/)
    // A scheduled game's stored 0-0 is not a score.
    const chi = /data-picker-game="g-chi-gb">([\s\S]*?)<\/button>/.exec(html)?.[1] ?? ''
    expect(chi).not.toContain('>0<')
    const min = /data-picker-game="g-min-no">([\s\S]*?)<\/button>/.exec(html)?.[1] ?? ''
    expect(min).toContain('>23<')
    expect(min).toContain('>Final<')
  })

  it('the game header: team tiles, stored scores, the live quarter and clock in red', () => {
    expect(html).toMatch(/data-game-header="true" data-game-state="live"/)
    expect(html).toMatch(/data-game-side="away">[\s\S]*?>CIN<[\s\S]*?>28</)
    expect(html).toMatch(/data-game-side="home">[\s\S]*?>18<[\s\S]*?>MIA</)
    expect(html).toMatch(/class="[^"]*text-negative-strong[^"]*" data-game-status="true">[\s\S]*?Q4 2:19/)
  })

  it('the box score’s groups: Passing then Receiving, away side first', () => {
    expect([...html.matchAll(/data-box-group="([^"]+)"/g)].map((m) => m[1])).toEqual(['passing', 'receiving'])
    expect(groupRows(html, 'passing')).toEqual([
      ['J. Burrow · CIN', '24/31', '288', '2', '0'],
      ['T. Tagovailoa · MIA', '19/28', '201', '1', '1'],
    ])
    expect(groupRows(html, 'receiving')).toEqual([['J. Chase · CIN', '9', '132', '1']])
    expect(html).toMatch(/data-box-group="passing">[\s\S]*?>Passing<[\s\S]*?>C\/Att<[\s\S]*?>Yds<[\s\S]*?>TD<[\s\S]*?>Int</)
  })

  it('each row is a button that names its columns', () => {
    expect(html).toMatch(/<button type="button" aria-label="J. Burrow, CIN: 24\/31 C\/Att, 288 Yds, 2 TD, 0 Int" class="[^"]*" data-box-row="burrow"/)
  })

  it('leaves out what nothing sends: Play by play, Team stats, the win bar', () => {
    expect(html).not.toContain('Play by play')
    expect(html).not.toContain('Team stats')
    expect(html).not.toContain('% win')
    expect(html).not.toContain('My players')
  })
})

describe('the NFL game screen — other states', () => {
  it('no matchup this week (or no team) titles the bar with the game', () => {
    const html = render({ week: { ...WEEK, matchups: [] } })
    expect(html).not.toContain('data-match-strip')
    expect(html).toContain('>CIN @ MIA<')
  })

  it('a game before kickoff: the kickoff for status, no scores, "once the game starts"', () => {
    const html = render({ box: { ...BOX, game: { ...GAME, status: 'scheduled', away_score: 0, home_score: 0, quarter: null, game_clock: null }, lines: [] } })
    expect(html).toMatch(/data-game-state="scheduled"/)
    expect(html).not.toMatch(/data-game-side="away">[\s\S]*?>0</)
    expect(html).toContain('Stats show here once the game starts.')
  })

  it('a final game with no lines says so', () => {
    const html = render({ box: { ...BOX, game: { ...GAME, status: 'final' }, lines: [] } })
    expect(html).toMatch(/data-game-status="true">Final</)
    expect(html).toContain('No player stats for this game.')
  })

  it('a cancelled game: its players score 0, and no lines show', () => {
    const html = render({ box: { ...BOX, game: { ...GAME, operator_hold: 'cancelled' } } })
    expect(html).toContain('>Cancelled<')
    expect(html).toContain('Its players score 0 this week.')
    expect(html).not.toContain('data-box-row')
  })

  it('an unknown game id is a real "not found", with the way back', () => {
    const html = render({ box: { game: null, players: [], lines: [] } })
    expect(html).toContain('Couldn’t find this game.')
    expect(html).toContain(`href="/app/leagues/${LEAGUE}/matchup"`)
  })

  it('a failed read says so with Try again — never an empty box', () => {
    const html = render({ box: 'error' })
    expect(html).toMatch(/role="alert"[\s\S]*?Couldn’t load this game\.[\s\S]*?Try again/)
    expect(html).not.toContain('data-box-score')
  })

  it('a failed re-poll keeps the last read on screen and says so', () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false, retryOnMount: false } } })
    qc.setQueryData(nflGameBoxKeys.game('g-cin-mia'), BOX)
    const query = qc.getQueryCache().find({ queryKey: nflGameBoxKeys.game('g-cin-mia') })!
    query.setState({ status: 'error', error: new Error('boom'), fetchStatus: 'idle' })
    qc.setQueryData(['mobile-team-games', 2099, 5], WEEK_GAMES)
    qc.setQueryData(leaguesKeys.detail(LEAGUE), DETAIL)
    const html = unescape(renderToStaticMarkup(createElement(QueryClientProvider, { client: qc }, createElement(NflGameScreen, { leagueId: LEAGUE, gameId: 'g-cin-mia' }))))
    expect(html).toContain('Couldn’t refresh this game — showing the last update.')
    expect(html).toContain('data-box-row="burrow"')
  })

  it('one game in the week is no picker', () => {
    const html = render({ weekGames: [WEEK_GAMES[1]!] })
    expect(html).not.toContain('data-game-picker')
  })

  it('a final game whose lines name no game says players are listed by their current team', () => {
    const final = render({ box: { ...BOX, game: { ...GAME, status: 'final' } } })
    expect(final).toMatch(/data-box-note="current-team">Players are listed by their current team\.</)
    // A live game, or lines that each name their game, need no note.
    expect(render()).not.toContain('data-box-note')
    const named = { ...BOX, game: { ...GAME, status: 'final' }, lines: BOX.lines.map((l) => ({ ...l, game_id: GAME.id })) }
    expect(render({ box: named })).not.toContain('data-box-note')
  })
})

describe('the route’s screen (rendered by games/layout.tsx, above [gameId])', () => {
  const renderRoute = (params: Record<string, string>) => {
    route.params = params
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false, retryOnMount: false } } })
    qc.setQueryData(nflGameBoxKeys.game('g-cin-mia'), BOX)
    qc.setQueryData(['mobile-team-games', 2099, 5], WEEK_GAMES)
    qc.setQueryData(leaguesKeys.detail(LEAGUE), DETAIL)
    try {
      return unescape(renderToStaticMarkup(createElement(QueryClientProvider, { client: qc }, createElement(NflGameRouteScreen, { leagueId: LEAGUE }))))
    } finally {
      route.params = { gameId: 'g-cin-mia' }
    }
  }

  it('reads the game id from the URL', () => {
    const html = renderRoute({ leagueId: LEAGUE, gameId: 'g-cin-mia' })
    expect(html).toContain('data-nfl-game="g-cin-mia"')
    expect(html).toContain('data-box-row="burrow"')
  })

  it('renders nothing without one', () => {
    expect(renderRoute({ leagueId: LEAGUE })).toBe('')
  })
})

describe('the NFL game screen — picking another game', () => {
  // The picker asked for CHI @ GB; CIN @ MIA's read is still what's kept.
  const picked = () => {
    kept.from = 'g-cin-mia'
    try {
      return render({ gameId: 'g-chi-gb' })
    } finally {
      kept.from = null
    }
  }

  it('the read keeps the last game while the next one loads', () => {
    expect(nflGameBoxQuery('g-chi-gb').placeholderData).toBe(keepPreviousData)
  })

  it('the bar and the picker stay on screen, the picked game ringed', () => {
    const html = picked()
    expect(html).toContain('data-match-strip="mB"')
    expect([...html.matchAll(/data-picker-game="([^"]+)"/g)].map((m) => m[1])).toEqual(['g-min-no', 'g-cin-mia', 'g-chi-gb'])
    expect(html).toMatch(/aria-pressed="true" class="[^"]*ring-accent[^"]*" data-picker-game="g-chi-gb"/)
    expect(html).toMatch(/aria-pressed="false" class="[^"]*" data-picker-game="g-cin-mia"/)
  })

  it('only the body waits: no header or rows from the last game', () => {
    const html = picked()
    expect(html).toContain('data-skeleton="game"')
    expect(html).not.toContain('data-game-header')
    expect(html).not.toContain('data-box-row')
  })

  it('with no matchup to show, the bar doesn’t title the last game', () => {
    kept.from = 'g-cin-mia'
    try {
      const html = render({ gameId: 'g-chi-gb', week: { ...WEEK, matchups: [] } })
      expect(html).not.toContain('CIN @ MIA')
      expect(html).toContain('data-game-picker')
    } finally {
      kept.from = null
    }
  })
})

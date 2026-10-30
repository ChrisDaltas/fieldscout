/**
 * Mobile Home (m-home §2A) rendered over seeded query caches — the designed
 * sections in order, the tile and card doors, the league card's stored
 * numbers, and the honest omissions (no win %, no add/drop counts). Plan C8:
 * "From the Community" right after My stuff while Community is switched on
 * (For you's lists, in For you's order, each opening Community's list page),
 * and the AI experts' boards opening where a list opens in the app. Home
 * itself never says "Scout AI" unless the AI experts shelf is there — the
 * AI note on an expert's board is on Community's list page, not Home.
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
const flags = vi.hoisted(() => ({ leagues: true, mockDrafts: true, personas: false, messages: false, weeklyRanks: true, startOrSit: true, community: false }))
vi.mock('@/lib/feature-flags', () => ({ featureFlags: flags }))

import { leagueStandingsKeys } from '@/hooks/use-standings'
import { leagueMatchupKeys } from '@/hooks/use-matchups'
import { leagueRosterKeys } from '@/hooks/use-rosters'
import { scheduleKeys } from '@/hooks/use-schedule'
import { auctionPoolKeys } from '@/hooks/use-draft-pool'
import { listsKeys } from '@/hooks/use-lists'
import { mobileRankingBoardsKey, type BoardPlayerLite } from '@/hooks/use-mobile-rankings-boards'
import { mobileCommunityKeys, type CommunityItem, type CommunityPool } from '@/hooks/use-mobile-community-feed'

import { MobileHome } from './mobile-home'

const LEAGUES = [
  { id: 'A', name: 'Sunday Funday League', avatar_url: null, season: 2026, status: 'in_season', team_count: 12, created_at: null, my_role: 'manager', my_team_id: 't1' },
  { id: 'B', name: 'Joy to Us', avatar_url: null, season: 2026, status: 'setup', team_count: 12, created_at: null, my_role: 'manager', my_team_id: 'u1' },
  { id: 'C', name: 'Work League', avatar_url: null, season: 2026, status: 'drafting', team_count: 10, created_at: null, my_role: 'manager', my_team_id: 'w1' },
]

function seeded() {
  const qc = new QueryClient()
  qc.setQueryData(['leagues'], LEAGUES)
  qc.setQueryData(listsKeys.collection(1, 100), { lists: [], pagination: { page: 1, pageSize: 100, total: 3, hasMore: false } })
  qc.setQueryData(auctionPoolKeys.scoring('A'), { receptions: 0 })
  qc.setQueryData(auctionPoolKeys.scoring('B'), { receptions: 1 })
  qc.setQueryData(auctionPoolKeys.scoring('C'), { receptions: 0.5 })
  // Profile › Rankings' read (no signed-in user in this render → 'none'):
  // two boards holding three position rankings.
  const boardRow = (listId: string, pos: string): BoardPlayerLite => ({
    list_id: listId,
    player_id: `${listId}-${pos}`,
    position: 1,
    updated_at: null,
    added_at: null,
    player: { id: `${listId}-${pos}`, full_name: `${pos} One`, position: pos, team: 'KC', headshot_url: null },
  })
  qc.setQueryData(mobileRankingBoardsKey(null), {
    season: { listId: 'r2', week: 0, players: [boardRow('r2', 'RB'), boardRow('r2', 'WR')] },
    weeks: [{ listId: 'r1', week: 5, players: [boardRow('r1', 'QB')] }],
  })
  qc.setQueryData(scheduleKeys.all('A'), {
    weeks: [
      { id: 'w4', season: 2026, week: 4, status: 'final', finalized_at: null, median_score: null },
      { id: 'w5', season: 2026, week: 5, status: 'live', finalized_at: null, median_score: null },
      { id: 'w6', season: 2026, week: 6, status: 'upcoming', finalized_at: null, median_score: null },
    ],
    matchups: [],
  })
  qc.setQueryData(leagueMatchupKeys.week('A', 5), {
    league_id: 'A',
    season: 2026,
    week: 5,
    schedule_mode: 'h2h',
    league_week: { status: 'live', median_score: null, finalized_at: null },
    teams: [
      { id: 't1', name: 'Touchdown Tacos', status: 'active' },
      { id: 't2', name: 'Gridiron Gurus', status: 'active' },
    ],
    matchups: [
      { id: 'm1', season: 2026, week: 5, round_type: 'regular', status: 'live', home_team_id: 't2', away_team_id: 't1', home_score: 16.4, away_score: 39.7, result: null, is_overridden: false, updated_at: null },
    ],
    results: [],
  })
  qc.setQueryData(leagueStandingsKeys.all('A'), {
    standings: [
      { team_id: 't1', wins: 2, losses: 6, ties: 0 },
      { team_id: 't2', wins: 8, losses: 0, ties: 0 },
    ],
    reason: null,
  })
  qc.setQueryData(leagueRosterKeys.all('A'), { league_id: 'A', season: 2026, teams: [{ team_id: 't1', name: 'Touchdown Tacos', roster: [{ player_id: 'p9' }] }] })
  qc.setQueryData(leagueRosterKeys.all('C'), { league_id: 'C', season: 2026, teams: [{ team_id: 'w1', name: 'Work Team', roster: [] }] })
  qc.setQueryData(['home', 'players', 'ppr'], {
    players: [
      { id: 'p1', full_name: 'Roschon Johnson', position: 'RB', team: 'CHI', headshot_url: null, status: 'Active', current_pts: 0, current_games: 0, last_pts: 100, last_games: 16, projected_pts: 160 },
      { id: 'p2', full_name: 'Jahan Dotson', position: 'WR', team: 'PHI', headshot_url: null, status: 'Active', current_pts: 0, current_games: 0, last_pts: 180, last_games: 16, projected_pts: 120 },
    ],
  })
  qc.setQueryData(['mobile-home', 'injuries', 'p9'], [
    { id: 'p9', full_name: 'James Conner', position: 'RB', team: 'ARI', headshot_url: null, status: 'Questionable', injury_body_part: 'Ankle', injury_notes: null, practice_participation: null, projected_pts_ppr: 200 },
    { id: 'p8', full_name: 'Puka Nacua', position: 'WR', team: 'LAR', headshot_url: null, status: 'Out', injury_body_part: 'Knee', injury_notes: null, practice_participation: null, projected_pts_ppr: 250 },
  ])
  return qc
}

const render = (qc: QueryClient = seeded()) =>
  renderToStaticMarkup(createElement(QueryClientProvider, { client: qc }, createElement(MobileHome)))
    .replace(/&#x27;/g, "'")
    .replace(/&amp;/g, '&')

describe('mobile Home', () => {
  const out = render()

  it('lays the designed sections out in order', () => {
    const order = ['FieldScout', 'My stuff', 'Matchups', 'Join or create a league', 'Trending players', 'Injury news', 'Practice', 'Recently viewed']
    const at = order.map((s) => out.indexOf(s))
    expect(at.every((i) => i >= 0), JSON.stringify(at)).toBe(true)
    expect([...at].sort((a, b) => a - b)).toEqual(at)
  })

  it('shows no sample data: the desktop Scout AI and waiver mocks are left out', () => {
    expect(out).not.toContain('Scout AI')
    expect(out).not.toContain('Bijan Robinson')
    expect(out).not.toContain('Top waiver adds')
    expect(out).not.toContain('Jaylen Warren')
  })

  it('My stuff tiles open Profile on that segment, with live counts', () => {
    expect(out).toContain('href="/app/profile?tab=rankings"')
    expect(out).toContain('href="/app/profile?tab=lists"')
    expect(out).toContain('href="/app/profile?tab=ss"')
    expect(out).toContain('3 lists')
    // The same rows Profile › Rankings lists: one per position ranking.
    expect(out).toContain('3 rankings')
  })

  it('Rankings and Start/Sit tiles appear only while those surfaces are released', () => {
    flags.weeklyRanks = false
    flags.startOrSit = false
    try {
      const off = render()
      expect(off).toContain('href="/app/profile?tab=lists"')
      expect(off).not.toContain('tab=rankings')
      expect(off).not.toContain('tab=ss')
    } finally {
      flags.weeklyRanks = true
      flags.startOrSit = true
    }
  })

  it('a failed count says so, with Try again — never a blank that looks like loading', () => {
    const qc = seeded()
    // Keep the failure on screen (no refetch on mount in this static render).
    qc.setDefaultOptions({ queries: { retryOnMount: false } })
    qc.removeQueries({ queryKey: listsKeys.collection(1, 100) })
    const cache = qc.getQueryCache()
    const q = cache.build(qc, { queryKey: listsKeys.collection(1, 100) })
    q.setState({ status: 'error', error: new Error('boom'), fetchStatus: 'idle' })
    const failed = render(qc)
    expect(failed).toContain('Couldn’t load<')
    expect(failed).toContain('Couldn’t load some of your counts.')
  })

  it('each league card opens what its league is doing; stored scores, records and week', () => {
    const cardTag = (id: string) => out.match(new RegExp(`<a [^>]*data-league-card="${id}"[^>]*>`))?.[0] ?? ''
    // In season → the Match tab.
    expect(cardTag('A')).toContain('href="/app/leagues/A/matchup"')
    // Pre-draft → the League tab's draft home, not an empty Match tab.
    expect(cardTag('B')).toContain('href="/app/leagues/B"')
    // Drafting → the live draft room, labelled "Draft live" (never "Pre-draft").
    expect(cardTag('C')).toContain('href="/app/leagues/C/draft"')
    const cardC = out.slice(out.indexOf('data-league-card="C"'))
    expect(cardC).toContain('Draft live')
    expect(cardC.slice(0, cardC.indexOf('</a>'))).not.toContain('Pre-draft')
    expect(cardC).toContain('10-team half PPR · 2026')
    expect(out).toContain('12-team standard · Week 5')
    expect(out).toContain('Touchdown Tacos (2-6)')
    expect(out).toContain('Gridiron Gurus (8-0)')
    expect(out.indexOf('39.70')).toBeLessThan(out.indexOf('16.40'))
    expect(out).toContain('>Week 5</span>')
    // Pre-draft league: the pill, the season, no score block.
    expect(out).toContain('12-team PPR · 2026')
    expect(out).toContain('Pre-draft')
    // No win-probability model: no "% win".
    expect(out).not.toMatch(/% win/)
  })

  it('trending names what the numbers are and never shows add counts or rostered %', () => {
    expect(out).toContain('Risers')
    expect(out).toContain('Fallers')
    expect(out).toContain('Roschon Johnson')
    expect(out).toContain('+60.0')
    expect(out).toContain('RB · CHI · Proj 160.0 · Last yr 100.0')
    expect(out).not.toContain('Adds')
  })

  it('Trending "See all" opens League › Players on Available', () => {
    expect(out).toMatch(/href="\/app\/leagues\/A\/players\?status=avail"[^>]*>See all</)
  })

  it('Practice: the card starts a mock and "Your mocks" opens the practice home (gap list §3 #2)', () => {
    const practice = out.slice(out.indexOf('>Practice</h2>'))
    // The link sits in the Practice title row, before the card itself…
    expect(practice).toMatch(/^>Practice<\/h2><a [^>]*href="\/app\/mocks"[^>]*>Your mocks<\/a>/)
    expect(practice.indexOf('Your mocks')).toBeLessThan(practice.indexOf('Mock draft'))
    // …and is its own anchor, never nested inside the card's button.
    const card = practice.slice(practice.indexOf('<button'), practice.indexOf('</button>'))
    expect(card).toContain('Practice against AI drafters')
    expect(card).not.toContain('<a ')
  })

  it('with practice drafts switched off there is no Practice card and no "Your mocks"', () => {
    flags.mockDrafts = false
    try {
      const off = render()
      expect(off).not.toContain('>Practice</h2>')
      expect(off).not.toContain('Your mocks')
      expect(off).not.toContain('href="/app/mocks"')
    } finally {
      flags.mockDrafts = true
    }
  })

  it('a roster that fails to load is the injury section’s error, never a list missing "On your roster"', () => {
    const qc = seeded()
    qc.setDefaultOptions({ queries: { retryOnMount: false } })
    qc.removeQueries({ queryKey: leagueRosterKeys.all('A') })
    qc.getQueryCache().build(qc, { queryKey: leagueRosterKeys.all('A') }).setState({ status: 'error', error: new Error('boom'), fetchStatus: 'idle' })
    const failed = render(qc)
    expect(failed).toContain('Couldn’t load injury news.')
    expect(failed).not.toContain('Puka Nacua')
  })

  it("injury news puts the user's own player first with the roster line", () => {
    expect(out.indexOf('James Conner')).toBeLessThan(out.indexOf('Puka Nacua'))
    expect(out).toContain('On your roster · Touchdown Tacos')
    expect(out).toContain('>Questionable</span>')
    expect(out).toContain('>Out</span>')
  })
})

describe('From the AI experts (audit lists-2)', () => {
  const board = {
    id: 'b1',
    title: 'Week 9 RB rankings',
    slug: 'week-9-rb-rankings',
    description: null,
    position_filter: 'RB',
    player_count: 24,
    updated_at: new Date().toISOString(),
    persona: { username: 'bathew', display_name: 'Bathew Merry', avatar_url: null },
    owner: { username: 'bathew_ai' },
  }
  const renderBoards = () => {
    const qc = seeded()
    qc.setQueryData(['persona-boards', 9], [board])
    return render(qc)
  }

  it('an expert’s board opens the phone List view while Community is off — never the desktop share page', () => {
    const out = renderBoards()
    expect(out).toContain('From the AI experts')
    expect(out).toContain('href="/app/lists?list=b1"')
    expect(out).not.toContain('/lists/week-9-rb-rankings')
  })

  it('…and Community’s list page while it is on, as search, profiles and a shared link do (inAppListHref)', () => {
    flags.community = true
    try {
      const out = renderBoards()
      expect(out).toContain('href="/app/explore?list=b1"')
      expect(out).not.toContain('/lists/week-9-rb-rankings')
    } finally {
      flags.community = false
    }
  })
})

describe('From the AI experts — a read that fails says so (plan C8)', () => {
  it('Couldn’t load, with Try again — never a shelf that quietly isn’t there', () => {
    const qc = seeded()
    qc.setDefaultOptions({ queries: { retryOnMount: false } })
    qc.getQueryCache().build(qc, { queryKey: ['persona-boards', 9] }).setState({ status: 'error', error: new Error('boom'), fetchStatus: 'idle' })
    const out = render(qc)
    expect(out).toContain('From the AI experts')
    expect(out).toContain('Couldn’t load the AI experts.')
    expect(out).toMatch(/role="alert"/)
    expect(out).toContain('>Try again<')
  })
})

/** Plan C8: Home's "From the Community" shelf (phone). */
describe('From the Community (plan C8)', () => {
  const DAY = 24 * 60 * 60 * 1000
  const daysAgo = (d: number) => new Date(Date.now() - d * DAY).toISOString()
  const person = { profileId: 'u-kelly', username: 'kelly', avatarUrl: null, followers: 3, isPersona: false }
  const communityItem = (id: string, over: Partial<CommunityItem> = {}): CommunityItem => ({
    id,
    title: `List ${id}`,
    slug: id,
    description: null,
    kind: 'list',
    rankType: null,
    positionFilter: 'WR',
    scoring: 'Half PPR',
    scoringFormat: 'half',
    playerCount: 8,
    likeCount: 0,
    recentLikes: [],
    createdAt: daysAgo(1),
    updatedAt: daysAgo(1),
    thumbnailUrl: null,
    ownerUsername: 'kelly',
    author: person,
    heads: [],
    tags: [],
    videos: [],
    ...over,
  })
  const pool = (items: CommunityItem[], popularExtra: CommunityItem[] = []): CommunityPool => ({
    items,
    latest: [],
    popularExtra,
    capped: false,
    olderFrom: null,
  })
  const withCommunity = (fn: () => void) => {
    flags.community = true
    try {
      fn()
    } finally {
      flags.community = false
    }
  }
  const renderPool = (data: CommunityPool) => {
    const qc = seeded()
    qc.setQueryData(mobileCommunityKeys.pool(), data)
    return render(qc)
  }
  /** The shelf's own markup. */
  const shelfOf = (out: string) => {
    const at = out.indexOf('data-home-community=')
    expect(at).toBeGreaterThan(-1)
    return out.slice(at, out.indexOf('</section>', at))
  }
  const cardIds = (shelf: string) => [...shelf.matchAll(/href="\/app\/explore\?list=([^"]+)"/g)].map((m) => m[1])

  it('sits right after My stuff, before the league sections', () => {
    withCommunity(() => {
      const out = renderPool(pool([communityItem('a')]))
      const order = ['My stuff', 'From the Community', 'Matchups', 'Join or create a league', 'Trending players', 'Injury news', 'Practice', 'Recently viewed']
      const at = order.map((s) => out.indexOf(s))
      expect(at.every((i) => i >= 0), JSON.stringify(at)).toBe(true)
      expect([...at].sort((a, b) => a - b)).toEqual(at)
    })
  })

  it('For you’s lists in For you’s order (popular + recent), at most five, each opening Community’s list page', () => {
    withCommunity(() => {
      const now = Date.now()
      const items = [
        communityItem('fresh', { updatedAt: daysAgo(0.1), createdAt: daysAgo(0.1) }),
        communityItem('quiet', { updatedAt: daysAgo(2) }),
        communityItem('liked', { updatedAt: daysAgo(20), likeCount: 4, recentLikes: [now - 1000, now - 2000, now - 3000, now - 4000] }),
        communityItem('l4', { updatedAt: daysAgo(3) }),
        communityItem('l5', { updatedAt: daysAgo(4) }),
        communityItem('l6', { updatedAt: daysAgo(5) }),
        // Rankings never show here, however liked.
        communityItem('board', { kind: 'rank', rankType: 'season', likeCount: 50, recentLikes: [now, now, now] }),
      ]
      const extra = communityItem('extra', { updatedAt: daysAgo(30), likeCount: 9, recentLikes: [now, now, now, now, now, now] })
      const shelf = shelfOf(renderPool(pool(items, [extra])))
      expect(cardIds(shelf)).toEqual(['extra', 'liked', 'fresh', 'quiet', 'l4'])
      expect(shelf).not.toContain('board')
      // A plain link into Community's list page — no feed under Home to open it over.
      expect(shelf).not.toContain('/app/lists?list=')
      // "See all" opens Community.
      expect(shelf).toMatch(/<a [^>]*href="\/app\/explore"[^>]*>See all<\/a>/)
      // The card's last line says how popular it is.
      expect(shelf).toContain('8 players · 4 likes')
      expect(shelf).toContain('@kelly')
    })
  })

  it('no list to show: the section is left out — no empty box', () => {
    withCommunity(() => {
      const out = renderPool(pool([communityItem('board', { kind: 'rank', rankType: 'season' })]))
      expect(out).not.toContain('From the Community')
      expect(out).toContain('My stuff')
    })
  })

  it('loading: card placeholders under the title, never a blank', () => {
    withCommunity(() => {
      const shelf = shelfOf(render())
      expect(shelf).toContain('From the Community')
      expect(shelf).toContain('aria-busy="true"')
      expect(shelf).toContain('aria-label="Loading lists"')
    })
  })

  it('a failed read says Couldn’t load, with Try again — never an empty shelf', () => {
    withCommunity(() => {
      const qc = seeded()
      qc.setDefaultOptions({ queries: { retryOnMount: false } })
      qc.getQueryCache().build(qc, { queryKey: mobileCommunityKeys.pool() }).setState({ status: 'error', error: new Error('boom'), fetchStatus: 'idle' })
      const shelf = shelfOf(render(qc))
      expect(shelf).toContain('Couldn’t load lists from the Community.')
      expect(shelf).toContain('role="alert"')
      expect(shelf).toContain('>Try again<')
    })
  })

  it('never says "Scout AI" on Home — the AI note lives on Community’s list page', () => {
    withCommunity(() => {
      expect(renderPool(pool([communityItem('a')]))).not.toContain('Scout AI')
    })
  })

  it('Community switched off: no shelf, and Community’s feed isn’t read', () => {
    const qc = seeded()
    const out = render(qc)
    expect(out).not.toContain('From the Community')
    expect(qc.getQueryCache().find({ queryKey: mobileCommunityKeys.pool() })).toBeUndefined()
  })
})

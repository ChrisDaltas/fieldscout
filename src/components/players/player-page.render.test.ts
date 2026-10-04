/**
 * The full player page (built to the Claude Design prototype's PlayerPage,
 * Chris 2026-10-04).
 *
 *  1. Hero: every field with a real source renders; a field without one is
 *     OMITTED (no "—" placeholder on the page; Pos rank has no source yet).
 *  2. Actions column per context: in a league "Viewing in <League>" + the
 *     card's own league actions; outside one "Your leagues" + the card's
 *     per-league rows. Add to list in both.
 *  3. Tabs: Overview / Stats / Schedule — no News (no source).
 *  4. Schedule rows + OPRK chip; the Scout AI read only on real data.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createElement, type ReactElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

vi.mock('next/navigation', () => ({
  usePathname: () => '/app/players/p1',
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
// The shell header is a store write in an effect (none run in static
// markup) — stand it in with a marker carrying exactly what the page hands it.
vi.mock('@/components/layout/app-header', async () => {
  const { createElement: h } = await import('react')
  return {
    PageHeader: ({ title, actions }: { title: unknown; actions?: unknown }) =>
      h('div', { 'data-page-header': typeof title === 'string' ? title : 'node' }, actions as never),
  }
})
vi.mock('@/lib/feature-flags', () => ({ featureFlags: { leagues: true, messages: false } }))

import type { PlayerStatsPlayer, PlayerStatsResponse } from '@/hooks/use-player-stats'
import { leaguesKeys } from '@/hooks/use-leagues'

import { PlayerDetailHeader } from './player-detail-header'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import {
  ActionsColumn,
  DraftValue,
  PlayerBody,
  PlayerDetailPageView,
  SeasonTable,
  SECTIONS,
  SectionToggles,
  StatsStrip,
  ThisWeekBlock,
} from './player-detail-page-view'
import {
  draftValueCells,
  identityParts,
  matchupBadge,
  nextScheduled,
  playerPageHref,
  scheduleRows,
  seasonTable,
  thisWeek,
  vitalCells,
  type TeamGame,
} from './player-page-ops'
import { decisionTiles, type CoreStatsPayload } from '@/lib/players/core-stats-ops'

const html = (el: ReactElement, qc = new QueryClient()) =>
  renderToStaticMarkup(createElement(QueryClientProvider, { client: qc }, el))
    .replace(/&#x27;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')

function player(over: Partial<PlayerStatsPlayer> = {}): PlayerStatsPlayer {
  return {
    id: 'p1',
    full_name: 'Test Runner',
    position: 'RB',
    team: 'DAL',
    headshot_url: null,
    status: 'Questionable',
    jersey_number: 20,
    height: '71',
    weight: 215,
    birth_date: '2000-01-15',
    college: null,
    experience_years: 3,
    bye_week: 7,
    draft_year: null,
    draft_round: null,
    draft_pick: null,
    adp: 12.4,
    sos: 9,
    auction_value: 41,
    injury_body_part: 'Hamstring',
    injury_notes: null,
    injury_start_date: null,
    practice_participation: null,
    ...over,
  }
}

const SEASON = { season: 2026, gamesPlayed: 0, totals: {} as PlayerStatsResponse['seasons']['current']['totals'], fantasy: { ppr: 0, standard: 0 } }
const stats = (p: PlayerStatsPlayer): PlayerStatsResponse => ({
  player: p,
  seasons: { current: SEASON, last: { ...SEASON, season: 2025 }, projection: SEASON },
  gameLog: [],
})

// ---------------------------------------------------------------------------
// 1. Hero
// ---------------------------------------------------------------------------

const count = (hay: string, needle: string) => hay.split(needle).length - 1

describe('player page — identity: each fact exactly once (D486(12))', () => {
  it('a full record: name, status tag, ONE identity line', () => {
    const out = html(createElement(PlayerDetailHeader, { player: player(), size: 'expanded' }))
    expect(out).toContain('Test Runner')
    expect(out).toMatch(/>Q<span[^>]*>— Hamstring/)
    const parts = identityParts(player(), new Date('2026-10-04T12:00:00Z'))
    expect(parts.primary.map((p) => p.text)).toEqual(['Bye Wk 7'])
    expect(parts.secondary.map((p) => p.text)).toEqual(['Age 26', `5'11"`, '215 lb'])
    expect(out).toMatch(/data-player-vitals-line[^>]*>.*Age 26.*5'11".*215 lb/)
    // Each fact once — the old meta line + vitals grid duplicates are gone.
    expect(count(out, 'Bye')).toBe(1)
    expect(count(out, 'Age ')).toBe(1)
    expect(count(out, `5'11"`)).toBe(1)
    expect(count(out, '215 lb')).toBe(1)
    expect(out).not.toContain('data-player-vitals=')
    expect(out).not.toContain('data-vital=')
    // ADP / Auction $ / SOS are NOT here — they live in Draft & value.
    expect(out).not.toContain('ADP')
    expect(out).not.toContain('$41')
  })

  it('a sparse record: the missing parts are omitted', () => {
    const sparse = player({ height: null, weight: null, birth_date: null, bye_week: null, status: null })
    const out = html(createElement(PlayerDetailHeader, { player: sparse, size: 'expanded' }))
    expect(identityParts(sparse, new Date())).toEqual({ primary: [], secondary: [] })
    expect(out).not.toContain('data-player-vitals-line')
    expect(out).not.toContain('Bye')
    expect(out).not.toMatch(/>Q</)
  })

  it('Draft & value: ADP · Auction $ · SOS, omitting what we lack', () => {
    expect(draftValueCells(player())).toEqual([
      { key: 'adp', label: 'ADP', value: '12.4' },
      { key: 'auction', label: 'Auction $', value: '$41' },
      { key: 'sos', label: 'SOS', value: '9 of 32' },
    ])
    expect(draftValueCells(player({ adp: null, auction_value: null, sos: null }))).toEqual([])
  })

  it('vitalCells (the card) still keeps every cell; null is the omit signal', () => {
    const cells = vitalCells(player({ auction_value: null }), new Date('2026-10-04T12:00:00Z'))
    expect(cells.map((c) => c.label)).toEqual(['ADP', 'Auction $', 'Pos rank', 'SOS', 'Height', 'Weight', 'Age', 'Seasons'])
  })

  it('the hero carries no resting shadow (not interactive)', () => {
    const out = html(createElement(PlayerDetailHeader, { player: player(), size: 'expanded' }))
    expect(out).not.toMatch(/(^|\s)shadow-hard/)
  })
})

describe('player page — the standard header (D486(12))', () => {
  it('claims the shell header with a plain title + a Back action — no custom header of its own', () => {
    const out = html(createElement(PlayerDetailPageView, { playerId: 'p1' }))
    expect(out).toContain('data-page-header="Player"')
    expect(out).toMatch(/data-page-header="Player"><button[^>]*data-player-back/)
    expect(out).not.toMatch(/<h1|<header/)
  })
})

// ---------------------------------------------------------------------------
// 2. Actions column per context
// ---------------------------------------------------------------------------

describe('player page — actions reused per context', () => {
  it('in a league: "Viewing in <League>" and the card\'s league actions', () => {
    const qc = new QueryClient()
    qc.setQueryData(leaguesKeys.detail('L1'), { league: { name: 'Sunday League' } })
    const out = html(createElement(ActionsColumn, { player: player(), leagueId: 'L1' }), qc)
    expect(out).toContain('data-card-actions="league"')
    expect(out).toContain('Viewing in Sunday League')
    expect(out).toContain('data-card-all-leagues')
    expect(out).not.toContain('Your leagues')
    expect(out).toContain('Add to list')
  })

  it('outside a league: "Your leagues" + the card\'s per-league rows', () => {
    const qc = new QueryClient()
    qc.setQueryData(leaguesKeys.all, [
      { id: 'L1', name: 'Sunday League', avatar_url: null, season: 2026, status: 'in_season', team_count: 8, created_at: null, my_role: 'manager', my_team_id: 't1' },
      { id: 'L2', name: 'Work League', avatar_url: null, season: 2026, status: 'in_season', team_count: 8, created_at: null, my_role: 'manager', my_team_id: 't2' },
    ])
    const out = html(createElement(ActionsColumn, { player: player(), leagueId: null }), qc)
    expect(out).toContain('data-card-actions="global"')
    expect(out).toContain('Your leagues')
    expect(out).toContain('data-card-league-row="L1"')
    expect(out).toContain('data-card-league-row="L2"')
    expect(out).not.toContain('data-viewing-in')
    expect(out).toContain('Add to list')
  })

  it('R1501: a ?league= the viewer is not in (read fails) falls back to the page without a league', () => {
    // The settled state after the read's retries have failed.
    const qc = new QueryClient({ defaultOptions: { queries: { retryOnMount: false } } })
    qc.getQueryCache()
      .build(qc, { queryKey: leaguesKeys.detail('LX') })
      .setState({ status: 'error', error: new Error('Not a member'), fetchStatus: 'idle' })
    qc.setQueryData(leaguesKeys.all, [])
    const out = html(createElement(ActionsColumn, { player: player(), leagueId: 'LX' }), qc)
    expect(out).toContain('data-card-actions="global"')
    expect(out).toContain('Your leagues')
    expect(out).not.toContain('data-viewing-in')
    expect(out).not.toContain('Viewing in')
  })

  it('the league variant URL carries ?league=', () => {
    expect(playerPageHref('p1')).toBe('/app/players/p1')
    expect(playerPageHref('p1', 'L1')).toBe('/app/players/p1?league=L1')
  })
})

// ---------------------------------------------------------------------------
// 3–4. Tabs, schedule, Scout AI
// ---------------------------------------------------------------------------

const GAMES: TeamGame[] = [
  { week: 1, home_team: 'DAL', away_team: 'NYG', kickoff_at: '2026-09-13T17:00:00Z', status: 'final' },
  { week: 2, home_team: 'PHI', away_team: 'DAL', kickoff_at: '2026-09-20T17:00:00Z', status: 'scheduled' },
]
// 32 defenses ranked 1..32 (033: 1 = most generous); NYG is 1, PHI is 30.
const SPLITS = Array.from({ length: 32 }, (_, i) => ({
  defense: i === 0 ? 'NYG' : i === 29 ? 'PHI' : `T${i}`,
  position: 'RB',
  rank: i + 1,
}))

describe('player page — schedule reads', () => {
  it('schedule rows: week, opponent, OPRK, and the bye week', () => {
    const rows = scheduleRows('DAL', 'RB', GAMES, SPLITS, 7)
    expect(rows.map((r) => [r.week, r.opponent.kind === 'game' ? r.opponent.label : 'BYE', r.oprk])).toEqual([
      [1, 'vs NYG', 32],
      [2, '@ PHI', 3],
      [7, 'BYE', null],
    ])
  })

  it('R1502: a null status is NOT scheduled', () => {
    const nullStatus = GAMES.map((g) => (g.week === 2 ? { ...g, status: null } : g))
    expect(nextScheduled(scheduleRows('DAL', 'RB', nullStatus, SPLITS, 7), nullStatus)).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// 5. This week + upcoming (D486(12))
// ---------------------------------------------------------------------------

/** 32 RB defenses where `opp` lands at OPRK `oprk` (1 = toughest). */
function splitsWith(opp: string, oprk: number) {
  // 033 stores 1 = most generous: OPRK = 33 - stored rank.
  return Array.from({ length: 32 }, (_, i) => {
    const stored = i + 1
    return { defense: stored === 33 - oprk ? opp : `X${i}`, position: 'RB', rank: stored }
  })
}

const SEA_WEEK: TeamGame[] = [
  { week: 4, home_team: 'LAC', away_team: 'NYG', kickoff_at: '2026-09-27T17:00:00Z', status: 'final' },
  { week: 5, home_team: 'SEA', away_team: 'LAC', kickoff_at: '2026-10-04T20:25:00Z', status: 'scheduled' },
  { week: 6, home_team: 'LAC', away_team: 'KC', kickoff_at: '2026-10-11T20:25:00Z', status: 'scheduled' },
  { week: 8, home_team: 'DEN', away_team: 'LAC', kickoff_at: '2026-10-25T17:00:00Z', status: 'scheduled' },
]

function block(oprk: number) {
  const splits = splitsWith('SEA', oprk)
  const tw = thisWeek('LAC', 'RB', SEA_WEEK, splits, 7)!
  return html(createElement(ThisWeekBlock, { tw, position: 'RB' }))
}

describe('player page — this week (D486(12))', () => {
  it('"@ SEA · Sun 4:25 PM ET" and the badge', () => {
    const out = block(4)
    expect(out).toContain('data-this-week="game"')
    expect(out).toContain('This week · Wk 5')
    expect(out).toContain('title="@ Seattle Seahawks" data-this-week-opp="true">@ SEA<')
    expect(out).toContain('>· Sun 4:25 PM ET<')
    expect(out).toContain('data-matchup-badge="negative"')
    expect(out).toContain('4th toughest vs RB')
  })

  it('rank bands: text from the shorter side, colour = My Team\'s OPRK tones', () => {
    expect(matchupBadge(1, 32, 'RB')).toEqual({ text: '1st toughest vs RB', tone: 'negative' })
    expect(matchupBadge(8, 32, 'RB')).toEqual({ text: '8th toughest vs RB', tone: 'negative' })
    expect(matchupBadge(9, 32, 'RB')).toEqual({ text: '9th toughest vs RB', tone: 'caution' })
    expect(matchupBadge(16, 32, 'WR')).toEqual({ text: '16th toughest vs WR', tone: 'caution' })
    expect(matchupBadge(17, 32, 'WR')).toEqual({ text: '16th easiest vs WR', tone: 'caution' })
    expect(matchupBadge(23, 32, 'TE')).toEqual({ text: '10th easiest vs TE', tone: 'caution' })
    expect(matchupBadge(24, 32, 'TE')).toEqual({ text: '9th easiest vs TE', tone: 'positive' })
    expect(matchupBadge(32, 32, 'QB')).toEqual({ text: '1st easiest vs QB', tone: 'positive' })
    expect(block(30)).toContain('data-matchup-badge="positive"')
    expect(block(30)).toContain('3rd easiest vs RB')
    expect(block(12)).toContain('data-matchup-badge="caution"')
  })

  it('no rank on file → no badge, never an invented one', () => {
    const tw = thisWeek('LAC', 'RB', SEA_WEEK, [], 7)!
    const out = html(createElement(ThisWeekBlock, { tw, position: 'RB' }))
    expect(out).toContain('>@ SEA<')
    expect(out).not.toContain('data-matchup-badge')
    expect(out).not.toContain('toughest')
  })

  it('a bye week says "Bye week"', () => {
    const games = SEA_WEEK.map((g) => (g.week === 5 ? { ...g, week: 9 } : g))
    const tw = thisWeek('LAC', 'RB', games, [], 5)
    expect(tw).toEqual({ kind: 'bye', week: 5 })
    const out = html(createElement(ThisWeekBlock, { tw: tw!, position: 'RB' }))
    expect(out).toContain('Bye week')
    expect(out).not.toContain('data-matchup-badge')
  })

  it('no game data → null (the block is omitted)', () => {
    expect(thisWeek('LAC', 'RB', [], [], 7)).toBeNull()
    expect(thisWeek(null, 'RB', SEA_WEEK, [], 7)).toBeNull()
    const allFinal = SEA_WEEK.map((g) => ({ ...g, status: 'final' }))
    expect(thisWeek('LAC', 'RB', allFinal, [], 7)).toBeNull()
    // A later bye with nothing scheduled is NOT "this week" — we can't know.
    expect(thisWeek('LAC', 'RB', allFinal.filter((g) => g.week === 4), [], 7)).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// 6. Key numbers + the season table (D486(12))
// ---------------------------------------------------------------------------

const PAYLOAD: CoreStatsPayload = {
  basis: { kind: 'system', system: 'espn_standard' },
  season: 2026,
  week: 5,
  total_points: 84.6,
  games: 4,
  avg_points: 21.15,
  projected_points: 17.3,
  pos_rank: 12,
  overall_rank: 31,
  box: { games: 0, totals: {} },
  usage: null,
  weekly: [
    { week: 4, points: 22.1, proj: 15.2 },
    { week: 5, points: null, proj: 17.3 },
  ],
}

describe('player view — the decision line', () => {
  it('three large numbers: Pos rank · Avg / week · Proj this wk — no boxes, nothing else', () => {
    const out = html(createElement(StatsStrip, { tiles: decisionTiles(PAYLOAD, { position: 'RB' }) }))
    expect(count(out, 'data-stats-strip')).toBe(1)
    expect([...out.matchAll(/data-core-tile="([^"]+)"/g)].map((m) => m[1])).toEqual(['pos-rank', 'avg', 'proj'])
    for (const v of ['RB 12', '21.1', '17.3']) expect(out).toContain(`>${v}</p>`)
    expect(out).not.toMatch(/SOS|Bye|Total|Overall/)
    expect(out).not.toMatch(/(^|\s)shadow-hard/)
  })

  it('Draft & value: ADP · Auction $ · SOS + Total pts + Overall, missing ones omitted', () => {
    const out = html(createElement(DraftValue, { player: player(), stats: PAYLOAD }))
    expect([...out.matchAll(/data-draft-cell="([^"]+)"/g)].map((m) => m[1])).toEqual(['adp', 'auction', 'sos', 'total', 'overall-rank'])
    const sparse = html(createElement(DraftValue, { player: player({ adp: null, auction_value: null, sos: null }), stats: { ...PAYLOAD, overall_rank: null } }))
    expect([...sparse.matchAll(/data-draft-cell="([^"]+)"/g)].map((m) => m[1])).toEqual(['total'])
    expect(sparse).not.toContain('—')
  })
})

describe('player view — the season table', () => {
  const splits = splitsWith('SEA', 8)
  const sched = scheduleRows('LAC', 'RB', SEA_WEEK, splits, 7)
  const rows = seasonTable(sched, SEA_WEEK, PAYLOAD.weekly, 5)

  it('one row per week: Wk · Opp (rank) · Proj · Pts; the bye is BYE; the current week marked', () => {
    expect(rows.map((r) => r.week)).toEqual([4, 5, 6, 7, 8])
    const out = html(createElement(SeasonTable, { rows, loading: false, error: false }))
    expect(out).toMatch(/<th[^>]*>Wk<\/th><th[^>]*>Opp<\/th><th[^>]*>Proj<\/th><th[^>]*>Pts<\/th>/)
    expect(out).toMatch(/data-season-week="4"[^>]*>.*?>vs NYG<.*?>15\.2<.*?>22\.1</)
    expect(out).toMatch(/data-season-week="5" data-current="true">/)
    expect(out).toMatch(/data-season-week="5"[^>]*>.*?@ SEA<span[^>]*bg-negative[^>]*data-oprk="8">8th<.*?>17\.3<.*?>Sun 4:25 PM</)
    expect(count(out, 'data-current="true"')).toBe(1)
    expect(out).toMatch(/data-season-week="7"[^>]*>.*?>BYE</)
    expect(out).toMatch(/data-season-week="6"[^>]*>.*?>vs KC<.*?>—<.*?>Sun 4:25 PM</)
  })

  it('no rank on file → no chip', () => {
    const plain = seasonTable(scheduleRows('LAC', 'RB', SEA_WEEK, [], 7), SEA_WEEK, [], 5)
    const out = html(createElement(SeasonTable, { rows: plain, loading: false, error: false }))
    expect(out).not.toContain('data-oprk')
    expect(out).toContain('>@ SEA<')
  })

  it('an empty season says so', () => {
    expect(html(createElement(SeasonTable, { rows: [], loading: false, error: false }))).toContain('No schedule on file')
  })
})

describe('player view — the calm default view + progressive disclosure (D486(13))', () => {
  function seeded() {
    const qc = new QueryClient()
    qc.setQueryData(['nfl-team-schedule', 2026, 'LAC'], SEA_WEEK)
    qc.setQueryData(['defense-splits', 2026], splitsWith('SEA', 4))
    qc.setQueryData(['player-core-stats', 'p1', 'espn_standard'], {
      ...PAYLOAD,
      box: { games: 4, totals: { rush_attempts: 62, rush_yards: 301, rush_tds: 3, targets: 14, receptions: 11 } },
      usage: { snap_pct: 64.2, target_share: null },
    })
    qc.setQueryData(leaguesKeys.all, [])
    return qc
  }
  const body = () =>
    html(createElement(PlayerBody, { data: stats(player({ team: 'LAC' })), leagueId: null, goContext: () => {} }), seeded())

  it('header → decision line + basis → this week → season table → four section toggles', () => {
    const out = body()
    const order = ['data-player-identity', 'data-card-actions=', 'data-stats-strip', 'data-core-basis', 'data-this-week="game"', 'data-key-stats="primary"', 'data-season-table', 'data-section-toggles']
    const at = order.map((m) => out.indexOf(m))
    expect(at.every((i) => i >= 0)).toBe(true)
    expect([...at].sort((x, y) => x - y)).toEqual(at)
    expect(out).toContain('>ESPN Standard scoring</button>')
    expect(out).toContain('4th toughest vs RB')
    // D486(14) Key stats: the RB's six, from stored / derived values only.
    expect([...out.matchAll(/data-key-stat="([^"]+)"/g)].map((m) => m[1])).toEqual(['snap_pct', 'carries_pg', 'rush_yds', 'rush_td', 'targets', 'receptions'])
    expect(out).toMatch(/data-key-stat="carries_pg"><p[^>]*>15\.5</)
  })

  it('every section is collapsed by default — no stats, game log, dropdown or value grid rendered', () => {
    const out = body()
    for (const sec of SECTIONS) expect(out).toContain(`aria-expanded="false" data-section-toggle="${sec.key}"`)
    expect(out).not.toContain('data-section=')
    expect(out).not.toContain('data-core-scoring')
    expect(out).not.toContain('data-draft-value')
    expect(out).not.toMatch(/>(Overview|Schedule|News)</)
  })

  it('a toggle reads open when its section is open', () => {
    const out = html(createElement(SectionToggles, { open: ['log'], onToggle: () => {} }))
    expect(out).toContain('aria-expanded="true" data-section-toggle="log"')
    expect(out).toContain('aria-expanded="false" data-section-toggle="stats"')
  })

  it('a plain PlayerLink click still opens the MINI CARD — never the modal', () => {
    const src = readFileSync(join(__dirname, 'player-link.tsx'), 'utf8')
    expect(src).toContain('usePlayerWindowsStore')
    expect(src).not.toContain('usePlayerModalStore')
    // …and the card's expand icon is what opens the modal.
    const win = readFileSync(join(__dirname, 'player-window.tsx'), 'utf8')
    expect(win).toMatch(/openPlayerView\(playerId, expandLeagueId\)/)
  })
})

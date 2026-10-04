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
vi.mock('@/lib/feature-flags', () => ({ featureFlags: { leagues: true, messages: false } }))

import type { PlayerStatsPlayer, PlayerStatsResponse } from '@/hooks/use-player-stats'
import { leaguesKeys } from '@/hooks/use-leagues'

import { PlayerDetailHeader } from './player-detail-header'
import { ActionsColumn, PlayerTabs, ScheduleList } from './player-detail-page-view'
import {
  heroMetaParts,
  nextScheduled,
  playerPageHref,
  scheduleRows,
  scoutMatchupRead,
  vitalCells,
  type TeamGame,
} from './player-page-ops'

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

describe('player page — hero fields present or omitted', () => {
  it('a full record: name, status tag, meta line, every sourced vital', () => {
    const out = html(createElement(PlayerDetailHeader, { player: player(), size: 'expanded' }))
    expect(out).toContain('Test Runner')
    expect(out).toMatch(/>Q<span[^>]*>— Hamstring/)
    expect(out).toContain(`data-player-meta="true">5'11" · 215 lb · Bye 7</span>`)
    for (const label of ['ADP', 'Auction $', 'SOS', 'Height', 'Weight', 'Age', 'Seasons']) {
      expect(out).toContain(`data-vital="${label}"`)
    }
    expect(out).toContain('$41')
    expect(out).toContain('9 of 32')
    // Pos rank has no source — omitted, never a "—".
    expect(out).not.toContain('data-vital="Pos rank"')
    expect(out).not.toContain('—</p>')
  })

  it('a sparse record: the missing fields are omitted, not placeholdered', () => {
    const sparse = player({ adp: null, auction_value: null, sos: null, height: null, weight: null, birth_date: null, bye_week: null, status: null })
    const out = html(createElement(PlayerDetailHeader, { player: sparse, size: 'expanded' }))
    for (const label of ['ADP', 'Auction $', 'SOS', 'Height', 'Weight', 'Age', 'Pos rank']) {
      expect(out).not.toContain(`data-vital="${label}"`)
    }
    expect(out).toContain('data-vital="Seasons"')
    expect(out).not.toContain('data-player-meta')
    expect(out).not.toMatch(/>Q</)
    expect(heroMetaParts(sparse)).toEqual([])
  })

  it('vitalCells: the card keeps every cell; null is the omit signal', () => {
    const cells = vitalCells(player({ auction_value: null }), new Date('2026-10-04T12:00:00Z'))
    expect(cells.map((c) => c.label)).toEqual(['ADP', 'Auction $', 'Pos rank', 'SOS', 'Height', 'Weight', 'Age', 'Seasons'])
    expect(cells.find((c) => c.label === 'Auction $')!.value).toBeNull()
    expect(cells.find((c) => c.label === 'Age')!.value).toBe('26')
  })

  it('the hero card carries no resting shadow (not interactive)', () => {
    const out = html(createElement(PlayerDetailHeader, { player: player(), size: 'expanded' }))
    expect(out).not.toMatch(/(^|\s)shadow-hard/)
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

describe('player page — tabs, schedule and the Scout AI read', () => {
  it('Overview / Stats / Schedule — and no News tab (no source)', () => {
    const out = html(createElement(PlayerTabs, { data: stats(player()), schedule: { rows: [], loading: false, error: false } }))
    for (const t of ['Overview', 'Stats', 'Schedule']) expect(out).toContain(`>${t}</button>`)
    expect(out).not.toContain('News')
  })

  it('schedule rows: week, opponent, OPRK chip, and the bye week', () => {
    const rows = scheduleRows('DAL', 'RB', GAMES, SPLITS, 7)
    expect(rows.map((r) => r.week)).toEqual([1, 2, 7])
    const out = html(createElement(ScheduleList, { rows, loading: false, error: false }))
    expect(out).toContain('vs NYG')
    expect(out).toContain('@ PHI')
    expect(out).toContain('BYE')
    // 033's rank 1 = most generous → OPRK 32 (soft); PHI's 30 → OPRK 3 (tough).
    expect(out).toContain('data-oprk="32"')
    expect(out).toContain('data-oprk="3"')
  })

  it('the Scout AI read: the next scheduled game with a real rank', () => {
    const rows = scheduleRows('DAL', 'RB', GAMES, SPLITS, 7)
    const next = nextScheduled(rows, GAMES)
    expect(next?.week).toBe(2)
    expect(scoutMatchupRead(next, 'RB')).toBe('Week 2 @ PHI: that defense ranks 3rd toughest against RBs.')
  })

  it('no Scout AI read without real data: no splits, no schedule, all final', () => {
    const noSplits = scheduleRows('DAL', 'RB', GAMES, [], 7)
    expect(scoutMatchupRead(nextScheduled(noSplits, GAMES), 'RB')).toBeNull()
    expect(scoutMatchupRead(nextScheduled([], []), 'RB')).toBeNull()
    const allFinal = GAMES.map((g) => ({ ...g, status: 'final' }))
    expect(scoutMatchupRead(nextScheduled(scheduleRows('DAL', 'RB', allFinal, SPLITS, 7), allFinal), 'RB')).toBeNull()
    expect(scheduleRows(null, 'RB', GAMES, SPLITS, 7)).toEqual([])
  })

  it('an empty schedule says so', () => {
    expect(html(createElement(ScheduleList, { rows: [], loading: false, error: false }))).toContain('No schedule on file')
  })
})

/**
 * Desktop Home's "Injury report" card (Chris, 2026-10-15): real data — the
 * same read as the phone's Home "Injury news" (`useMobileHomeInjuries`) — in
 * the desktop card language, with loading / empty / error states, and NO
 * sample rows (the old card showed "Garrett Wilson · On your team" to every
 * user on the live site).
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/supabase/client', () => ({
  createBrowserClient: () => ({ from: () => ({}) }),
}))
const flags = vi.hoisted(() => ({ leagues: true }))
vi.mock('@/lib/feature-flags', () => ({ featureFlags: flags }))

import { leaguesKeys } from '@/hooks/use-leagues'
import { leagueRosterKeys } from '@/hooks/use-rosters'

import { InjuryNewsCard } from './injury-news-card'

const LEAGUES = [
  { id: 'A', name: 'Sunday Funday League', avatar_url: null, season: 2026, status: 'in_season', team_count: 12, created_at: null, my_role: 'manager', my_team_id: 't1' },
  // Last season's rosters never make a player "yours".
  { id: 'Z', name: 'Old League', avatar_url: null, season: 2025, status: 'complete', team_count: 12, created_at: null, my_role: 'manager', my_team_id: 'z1' },
]

const CONNER = { id: 'p9', full_name: 'James Conner', position: 'RB', team: 'ARI', headshot_url: null, status: 'Questionable', injury_body_part: 'Ankle', injury_notes: null, practice_participation: 'Limited', projected_pts_ppr: 200 }
const NACUA = { id: 'p8', full_name: 'Puka Nacua', position: 'WR', team: 'LAR', headshot_url: null, status: 'Out', injury_body_part: 'Knee', injury_notes: null, practice_participation: null, projected_pts_ppr: 250 }
const MAYE = { id: 'p7', full_name: 'Drake Maye', position: 'QB', team: 'NE', headshot_url: null, status: 'IR', injury_body_part: null, injury_notes: null, practice_participation: null, projected_pts_ppr: 240 }

function seeded() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, retryOnMount: false } } })
  qc.setQueryData(leaguesKeys.all, LEAGUES)
  qc.setQueryData(leagueRosterKeys.all('A'), { league_id: 'A', season: 2026, teams: [{ team_id: 't1', name: 'Touchdown Tacos', roster: [{ player_id: 'p9' }] }] })
  qc.setQueryData(['mobile-home', 'injuries', 'p9'], [CONNER, NACUA, MAYE])
  return qc
}

function failed(qc: QueryClient, queryKey: readonly unknown[]) {
  qc.removeQueries({ queryKey, exact: true })
  qc.getQueryCache().build(qc, { queryKey }).setState({ status: 'error', error: new Error('boom'), fetchStatus: 'idle' })
}

const render = (qc: QueryClient = seeded()) =>
  renderToStaticMarkup(createElement(QueryClientProvider, { client: qc }, createElement(InjuryNewsCard)))
    .replace(/&#x27;/g, "'")
    .replace(/&amp;/g, '&')

describe('desktop Home — Injury report card', () => {
  const out = render()

  it('shows no sample data', () => {
    for (const mock of ['Garrett Wilson', 'Jaylen Waddle', 'Christian McCaffrey', 'On your team', 'Hamstring', 'Your players + top 50']) {
      expect(out).not.toContain(mock)
    }
  })

  it('renders the real feed: the viewer’s own injured player first, then the rest by relevance', () => {
    expect(out).toContain('Injury report')
    const at = ['James Conner', 'Puka Nacua', 'Drake Maye'].map((n) => out.indexOf(n))
    expect(at.every((i) => i >= 0), JSON.stringify(at)).toBe(true)
    expect([...at].sort((a, b) => a - b)).toEqual(at)
  })

  it('marks "On your roster" with the team that holds him — only on his row', () => {
    expect(out.match(/On your roster/g)).toHaveLength(1)
    expect(out).toContain('Touchdown Tacos')
    expect(out.indexOf('On your roster')).toBeLessThan(out.indexOf('Puka Nacua'))
  })

  it('carries the feed’s designation as a v7 status badge and its injury note', () => {
    expect(out).toMatch(/bg-caution-soft[^"]*">Questionable</)
    expect(out).toMatch(/bg-negative-soft[^"]*">Out</)
    expect(out).toMatch(/bg-ink[^"]*">IR</)
    expect(out).toContain('Ankle · limited practice')
    expect(out).toContain('Knee')
  })

  it('names open the player', () => {
    expect(out).toMatch(/<button type="button"[^>]*>James Conner<\/button>/)
  })

  it('loading: skeleton rows, no player names', () => {
    const qc = new QueryClient()
    qc.setQueryData(leaguesKeys.all, LEAGUES)
    const loading = render(qc)
    expect(loading).toContain('aria-busy="true"')
    expect(loading).not.toContain('James Conner')
  })

  it('empty: says there are no designations', () => {
    const qc = seeded()
    qc.setQueryData(['mobile-home', 'injuries', 'p9'], [])
    expect(render(qc)).toContain('No injury designations right now.')
  })

  it('a roster that fails to load is the card’s error, never a list missing "On your roster"', () => {
    const qc = seeded()
    failed(qc, leagueRosterKeys.all('A'))
    const html = render(qc)
    expect(html).toContain('Couldn\'t load injury news.')
    expect(html).toContain('Try again')
    expect(html).not.toContain('Puka Nacua')
  })

  it('a league list that fails to load is the card’s error too', () => {
    const qc = seeded()
    failed(qc, leaguesKeys.all)
    const html = render(qc)
    expect(html).toContain('Couldn\'t load injury news.')
    expect(html).not.toContain('James Conner')
  })

  it('the feed failing is the card’s error', () => {
    const qc = seeded()
    failed(qc, ['mobile-home', 'injuries', 'p9'])
    expect(render(qc)).toContain('Couldn\'t load injury news.')
  })

  it('leagues release off: no league read, no "yours" — just the league-wide feed', () => {
    flags.leagues = false
    try {
      const qc = new QueryClient()
      qc.setQueryData(['mobile-home', 'injuries', ''], [NACUA, MAYE])
      const off = render(qc)
      expect(off).toContain('Puka Nacua')
      expect(off).not.toContain('On your roster')
      expect(off).not.toContain('Your players first')
    } finally {
      flags.leagues = true
    }
  })
})

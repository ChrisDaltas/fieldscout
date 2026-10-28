/**
 * The phone League Menu's Draft results row carries the draft's day (handoff
 * §2.5 F: "Draft results · Aug 30"): the day a finished draft actually ran,
 * else the league's saved draft day — and no date at all when there is none.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createElement, type ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

import type { CompletedRealDraft } from '@/hooks/use-draft'
import type { LeagueDetail } from '@/hooks/use-league'
import { leaguesKeys, type MyLeagueRow } from '@/hooks/use-leagues'
import { defaultsForTeamCount } from '@/lib/leagues/settings/league-settings'

import { LeagueMenuSheet } from './league-menu-sheet'

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), back: vi.fn(), replace: vi.fn() }),
  usePathname: () => '/app/leagues/league-1',
}))
// The Menu sheet portals (Radix) — render an open one in place.
vi.mock('@/components/mobile/ui/mobile-sheet', () => ({
  MobileSheet: ({ open, title, children }: { open: boolean; title: string; children: ReactNode }) =>
    open ? createElement('div', { 'data-sheet': title }, children) : null,
}))

const LEAGUE = 'league-1'
// Noon UTC: the same calendar day in every test clock.
const SAVED_AT = '2099-08-28T12:00:00Z'
const RAN_AT = '2099-08-30T12:00:00Z'

const LEAGUE_ROW: MyLeagueRow = {
  id: LEAGUE,
  name: 'Sunday Funday League',
  avatar_url: null,
  season: 2099,
  status: 'in_season',
  team_count: 8,
  created_at: null,
  my_role: 'manager',
  my_team_id: null,
}

function detail(scheduledAt: string | null): LeagueDetail {
  const settings = defaultsForTeamCount(8)
  return {
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
    settings: { ...settings, draft: { ...settings.draft, draft_scheduled_at: scheduledAt } },
    members: [],
    teams: [],
    my_role: 'manager',
    active_draft: null,
  }
}

/** The Menu, open, over the given reads; `completed` left out = not read yet. */
function menu(seed: { detail: LeagueDetail; completed?: CompletedRealDraft | null }): string {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, retryOnMount: false } } })
  qc.setQueryData(leaguesKeys.detail(LEAGUE), seed.detail)
  if (seed.completed !== undefined) qc.setQueryData(['completed-real-draft', LEAGUE], seed.completed)
  return renderToStaticMarkup(
    createElement(QueryClientProvider, { client: qc }, createElement(LeagueMenuSheet, { open: true, onOpenChange: () => {}, league: LEAGUE_ROW })),
  )
}

/** The Draft results row's trailing value, or null when it has none. */
function draftResultsSub(html: string): string | null {
  const at = html.indexOf('>Draft results</span>')
  expect(at).toBeGreaterThan(-1)
  const row = html.slice(at, html.indexOf('</button>', at))
  return /<span class="[^"]*text-m-t3[^"]*">([^<]*)<\/span>/.exec(row)?.[1] ?? null
}

describe('the Menu’s Draft results row', () => {
  it('a finished draft: the day it actually ran, not the time that had been saved for it', () => {
    const html = menu({ detail: detail(SAVED_AT), completed: { id: 'd1', started_at: RAN_AT, completed_at: RAN_AT } })
    expect(draftResultsSub(html)).toBe('Aug 30')
  })

  it('before the draft: the league’s saved draft day', () => {
    expect(draftResultsSub(menu({ detail: detail(SAVED_AT), completed: null }))).toBe('Aug 28')
  })

  it('no draft date: no value on the row', () => {
    expect(draftResultsSub(menu({ detail: detail(null), completed: null }))).toBeNull()
  })

  it('while the finished-draft read is out: no value yet, never the saved day in its place', () => {
    expect(draftResultsSub(menu({ detail: detail(SAVED_AT) }))).toBeNull()
  })
})

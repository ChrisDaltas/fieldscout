/**
 * League Menu › My team on the phone (gap list §3 #10; handoff G1): the Menu
 * card opens the My team page, where a manager renames his own team through
 * the desktop's door (`useRenameOwnTeam` → `rename_own_team`). Rendered from
 * a seeded query (`renderToStaticMarkup`; effects don't run), plus the pure
 * Save gate and the toast after a save.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createElement, type ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

import { renameGate } from '@/components/leagues/team-commish-ops'
import type { LeagueDetail } from '@/hooks/use-league'
import { leaguesKeys, type MyLeagueRow } from '@/hooks/use-leagues'
import { defaultsForTeamCount } from '@/lib/leagues/settings/league-settings'

import { LeagueMenuSheet } from './league-menu-sheet'
import { MY_TEAM_NAME_MAX, MyTeamPage, myTeamSave, myTeamSavedToast } from './my-team-page'

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), back: vi.fn(), replace: vi.fn() }),
  usePathname: () => '/app/leagues/league-1',
}))
// The overlay portals on the client only — render it in place.
vi.mock('@/components/mobile/trades/m-overlay', async (importActual) => {
  const actual = await importActual<typeof import('@/components/mobile/trades/m-overlay')>()
  return {
    ...actual,
    MOverlay: ({ children, label }: { children: ReactNode; label: string }) => createElement('div', { 'data-m-overlay': label }, children),
  }
})
// The Menu sheet portals (Radix) — render an open one in place.
vi.mock('@/components/mobile/ui/mobile-sheet', () => ({
  MobileSheet: ({ open, title, children }: { open: boolean; title: string; children: ReactNode }) =>
    open ? createElement('div', { 'data-sheet': title }, children) : null,
}))

const LEAGUE = 'league-1'
const ME = 'aaaaaaaa-0000-4000-8000-000000000001'
const THEM = 'aaaaaaaa-0000-4000-8000-000000000002'

const detail: LeagueDetail = {
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
  settings: defaultsForTeamCount(8),
  members: [],
  teams: [
    { id: THEM, name: 'Gridiron Gurus', owner_id: 'user-them', status: 'active', created_at: '2099-01-01T00:00:00Z' },
    { id: ME, name: 'Touchdown Tacos', owner_id: 'user-me', status: 'active', created_at: '2099-01-02T00:00:00Z' },
  ],
  my_role: 'manager',
  active_draft: null,
}

const LEAGUE_ROW: MyLeagueRow = {
  id: LEAGUE,
  name: 'Sunday Funday League',
  avatar_url: null,
  season: 2099,
  status: 'in_season',
  team_count: 8,
  created_at: null,
  my_role: 'manager',
  my_team_id: ME,
}

const unescape = (html: string) => html.replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, '&')

function render(element: ReturnType<typeof createElement>, seed?: LeagueDetail | 'error'): string {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, retryOnMount: false } } })
  if (seed === 'error') {
    const query = qc.getQueryCache().build(qc, { queryKey: leaguesKeys.detail(LEAGUE) })
    query.setState({ status: 'error', error: new Error('boom'), fetchStatus: 'idle', data: undefined, dataUpdatedAt: 0 })
  } else if (seed) {
    qc.setQueryData(leaguesKeys.detail(LEAGUE), seed)
  }
  return unescape(renderToStaticMarkup(createElement(QueryClientProvider, { client: qc }, element)))
}

const page = (seed?: LeagueDetail | 'error', teamId = ME) => render(createElement(MyTeamPage, { leagueId: LEAGUE, teamId, onClose: () => {} }), seed)

describe('the Menu’s My team card', () => {
  it('says "edit name" (no avatar editing yet) and opens the page in place — no jump to the team screen', () => {
    const html = render(createElement(LeagueMenuSheet, { open: true, onOpenChange: () => {}, league: LEAGUE_ROW }), detail)
    expect(html).toMatch(/<button[^>]*data-menu-my-team[^>]*>/)
    expect(html).toContain('Touchdown Tacos')
    expect(html).toContain('My team · edit name<')
    expect(html).not.toContain('edit name and avatar')
    expect(html).not.toContain(`/team/${ME}`)
    // Closed until the card is tapped.
    expect(html).not.toContain('data-m-overlay')
  })

  it('no team in this league (a commissioner without a seat): no card', () => {
    const html = render(createElement(LeagueMenuSheet, { open: true, onOpenChange: () => {}, league: { ...LEAGUE_ROW, my_team_id: null } }), detail)
    expect(html).not.toContain('data-menu-my-team')
  })
})

describe('the My team page', () => {
  it('draws the handoff’s page: Back, "My team", the avatar, the name field with its counter, and Save', () => {
    const html = page(detail)
    expect(html).toContain('data-m-overlay="My team"')
    expect(html).toMatch(/<button[^>]*aria-label="Back"[^>]*data-my-team-back/)
    // Your team wears the accent blue, with the name's first letter.
    expect(html).toMatch(/<span[^>]*class="[^"]*bg-accent[^"]*"[^>]*width:96px;height:96px[^>]*data-team-avatar="[^"]+">T<\/span>/)
    expect(html).toMatch(/<label[^>]*>Team name<\/label>/)
    expect(html).toMatch(/<input[^>]*value="Touchdown Tacos"[^>]*maxLength="24"|<input[^>]*maxLength="24"[^>]*value="Touchdown Tacos"/)
    expect(html).toMatch(/data-my-team-count[^>]*>15 \/ 24</)
  })

  it('Save starts greyed out — nothing has changed yet, and nothing is said about it', () => {
    const html = page(detail)
    expect(html).toMatch(/<button type="submit" disabled=""[^>]*bg-m-b3s[^>]*data-my-team-save[^>]*>Save<\/button>/)
    expect(html).not.toContain('data-my-team-why')
    expect(html).not.toContain('role="alert"')
  })

  it('leaves out what teams can’t have yet: no photo upload, no colour swatches', () => {
    const html = page(detail)
    expect(html).not.toContain('Upload photo')
    expect(html).not.toContain('Avatar color')
  })

  it('edits THIS league’s team — the one it was opened for', () => {
    expect(page(detail, THEM)).toContain('value="Gridiron Gurus"')
  })

  it('still reading: a placeholder, no form', () => {
    const html = page()
    expect(html).toContain('data-my-team="loading"')
    expect(html).not.toContain('data-my-team-form')
  })

  it('a failed read says so with Try again — never an empty form', () => {
    const html = page('error')
    expect(html).toContain('role="alert"')
    expect(html).toContain('Couldn’t load your team.')
    expect(html).toContain('Try again')
    expect(html).not.toContain('data-my-team-form')
  })

  it('a team that is no longer in the league says so', () => {
    const html = page(detail, 'aaaaaaaa-0000-4000-8000-00000000dead')
    expect(html).toContain('Your team isn’t in this league anymore.')
    expect(html).not.toContain('Try again')
  })
})

describe('myTeamSave — when Save is on', () => {
  it('a new name saves trimmed', () => {
    expect(myTeamSave('  Sunday Scaries ', 'Touchdown Tacos')).toEqual({ ok: true, name: 'Sunday Scaries' })
  })

  it('the same name — even with spaces added — is not a change (the prototype enabled Save there)', () => {
    expect(myTeamSave('Touchdown Tacos', 'Touchdown Tacos')).toEqual({ ok: false, why: null })
    expect(myTeamSave('  Touchdown Tacos  ', 'Touchdown Tacos')).toEqual({ ok: false, why: null })
  })

  it('an empty name says what to do', () => {
    expect(myTeamSave('   ', 'Touchdown Tacos')).toEqual({ ok: false, why: 'Type a team name to save.' })
  })

  it('holds to the page’s 24 characters (a longer name set on desktop must be shortened)', () => {
    expect(MY_TEAM_NAME_MAX).toBe(24)
    expect(myTeamSave('x'.repeat(24), 'Touchdown Tacos')).toEqual({ ok: true, name: 'x'.repeat(24) })
    expect(myTeamSave('x'.repeat(30), 'Touchdown Tacos')).toEqual({ ok: false, why: 'A team name is at most 24 characters — this one is 30.' })
  })

  it('the desktop gate is unchanged (100), and a tighter limit never loosens it', () => {
    expect(renameGate('x'.repeat(100))).toEqual({ ok: true, name: 'x'.repeat(100) })
    expect(renameGate('x'.repeat(101), 500)).toEqual({ ok: false, why: 'A team name is at most 100 characters — this one is 101.' })
  })
})

describe('myTeamSavedToast — after Save', () => {
  it('"Team updated"', () => {
    expect(myTeamSavedToast({ no_changes: false, name: 'Sunday Scaries', name_collides_with: [] })).toEqual({ title: 'Team updated' })
  })

  it('says so when another team in the league has the same name (allowed, but worth knowing)', () => {
    expect(myTeamSavedToast({ no_changes: false, name: 'Gridiron Gurus', name_collides_with: [{ team_id: THEM }] })).toEqual({
      title: 'Team updated',
      description: 'Another team in this league has the same name.',
    })
  })

  it('never says "updated" when nothing changed', () => {
    expect(myTeamSavedToast({ no_changes: true, name: 'Touchdown Tacos', name_collides_with: [] })).toEqual({ title: 'Your team is already called Touchdown Tacos' })
  })
})

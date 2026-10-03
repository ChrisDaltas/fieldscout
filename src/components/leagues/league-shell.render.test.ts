/**
 * league-shell.render.test.ts — League UX batch 1 (Chris 2026-10-03): ONE
 * league header (identity row + sub-nav) on every league page, in every
 * league state; one way into the Commissioner console (League settings);
 * the override indicator only while the mode is on.
 *
 * Rig: `renderToStaticMarkup` over the REAL header parts with the league
 * detail (and standings) pre-seeded in the React Query cache. The shell's
 * desktop claim goes through a store effect a static render never runs, so
 * the cells render `LeagueHeaderParts` — the same identity + nav the claim
 * puts into the app header (and the mobile copy renders inline).
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { LeagueDetail } from '@/hooks/use-league'
import { leaguesKeys } from '@/hooks/use-leagues'
import { leagueStandingsKeys } from '@/hooks/use-standings'
import { defaultsForTeamCount } from '@/lib/leagues/settings/league-settings'
import { useOverrideMode } from '@/stores/commish-override-store'

import { LeagueHeaderParts } from './league-shell'
import { NOT_STARTED_REASON, OVERRIDE_ON_INDICATOR, activeLeagueSection } from './league-shell-ops'
import { CommishConsoleRow } from './settings-panel'

const pathname = { current: '/' }
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: () => {}, replace: () => {}, refresh: () => {} }),
  usePathname: () => pathname.current,
}))
vi.mock('@/hooks/use-auth', () => ({
  useAuth: () => ({ user: { id: 'user-me' }, profile: { username: 'me' } }),
}))
vi.mock('@/stores/commish-override-store', async (importOriginal) => {
  const orig = await importOriginal<typeof import('@/stores/commish-override-store')>()
  return { ...orig, useOverrideMode: vi.fn(() => false) }
})

const LEAGUE = 'd5550000-0000-4000-8000-000000000001'
const MINE = 'd5550000-0000-4000-8000-000000000101'
const OTHER = 'd5550000-0000-4000-8000-000000000102'
const BASE = `/app/leagues/${LEAGUE}`

function detail(status: string, role: string = 'manager'): LeagueDetail {
  return {
    league: {
      id: LEAGUE,
      name: 'Shell League',
      avatar_url: null,
      description: null,
      season: 2099,
      status,
      owner_id: 'user-other',
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
      { id: 'm1', user_id: 'user-me', team_id: MINE, role, is_placeholder: false, is_autodraft: false, joined_at: null, profiles: null },
      { id: 'm2', user_id: 'user-other', team_id: OTHER, role: 'commissioner', is_placeholder: false, is_autodraft: false, joined_at: null, profiles: null },
    ],
    teams: [
      { id: MINE, name: 'Mine FC', owner_id: 'user-me', status: 'active', created_at: null },
      { id: OTHER, name: 'Other FC', owner_id: 'user-other', status: 'active', created_at: null },
    ],
    my_role: role,
    active_draft: null,
  } as LeagueDetail
}

function render(d: LeagueDetail, at: string, standings?: unknown): string {
  pathname.current = at
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, retryOnMount: false } } })
  qc.setQueryData(leaguesKeys.detail(LEAGUE), d)
  if (standings) qc.setQueryData(leagueStandingsKeys.all(LEAGUE), standings)
  return renderToStaticMarkup(
    createElement(QueryClientProvider, { client: qc }, createElement(LeagueHeaderParts, { leagueId: LEAGUE, data: d })),
  )
}

/** Every page.tsx under the league workspace, as a URL path. */
function leagueRoutes(): string[] {
  const root = path.resolve(process.cwd(), 'src/app/app/(shell)/leagues/[leagueId]')
  const out: string[] = []
  const walk = (dir: string, rel: string[]) => {
    for (const entry of readdirSync(dir)) {
      const full = path.join(dir, entry)
      if (statSync(full).isDirectory()) walk(full, [...rel, entry])
      else if (entry === 'page.tsx') out.push(rel.join('/'))
    }
  }
  walk(root, [])
  return out
}

function urlFor(route: string): string {
  const segs = route
    .split('/')
    .filter(Boolean)
    .map((s) => (s === '[teamId]' ? MINE : s === '[mid]' ? 'mid-1' : s))
  return segs.length ? `${BASE}/${segs.join('/')}` : BASE
}

afterEach(() => {
  vi.mocked(useOverrideMode).mockReturnValue(false)
})

describe('every league route renders inside the ONE league layout', () => {
  it('the [leagueId] layout exists and mounts LeagueShell — so every page under it gets the header', () => {
    const layout = readFileSync(path.resolve(process.cwd(), 'src/app/app/(shell)/leagues/[leagueId]/layout.tsx'), 'utf8')
    expect(layout).toContain('<LeagueShell')
    expect(layout).toContain('{children}')
  })

  it('every league route (all page.tsx files) renders the nav, and each one marks a section', () => {
    const routes = leagueRoutes()
    // Premise: the walk found the workspace (home + the pages).
    expect(routes).toContain('')
    expect(routes.length).toBeGreaterThanOrEqual(13)
    for (const route of routes) {
      const url = urlFor(route)
      const html = render(detail('in_season'), url)
      expect(html, route).toContain('data-league-nav')
      expect(html, route).toContain('data-league-identity')
      expect(activeLeagueSection(url, LEAGUE, MINE), route).not.toBeNull()
    }
  })

  it('no league page claims the header itself — no PageHeader in any league page component (one header bar)', () => {
    const dir = path.resolve(process.cwd(), 'src/components/leagues')
    const offenders = readdirSync(dir)
      .filter((f) => f.endsWith('.tsx') && f !== 'leagues-index.tsx')
      .filter((f) => readFileSync(path.join(dir, f), 'utf8').includes('<PageHeader'))
    expect(offenders).toStrictEqual([])
  })
})

describe('the sub-nav — tabs, the current one marked, and More', () => {
  it('the six tabs in the prototype’s order, then More', () => {
    const html = render(detail('in_season'), BASE)
    const keys = [...html.matchAll(/data-nav="([a-z]+)"/g)].map((m) => m[1])
    expect(keys).toStrictEqual(['home', 'team', 'matchup', 'players', 'schedule', 'stats', 'more'])
  })

  it.each([
    [BASE, 'home'],
    [`${BASE}/team/${MINE}`, 'team'],
    [`${BASE}/matchup`, 'matchup'],
    [`${BASE}/matchup/mid-1`, 'matchup'],
    [`${BASE}/players`, 'players'],
    [`${BASE}/schedule`, 'schedule'],
    [`${BASE}/standings`, 'stats'],
  ])('%s marks %s as the current tab (and only it)', (url, key) => {
    const html = render(detail('in_season'), url)
    expect(html.match(/aria-current="page"/g)).toHaveLength(1)
    expect(html).toMatch(new RegExp(`data-state="active"[^>]*aria-current="page"[^>]*data-nav="${key}"`))
  })

  it('settings, the console, trades, members and activity mark More', () => {
    for (const sub of ['settings', 'commish', 'trades', 'members', 'activity', 'draft/recap']) {
      const html = render(detail('in_season', 'commissioner'), `${BASE}/${sub}`)
      expect(html, sub).toMatch(/data-state="active"[^>]*data-nav="more"/)
    }
  })

  it('another team’s page marks no tab', () => {
    const html = render(detail('in_season'), `${BASE}/team/${OTHER}`)
    expect(html).not.toContain('aria-current="page"')
  })

  it('PRE-SEASON (setup / scheduled / drafting): Matchup, Schedule and Stats are disabled WITH the reason — no dead link', () => {
    for (const status of ['setup', 'scheduled', 'drafting']) {
      const html = render(detail(status), BASE)
      for (const key of ['matchup', 'schedule', 'stats']) {
        const el = html.match(new RegExp(`<span[^>]*data-nav="${key}"[^>]*>`))?.[0] ?? ''
        expect(el, `${status} ${key}`).toContain('aria-disabled="true"')
        expect(el, `${status} ${key}`).toContain(`data-nav-disabled="${NOT_STARTED_REASON}"`)
      }
      expect(html, status).not.toContain(`href="${BASE}/matchup"`)
      expect(html, status).toContain(`href="${BASE}/players"`)
    }
  })

  it('a viewer with no team: My Team is disabled with its reason', () => {
    const d = detail('in_season')
    const noTeam = { ...d, members: d.members.map((m) => (m.user_id === 'user-me' ? { ...m, team_id: null } : m)) }
    const html = render(noTeam, BASE)
    expect(html).toMatch(/<span[^>]*aria-disabled="true"[^>]*data-nav="team"/)
  })
})

describe('commissioner — one way in, override indicator only while ON', () => {
  it('the header offers NO Commissioner link — for a commissioner, in any state', () => {
    for (const status of ['setup', 'drafting', 'in_season', 'playoffs', 'complete']) {
      const html = render(detail(status, 'commissioner'), BASE)
      expect(html, status).not.toContain(`${BASE}/commish`)
      expect(html, status).not.toMatch(/>Commissioner</)
    }
  })

  it('League settings carries the ONE door into the console', () => {
    const row = renderToStaticMarkup(createElement(CommishConsoleRow, { leagueId: LEAGUE }))
    expect(row).toContain(`href="${BASE}/commish"`)
    expect(row).toContain('data-door="commish"')
    expect(row).not.toMatch(/[\s"]shadow-hard/) // elevation only behind hover:/focus-visible:
  })

  it('override OFF: nothing about it shows; ON: the slim indicator with Turn off — commissioner only', () => {
    expect(render(detail('in_season', 'commissioner'), BASE)).not.toContain('data-override-indicator')
    vi.mocked(useOverrideMode).mockReturnValue(true)
    const on = render(detail('in_season', 'commissioner'), BASE)
    expect(on).toContain('data-override-indicator')
    expect(on).toContain(OVERRIDE_ON_INDICATOR)
    expect(on).toContain('data-override-off')
    expect(on).not.toContain('data-override-toggle') // no full switch bar in the header
    // A manager never sees it, whatever the store says.
    expect(render(detail('in_season', 'manager'), BASE)).not.toContain('data-override-indicator')
  })
})

describe('the identity row — never invented numbers', () => {
  it('team name, league name and the muted line; status badge until a week is final', () => {
    const html = render(detail('in_season'), BASE)
    expect(html).toContain('Mine FC')
    expect(html).toContain('Shell League')
    expect(html).toMatch(/data-identity-line[^>]*>2 teams · \d+ roster spots</)
    expect(html).toContain('data-identity-status')
    expect(html).not.toContain('data-identity-record')
    expect(html).not.toContain('data-identity-rank')
    expect(html).not.toMatch(/odds/i)
  })

  it('with a final week: the record and the rank from the standings row', () => {
    const standings = {
      reason: null,
      standings: [
        { rank: 1, team_id: OTHER, wins: 3, losses: 0, ties: 0, games: 3 },
        { rank: 2, team_id: MINE, wins: 2, losses: 1, ties: 0, games: 3 },
      ],
    }
    const html = render(detail('in_season'), BASE, standings)
    expect(html).toMatch(/data-identity-record[^>]*>2-1</)
    expect(html).toContain('Rank #2')
  })
})

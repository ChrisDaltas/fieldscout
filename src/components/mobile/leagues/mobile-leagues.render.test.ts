/**
 * Leagues on the phone (gap list §4 item 104): `/app/leagues` draws its own
 * FieldScout Mobile screen — the 52px page bar (blue back chevron,
 * "Leagues" as the h1) over one Home league card per league and Home's
 * "Join or create a league" button — in `m-*` tokens so the phone's dark
 * mode follows, instead of the borrowed desktop layout. Desktop keeps its
 * page, on the same `useLeagues` read.
 *
 * Screens render statically over a seeded query cache (effects don't run).
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createElement, type ReactElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

vi.mock('next/navigation', () => ({
  usePathname: () => '/app/leagues',
  useRouter: () => ({ push: vi.fn(), back: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}))
vi.mock('@/lib/supabase/client', () => ({
  createBrowserClient: () => ({
    auth: { getSession: async () => ({ data: { session: null } }), onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => {} } } }) },
    from: () => ({}),
    channel: () => ({ on: () => ({}), subscribe: () => ({}) }),
    removeChannel: () => {},
  }),
}))
const flags = vi.hoisted(() => ({ leagues: true, mockDrafts: true, personas: false, messages: false, weeklyRanks: true, startOrSit: true }))
vi.mock('@/lib/feature-flags', () => ({ featureFlags: flags }))

import { LeagueCard } from '@/components/mobile/home/home-matchups'
import { auctionPoolKeys } from '@/hooks/use-draft-pool'
import { leaguesKeys, type MyLeagueRow } from '@/hooks/use-leagues'
import { leagueMatchupKeys } from '@/hooks/use-matchups'
import { scheduleKeys } from '@/hooks/use-schedule'
import { leagueStandingsKeys } from '@/hooks/use-standings'

import { LEAGUES_COPY } from './leagues-ops'
import { MobileLeagues } from './mobile-leagues'

function league(id: string, over: Partial<MyLeagueRow>): MyLeagueRow {
  return { id, name: `League ${id}`, avatar_url: null, season: 2026, status: 'in_season', team_count: 12, created_at: null, my_role: 'manager', my_team_id: `${id}-team`, ...over }
}

/** The route's order, kept as is — the app's one league order. */
const LEAGUES: MyLeagueRow[] = [
  league('A', { name: 'Sunday Funday League', team_count: 8, my_role: 'commissioner', my_team_id: 't1' }),
  league('B', { name: 'Joy to Us', status: 'setup' }),
  league('C', { name: 'Work League', status: 'drafting', team_count: 10, my_role: 'co_commissioner' }),
  league('D', { name: 'Office Pool', status: 'playoffs' }),
  league('E', { name: 'Last Year', status: 'complete', season: 2025 }),
]

function client() {
  return new QueryClient({ defaultOptions: { queries: { retry: false, retryOnMount: false } } })
}

function seeded(leagues: MyLeagueRow[] = LEAGUES) {
  return (qc: QueryClient) => {
    qc.setQueryData(leaguesKeys.all, leagues)
    qc.setQueryData(auctionPoolKeys.scoring('A'), { receptions: 1 })
    qc.setQueryData(auctionPoolKeys.scoring('B'), { receptions: 0 })
    qc.setQueryData(auctionPoolKeys.scoring('C'), { receptions: 0.5 })
    qc.setQueryData(scheduleKeys.all('A'), {
      weeks: [
        { id: 'w1', season: 2026, week: 1, status: 'live', finalized_at: null, median_score: null },
        { id: 'w2', season: 2026, week: 2, status: 'upcoming', finalized_at: null, median_score: null },
      ],
      matchups: [],
    })
    qc.setQueryData(leagueMatchupKeys.week('A', 1), {
      league_id: 'A',
      season: 2026,
      week: 1,
      schedule_mode: 'h2h',
      league_week: { status: 'live', median_score: null, finalized_at: null },
      teams: [
        { id: 't1', name: 'Fourth & Long', status: 'active' },
        { id: 't2', name: 'Hail Mary Heroes', status: 'active' },
      ],
      matchups: [
        { id: 'm1', season: 2026, week: 1, round_type: 'regular', status: 'live', home_team_id: 't1', away_team_id: 't2', home_score: 41.2, away_score: 17.5, result: null, is_overridden: false, updated_at: null },
      ],
      results: [],
    })
    qc.setQueryData(leagueStandingsKeys.all('A'), {
      standings: [
        { team_id: 't1', wins: 3, losses: 1, ties: 0 },
        { team_id: 't2', wins: 1, losses: 3, ties: 0 },
      ],
      reason: null,
    })
  }
}

function html(node: ReactElement, seed?: (qc: QueryClient) => void): string {
  const qc = client()
  seed?.(qc)
  return renderToStaticMarkup(createElement(QueryClientProvider, { client: qc }, node))
    .replace(/&#x27;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
}

const render = (seed?: (qc: QueryClient) => void) => html(createElement(MobileLeagues), seed)

/** A leagues read that failed, with or without leagues from an earlier read. */
function failed(data: MyLeagueRow[] | undefined) {
  return (qc: QueryClient) => {
    if (data) seeded(data)(qc)
    const query = qc.getQueryCache().build(qc, { queryKey: leaguesKeys.all })
    query.setState({ ...query.state, status: 'error', error: new Error('boom'), data, fetchStatus: 'idle' })
  }
}

/** One card's markup, from its anchor to its close. */
function card(out: string, id: string): string {
  const at = out.indexOf(`data-league-card="${id}"`)
  expect(at, id).toBeGreaterThanOrEqual(0)
  const start = out.lastIndexOf('<a ', at)
  return out.slice(start, out.indexOf('</a>', at) + 4)
}

/** Desktop colour tokens: fixed light colours that don't follow phone dark
 *  mode (the phone draws in `m-*`). The one exception is the gold league
 *  tile's dark letters (`leagueAvClass`, ruling #38), fixed on a fixed fill. */
const DESKTOP_COLOUR = /^(?:[a-z]+:)*(?:text|bg|border)-(?:ink|white|n-\d|negative|positive|caution|surface)/
function expectPhoneTokensOnly(out: string) {
  const tokens = [...out.matchAll(/class="([^"]*)"/g)]
    .map((m) => m[1])
    .filter((cls) => !cls.includes('bg-pos-te text-ink'))
    .flatMap((cls) => cls.split(/\s+/))
    .filter(Boolean)
  expect(tokens.filter((t) => DESKTOP_COLOUR.test(t) && t !== 'text-white')).toEqual([])
}

describe('Leagues — the phone screen (gap list §4 item 104)', () => {
  const out = render(seeded())

  it('has its own page bar: the blue back chevron and “Leagues” as the h1', () => {
    expect(out).toMatch(/<button[^>]*aria-label="Back"[^>]*class="[^"]*text-accent[^"]*"[^>]*data-page-back/)
    expect(out).toMatch(/<h1[^>]*>Leagues<\/h1>/)
    expect(out).toContain('data-mobile-screen')
  })

  it('draws one Home league card per league, in the route’s order', () => {
    const ids = [...out.matchAll(/data-league-card="([^"]+)"/g)].map((m) => m[1])
    expect(ids).toEqual(['A', 'B', 'C', 'D', 'E'])
    // Home's card: 18px corners on b1, the pressed tint.
    for (const id of ids) expect(card(out, id)).toMatch(/class="[^"]*rounded-\[18px\] bg-m-b1[^"]*active:bg-m-b2h/)
    expectPhoneTokensOnly(out)
  })

  it('each card opens what its league is doing, as on Home', () => {
    const tag = (id: string) => card(out, id).match(/^<a [^>]*>/)?.[0] ?? ''
    expect(tag('A')).toContain('href="/app/leagues/A/matchup"') // in season → Match
    expect(tag('B')).toContain('href="/app/leagues/B"') // pre-draft → the League tab's draft home
    expect(tag('C')).toContain('href="/app/leagues/C/draft"') // drafting → the draft room
    expect(tag('D')).toContain('href="/app/leagues/D/matchup"')
    expect(tag('E')).toContain('href="/app/leagues/E/matchup"')
  })

  it('in season: size and scoring, the week, the role, and the week’s stored scores and records', () => {
    const a = card(out, 'A')
    expect(a).toContain('>Sunday Funday League<')
    expect(a).toContain('>8-team PPR · Week 1 · Commissioner<')
    expect(a).toContain('Fourth & Long (3-1)')
    expect(a).toContain('Hail Mary Heroes (1-3)')
    expect(a.indexOf('41.20')).toBeLessThan(a.indexOf('17.50'))
    expect(a).not.toContain('data-league-status')
  })

  it('before and during the draft: the draft pill, the season, and the role when you run it', () => {
    const b = card(out, 'B')
    expect(b).toContain('>12-team standard · 2026<')
    expect(b).toContain('Pre-draft')
    const c = card(out, 'C')
    expect(c).toContain('>10-team half PPR · 2026 · Co-commissioner<')
    expect(c).toContain('Draft live')
    expect(c).not.toContain('Pre-draft')
  })

  it('names the playoffs and a finished league — desktop’s badge, in the pill’s shape', () => {
    const d = card(out, 'D')
    expect(d).toMatch(/<span class="[^"]*rounded-pill[^"]*bg-m-gb text-m-tb[^"]*" data-league-status="playoffs">Playoffs<\/span>/)
    const e = card(out, 'E')
    expect(e).toMatch(/<span class="[^"]*rounded-pill[^"]*bg-m-b3s text-m-t2[^"]*" data-league-status="complete">Complete<\/span>/)
    // A manager's card names no role.
    expect(d).not.toMatch(/Manager|Commissioner/)
  })

  it('ends with Home’s “Join or create a league” — the free join and create doors', () => {
    expect(out).toMatch(/<button[^>]*>.*Join or create a league<\/button>/)
    expect(out.indexOf('Join or create a league')).toBeGreaterThan(out.lastIndexOf('data-league-card='))
  })

  it('says so when you’re in no league, and still offers Join or create', () => {
    const empty = render(seeded([]))
    expect(empty).toContain(`>${LEAGUES_COPY.emptyTitle}<`)
    expect(empty).toContain(`>${LEAGUES_COPY.emptyBody}<`)
    expect(empty).not.toContain('data-league-card')
    expect(empty).toContain('Join or create a league')
    expectPhoneTokensOnly(empty)
  })

  it('shows loading cards before the first read', () => {
    const loading = render()
    expect(loading).toContain('data-leagues-loading')
    expect(loading).not.toContain(LEAGUES_COPY.emptyTitle)
    expect(loading).toContain('Join or create a league')
  })

  it('a failed read is an error with Try again — never “No leagues yet”', () => {
    const out = render(failed(undefined))
    expect(out).toContain(`>${LEAGUES_COPY.loadFailed}<`)
    expect(out).toContain('>boom<')
    expect(out).toMatch(/<button[^>]*>Try again<\/button>/)
    expect(out).not.toContain(LEAGUES_COPY.emptyTitle)
    expectPhoneTokensOnly(out)
  })

  it('a failed refresh keeps the cards and says it could not refresh', () => {
    const out = render(failed(LEAGUES))
    expect(out).toMatch(new RegExp(`role="alert"[\\s\\S]*${LEAGUES_COPY.refreshFailed.replace('.', '\\.')}[\\s\\S]*Try again`))
    expect([...out.matchAll(/data-league-card=/g)]).toHaveLength(5)
  })
})

describe('Home keeps its own card', () => {
  it('the home variant adds no status pill and no role', () => {
    const out = html(createElement(LeagueCard, { league: league('D', { status: 'playoffs', my_role: 'commissioner' }), index: 0 }), seeded())
    expect(out).not.toContain('data-league-status')
    expect(out).not.toContain('Commissioner')
  })
})

describe('the route draws it on the phone (ByLayout), desktop unchanged', () => {
  const page = readFileSync(path.join(process.cwd(), 'src/app/app/(shell)/leagues/page.tsx'), 'utf8')
  it('ByLayout: desktop keeps LeaguesIndex, the phone gets MobileLeagues', () => {
    expect(page).toContain('<ByLayout desktop={<LeaguesIndex />} mobile={<MobileLeagues />} />')
  })
})

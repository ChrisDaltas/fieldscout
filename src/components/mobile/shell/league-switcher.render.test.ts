/**
 * The league switcher and Home's league cards before the season (gap list
 * §3 #20): the draft time or "Draft live" in place of a record (never
 * "Pre-draft" mid-draft, never a stray 0-0), the size-and-scoring line in
 * the Switch league sheet, "Switched to {your team}", and the league's
 * photo when one is uploaded.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createElement, type ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

const nav = vi.hoisted(() => ({ pathname: '/app/leagues/A/matchup' }))
vi.mock('next/navigation', () => ({
  usePathname: () => nav.pathname,
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
vi.mock('@/lib/feature-flags', () => ({ featureFlags: { leagues: true, mockDrafts: true, community: false, messages: false } }))
// The sheet portals (Radix) — render its body in place so the rows can be read.
vi.mock('@/components/mobile/ui/mobile-sheet', () => ({
  MobileSheet: ({ open, title, children }: { open: boolean; title: string; children: ReactNode }) =>
    open ? createElement('div', { 'data-sheet': title }, children) : null,
}))
// Radix's avatar shows its image only after the browser loads it — a static
// render never does; expose which photo each tile was handed.
vi.mock('@/components/mobile/messages/messages-avatar', () => ({
  MessagesAvatar: ({ text, src }: { text: string; src?: string | null }) => createElement('span', { 'data-photo': src ?? 'none' }, text),
}))

import { HomeMatchups } from '@/components/mobile/home/home-matchups'
import { auctionPoolKeys } from '@/hooks/use-draft-pool'
import { leaguesKeys } from '@/hooks/use-leagues'
import { leagueStandingsKeys } from '@/hooks/use-standings'

import { LeagueSwitchSheet } from './league-switch-sheet'
import { MobileDock } from './mobile-dock'
import { switchedToTitle } from './use-league-card'

// A draft time far ahead and at noon UTC: "Aug 28" in every test clock.
const DRAFT_AT = '2099-08-28T12:00:00Z'
const DRAFT_TEXT = /Draft Aug 28 · \d{1,2}:\d{2}[\s ][AP]M/

const LEAGUES = [
  { id: 'A', name: 'Sunday Funday League', avatar_url: null, season: 2099, status: 'in_season', team_count: 12, created_at: null, my_role: 'manager', my_team_id: 't1' },
  { id: 'B', name: 'Joy to Us', avatar_url: 'https://img.test/joy.png', season: 2099, status: 'scheduled', team_count: 12, created_at: null, my_role: 'manager', my_team_id: 'u1' },
  { id: 'C', name: 'Work League', avatar_url: null, season: 2099, status: 'drafting', team_count: 10, created_at: null, my_role: 'manager', my_team_id: 'w1' },
  { id: 'D', name: 'Family Bragging Rights', avatar_url: null, season: 2099, status: 'setup', team_count: 10, created_at: null, my_role: 'commissioner', my_team_id: 'f1' },
]

function detail(teams: { id: string; name: string }[], draftAt: string | null) {
  return { teams: teams.map((t) => ({ ...t, owner_id: 'o', status: 'active', created_at: null })), settings: { draft: { draft_scheduled_at: draftAt } } }
}

function seeded() {
  const qc = new QueryClient()
  qc.setQueryData(['leagues'], LEAGUES)
  qc.setQueryData(auctionPoolKeys.scoring('A'), { receptions: 0 })
  qc.setQueryData(auctionPoolKeys.scoring('B'), { receptions: 1 })
  qc.setQueryData(auctionPoolKeys.scoring('C'), { receptions: 0.5 })
  qc.setQueryData(leaguesKeys.detail('A'), detail([{ id: 't1', name: 'Touchdown Tacos' }], null))
  qc.setQueryData(leaguesKeys.detail('B'), detail([{ id: 'u1', name: 'Taco Tuesday' }], DRAFT_AT))
  // Drafting with a saved time: still "Draft live", never the time or "Pre-draft".
  qc.setQueryData(leaguesKeys.detail('C'), detail([{ id: 'w1', name: 'Spreadsheet Slingers' }], DRAFT_AT))
  qc.setQueryData(leaguesKeys.detail('D'), detail([{ id: 'f1', name: 'Dalton’s Dynasty' }], null))
  qc.setQueryData(leagueStandingsKeys.all('A'), { standings: [{ team_id: 't1', name: 'Touchdown Tacos', wins: 2, losses: 6, ties: 0 }], reason: null })
  // A scheduled league's standings are every team at 0-0 — never shown.
  qc.setQueryData(leagueStandingsKeys.all('B'), { standings: [{ team_id: 'u1', name: 'Taco Tuesday', wins: 0, losses: 0, ties: 0 }], reason: 'no_final_weeks' })
  return qc
}

const html = (node: ReturnType<typeof createElement>) =>
  renderToStaticMarkup(createElement(QueryClientProvider, { client: seeded() }, node)).replace(/&#x27;/g, "'").replace(/&amp;/g, '&')

/** The markup of one element, from its opening tag to its matching close. */
function block(out: string, attr: string, tag = 'button'): string {
  const at = out.indexOf(attr)
  if (at < 0) return ''
  const start = out.lastIndexOf(`<${tag}`, at)
  return out.slice(start, out.indexOf(`</${tag}>`, at) + tag.length + 3)
}

describe('league switcher (gap list §3 #20)', () => {
  it('the switcher card shows your team and its record in season', () => {
    const out = html(createElement(MobileDock))
    const card = block(out, 'data-league-switcher', 'div')
    expect(card).toContain('Touchdown Tacos')
    expect(card).toContain('>2-6</span>')
    expect(card).toContain('data-photo="none"')
  })

  it('the switcher card before the season: the draft day only ("Draft Aug 28"), in its own unshrinking span so a long team name truncates instead of it', () => {
    try {
      nav.pathname = '/app/leagues/B/matchup'
      const b = block(html(createElement(MobileDock)), 'data-league-switcher', 'div')
      expect(b).toMatch(/<span class="min-w-0 truncate">Taco Tuesday<\/span><span class="flex-none whitespace-nowrap[^"]*">Draft Aug 28<\/span>/)
      expect(b).not.toMatch(DRAFT_TEXT)
      expect(b).not.toContain('0-0')
      expect(b).toContain('data-photo="https://img.test/joy.png"')

      nav.pathname = '/app/leagues/C/matchup'
      const c = block(html(createElement(MobileDock)), 'data-league-switcher', 'div')
      expect(c).toMatch(/<span class="min-w-0 truncate">Spreadsheet Slingers<\/span><span class="flex-none whitespace-nowrap[^"]*">Draft live<\/span>/)
    } finally {
      nav.pathname = '/app/leagues/A/matchup'
    }
  })

  it('the Switch league sheet: the draft time or "Draft live" for a league not yet playing, size and scoring, the league photo', () => {
    const out = html(createElement(LeagueSwitchSheet, { open: true, onOpenChange: () => {}, current: LEAGUES[0]!, leagues: LEAGUES, tab: 'match' }))
    expect(out).toContain('data-sheet="Switch league"')

    const a = block(out, 'data-switch-league="A"')
    expect(a).toContain('Touchdown Tacos')
    expect(a).toContain('>2-6</span>')
    expect(a).toContain('Sunday Funday League · 12-team standard')

    const b = block(out, 'data-switch-league="B"')
    expect(b).toContain('Taco Tuesday')
    expect(b).toMatch(DRAFT_TEXT)
    // The name truncates on its own; the draft line never does.
    expect(b).toMatch(/<span class="min-w-0 truncate">Taco Tuesday<\/span><span class="flex-none whitespace-nowrap[^"]*">Draft Aug 28 · /)
    expect(b).not.toContain('0-0')
    expect(b).not.toContain('Pre-draft')
    expect(b).toContain('Joy to Us · 12-team PPR')
    expect(b).toContain('data-photo="https://img.test/joy.png"')

    const c = block(out, 'data-switch-league="C"')
    expect(c).toContain('Spreadsheet Slingers')
    expect(c).toContain('Draft live')
    expect(c).not.toContain('Pre-draft')
    expect(c).not.toMatch(DRAFT_TEXT)
    expect(c).toContain('Work League · 10-team half PPR')

    // No draft time set yet; scoring not read → no scoring word guessed.
    const d = block(out, 'data-switch-league="D"')
    expect(d).toContain('Dalton’s Dynasty')
    expect(d).toContain('Pre-draft')
    expect(d).toContain('Family Bragging Rights · 10-team<')
  })

  it('says "Switched to" your team there — the league’s name only when there is no team to name', () => {
    const league = { name: 'Joy to Us', my_team_id: 'u1' }
    expect(switchedToTitle(league, { teams: [{ id: 'u1', name: 'Taco Tuesday', owner_id: 'o', status: 'active', created_at: null }] })).toBe('Switched to Taco Tuesday')
    expect(switchedToTitle(league, undefined)).toBe('Switched to Joy to Us')
    expect(switchedToTitle({ name: 'Joy to Us', my_team_id: null }, { teams: [] })).toBe('Switched to Joy to Us')
  })
})

describe('league switcher dots (gap list §4 item 7)', () => {
  it('the "you are here" dash is white in both themes — never the page colour, which turns near-black on the dark card', () => {
    for (const [path, current] of [
      ['/app/leagues/A/matchup', 0],
      ['/app/leagues/C/matchup', 2],
    ] as const) {
      try {
        nav.pathname = path
        const card = block(html(createElement(MobileDock)), 'data-league-switcher', 'div')
        const dots = card.match(/<span class="h-1\.5 rounded-pill[^"]*"><\/span>/g) ?? []
        expect(dots).toHaveLength(LEAGUES.length)
        dots.forEach((dot, i) => {
          if (i === current) expect(dot).toMatch(/(?<![\w-])w-3\.5 bg-white(?![\w/-])/)
          else expect(dot).toMatch(/(?<![\w-])w-1\.5 bg-m-dot(?![\w-])/)
        })
        // The theme-flipping page colour (#121212 in dark) never paints a dot.
        expect(card).not.toMatch(/(?<![\w-])bg-m-b\d/)
      } finally {
        nav.pathname = '/app/leagues/A/matchup'
      }
    }
  })
})

describe('Home league cards before the season (gap list §3 #20)', () => {
  it('a pre-draft card names its draft time; "Pre-draft" only with none set; "Draft live" while drafting', () => {
    const out = html(createElement(HomeMatchups))
    const b = block(out, 'data-league-card="B"', 'a')
    expect(b).toMatch(DRAFT_TEXT)
    expect(b).not.toContain('Pre-draft')
    expect(b).toContain('12-team PPR · 2099')
    const c = block(out, 'data-league-card="C"', 'a')
    expect(c).toContain('Draft live')
    expect(c).not.toMatch(DRAFT_TEXT)
    expect(block(out, 'data-league-card="D"', 'a')).toContain('Pre-draft')
  })

  it('a card shows the league’s photo when one is uploaded, its letters otherwise', () => {
    const out = html(createElement(HomeMatchups))
    expect(block(out, 'data-league-card="B"', 'a')).toContain('data-photo="https://img.test/joy.png"')
    expect(block(out, 'data-league-card="A"', 'a')).toContain('data-photo="none">SF<')
  })
})

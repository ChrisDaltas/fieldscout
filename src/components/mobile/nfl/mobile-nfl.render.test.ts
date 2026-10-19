/**
 * NFL team pages on the phone (gap list §4 item 103): `/app/nfl` and
 * `/app/nfl/[team]` draw their own FieldScout Mobile screens — the teams by
 * division under the 52px page bar, and a team under its team-colour header
 * with its fantasy players in ADP order — on the same data as desktop, in
 * `m-*` tokens so the phone's dark mode follows, instead of the borrowed
 * desktop layout. Desktop keeps its pages.
 *
 * Rendered statically (effects don't run).
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'

import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

vi.mock('next/navigation', () => ({
  usePathname: () => '/app/nfl',
  useRouter: () => ({ push: vi.fn(), back: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}))

import type { RosterPlayer } from '@/components/teams/team-roster'
import { NFL_DIVISIONS, NFL_TEAMS, getNflTeam, teamsInDivision } from '@/lib/nfl-teams'

import { MobileNflTeam, MobileNflTeams } from './mobile-nfl'
import { NFL_COPY } from './nfl-ops'

function clean(html: string): string {
  return html.replace(/&#x27;/g, "'").replace(/&amp;/g, '&').replace(/&quot;/g, '"')
}

function player(id: string, over: Partial<RosterPlayer> = {}): RosterPlayer {
  return {
    id,
    full_name: `Player ${id}`,
    position: 'WR',
    team: 'BUF',
    headshot_url: null,
    status: 'Active',
    jersey_number: 10,
    adp: 100,
    bye_week: 7,
    ...over,
  }
}

/** ADP order, nulls last — the route's read, kept as is. */
const ROSTER: RosterPlayer[] = [
  player('cook', { full_name: 'James Cook', position: 'RB', jersey_number: 4, adp: 8.8 }),
  player('moore', { full_name: 'DJ Moore', jersey_number: 2, adp: 49.8, status: 'Questionable' }),
  player('shavers', { full_name: 'Tyrell Shavers', jersey_number: 14, adp: 519.1, status: 'PUP' }),
  player('dst', { full_name: 'Buffalo Bills', position: 'DEF', jersey_number: null, adp: 683.5 }),
  player('latu', { full_name: 'Keleki Latu', position: 'TE', jersey_number: 83, adp: null, status: 'Inactive' }),
]

function renderTeam(abbr: string, roster: RosterPlayer[], byeWeek: number | null = 7): string {
  const team = getNflTeam(abbr)!
  return clean(renderToStaticMarkup(createElement(MobileNflTeam, { team, roster, byeWeek })))
}

/** Desktop colour tokens: fixed light colours that don't follow phone dark
 *  mode (the phone draws in `m-*`). Allowed: white text, the see-through
 *  white on a team colour (the profile header's), and the shared headshot's
 *  initials on its fixed #EEEEF1 fallback. */
const DESKTOP_COLOUR = /^(?:[a-z]+:)*(?:text|bg|border)-(?:ink|white|n-\d|negative|positive|caution|surface)/
const ON_TEAM_COLOUR = /^(?:active:)?(?:bg|text)-white\/(?:\[\.\d+\]|\d+)$/
function desktopTokens(html: string): string[] {
  const tokens = [...html.matchAll(/class="([^"]*)"/g)].flatMap((m) => m[1].split(/\s+/)).filter(Boolean)
  return tokens.filter((t) => DESKTOP_COLOUR.test(t) && t !== 'text-white' && t !== 'text-n-3' && !ON_TEAM_COLOUR.test(t))
}

describe('NFL teams — the phone screen (gap list §4 item 103)', () => {
  const html = clean(renderToStaticMarkup(createElement(MobileNflTeams)))

  it('has its own page bar: the blue back chevron and “NFL teams” as the h1', () => {
    expect(html).toMatch(/<button[^>]*aria-label="Back"[^>]*class="[^"]*text-accent[^"]*"[^>]*data-page-back/)
    expect(html).toMatch(/<h1[^>]*>NFL teams<\/h1>/)
    expect(html).toContain('data-mobile-screen')
  })

  it('every division in order, each with its four teams linking to the team page', () => {
    const divisions = [...html.matchAll(/data-nfl-division="([^"]+)"/g)].map((m) => m[1])
    expect(divisions).toEqual(NFL_DIVISIONS.map(({ conference, division }) => `${conference} ${division}`))
    for (const d of divisions) expect(html).toMatch(new RegExp(`<h2[^>]*>${d}</h2>`))
    const links = [...html.matchAll(/<a[^>]*data-nfl-team-link="([A-Z]+)"[^>]*href="\/app\/nfl\/\1"/g)].map((m) => m[1])
    expect(links).toEqual(NFL_DIVISIONS.flatMap(({ conference, division }) => teamsInDivision(conference, division).map((t) => t.abbr)))
    expect(new Set(links).size).toBe(Object.keys(NFL_TEAMS).length)
    expect(html).toContain('>Buffalo Bills<')
    expect(html).toContain('>San Francisco 49ers<')
  })

  it('each crest is the team’s abbreviation on its colour — dark text on the light ones', () => {
    expect(html).toMatch(/class="[^"]*text-white[^"]*" style="background-color:#00338D" data-nfl-crest="true">BUF</)
    // PIT gold and NO old gold take dark text (the prototype's isLight).
    expect(html).toMatch(/class="[^"]*text-ink[^"]*" style="background-color:#FFB612" data-nfl-crest="true">PIT</)
    expect(html).toMatch(/class="[^"]*text-ink[^"]*" style="background-color:#D3BC8D" data-nfl-crest="true">NO</)
  })

  it('draws in phone tokens only (the team colour is the one fixed fill, and its text)', () => {
    expect(desktopTokens(html).filter((t) => t !== 'text-ink')).toEqual([])
  })
})

describe('One NFL team — the phone screen (gap list §4 item 103)', () => {
  it('the team-colour header: the back button, the crest and the team as the h1, its division and bye', () => {
    const html = renderTeam('BUF', ROSTER)
    expect(html).toMatch(/<div class="[^"]*text-white[^"]*" style="background:#00338D" data-nfl-team-band="BUF">/)
    expect(html).toMatch(/<button[^>]*aria-label="Back"[^>]*data-page-back/)
    expect(html).toMatch(/<h1[^>]*>Buffalo Bills<\/h1>/)
    expect(html).toContain('>AFC East · Bye week 7<')
    expect(html).toContain('data-mobile-screen')
  })

  it('a light team colour takes dark text', () => {
    const html = renderTeam('PIT', [player('w', { team: 'PIT' })], 9)
    expect(html).toMatch(/<div class="[^"]*text-ink[^"]*" style="background:#FFB612" data-nfl-team-band="PIT">/)
    expect(html).toContain('>AFC North · Bye week 9<')
  })

  it('no bye on file: the header names the division only', () => {
    const html = renderTeam('BUF', ROSTER, null)
    expect(html).toContain('>AFC East<')
    expect(html).not.toContain('Bye week')
  })

  it('lists every player in the route’s order under the count and an ADP column', () => {
    const html = renderTeam('BUF', ROSTER)
    expect(html).toMatch(/<h2[^>]*>5 fantasy players<\/h2>/)
    expect(html).toMatch(/aria-hidden="true"[^>]*>ADP<\/span>/)
    const rows = [...html.matchAll(/data-nfl-player="([^"]+)"/g)].map((m) => m[1])
    expect(rows).toEqual(['cook', 'moore', 'shavers', 'dst', 'latu'])
    expect(html).toContain('<span class="sr-only">ADP </span>8.8<')
    expect(html).toContain('<span class="sr-only">ADP </span>683.5<')
    // No ADP: a faint dash.
    expect(html).toMatch(/class="[^"]*text-m-t5[^"]*"><span class="sr-only">ADP <\/span>–</)
  })

  it('each row: the name, the position in its colour, the number and the designation in its tone', () => {
    const html = renderTeam('BUF', ROSTER)
    expect(html).toMatch(/>James Cook<\/span><span class="[^"]*text-m-pos-rb[^"]*">RB</)
    expect(html).toMatch(/data-nfl-player-meta="true">#4<\/span>/)
    expect(html).toMatch(/data-nfl-player-meta="true">#2 · <span class="[^"]*text-m-to[^"]*">Questionable<\/span>/)
    expect(html).toMatch(/data-nfl-player-meta="true">#14 · <span class="[^"]*text-m-red[^"]*">PUP<\/span>/)
    expect(html).toMatch(/data-nfl-player-meta="true">#83 · <span class="text-m-t3">Inactive<\/span>/)
    // A defense: "D/ST", no number, and an Active one has no second line.
    expect(html).toMatch(/>Buffalo Bills<\/span><span class="[^"]*">D\/ST</)
    const dst = html.slice(html.indexOf('data-nfl-player="dst"'), html.indexOf('data-nfl-player="latu"'))
    expect(dst).not.toContain('data-nfl-player-meta')
    // The bye is the team's, in the header — never repeated on every row.
    expect(html.match(/Bye week/g)).toHaveLength(1)
  })

  it('a row is one button that opens the player — never a link off the page', () => {
    const html = renderTeam('BUF', ROSTER)
    expect(html.match(/<li[^>]*data-nfl-player="[^"]+"><button type="button"/g)).toHaveLength(ROSTER.length)
    expect(html).not.toContain('<a ')
  })

  it('an empty roster says so', () => {
    const html = renderTeam('BUF', [], null)
    expect(html).toContain(`>${NFL_COPY.emptyTitle}<`)
    expect(html).toContain(`>${NFL_COPY.emptyBody}<`)
    expect(html).not.toContain('data-nfl-player=')
    expect(html).not.toContain('fantasy players<')
  })

  it('draws in phone tokens only (the team colour is the one fixed fill, and its text)', () => {
    expect(desktopTokens(renderTeam('BUF', ROSTER))).toEqual([])
    expect(desktopTokens(renderTeam('PIT', [player('w', { team: 'PIT' })])).filter((t) => !/^text-ink(\/|$)/.test(t))).toEqual([])
  })
})

describe('the routes draw them on the phone (ByLayout); desktop keeps its pages', () => {
  const src = (p: string) => readFileSync(path.join(process.cwd(), p), 'utf8')

  it('NFL teams: desktop keeps its cards, the phone gets MobileNflTeams', () => {
    expect(src('src/app/app/(shell)/nfl/page.tsx')).toContain(
      '<ByLayout desktop={<DesktopNflTeams />} mobile={<MobileNflTeams />} />',
    )
  })

  it('a team: both layouts get the one server read (roster, bye)', () => {
    const page = src('src/app/app/(shell)/nfl/[team]/page.tsx')
    expect(page).toContain('desktop={<DesktopNflTeam info={info} roster={roster} byeWeek={byeWeek} />}')
    expect(page).toContain('mobile={<MobileNflTeam team={info} roster={roster} byeWeek={byeWeek} />}')
  })

  it('a phone row opens the player’s profile (outside any league)', () => {
    const screen = src('src/components/mobile/nfl/mobile-nfl.tsx')
    expect(screen).toContain('usePlayerModalStore((s) => s.openPlayerView)')
    expect(screen).toContain('onOpen={() => openPlayer(p.id)}')
  })

  it('Back: where you came from, else the teams list (a team) or Home (the list)', () => {
    const screen = src('src/components/mobile/nfl/mobile-nfl.tsx')
    expect(screen).toContain('goBack(NFL_TEAM_PARENT)')
    expect(screen).toContain('goBack(NFL_TEAMS_PARENT)')
    const ops = src('src/components/mobile/nfl/nfl-ops.ts')
    expect(ops).toContain("NFL_TEAM_PARENT = '/app/nfl'")
    expect(ops).toContain("NFL_TEAMS_PARENT = '/app'")
  })
})

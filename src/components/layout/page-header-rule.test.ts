import { readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

/**
 * F577 / D487 — ONE page header in the logged-in app.
 *
 * Chris (2026-10-04): "the page header looks strangely tall and inconsistent.
 * That should be a standard component used throughout the application."
 * The standard is the shell's `AppHeader`, claimed by a page with
 * `PageHeader` (`app-header.tsx`): one 58px row, `text-h5` title, actions on
 * the right, plus a few generic options (subtitle · aside · editableTitle ·
 * subnav · inPageOnMobile). This scan stops a page from growing its own
 * header again. It reads `src/app/app/(shell)/**` and `src/components/**`.
 *
 * Page-level header markup it looks for (comments stripped first, so a
 * docblock can't satisfy or trip it):
 *   A. an `<h1>`                                        — page-level heading
 *   B. a `<header>` element                             — a header of its own
 *   C. a heading element at page size (`text-h1`–`text-h4`)
 *   D. a hand-rolled mobile title row (`lg:hidden` + a heading) — use
 *      `PageHeader … inPageOnMobile` instead (no exceptions)
 *   E. `PageHeader title={<…>}` — a custom title node; pass a string and use
 *      the options instead (no exceptions)
 *
 * A–C may be pinned per file below, each with its reason. A pin that no
 * longer trips any rule fails too, so the list cannot go stale.
 */

const ROOTS = ['src/app/app/(shell)', 'src/components']

const EXCEPTIONS: Record<string, string> = {
  'src/components/layout/app-header.tsx':
    'IS the standard header (the shell bar and its in-page mobile row).',
  'src/components/layout/top-nav.tsx':
    'The mobile shell top bar (navigation, not a page header) — the shell swaps it for AppHeader at `lg`.',
  'src/components/landing/landing-page.tsx':
    'Public marketing page outside the logged-in shell, on its own "Landing v13" look (Chris 2026-10-02); its hero h1 is the page\'s SEO heading.',
  'src/components/big-board/public-big-board.tsx':
    'Public, server-rendered SEO page outside the logged-in shell — there is no shell header to claim, and the h1 is the SEO title.',
  'src/components/profile/profile-header.tsx':
    'An identity card in the page content, shared with the public /u/[username] page (where it is the SEO h1). On /app/profile the page title is the standard header ("My stats"); the card demotes to h2 there.',
  'src/app/app/(shell)/nfl/[team]/page.tsx':
    'The team identity card in the content (crest, division, bye); the page title + back action are already the standard header (D486(12)).',
  'src/components/players/player-detail-header.tsx':
    "The player identity hero in the page content (headshot, name, status) — found by R1511's dynamic-className scan; the page title + Back are already the standard header (D486).",
  'src/components/draft/draft-command-bar.tsx':
    'The full-screen draft room\'s command bar (D-room chrome, pinned over the board) — the room replaces the shell, it is not a page header.',
  'src/components/leagues/playoff-bracket.tsx':
    'A section header inside a card (13px h3), not a page header.',
  'src/components/mobile/community/community-detail.tsx':
    "FieldScout Mobile list detail — its title over the cover is the screen's h1 (mobile handoff; the shell's AppHeader is desktop-only).",
  'src/components/mobile/ui/mobile-header.tsx':
    "FieldScout Mobile pages' 52px page bar (`MPageBar`, wrapped by the league pages' `LeaguePageBar`) — its title (“Draft results”, “League history”, “League settings”, “Playoffs”, “Members”, “Settings”, “Scoring”, “Trash”, “NFL teams”, “Leagues”) is the screen's h1 (mobile handoff G pages; AppHeader is desktop-only). It replaces the fallback-header h1 these pages had on the phone.",
  'src/components/mobile/nfl/mobile-nfl.tsx':
    "FieldScout Mobile NFL team — the team's name in its team-colour header row is the screen's h1 (extends the player profile's header; AppHeader is desktop-only). The NFL teams list's h1 is `MPageBar`'s.",
  'src/components/mobile/league/team/team-view.tsx':
    'FieldScout Mobile team view — a full-screen overlay whose team name is its h1 (mobile handoff; AppHeader is desktop-only).',
  'src/components/mobile/lists/list-view.tsx':
    "FieldScout Mobile list view — the list title is the screen's h1 (mobile handoff; AppHeader is desktop-only).",
  'src/components/mobile/lists/lists-grid.tsx':
    "FieldScout Mobile Lists grid — its large “Lists” title is the screen's h1 (mobile handoff; AppHeader is desktop-only).",
  'src/components/mobile/messages/messages-list-screen.tsx':
    "FieldScout Mobile Messages — its large “Messages” title is the screen's h1 (mobile handoff; AppHeader is desktop-only).",
  'src/components/mobile/messages/thread-screen.tsx':
    "FieldScout Mobile conversation — the thread's name in its header row is the h1 (mobile handoff; AppHeader is desktop-only).",
  'src/components/mobile/players/research-players-screen.tsx':
    "FieldScout Mobile Players — its large “Players” title is the screen's h1 (mobile handoff; AppHeader is desktop-only).",
  'src/components/mobile/shell/fallback-header.tsx':
    "The mobile header for pages with no mobile screen yet — it IS that page's header in the mobile layout (AppHeader is desktop-only); the page's own title is hidden there.",
  'src/components/mobile/trades/mobile-trades-screen.tsx':
    "FieldScout Mobile Trades — “Trades” in its header row is the screen's h1 (mobile handoff; AppHeader is desktop-only).",
  'src/components/mobile/trades/trade-builder-overlay.tsx':
    'FieldScout Mobile trade builder — a full-screen overlay titled in its own header row (mobile handoff).',
  'src/components/mobile/trades/trade-detail-overlay.tsx':
    'FieldScout Mobile trade detail — a full-screen overlay whose “Trade offer” title is its h1 (mobile handoff).',
}

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name)
    if (statSync(full).isDirectory()) walk(full, out)
    else if (/\.tsx$/.test(name) && !/\.test\.tsx?$/.test(name)) out.push(full)
  }
  return out
}

function code(file: string): string {
  return readFileSync(file, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, '')
    .split('\n')
    .filter((line) => !line.trim().startsWith('//'))
    .join('\n')
}

type Rule = { id: string; pinnable: boolean; test: (src: string) => boolean }

const RULES: Rule[] = [
  { id: 'A <h1>', pinnable: true, test: (s) => /<h1[\s>]/.test(s) },
  { id: 'B <header>', pinnable: true, test: (s) => /<header[\s>]/.test(s) },
  {
    id: 'C page-size heading',
    pinnable: true,
    // R1511: a dynamic className (`{cn('…')}` / a template literal) counts too.
    test: (s) =>
      /<(h[1-6]|Heading)\b[^>]*?className=(?:"[^"]*|\{[^}]*?)\btext-h[1-4]\b/.test(s),
  },
  {
    id: 'D hand-rolled mobile title row',
    pinnable: false,
    test: (s) =>
      /lg:hidden[^\n]*\n?[^\n]*<h[1-6]\b[^>]*text-h\d/.test(s) ||
      /<h[1-6]\b[^>]*className="[^"]*\btext-h\d[^"]*\blg:hidden/.test(s),
  },
  {
    id: 'E custom PageHeader title node',
    pinnable: false,
    test: (s) => /<PageHeader\b[^>]*?\btitle=\{\s*</.test(s),
  },
]

const files = ROOTS.flatMap((r) => walk(path.resolve(process.cwd(), r)))
const rel = (f: string) => path.relative(process.cwd(), f)

describe('F577 / D487 — page headers are the standard PageHeader', () => {
  it('scans a real tree (guard against an empty glob)', () => {
    expect(files.length).toBeGreaterThan(200)
  })

  for (const rule of RULES) {
    it(`no ${rule.id} outside the pinned exceptions`, () => {
      const offenders = files
        .map(rel)
        .filter((f) => rule.test(code(f)))
        .filter((f) => !(rule.pinnable && f in EXCEPTIONS))
      expect(offenders).toEqual([])
    })
  }

  it('every exception still trips a pinnable rule (no stale pins) and has a reason', () => {
    for (const [file, reason] of Object.entries(EXCEPTIONS)) {
      expect(reason.length, file).toBeGreaterThan(20)
      const src = code(path.resolve(process.cwd(), file))
      expect(
        RULES.some((r) => r.pinnable && r.test(src)),
        `${file} is pinned but trips no rule — remove the pin`,
      ).toBe(true)
    }
  })

  it('the rules catch what they claim (fixtures)', () => {
    const hit = (id: string, s: string) => RULES.find((r) => r.id.startsWith(id))!.test(s)
    expect(hit('A', '<h1 className="text-h5">x</h1>')).toBe(true)
    expect(hit('B', '<header className="flex">')).toBe(true)
    expect(hit('C', '<h2 className="text-h4">x</h2>')).toBe(true)
    expect(hit('C', '<h2 className="text-h5">x</h2>')).toBe(false)
    expect(hit('C', "<h2 className={cn('min-w-0', 'text-h3')}>x</h2>")).toBe(true)
    expect(hit('C', '<h2 className={`truncate text-h2 ${x}`}>x</h2>')).toBe(true)
    expect(hit('C', "<h2 className={cn('text-h5', a)}>x</h2>")).toBe(false)
    expect(hit('D', '<div className="flex lg:hidden">\n  <h3 className="mr-auto text-h5">Lists</h3>')).toBe(true)
    expect(hit('D', '<h3 className="text-h5 lg:hidden">Report</h3>')).toBe(true)
    expect(hit('E', '<PageHeader\n  title={\n    <div>')).toBe(true)
    expect(hit('E', '<PageHeader title="Lists" aside={<Segment />} />')).toBe(false)
  })
})

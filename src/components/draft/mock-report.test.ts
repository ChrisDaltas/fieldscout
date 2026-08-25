import { readFileSync } from 'node:fs'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

/**
 * Source-level pins for the MOCK DRAFT REPORT (MP task MP.8; spec v2.16
 * §8.8; **D230**) — the `room-exits.test.ts` / `draft-command-bar.test.ts`
 * idiom: `jsx: "preserve"` stops Vite importing a `.tsx`, and what is pinned
 * here is structural (which columns exist, behind which gate, in which
 * container), not that React mounted it. The row set arithmetic is pinned
 * for real in `draft-recap-ops.test.ts`.
 *
 * What is pinned, and why each one would fail silently otherwise:
 *
 *   1. **TWO COLUMN SETS, NEVER ONE TABLE WITH BLANKS (D230(2)).** The whole
 *      ruling is that an auction table has `Price` + `Nom #` and a snake
 *      table has `Round` + `Pick #`, and that neither prints the other's
 *      columns — *an empty column claims the value exists and is unknown,
 *      which is false in both directions.* A merged table is a one-line edit
 *      that looks tidier, so the separation is asserted rather than
 *      remembered.
 *   2. **It COMPOSES the shipped derivations (D230(3))** — a second recap
 *      derivation tree is the LV.7 failure pattern.
 *   3. **No league exit (F119's remaining half).** Every way out of this page
 *      goes to `/app/mocks`.
 *   4. **Wide content scrolls in its own focusable container**, and **nothing
 *      in normal page flow is elevated at rest** (CLAUDE.md) — a table is
 *      not an overlay.
 *   5. **Delete is launcher-keyed** — `recapVariant`'s `canDelete`, which the
 *      RPC enforces and the UI must not offer more widely.
 */

const REPORT = 'src/components/draft/mock-report.tsx'
const PAGE = 'src/app/app/(shell)/mocks/[mockId]/report/page.tsx'
const RECAP_PAGE = 'src/app/app/(shell)/leagues/[leagueId]/draft/recap/page.tsx'

function read(rel: string): string {
  return readFileSync(path.resolve(process.cwd(), rel), 'utf8')
}

/** Source with comments removed — this file DISCUSSES the merged table it
 *  must not build, so a pin a comment can satisfy pins nothing. */
function code(rel: string): string {
  return read(rel)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((line) => !line.trim().startsWith('//'))
    .join('\n')
}

/** One named component's body, so a sibling in the same file can't satisfy a pin. */
function bodyOf(source: string, name: string): string {
  const start = source.indexOf(`function ${name}(`)
  expect(start, `${name} found`).toBeGreaterThan(-1)
  const next = source.slice(start + 1).search(/\nfunction \w+\(/)
  return next === -1 ? source.slice(start) : source.slice(start, start + 1 + next)
}

describe('the report is a real table, with two column sets (D230(2))', () => {
  const source = code(REPORT)

  it('the auction table carries Price and Nom #, and no round columns', () => {
    const body = bodyOf(source, 'AuctionReportTable')
    expect(body).toContain('<TableHead>Player</TableHead>')
    expect(body).toContain('<TableHead>Pos</TableHead>')
    expect(body).toContain('<TableHead>Team</TableHead>')
    expect(body).toMatch(/<TableHead[^>]*>Price<\/TableHead>/)
    expect(body).toMatch(/<TableHead[^>]*>Nom #<\/TableHead>/)
    expect(body).not.toContain('>Round<')
    expect(body).not.toContain('>Pick #<')
  })

  it('the snake table carries Round and Pick #, and no price columns', () => {
    const body = bodyOf(source, 'SnakeReportTable')
    expect(body).toContain('<TableHead>Player</TableHead>')
    expect(body).toContain('<TableHead>Pos</TableHead>')
    expect(body).toContain('<TableHead>Team</TableHead>')
    expect(body).toMatch(/<TableHead[^>]*>Round<\/TableHead>/)
    expect(body).toMatch(/<TableHead[^>]*>Pick #<\/TableHead>/)
    expect(body).not.toContain('>Price<')
    expect(body).not.toContain('>Nom #<')
  })

  it('they are two tables chosen by draft type, never one table with blanks', () => {
    // The defect: a later "simplification" into one five-column table.
    expect(source).toMatch(/const isAuction = draft\.draft_type === 'auction'/)
    expect(source).toMatch(/isAuction \? \(\s*<AuctionReportTable/)
    expect(source).toContain('<SnakeReportTable')
  })

  it('every row set comes from the shipped ops file (D230(3))', () => {
    for (const fn of [
      'recapBuysInOrder',
      'recapPicksByRound',
      'recapTeamSpend',
      'recapRostersFromPicks',
      'recapTeamOrder',
      'recapVariant',
    ]) {
      expect(source, fn).toContain(fn)
    }
    // …and it derives nothing of its own: no second sort/filter over picks.
    expect(source).not.toMatch(/picks\.sort\(/)
  })
})

describe('the report is a practice surface, not a league one (F119)', () => {
  it('no league URL is built anywhere on the page or in its route', () => {
    expect(code(REPORT)).not.toContain('/app/leagues')
    expect(code(PAGE)).not.toContain('/app/leagues')
  })

  it('every exit is the practice home, from the shared constant', () => {
    const source = code(REPORT)
    expect(source).toContain("import { PRACTICE_HOME_HREF } from './room-scope'")
    const literals = source.match(/href=\{?["'`]\/app\/[^"'`}]*/g) ?? []
    expect(literals, 'no hand-rolled hrefs — the constant is the source').toEqual([])
    expect(source).toContain('href={PRACTICE_HOME_HREF}')
  })

  it('delete is offered to the LAUNCHER alone, and travels with the report', () => {
    const source = code(REPORT)
    expect(source).toMatch(/variant\.kind === 'mock' && variant\.canDelete/)
    expect(source).toContain('useDeleteMockDraft(leagueId)')
  })
})

describe('the report obeys the layout rules it is subject to', () => {
  const source = code(REPORT)

  it('wide content scrolls inside its own focusable, labelled region', () => {
    const region = bodyOf(source, 'ScrollRegion')
    expect(region).toContain('overflow-y-auto')
    expect(region).toContain('role="region"')
    expect(region).toContain('tabIndex={0}')
    expect(region).toContain('aria-label={label}')
    // …and all three tables go through it rather than scrolling the page.
    const uses = source.match(/<ScrollRegion/g) ?? []
    expect(uses.length).toBe(3)
  })

  it('nothing in normal page flow is elevated at rest (CLAUDE.md)', () => {
    // The report has no overlay of its own except the shipped Dialog, which
    // carries its own elevation inside `ui/dialog.tsx`.
    expect(source).not.toMatch(/(?<!hover:|active:|focus-visible:|group-hover:)shadow-hard/)
    expect(source).not.toMatch(/shadow-\[/)
  })
})

describe('the legacy mock recap redirects, and the REAL recap is untouched (D230(4))', () => {
  const source = code(RECAP_PAGE)

  it('a mock the viewer launched is redirected to its report', () => {
    expect(source).toContain('listMyMockDrafts')
    expect(source).toMatch(/redirect\(`\/app\/mocks\/\$\{draftIdParam\}\/report`\)/)
  })

  it('the redirect is keyed on the LAUNCHER and on a `?draft=` id only', () => {
    // Two guards, both load-bearing. Without the id guard the league's own
    // real-draft recap (no `?draft=`) would enter the lookup; without the
    // launcher scope a league-mate who can read the mock but does not own it
    // would be sent to a report that is empty for them.
    expect(source).toMatch(/if \(draftIdParam && featureFlags\.mockDrafts\)/)
    expect(source).toContain('listMyMockDrafts(supabase, user.id)')
  })

  it('the recap component itself is still what renders otherwise', () => {
    expect(source).toContain('<DraftRecap leagueId={leagueId} draftIdParam={draftIdParam} />')
  })
})

/**
 * FieldScout Mobile — the ranking editor's Add players sheet (gap list §3
 * #31), rendered: a ranking holds one position, so the redundant "All" chip
 * is gone and the position is the one chip; on a weekly ranking a player
 * whose team has no game that week is marked "Bye" (and can still be
 * added), from the real schedule. A season ranking — or a week whose
 * schedule isn't on record — marks nobody. Each "not shown" case is paired
 * with the shown one.
 */
import { createElement, type ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

vi.mock('next/navigation', () => ({
  usePathname: () => '/app/weekly-ranks',
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({ push: () => {}, replace: () => {}, refresh: () => {}, back: () => {} }),
}))
// Radix portals don't render on the server: an open sheet is drawn inline.
vi.mock('@/components/mobile/ui/mobile-sheet', () => ({
  MobileSheet: ({ open, title, subtitle, children }: { open: boolean; title: string; subtitle?: string; children: ReactNode }) =>
    open ? createElement('section', { 'data-sheet': title }, createElement('p', null, subtitle), children) : null,
}))

import type { PoolStat } from '@/hooks/use-mobile-rankings-sources'

import { AddPlayersSheet } from './ranking-editor'
import type { RankPos, WeekGameLite } from './rankings-ops'

function stat(id: string, full_name: string, team: string | null, projRank: number, position = 'WR'): PoolStat {
  return { id, full_name, position, team, headshot_url: null, pts: 0, games: 0, proj: 200 - projRank, posRank: null, projRank }
}

const POOL = new Map<string, PoolStat>([
  ['jj', stat('jj', 'Justin Jefferson', 'MIN', 1)],
  ['jc', stat('jc', "Ja'Marr Chase", 'CIN', 2)],
  ['fa', stat('fa', 'Free Agent Guy', null, 3)],
])

/** Week 6: CIN plays, MIN doesn't (bye). */
const WEEK_GAMES: WeekGameLite[] = [
  { home_team: 'CIN', away_team: 'PIT' },
  { home_team: 'BUF', away_team: 'NYJ' },
]

function render(weekGames: readonly WeekGameLite[] | undefined, pos: RankPos = 'WR', pool = POOL): string {
  return renderToStaticMarkup(
    createElement(AddPlayersSheet, {
      open: true,
      onOpenChange: () => {},
      pos,
      weekGames,
      pool,
      poolPending: false,
      inRanking: new Set(['jc']),
      count: 1,
      onToggle: () => {},
    }),
  )
}

/** Visible text, tags stripped (React splits adjacent text with comments). */
function text(html: string): string {
  return html
    .replace(/<!-- -->/g, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&#x27;/g, "'")
    .replace(/\s+/g, ' ')
}

/** The row (toggle button) for one player. */
function rowOf(html: string, name: string): string {
  const rows = html.split('<button').slice(1)
  const hit = rows.find((r) => text(r).includes(name))
  if (!hit) throw new Error(`no row for ${name}`)
  return hit
}

describe('Add players sheet — bye marks (gap list §3 #31)', () => {
  it('a weekly ranking marks the player whose team has no game that week', () => {
    const html = render(WEEK_GAMES)
    const jj = rowOf(html, 'Justin Jefferson')
    expect(text(jj)).toContain('WR MIN · Bye · Proj #1')
    expect(jj).toContain('data-bye')
    // …and he can still be added: the row is the same toggle as everyone's.
    expect(jj).toContain('aria-pressed="false"')
  })

  it("a player whose team plays that week isn't marked", () => {
    const jc = rowOf(render(WEEK_GAMES), 'Chase')
    expect(text(jc)).toContain('WR CIN · Proj #2')
    expect(jc).not.toContain('data-bye')
    expect(jc).toContain('aria-pressed="true"')
  })

  it('a free agent has no team, so no bye', () => {
    const fa = rowOf(render(WEEK_GAMES), 'Free Agent Guy')
    expect(text(fa)).toContain('WR FA · Proj #3')
    expect(fa).not.toContain('data-bye')
  })

  it('a season ranking marks nobody (it spans every week)', () => {
    const html = render(undefined)
    expect(html).not.toContain('data-bye')
    expect(text(rowOf(html, 'Justin Jefferson'))).toContain('WR MIN · Proj #1')
  })

  it("a week whose schedule isn't on record marks nobody", () => {
    const html = render([])
    expect(html).not.toContain('data-bye')
    expect(text(rowOf(html, 'Justin Jefferson'))).toContain('WR MIN · Proj #1')
  })
})

describe('Add players sheet — position chip (gap list §3 #31)', () => {
  it('shows the ranking\'s position as its one chip, without "All"', () => {
    const html = render(WEEK_GAMES)
    // The sheet's chrome before the first row: search + the chip.
    const chrome = text(html.split('<button')[0]!)
    expect(chrome).toContain('WR')
    expect(chrome).not.toMatch(/\bAll\b/)
    // The chip isn't a do-nothing button: the only buttons are the rows.
    expect(html.split('<button').length - 1).toBe(POOL.size)
  })

  it('a D/ST ranking reads D/ST', () => {
    const pool = new Map([['den', stat('den', 'Broncos D/ST', 'DEN', 1, 'DEF')]])
    const chrome = text(render(WEEK_GAMES, 'DST', pool).split('<button')[0]!)
    expect(chrome).toContain('D/ST')
    expect(chrome).not.toMatch(/\bAll\b/)
  })
})

/**
 * The desktop main menu's order (Community launch plan C7, readiness F3).
 *
 * Chris (2026-10-27) put Community in the main menu right after Lists. It
 * used to sit under More, closed by default. It is behind its own switch
 * (`featureFlags.community`), so with Community off the menu is exactly what
 * it was: Home · Lists · Players. With the rankings rows on, Community stays
 * right after Lists.
 *
 * `PRIMARY` is built when the module loads, so each case loads a fresh copy
 * of the sidebar under its own switches. The More list's contents are pinned
 * by `more-lists.test.ts` (Community is in neither More list).
 */
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('next/navigation', () => ({ usePathname: () => '/app' }))
vi.mock('@/hooks/use-leagues', () => ({ useLeagues: () => ({ data: [] }) }))

type Flags = {
  community: boolean
  bigBoard: boolean
  weeklyRanks: boolean
  leagues: boolean
  mockDrafts: boolean
}

const OFF: Flags = { community: false, bigBoard: false, weeklyRanks: false, leagues: false, mockDrafts: true }

async function renderSidebar(flags: Partial<Flags>, pathname = '/app'): Promise<string> {
  vi.resetModules()
  vi.doMock('@/lib/feature-flags', () => ({ featureFlags: { ...OFF, ...flags } }))
  vi.doMock('next/navigation', () => ({ usePathname: () => pathname }))
  const { Sidebar } = await import('./sidebar')
  return renderToStaticMarkup(createElement(Sidebar))
}

/** The main menu's rows, in order: each `<a>` in the nav's label. */
function rows(html: string): string[] {
  const nav = html.slice(html.indexOf('<nav'), html.indexOf('</nav>'))
  return [...nav.matchAll(/<a\b[^>]*>[\s\S]*?<span[^>]*>([^<]+)<\/span><\/a>/g)].map((m) => m[1]!)
}

afterEach(() => {
  vi.doUnmock('@/lib/feature-flags')
})

describe('the desktop main menu (plan C7)', () => {
  it('Community on: Home · Lists · Community · Players', async () => {
    expect(rows(await renderSidebar({ community: true }))).toEqual(['Home', 'Lists', 'Community', 'Players'])
  })

  it('Community links to the Community feed', async () => {
    const html = await renderSidebar({ community: true })
    expect(html).toMatch(/<a[^>]*href="\/app\/explore"[^>]*>[\s\S]*?Community<\/span><\/a>/)
  })

  it('Community off: no Community row anywhere — the menu is Home · Lists · Players', async () => {
    const html = await renderSidebar({ community: false })
    expect(rows(html)).toEqual(['Home', 'Lists', 'Players'])
    expect(html).not.toContain('/app/explore')
    expect(html).not.toContain('Community')
  })

  it('with the rankings rows on, Community stays right after Lists', async () => {
    expect(rows(await renderSidebar({ community: true, bigBoard: true, weeklyRanks: true }))).toEqual([
      'Home',
      'Lists',
      'Community',
      'Big Board',
      'Rankings',
      'Players',
    ])
  })

  it('on a Community page its row is the selected one', async () => {
    const html = await renderSidebar({ community: true }, '/app/explore')
    const row = /<a[^>]*href="\/app\/explore"[^>]*>/.exec(html)?.[0] ?? ''
    expect(row).toContain('bg-surface-selected')
  })
})

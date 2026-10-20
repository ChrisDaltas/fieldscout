/**
 * Ranking history on the phone (gap list §4 item 111):
 * `/app/weekly-ranks/history` draws its own FieldScout Mobile screen — the
 * 52px page bar (blue back chevron, "Ranking history" as the h1) over
 * desktop's honest "No submissions yet" (there are no submission records
 * yet), in `m-*` tokens only so the phone's dark mode follows, instead of
 * the borrowed desktop layout. Desktop keeps its page.
 *
 * The screen renders statically (effects don't run). Its two ways out are
 * fired from its element tree against mocked Back helpers — how those
 * helpers choose back / replace is pinned in back-nav.test.ts.
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'

import { createElement, isValidElement, type ReactElement, type ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const nav = vi.hoisted(() => ({ goBack: vi.fn(), leaveTo: vi.fn() }))

vi.mock('next/navigation', () => ({
  usePathname: () => '/app/weekly-ranks/history',
  useRouter: () => ({ push: vi.fn(), back: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}))

vi.mock('@/components/mobile/ui/back-nav', () => ({
  useGoBack: () => nav.goBack,
  useLeaveTo: () => nav.leaveTo,
}))

import { MY_RANKINGS_HREF } from '@/components/mobile/profile/profile-ops'

import { MobileRankingHistory, RANKING_HISTORY_COPY, RANKING_HISTORY_PARENT } from './ranking-history'

function render(): string {
  return renderToStaticMarkup(createElement(MobileRankingHistory))
    .replace(/&#x27;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
}

/** Desktop colour tokens: fixed light colours that don't follow phone dark
 *  mode (the phone draws in `m-*`). */
const DESKTOP_COLOUR = /^(?:[a-z]+:)*(?:text|bg|border)-(?:ink|white|n-\d|negative|positive|caution|surface)/

/** Every onClick in the screen's element tree, keyed by the button's text
 *  or aria-label — to fire Back and the pill without a DOM. */
function clicks(node: ReactNode, out = new Map<string, () => void>()): Map<string, () => void> {
  if (Array.isArray(node)) {
    for (const child of node) clicks(child, out)
    return out
  }
  if (!isValidElement(node)) return out
  const el = node as ReactElement<Record<string, unknown>>
  if (typeof el.type === 'function') {
    const rendered = (el.type as (p: Record<string, unknown>) => ReactNode)(el.props)
    return clicks(rendered, out)
  }
  const props = el.props
  if (typeof props.onClick === 'function') {
    const key = (props['aria-label'] as string | undefined) ?? textOf(props.children as ReactNode)
    out.set(key, props.onClick as () => void)
  }
  for (const value of Object.values(props)) if (value && typeof value === 'object') clicks(value as ReactNode, out)
  return out
}

function textOf(node: ReactNode): string {
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  if (Array.isArray(node)) return node.map(textOf).join('')
  if (isValidElement(node)) return textOf((node.props as { children?: ReactNode }).children)
  return ''
}

describe('Ranking history — the phone screen (gap list §4 item 111)', () => {
  it('has its own page bar: the blue back chevron and “Ranking history” as the h1', () => {
    const html = render()
    expect(html).toMatch(/<button[^>]*aria-label="Back"[^>]*class="[^"]*text-accent[^"]*"[^>]*data-page-back/)
    expect(html).toMatch(/<h1[^>]*>Ranking history<\/h1>/)
    expect(html).toContain('data-mobile-screen')
  })

  it('says there are no submissions yet — desktop’s empty state, without the big board the phone can’t open', () => {
    const html = render()
    expect(html).toContain(`>${RANKING_HISTORY_COPY.emptyTitle}<`)
    expect(html).toContain(`>${RANKING_HISTORY_COPY.emptyBody}<`)
    expect(html).not.toMatch(/big board/i)
  })

  it('offers one blue pill to your rankings, and Back — nothing else', () => {
    const html = render()
    expect(html).toMatch(new RegExp(`<button[^>]*class="[^"]*bg-accent[^"]*"[^>]*>${RANKING_HISTORY_COPY.openRankings}</button>`))
    const controls = [...html.matchAll(/<button[^>]*?(?:aria-label="([^"]*)"[^>]*)?>([^<]*)</g)].map((m) => m[1] ?? m[2])
    expect(controls).toEqual(['Back', RANKING_HISTORY_COPY.openRankings])
    expect(html).not.toContain('<a ')
  })

  it('draws in phone tokens only, so phone dark mode follows', () => {
    const tokens = [...render().matchAll(/class="([^"]*)"/g)].flatMap((m) => m[1].split(/\s+/)).filter(Boolean)
    expect(tokens.filter((t) => DESKTOP_COLOUR.test(t) && t !== 'text-white')).toEqual([])
    expect(tokens).toEqual(expect.arrayContaining(['bg-m-b0', 'text-m-t1', 'text-m-t3']))
  })
})

describe('Ranking history — where its ways out go', () => {
  beforeEach(() => {
    nav.goBack.mockClear()
    nav.leaveTo.mockClear()
  })

  it('its parent is your rankings (the Rankings screen’s Mine tab)', () => {
    expect(RANKING_HISTORY_PARENT).toBe(MY_RANKINGS_HREF)
    expect(RANKING_HISTORY_PARENT).toBe('/app/weekly-ranks?view=mine')
  })

  it('Back goes to where you came from, else your rankings', () => {
    clicks(MobileRankingHistory()).get('Back')?.()
    expect(nav.goBack).toHaveBeenCalledExactlyOnceWith(RANKING_HISTORY_PARENT)
    expect(nav.leaveTo).not.toHaveBeenCalled()
  })

  it('the pill leaves this empty screen for your rankings — stepping back when they are behind, never stacking on it', () => {
    clicks(MobileRankingHistory()).get(RANKING_HISTORY_COPY.openRankings)?.()
    expect(nav.leaveTo).toHaveBeenCalledExactlyOnceWith(RANKING_HISTORY_PARENT)
    expect(nav.goBack).not.toHaveBeenCalled()
  })
})

describe('the route draws it on the phone (ByLayout); desktop keeps its page', () => {
  const page = readFileSync(path.join(process.cwd(), 'src/app/app/(shell)/weekly-ranks/history/page.tsx'), 'utf8')
  it('ByLayout: desktop keeps its page, the phone gets MobileRankingHistory', () => {
    expect(page).toContain('<ByLayout desktop={<DesktopRankingHistory />} mobile={<MobileRankingHistory />} />')
  })
  it('desktop is unchanged: its title, empty state and both links', () => {
    expect(page).toContain('<PageHeader title="Rankings" />')
    expect(page).toContain('No submissions yet')
    expect(page).toContain('<Link href="/app/weekly-ranks">Back to rankings</Link>')
    expect(page).toContain('<Link href="/app/big-board">Open the big board</Link>')
  })
})

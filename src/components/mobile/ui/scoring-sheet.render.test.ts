/**
 * The phone's Scoring sheet (gap list #19, §3 #18) — shared by the list's
 * scoring pill and the player profile's scoring chip: one row per choice,
 * the active one ticked; a tap picks it and closes the sheet.
 */
import { createElement, isValidElement, type ReactElement, type ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

// The sheet portals (Radix) — a static render shows nothing; render its
// body in place so the rows can be read.
vi.mock('@/components/mobile/ui/mobile-sheet', () => ({
  MobileSheet: ({ open, title, subtitle, children }: { open: boolean; title: string; subtitle?: string; children: ReactNode }) =>
    open ? createElement('div', { 'data-sheet': title, 'data-sub': subtitle }, children) : null,
}))

import { ScoringSheet } from './scoring-sheet'

const OPTIONS = [
  { value: 'ppr', label: 'PPR', sub: '1 point per catch' },
  { value: 'quarter_ppr', label: '0.25 PPR', sub: '0.25 points per catch' },
  { value: 'league:L1', label: 'Sunday Funday League', sub: 'Your league’s scoring' },
] as const

type V = (typeof OPTIONS)[number]['value']

function props(over: Partial<Parameters<typeof ScoringSheet<V>>[0]> = {}) {
  return {
    open: true,
    onOpenChange: vi.fn(),
    subtitle: 'The points on this profile',
    options: OPTIONS,
    value: 'quarter_ppr' as V,
    onPick: vi.fn(),
    ...over,
  }
}

/** Every <button> of a rendered tree (walked through the mocked sheet). */
function buttons(node: ReactNode, out: ReactElement<Record<string, unknown>>[] = []) {
  if (Array.isArray(node)) node.forEach((n) => buttons(n as ReactNode, out))
  else if (isValidElement<Record<string, unknown>>(node)) {
    if (node.type === 'button') out.push(node)
    buttons(node.props.children as ReactNode, out)
  }
  return out
}

describe('scoring sheet', () => {
  it('a "Scoring" sheet with the trigger’s subtitle, one row per choice, the active one ticked', () => {
    const out = renderToStaticMarkup(createElement(ScoringSheet<V>, props())).replace(/&#x27;/g, "'")
    expect(out).toContain('data-sheet="Scoring"')
    expect(out).toContain('data-sub="The points on this profile"')
    expect([...out.matchAll(/data-scoring-option="([^"]+)"/g)].map((m) => m[1])).toEqual(['ppr', 'quarter_ppr', 'league:L1'])
    expect([...out.matchAll(/aria-pressed="(\w+)"/g)].map((m) => m[1])).toEqual(['false', 'true', 'false'])
    expect(out).toContain('Your league’s scoring')
    expect(out.match(/<svg/g)).toHaveLength(1)
  })

  it('a tap picks that choice and closes the sheet', () => {
    const p = props()
    const tree = ScoringSheet<V>(p)
    const rows = buttons(tree.props.children as ReactNode)
    expect(rows).toHaveLength(3)
    ;(rows[2]!.props.onClick as () => void)()
    expect(p.onPick).toHaveBeenCalledWith('league:L1')
    expect(p.onOpenChange).toHaveBeenCalledWith(false)
  })

  it('closed: nothing', () => {
    expect(renderToStaticMarkup(createElement(ScoringSheet<V>, props({ open: false })))).toBe('')
  })
})

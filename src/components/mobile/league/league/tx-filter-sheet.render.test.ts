/**
 * The Transaction filters sheet's Teams list is a PICKER (gap list #42 —
 * Chris, 2026-10-15): tapping a row, the manager's name included, ticks
 * that team; the name is not a profile link there. Chris's explicit
 * exception to "usernames always link to profile" (2026-09-30), which holds
 * everywhere a name is not inside a pick-list. (The handoff draws the names
 * as bare handles, so `username-link.render.test.ts`'s `@`-handle census
 * has nothing to flag here.)
 */
import { createElement, isValidElement, type ReactElement, type ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

import type { TxFilter } from './league-tab-ops'
import { TxFilterSheet } from './tx-filter-sheet'

// The sheet portals (Radix) — a static render shows nothing; render its
// body in place so the rows can be read.
vi.mock('@/components/mobile/ui/mobile-sheet', () => ({
  MobileSheet: ({ open, children, footer }: { open: boolean; children: ReactNode; footer?: ReactNode }) =>
    open ? createElement('div', { 'data-sheet': true }, children, footer) : null,
}))

const TEAMS = [
  { id: 't1', name: 'Gridiron Gurus' },
  { id: 't2', name: 'Touchdown Tacos' },
]
const MANAGERS = new Map([
  ['t1', 'marcus'],
  ['t2', 'dalton'],
])

function props(filter: TxFilter, onChange = vi.fn()) {
  return {
    open: true,
    onOpenChange: () => {},
    filter,
    onChange,
    myMoves: false,
    teams: TEAMS,
    managerOf: (id: string) => MANAGERS.get(id) ?? null,
    teamIds: TEAMS.map((t) => t.id),
    myTeamId: 't2',
  }
}

/** Every element of a rendered tree whose component is named `name`. */
function elementsNamed(node: ReactNode, name: string, out: ReactElement<Record<string, unknown>>[] = []) {
  if (Array.isArray(node)) node.forEach((n) => elementsNamed(n as ReactNode, name, out))
  else if (isValidElement<Record<string, unknown>>(node)) {
    if (typeof node.type === 'function' && node.type.name === name) out.push(node)
    for (const value of Object.values(node.props)) if (value && typeof value === 'object') elementsNamed(value as ReactNode, name, out)
  }
  return out
}

describe('Transaction filters — the Teams list is a picker (gap list #42)', () => {
  it('each manager’s row is one tick button; the name is not a profile link inside it', () => {
    const html = renderToStaticMarkup(createElement(TxFilterSheet, props({ type: 'All', teams: ['t1'] })))
    expect(html).toMatch(/<button type="button" aria-pressed="true"[^>]*>(?:(?!<\/button>)[\s\S])*>marcus<\/span>/)
    expect(html).toMatch(/<button type="button" aria-pressed="false"[^>]*>(?:(?!<\/button>)[\s\S])*>dalton<\/span>/)
    expect(html).not.toContain('<a ')
    expect(html).not.toContain('data-username-link')
    expect(html).not.toContain('/u/')
  })

  it('tapping a row ticks (or unticks) its team; All teams clears the list', () => {
    const onChange = vi.fn()
    const rows = elementsNamed(TxFilterSheet(props({ type: 'All', teams: ['t1'] }, onChange)), 'TeamRow')
    expect(rows.map((r) => r.props.label)).toEqual(['All teams', 'marcus', 'dalton'])
    ;(rows[2]!.props.onClick as () => void)()
    expect(onChange).toHaveBeenLastCalledWith({ teams: ['t1', 't2'] })
    ;(rows[1]!.props.onClick as () => void)()
    expect(onChange).toHaveBeenLastCalledWith({ teams: [] })
    ;(rows[0]!.props.onClick as () => void)()
    expect(onChange).toHaveBeenLastCalledWith({ teams: [] })
  })
})

/**
 * The Transaction filters sheet's Teams list is a PICKER (gap list #42 —
 * Chris, 2026-10-15): tapping a row, the manager's name included, ticks
 * that team; the name is not a profile link there. Chris's explicit
 * exception to "usernames always link to profile" (2026-09-30), which holds
 * everywhere a name is not inside a pick-list. Each name is the manager's
 * @handle (gap list §4 item 12 — the League tab's one handle format; the
 * handoff drew bare handles), plain text, so it sits on the census allowlist
 * in `username-link.render.test.ts` with that reason.
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
  { id: 't3', name: 'Hail Marys' },
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
  it('each team reads as its manager’s @handle; a team with no manager, as its name (gap list §4 item 12)', () => {
    const html = renderToStaticMarkup(createElement(TxFilterSheet, props({ type: 'All', teams: [] })))
    const names = [...html.matchAll(/<span class="min-w-0 flex-1 truncate[^"]*">([^<]*)<\/span>/g)].map((m) => m[1])
    expect(names).toEqual(['All teams', '@marcus', '@dalton', 'Hail Marys'])
    // Never the prototype's bare handle.
    expect(html).not.toMatch(/>(marcus|dalton)</)
  })

  it('each manager’s row is one tick button; the name is not a profile link inside it', () => {
    const html = renderToStaticMarkup(createElement(TxFilterSheet, props({ type: 'All', teams: ['t1'] })))
    expect(html).toMatch(/<button type="button" aria-pressed="true"[^>]*>(?:(?!<\/button>)[\s\S])*>@marcus<\/span>/)
    expect(html).toMatch(/<button type="button" aria-pressed="false"[^>]*>(?:(?!<\/button>)[\s\S])*>@dalton<\/span>/)
    expect(html).not.toContain('<a ')
    expect(html).not.toContain('data-username-link')
    expect(html).not.toContain('/u/')
  })

  it('tapping a row ticks (or unticks) its team; All teams clears the list', () => {
    const onChange = vi.fn()
    const rows = elementsNamed(TxFilterSheet(props({ type: 'All', teams: ['t1'] }, onChange)), 'TeamRow')
    expect(rows.map((r) => r.props.label)).toEqual(['All teams', '@marcus', '@dalton', 'Hail Marys'])
    ;(rows[2]!.props.onClick as () => void)()
    expect(onChange).toHaveBeenLastCalledWith({ teams: ['t1', 't2'] })
    ;(rows[1]!.props.onClick as () => void)()
    expect(onChange).toHaveBeenLastCalledWith({ teams: [] })
    ;(rows[0]!.props.onClick as () => void)()
    expect(onChange).toHaveBeenLastCalledWith({ teams: [] })
  })
})

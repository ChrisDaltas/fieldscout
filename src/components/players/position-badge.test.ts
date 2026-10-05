import { readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'

import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { PositionBadge } from './position-badge'

/**
 * Position tags are ONE shared component (D497, Chris 2026-10-05):
 * `PositionBadge`. It keeps the position colours and carries NO stroke.
 *
 * Guard: a `bg-pos-*` fill anywhere else in `src/` is an ad-hoc position tag
 * and fails this test. The allowlist is the few places that use the position
 * colours for something that is not a tag, each with its reason.
 */
const ALLOWED = new Map<string, string>([
  ['src/components/players/position-badge.tsx', 'the shared component itself (+ POSITION_TAB_ACTIVE)'],
  ['src/components/lists/list-thumbnail.tsx', 'list cover tiles (POS_TINTS) — a cover, not a tag'],
  ['src/app/app/(shell)/styleguide/page.tsx', 'colour swatches on the styleguide'],
  ['src/components/landing/landing-bits.tsx', 'v13 landing PosTag — landing ships as designed (2026-10-02), already strokeless'],
])

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = path.join(dir, name)
    if (statSync(p).isDirectory()) walk(p, out)
    else if (/\.(tsx?|jsx?)$/.test(name) && !/\.test\./.test(name)) out.push(p)
  }
  return out
}

describe('position tags — one shared component, no stroke (D497)', () => {
  it('PositionBadge renders without any border class', () => {
    for (const pos of ['QB', 'RB', 'WR', 'TE', 'K', 'DEF']) {
      for (const size of ['sm', 'md'] as const) {
        const html = renderToStaticMarkup(createElement(PositionBadge, { position: pos, size }))
        const cls = /class="([^"]*)"/.exec(html)?.[1] ?? ''
        expect(cls).toContain(`bg-pos-${pos.toLowerCase()}`)
        expect(cls.split(/\s+/).filter((c) => /^border(-|$)/.test(c))).toEqual([])
      }
    }
  })

  it('no ad-hoc position tag: bg-pos-* only in the shared component (or an allowlisted non-tag)', () => {
    const root = process.cwd()
    const offenders = walk(path.join(root, 'src'))
      .map((f) => path.relative(root, f).split(path.sep).join('/'))
      .filter((rel) => !ALLOWED.has(rel))
      .filter((rel) => /\bbg-pos-/.test(readFileSync(path.join(root, rel), 'utf8')))
    expect(offenders).toEqual([])
  })
})

import { readFileSync } from 'node:fs'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

import { featureFlags } from '@/lib/feature-flags'

/**
 * 2026 go-live scope (CLAUDE.md → Active Builds): a deployed build ships
 * Lists + Stats/player research + AI stat lists only. Everything else is
 * built but not reskinned, so it must be unreachable — hidden from nav *and*
 * 404 on a direct URL.
 *
 * This pins both halves of that contract. Vitest runs with NODE_ENV="test"
 * and no NEXT_PUBLIC_FLAG_* set, which is exactly the deployed-build default
 * the gates have to survive. The layouts themselves are .tsx (Vite can't
 * parse them under Next's jsx: "preserve"), so the route gates are pinned by
 * their source — the point is that a gate exists on every gated surface and
 * reads the right flag, which deleting or rewiring one would break.
 */

/** Gated surface → [route layout, the flag it must read]. */
const GATES = [
  ['src/app/app/big-board/layout.tsx', 'bigBoard'],
  ['src/app/app/weekly-ranks/layout.tsx', 'weeklyRanks'],
  ['src/app/app/explore/layout.tsx', 'community'],
  ['src/app/app/start-or-sit/layout.tsx', 'startOrSit'],
  ['src/app/app/teams/layout.tsx', 'teams'],
  ['src/app/consensus/layout.tsx', 'consensus'],
  ['src/app/personas/layout.tsx', 'personas'],
  ['src/app/u/[username]/big-board/layout.tsx', 'bigBoard'],
] as const

const LAUNCH_SCOPE_FLAGS = [
  'bigBoard',
  'weeklyRanks',
  'consensus',
  'community',
  'startOrSit',
  'personas',
  'teams',
] as const

describe('launch-scope release flags', () => {
  it('default OFF when the env var is unset outside local development', () => {
    for (const flag of LAUNCH_SCOPE_FLAGS) {
      expect(featureFlags[flag], flag).toBe(false)
    }
  })

  it('leaves the launch surfaces ungated', () => {
    // Lists, player research, and AI stat lists ship — no flag guards them.
    expect(Object.keys(featureFlags)).not.toContain('lists')
    expect(Object.keys(featureFlags)).not.toContain('research')
  })
})

describe('gated route layouts', () => {
  for (const [file, flag] of GATES) {
    it(`${file} 404s on featureFlags.${flag}`, () => {
      const source = readFileSync(path.resolve(process.cwd(), file), 'utf8')
      expect(source).toContain(`featureFlags.${flag}`)
      // notFound(), never redirect() — a gated surface must be
      // indistinguishable from one that doesn't exist.
      expect(source).toContain('notFound()')
      expect(source).not.toContain('redirect(')
    })
  }
})

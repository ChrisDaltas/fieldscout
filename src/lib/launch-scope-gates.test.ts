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
  ['src/app/app/(shell)/big-board/layout.tsx', 'bigBoard'],
  ['src/app/app/(shell)/weekly-ranks/layout.tsx', 'weeklyRanks'],
  ['src/app/app/(shell)/explore/layout.tsx', 'community'],
  ['src/app/app/(shell)/start-or-sit/layout.tsx', 'startOrSit'],
  ['src/app/app/(shell)/teams/layout.tsx', 'teams'],
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
    // Lists, player research, and AI stat lists ship — no flag hides them.
    //
    // `featureFlags.listsV2` (LV.1.1) is not a counter-example and must not be
    // deleted as one: it does not gate Lists off, it chooses *which* Lists
    // screen renders, and its OFF default is the shipped one. Its own contract
    // — default OFF, branch direction on both routes — is pinned in
    // lists-v2-flag.test.ts.
    expect(Object.keys(featureFlags)).not.toContain('lists')
    expect(Object.keys(featureFlags)).not.toContain('research')
  })
})

describe('gated route layouts', () => {
  for (const [file, flag] of GATES) {
    it(`${file} redirects on featureFlags.${flag}`, () => {
      const source = readFileSync(path.resolve(process.cwd(), file), 'utf8')
      expect(source).toContain(`featureFlags.${flag}`)
      // redirect(), never notFound(). These routes shipped before the gate,
      // so real users hold bookmarks and history entries into them; a dead
      // end reads as a broken site during the feedback year. It also matches
      // the pre-existing leagues gate.
      //
      // notFound() was tried first and rejected on evidence: verified against
      // a production build, an explicit notFound() from these routes renders
      // Next's bare error document (<html id="__next_error__">, no
      // stylesheet, no nav, no way back) rather than src/app/not-found.tsx —
      // at both layout and page level, static and force-dynamic.
      expect(source).toContain('redirect(')
      expect(source).not.toContain('notFound()')
    })
  }
})

describe('404 boundaries exist for genuinely missing routes', () => {
  // Independent of the gates: before these, any bad URL rendered Next's
  // unbranded default. Verified in a production build — /nonexistent-page
  // returns 404 with the FieldScout wordmark and a link home.
  for (const file of ['src/app/not-found.tsx', 'src/app/app/(shell)/not-found.tsx']) {
    it(`${file} is branded and offers a way back`, () => {
      const source = readFileSync(path.resolve(process.cwd(), file), 'utf8')
      expect(source).toContain('export default function')
      expect(source).toMatch(/href="\/(app)?"/)
    })
  }
})

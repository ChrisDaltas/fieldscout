import { readFileSync } from 'node:fs'
import path from 'node:path'

import { afterEach, describe, expect, it, vi } from 'vitest'

import { featureFlags } from '@/lib/feature-flags'

/**
 * LV.1.1 (delivery-plan-lists-v2.md §1 "Flag", §4): the Lists v2 rebuild lands
 * behind `featureFlags.listsV2`, and the *direction* of that branch is the
 * whole safety property. Lists is a shipped, in-scope launch surface
 * (CLAUDE.md → Active Builds) — unlike the seven surfaces in
 * `launch-scope-gates.test.ts`, whose gates hide something users can't reach
 * anyway, this flag decides which of two real screens production serves. A
 * deployed build must keep serving the existing Lists page until Chris flips
 * the flag at LV.4.4; inverting either branch would replace production Lists
 * with an in-progress placeholder.
 *
 * Two things have to hold, and neither is self-evident from reading the diff:
 *
 *   1. the flag is OFF by default in a deployed build (and ON in local dev,
 *      which is where the rebuild is meant to be visible), and
 *   2. each route takes the v2 branch when the flag is ON — not when it is OFF.
 *
 * Vitest runs with NODE_ENV="test" and no NEXT_PUBLIC_FLAG_* set, which is
 * exactly the deployed-build default, so (1) is asserted directly. For (2) the
 * routes are .tsx, which Vite can't parse under Next's jsx: "preserve", so the
 * branch is pinned by its source — same idiom and same rationale as
 * `launch-scope-gates.test.ts`: the point is that a branch exists on each Lists
 * route, reads the right flag, and points the right way, which deleting,
 * rewiring, or negating it would break.
 */

const read = (file: string) => readFileSync(path.resolve(process.cwd(), file), 'utf8')

/** The exact, un-negated branch condition each Lists route must carry. */
const BRANCH = 'if (featureFlags.listsV2) {'

/**
 * Branched route → the component each side of the branch renders, plus what
 * the flag-OFF side must still mount (today's shipped Lists UI, unchanged).
 */
const ROUTES = [
  {
    file: 'src/app/app/lists/page.tsx',
    v2: 'ListsPageV2',
    legacy: 'ListsPageLegacy',
    legacyMounts: ['<PageHeader', '<ListsBrowse'],
  },
  {
    file: 'src/app/app/lists/[listId]/page.tsx',
    v2: 'ListDetailPageV2',
    legacy: 'ListDetailPageLegacy',
    legacyMounts: ['<ListDetailView', '<AiBuildBanner', '<CommentsThread'],
  },
] as const

describe('listsV2 release flag', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.resetModules()
  })

  it('defaults OFF, so a deployed build keeps serving the existing Lists page', () => {
    // No NEXT_PUBLIC_FLAG_LISTS_V2 set + NODE_ENV !== "development" is the
    // deployed-build default. Flipping this to ON before LV.4.4 would ship the
    // in-progress rebuild to every production user.
    expect(process.env.NODE_ENV).not.toBe('development')
    expect(featureFlags.listsV2).toBe(false)
  })

  it('defaults ON in local development, where the rebuild is meant to be visible', async () => {
    // Documented in .env.example: unset (or blank) means ON locally, so
    // `npm run dev` shows the v2 surface without any .env.local edit — and
    // NEXT_PUBLIC_FLAG_LISTS_V2=false restores today's Lists locally.
    vi.stubEnv('NODE_ENV', 'development')
    vi.resetModules()
    const { featureFlags: devFlags } = await import('@/lib/feature-flags')
    expect(devFlags.listsV2).toBe(true)
  })

  it('is opt-in per deployed environment via its own literal env var', () => {
    // NEXT_PUBLIC_ vars are inlined at build time, so the flag must read its
    // env var literally — a dynamic lookup would compile to undefined.
    expect(read('src/lib/feature-flags.ts')).toContain(
      'listsV2: enabled(process.env.NEXT_PUBLIC_FLAG_LISTS_V2)',
    )
  })
})

describe('Lists route-level branch (LV.1.1)', () => {
  for (const { file, v2, legacy, legacyMounts } of ROUTES) {
    it(`${file} renders ${v2} when the flag is ON, ${legacy} when it is OFF`, () => {
      const source = read(file)

      // Exact and un-negated. Inverting this to `if (!featureFlags.listsV2)` —
      // the one-character change that would replace production Lists with the
      // placeholder — fails here.
      expect(source).toContain(BRANCH)
      expect(source).not.toContain('!featureFlags.listsV2')

      // ...and it is the flag-ON branch that returns the v2 screen, with the
      // legacy screen as the fallback below it. Swapping the two return
      // bodies — same net effect, no negation needed — fails here.
      const branchAt = source.indexOf(BRANCH)
      const v2At = source.indexOf(`<${v2}`, branchAt)
      const legacyAt = source.indexOf(`<${legacy}`, branchAt)
      expect(v2At, `${v2} must be returned inside the flag-ON branch`).toBeGreaterThan(branchAt)
      expect(legacyAt, `${legacy} must be the fallback below it`).toBeGreaterThan(v2At)
    })

    it(`${file} flag-OFF path still mounts today's Lists UI`, () => {
      // The OFF path is production for the whole build, so it has to keep
      // rendering the real components — not a stub, not an error card.
      const source = read(file)
      for (const mount of legacyMounts) {
        expect(source, `${legacy} must still render ${mount}`).toContain(mount)
      }
    })
  }
})

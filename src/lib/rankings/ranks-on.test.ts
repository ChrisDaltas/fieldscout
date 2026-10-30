/**
 * `ranksOn()` — the one "are rankings switched on" Community asks (plan C3),
 * so the rankings rework changes it in one place. Pinned: it follows the
 * Weekly ranks switch, at call time; and the phone feed, the desktop feed
 * and community search all ask it rather than reading a switch of their own.
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'

import { describe, expect, it, vi } from 'vitest'

const flags = vi.hoisted(() => ({ weeklyRanks: false, bigBoard: true }))
vi.mock('@/lib/feature-flags', () => ({ featureFlags: flags }))

import { ranksOn } from './ranks-on'

const code = (file: string) =>
  readFileSync(path.resolve(process.cwd(), file), 'utf8').replace(/\/\*[\s\S]*?\*\/|(^|[^:])\/\/.*$/gm, (_m, before) => before ?? '')

describe('ranksOn', () => {
  it('follows the Weekly ranks switch, read when asked', () => {
    flags.weeklyRanks = false
    expect(ranksOn()).toBe(false)
    flags.weeklyRanks = true
    expect(ranksOn()).toBe(true)
  })

  it('Community asks it everywhere — no Community screen reads the rankings switch itself', () => {
    const askers = [
      'src/hooks/use-explore-feed.ts',
      // Community search: the screens' one door to it sends the switch along.
      'src/lib/community/community-search.ts',
      'src/components/mobile/community/mobile-community.tsx',
      'src/components/mobile/community/latest-screen.tsx',
      'src/components/mobile/community/community-cards.tsx',
      'src/components/mobile/community/create-sheet.tsx',
    ]
    for (const file of askers) {
      const src = code(file)
      expect(src, file).toMatch(/\branksOn\(\)/)
      expect(src, file).not.toMatch(/featureFlags\.weeklyRanks/)
    }
  })

  it('both search screens ask through that door; the route itself reads no switch', () => {
    for (const file of ['src/hooks/use-mobile-search.ts', 'src/components/shared/command-palette.tsx']) {
      const src = code(file)
      expect(src, file).toMatch(/communitySearchHref\(/)
      expect(src, file).not.toMatch(/\/api\/search\/community\?/)
    }
    const route = code('src/app/api/search/community/route.ts')
    expect(route).not.toMatch(/featureFlags|ranksOn/)
    expect(route).toMatch(/shownInCommunityQuery\(/)
  })
})

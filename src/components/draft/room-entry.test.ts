import { readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

/**
 * DR.6 entry-split pins (spec §16.1 v2.12; tasks-DR DR.6 items 1–2).
 *
 * **The sweep is the deliverable**: every site in `src/` that builds a URL
 * into the `/draft` route is enumerated below with its disposition, and the
 * enumeration is PINNED — a new entry link added anywhere fails this suite
 * until it is dispositioned (split, or deliberately in-place with a
 * reason). That is the property the banner asks for: nothing routes into
 * the room without the platform split having been considered.
 *
 * Dispositions (2026-08-18):
 *   - `league-home-states.tsx` — 2 sites, BOTH SPLIT: the scheduled hero's
 *     "Enter draft lobby" and the drafting hero's "Join draft" spread
 *     `useRoomEntryTarget()`'s props (new tab on measured desktop, in
 *     place on mobile/SSR).
 *   - `draft-bar-ops.ts` — 1 site (the href builder); the consuming Link in
 *     `draft-bar.tsx` is SPLIT the same way.
 *   - `mock-launcher-entry.ts` — 1 site, IN PLACE: `?practice=1` opens the
 *     practice LAUNCHER (a config surface — no draft id, no channel, no
 *     room), and the CTA that renders it (`PracticeCta`) is deliberately
 *     one component mounted on BOTH the league home and the in-room lobby
 *     (R279 — no fork), so it navigates in place everywhere. The mock room
 *     the launcher then opens is an in-room-world navigation.
 *   - `mock-draft-launcher.tsx` — 2 sites, IN PLACE: the post-launch
 *     `router.push` and the resume link both navigate WITHIN the
 *     chrome-free room world (the launcher lives on the room route); the
 *     split governs entry FROM the app, not movement inside the room.
 *
 * Draft-related NOTIFICATIONS never point here at all — they route to the
 * league/app home where these CTAs are the one entry point (Chris,
 * 2026-08-17); pinned in `notification-href.test.ts`.
 */

function read(rel: string): string {
  return readFileSync(path.resolve(process.cwd(), rel), 'utf8')
}

function code(rel: string): string {
  return read(rel)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((line) => !line.trim().startsWith('//'))
    .join('\n')
}

function sourceFiles(dir = 'src'): string[] {
  const out: string[] = []
  for (const entry of readdirSync(path.resolve(process.cwd(), dir))) {
    const rel = `${dir}/${entry}`
    const abs = path.resolve(process.cwd(), rel)
    if (statSync(abs).isDirectory()) {
      out.push(...sourceFiles(rel))
      continue
    }
    if (!/\.(ts|tsx)$/.test(entry)) continue
    if (/\.test\.(ts|tsx)$/.test(entry) || entry.endsWith('.d.ts')) continue
    out.push(rel)
  }
  return out
}

/** A template-literal URL into the room route: `/app/leagues/${…}/draft`
 *  NOT followed by `/recap` (the recap keeps the app shell and is not an
 *  entry into the room). API routes never match (they are `/api/…`). */
const ROOM_URL = /\/app\/leagues\/\$\{[^}]+\}\/draft(?!\/)/g

describe('every room-entry URL in src/ is enumerated with a disposition', () => {
  it('the sweep matches the dispositioned set exactly', () => {
    const hits: Array<[string, number]> = []
    for (const rel of sourceFiles()) {
      const count = (code(rel).match(ROOM_URL) ?? []).length
      if (count > 0) hits.push([rel, count])
    }
    hits.sort((a, b) => a[0].localeCompare(b[0]))
    expect(hits).toEqual([
      ['src/components/draft/mock-draft-launcher.tsx', 2], // in-room-world, in place
      ['src/components/draft/mock-launcher-entry.ts', 1], // launcher entry, in place (shared mount)
      ['src/components/layout/draft-bar-ops.ts', 1], // SPLIT via draft-bar.tsx
      ['src/components/leagues/league-home-states.tsx', 2], // both SPLIT
    ])
  })
})

describe('the split sites carry the entry-target spread on a real anchor', () => {
  it('both league-home CTAs spread roomEntry on their /draft Link', () => {
    const source = code('src/components/leagues/league-home-states.tsx')
    const links = source.match(/<Link href=\{`\/app\/leagues\/\$\{leagueId\}\/draft`\}[^>]*>/g) ?? []
    expect(links).toHaveLength(2)
    for (const link of links) expect(link).toContain('{...roomEntry}')
    expect(source).toContain("import { useRoomEntryTarget } from '@/hooks/use-room-entry-target'")
  })

  it("the DraftBar's Join spreads roomEntry on its Link", () => {
    const source = code('src/components/layout/draft-bar.tsx')
    expect(source).toMatch(/<Link href=\{draft\.href\} \{\.\.\.roomEntry\}>/)
    expect(source).toContain("import { useRoomEntryTarget } from '@/hooks/use-room-entry-target'")
  })

  it('the in-place sites deliberately do NOT import the split hook', () => {
    // The disposition pinned from the other side: in-room-world navigation
    // stays in place, so neither launcher file may quietly grow the split.
    for (const rel of [
      'src/components/draft/mock-draft-launcher.tsx',
      'src/components/draft/mock-launcher-entry.ts',
    ]) {
      expect(code(rel), rel).not.toContain('useRoomEntryTarget')
    }
  })
})

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
 *   - `mock-launcher-entry.ts` — 2 sites, BOTH IN PLACE. (1) `?practice=1`
 *     opens the
 *     practice LAUNCHER (a config surface — no draft id, no channel, no
 *     room), and the CTA that renders it (`PracticeCta`) is deliberately
 *     one component mounted on BOTH the league home and the in-room lobby
 *     (R279 — no fork), so it navigates in place everywhere. The mock room
 *     the launcher then opens is an in-room-world navigation. (2) MP.6/R521
 *     added `leagueMockRoomHref` — the LEAGUE-attached mock room's shipped
 *     URL, named here when a second caller appeared. Its caller is a SERVER
 *     `redirect()` in `(room)/mocks/[mockId]/page.tsx`, sending a
 *     league-attached mock id typed at the standalone route to the room it
 *     actually has. A redirect has no anchor and no tab to open, so the
 *     desktop split cannot apply to it — in place by construction, not by
 *     choice.
 *   - `mock-draft-launcher.tsx` — 2 sites, IN PLACE: the post-launch
 *     `router.push` and the resume link both navigate WITHIN the
 *     chrome-free room world (the launcher lives on the room route); the
 *     split governs entry FROM the app, not movement inside the room.
 *
 * **MP.6c: the sweep now covers the SECOND room URL family too** — R520,
 * discharged here because this is the task where the room actually mounts at
 * `/app/mocks/[mockId]`. Two new hits, both dispositioned:
 *   - `mock-launcher-entry.ts` — `mockRoomHref`, the seam itself. Its
 *     callers are the ones dispositioned; the builder is not an entry.
 *   - `mock-draft-launcher.tsx` — `MockRow`'s *Rejoin* / *Resume*, live
 *     since MP.6c (F119's room half). **F123 TAKEN (MP.11): SPLIT PER
 *     MOUNT via a `roomEntry` prop — exactly the fix shape the row
 *     specified.** `MockRow` is mounted THREE times; the two SHELL mounts
 *     (the league-home card and `/app/mocks`) spread
 *     `useRoomEntryTarget()`'s props into the row, and the in-room practice
 *     launcher passes nothing, so the same control opens a new tab on
 *     measured desktop when reached FROM the app and stays in place inside
 *     the room world. Never a flag or hook read inside the row — the row
 *     cannot know which world mounted it. Pinned in the `F123` describe
 *     block below.
 *
 * **R536: THE SWEEP NOW SEES HELPER CALLERS, NOT ONLY LITERALS — and that
 * gap is why MP.7 walked past it.** `ROOM_URL` matches a template literal, so
 * a file that routes into the room by CALLING one of `mock-launcher-entry`'s
 * href builders scored zero hits and never had to disposition itself. That is
 * the census's own property failing quietly: the builders exist precisely so
 * callers stop writing the literal, and every caller that adopts the seam
 * disappears from the sweep that adoption was supposed to keep honest.
 * `ROOM_HREF_HELPER` counts those calls (definitions excluded), which adds
 * three previously invisible entries — two of them pre-existing:
 *   - `(room)/leagues/[leagueId]/draft/page.tsx` — MP.6's legacy-URL
 *     `redirect(mockRoomHref(…))`. IN PLACE BY CONSTRUCTION: a server
 *     `redirect()` has no anchor and no tab to open.
 *   - `(room)/mocks/[mockId]/page.tsx` — R521's `redirect(leagueMockRoomHref(…))`,
 *     same argument, same construction.
 *   - `home-quick-actions.tsx` — **MP.7's Home chip, the third entry into the
 *     room and the first from OUTSIDE the room world.** IN PLACE, and for the
 *     redirect's reason rather than the launcher's: the navigation is a
 *     programmatic `router.push` in the launch dialog's `onLaunched`, after a
 *     POST — there is no anchor to spread `useRoomEntryTarget`'s props onto,
 *     and a `window.open` from a mutation callback is a popup, not a split.
 *     The chip itself opens a DIALOG, not the room.
 *   - `league-home-states.tsx` gains its `mockLauncherHref` call for the same
 *     reason (2 literals + 1 helper): the practice CTA, already IN PLACE
 *     above.
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

/** A template-literal URL into EITHER room route (MP.6c / R520):
 *   - `/app/leagues/${…}/draft` NOT followed by `/recap` (the recap keeps the
 *     app shell and is not an entry into the room);
 *   - `/app/mocks/${…}` NOT followed by `/report` — the STANDALONE practice
 *     room, which MP.6 opened and MP.6c actually mounts the room at. The
 *     report is the same shape of exclusion as the recap: a shell page.
 *  API routes never match (they are `/api/…`), and `/app/mocks` with no id
 *  is the practice HOME, not a room. */
const ROOM_URL =
  /(\/app\/leagues\/\$\{[^}]+\}\/draft(?!\/)|\/app\/mocks\/\$\{[^}]+\}(?!\/))/g

/**
 * A CALL into one of the seam's href builders (R536) — the other way a file
 * routes into the room, and the way the literal sweep cannot see. Definitions
 * are excluded (`function <name>(`), bare imports never match (no paren), so
 * what is left is exactly the callers. Adding a builder to
 * `mock-launcher-entry.ts` means adding it here; the enumeration below is what
 * forces that to be a deliberate edit.
 */
const ROOM_HREF_HELPER =
  /(?<!function\s)\b(?:mockRoomHref|leagueMockRoomHref|mockLauncherHref)\(/g

describe('every room-entry URL in src/ is enumerated with a disposition', () => {
  it('the sweep matches the dispositioned set exactly', () => {
    const hits: Array<[string, number]> = []
    for (const rel of sourceFiles()) {
      const source = code(rel)
      const count =
        (source.match(ROOM_URL) ?? []).length + (source.match(ROOM_HREF_HELPER) ?? []).length
      if (count > 0) hits.push([rel, count])
    }
    hits.sort((a, b) => a[0].localeCompare(b[0]))
    expect(hits).toEqual([
      ['src/app/app/(room)/leagues/[leagueId]/draft/page.tsx', 1], // MP.6's legacy-URL redirect — in place by construction (R536)
      ['src/app/app/(room)/mocks/[mockId]/page.tsx', 1], // R521's redirect to the league mock's own room — same (R536)
      ['src/components/draft/mock-draft-launcher.tsx', 3], // in-room-world ×2 + MockRow's standalone Rejoin (F123), all in place
      ['src/components/draft/mock-launcher-entry.ts', 3], // launcher entry + the league mock room's URL (R521) + mockRoomHref, all in place
      ['src/components/home/home-quick-actions.tsx', 1], // MP.7's Home chip — router.push after a POST, no anchor to split (R536)
      ['src/components/layout/draft-bar-ops.ts', 1], // SPLIT via draft-bar.tsx
      ['src/components/leagues/league-home-states.tsx', 3], // 2 literals SPLIT + the practice CTA's helper call, in place
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
      // R536: the three helper callers, in place for the redirect's reason —
      // no anchor exists at any of them (two server redirects and a
      // post-mutation router.push), so the split is not applicable rather
      // than declined.
      'src/app/app/(room)/leagues/[leagueId]/draft/page.tsx',
      'src/app/app/(room)/mocks/[mockId]/page.tsx',
      'src/components/home/home-quick-actions.tsx',
    ]) {
      expect(code(rel), rel).not.toContain('useRoomEntryTarget')
    }
  })
})

describe('F123: MockRow takes the split per MOUNT, through a prop (MP.11)', () => {
  it('MockRow spreads roomEntry on the unfinished open Link, and only there', () => {
    const source = code('src/components/draft/mock-draft-launcher.tsx')
    // The row's room-entry Link carries the spread…
    expect(source).toMatch(/<Link href=\{openHref\} \{\.\.\.roomEntry\}>/)
    // …and the finished row's report Link does NOT — the report is a shell
    // page, not the room, so the split does not apply to it.
    expect(source).toMatch(/<Link href=\{reportHref\}>/)
    // The prop is typed, optional, and defaults to the same-tab {}.
    expect(source).toContain('roomEntry = {},')
    expect(source).toContain('roomEntry?: RoomEntryTargetProps')
  })

  it('the two SHELL mounts pass it; the in-room launcher mounts do not', () => {
    const shellMountCounts: Array<[string, number, number]> = []
    for (const rel of [
      'src/components/leagues/league-home-states.tsx', // the league-home card
      'src/components/draft/mocks-home.tsx', // MP.5's practice home
      'src/components/draft/mock-draft-launcher.tsx', // the IN-ROOM launcher
    ]) {
      const source = code(rel)
      const mounts = (source.match(/<MockRow/g) ?? []).length
      const spreads = (source.match(/roomEntry=\{roomEntry\}/g) ?? []).length
      shellMountCounts.push([rel, mounts, spreads])
    }
    expect(shellMountCounts).toEqual([
      // Both league-home mounts spread it (2 of 2)…
      ['src/components/leagues/league-home-states.tsx', 2, 2],
      // …the practice home's one mount spreads it (1 of 1)…
      ['src/components/draft/mocks-home.tsx', 1, 1],
      // …and the launcher's two IN-ROOM mounts pass NOTHING: movement inside
      // the room world stays in place (DR.6's doctrine, the F123 reason).
      ['src/components/draft/mock-draft-launcher.tsx', 2, 0],
    ])
  })

  it('both shell hosts read the split from the real hook', () => {
    for (const rel of [
      'src/components/leagues/league-home-states.tsx',
      'src/components/draft/mocks-home.tsx',
    ]) {
      expect(code(rel), rel).toContain(
        "import { useRoomEntryTarget } from '@/hooks/use-room-entry-target'",
      )
    }
  })
})

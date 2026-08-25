import { readFileSync } from 'node:fs'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

/**
 * The two "More" lists agree about the entries they share (F104; MP task
 * MP.9).
 *
 * **The split itself is NOT the defect and this file must not be read as a
 * push toward unifying it.** Desktop shows the primaries in the sidebar with
 * a small More expander; mobile's five bottom tabs push far more overflow
 * into the sheet. The lists therefore hold *different* sets on purpose —
 * Community is desktop-only today, Big Board / Rankings / Start or sit /
 * Teams / Leagues are sheet-only — and Chris confirmed that production
 * behaviour (tasks-MP §5 MP.9 item 2, §6 "Deferred").
 *
 * **The defect is that nothing couples them**: an entry meant to appear on
 * both form factors can be added to one file and missed in the other with no
 * type error and no failing test. So this pins the intersection, two ways:
 *
 *   1. `SHARED` — the entries that must exist in BOTH files, with the same
 *      label, the same icon, and the same release flag. This is what catches
 *      a one-file edit; an intersection-only check cannot, because a row
 *      that exists in one file is simply absent from the intersection.
 *   2. **Completeness (R544)** — every href in either file must be either in
 *      `SHARED` or in an explicit `DESKTOP_ONLY` / `SHEET_ONLY` exclusion.
 *      Without this, `SHARED` is opt-in and catches one-file edits ONLY for
 *      hrefs already enrolled: a brand-new row added to one file is simply
 *      absent from it, and an href deleted FROM it shrinks a loop that
 *      cannot notice it generated one case fewer. **Enrollment is not
 *      coverage** (the D248(1)/D250(1)/R532 species).
 *   3. Anything else that happens to appear in both must not disagree about
 *      its label or icon.
 *
 * Source-text idiom (`elevation-rule.test.ts` / `draft-command-bar.test.ts`):
 * Vitest runs under `jsx: "preserve"`, so these `.tsx` files are read, not
 * imported, and what is asserted is structural.
 */

const SIDEBAR = 'src/components/layout/sidebar.tsx'
const SHEET = 'src/components/layout/more-sheet.tsx'

interface MoreEntry {
  href: string
  label: string
  icon: string
  /** The `featureFlags.*` key gating the entry, or null if it is ungated. */
  flag: string | null
}

/** Entries that belong on BOTH form factors. Adding one to a single file is
 *  the F104 defect, and this is the list that makes it fail — but ONLY for
 *  the hrefs enrolled here, which is why `every entry is classified` below
 *  exists (R544: enrollment is not coverage). */
const SHARED: MoreEntry[] = [
  { href: '/app/stats', label: 'My stats', icon: 'chart', flag: null },
  {
    href: '/app/mocks',
    label: 'Mock Drafts',
    icon: 'rocket',
    flag: 'mockDrafts',
  },
]

/**
 * The deliberate asymmetries, named one by one (R544).
 *
 * Every href in either file must be classified — SHARED, or one of these two
 * — so that a NEW row landing in one file only is a failure rather than an
 * absence. An href listed here must genuinely be missing from the other
 * file: an exclusion list you can park a shared entry in is the escape hatch
 * that would make the whole pin optional, so both directions are asserted.
 */
/** Desktop-only: the sidebar's More carries it, the sheet does not. */
const DESKTOP_ONLY = ['/app/explore'] as const
/** Sheet-only: mobile's five bottom tabs push far more overflow into the
 *  sheet than desktop's More expander shows. */
const SHEET_ONLY = [
  '/app/big-board',
  '/app/weekly-ranks',
  '/app/start-or-sit',
  '/app/teams',
  '/app/leagues',
] as const

function read(rel: string): string {
  return readFileSync(path.resolve(process.cwd(), rel), 'utf8')
}

/** Source with comments stripped — both files DISCUSS their nav rows at
 *  length, and a pin a comment can satisfy is not pinning the code. */
function code(rel: string): string {
  return read(rel)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
}

/** `MORE_ITEMS` in the sidebar: object literals with href/label/icon, each
 *  optionally wrapped in a `featureFlags.X ? [...] : []` spread. */
function sidebarEntries(): MoreEntry[] {
  const source = code(SIDEBAR)
  const block = source.slice(
    source.indexOf('const MORE_ITEMS'),
    source.indexOf('const ROLE_LABEL'),
  )
  expect(block, 'MORE_ITEMS block not found in ' + SIDEBAR).not.toBe('')

  const entries: MoreEntry[] = []
  const object =
    /href:\s*'([^']+)',\s*label:\s*'([^']+)',\s*icon:\s*'([^']+)'/g
  for (const m of block.matchAll(object)) {
    // The nearest conditional spread opened before this literal, and whether
    // it has already closed (`: []),`) by the time the literal appears.
    const before = block.slice(0, m.index)
    const open = before.lastIndexOf('...(featureFlags.')
    const tail = open >= 0 ? before.slice(open) : ''
    const flagMatch = /^\.\.\.\(featureFlags\.(\w+)/.exec(tail)
    const closed = tail.includes(': [])')
    entries.push({
      href: m[1],
      label: m[2],
      icon: m[3],
      flag: flagMatch && !closed ? flagMatch[1] : null,
    })
  }
  return entries
}

/** The sheet's inline `<Row …>` nav rows (the top `<ul>` only — the account
 *  rows at the foot are not a "More" list). */
function sheetEntries(): MoreEntry[] {
  const source = code(SHEET)
  const start = source.indexOf('<ul className="mt-3">')
  const block =
    start < 0 ? '' : source.slice(start, source.indexOf('</ul>', start))
  expect(block, 'the sheet nav <ul> was not found in ' + SHEET).not.toBe('')

  const entries: MoreEntry[] = []
  const row = /<Row\b[\s\S]*?\/>/g
  for (const m of block.matchAll(row)) {
    const href = /href="([^"]+)"/.exec(m[0])?.[1]
    const label = /label="([^"]+)"/.exec(m[0])?.[1]
    const icon = /icon="([^"]+)"/.exec(m[0])?.[1]
    if (!href || !label || !icon) continue
    // The guard immediately before this row, if any: `{featureFlags.X && (`.
    const before = block.slice(0, m.index)
    const guard = /\{featureFlags\.(\w+)\s*&&\s*\(?\s*$/.exec(before)
    entries.push({ href, label, icon, flag: guard ? guard[1] : null })
  }
  return entries
}

describe('the two More lists (F104)', () => {
  const sidebar = sidebarEntries()
  const sheet = sheetEntries()

  it('parses both lists — a pin over an empty list pins nothing', () => {
    expect(sidebar.length).toBeGreaterThanOrEqual(2)
    expect(sheet.length).toBeGreaterThanOrEqual(2)
  })

  for (const want of SHARED) {
    it(`${want.label} is in BOTH lists, same label, icon and flag`, () => {
      for (const [file, entries] of [
        [SIDEBAR, sidebar],
        [SHEET, sheet],
      ] as const) {
        const found = entries.find((e) => e.href === want.href)
        expect(found, `${want.href} missing from ${file}`).toBeDefined()
        expect(found!.label, `label in ${file}`).toBe(want.label)
        expect(found!.icon, `icon in ${file}`).toBe(want.icon)
        expect(found!.flag, `flag in ${file}`).toBe(want.flag)
      }
    })
  }

  // R544 — THE MANIFEST ABOVE IS OPT-IN, AND THIS IS WHAT MAKES IT COMPLETE.
  // Two edits the SHARED loop alone is green on: a brand-new row added to one
  // file (its href is simply not enrolled), and an href quietly DELETED from
  // SHARED (the loop shrinks, and a loop that generates its own cases cannot
  // notice that it generated one fewer). Both are caught here, because every
  // href in either file has to be accounted for BY NAME.
  it('every entry in either list is classified — SHARED, desktop-only or sheet-only', () => {
    const classified = new Set<string>([
      ...SHARED.map((e) => e.href),
      ...DESKTOP_ONLY,
      ...SHEET_ONLY,
    ])
    for (const [file, entries] of [
      [SIDEBAR, sidebar],
      [SHEET, sheet],
    ] as const) {
      for (const entry of entries) {
        expect(
          classified.has(entry.href),
          `${entry.href} (${file}) is in neither SHARED nor an explicit ` +
            `DESKTOP_ONLY / SHEET_ONLY exclusion. If it belongs on both form ` +
            `factors, add it to BOTH files and to SHARED; if it is deliberately ` +
            `one-sided, say so in the matching exclusion list.`,
        ).toBe(true)
      }
    }
  })

  it('the one-sided lists are genuinely one-sided, both directions', () => {
    // Otherwise an exclusion list is an escape hatch: park a shared entry in
    // one and the SHARED manifest becomes optional.
    for (const href of DESKTOP_ONLY) {
      expect(sidebar.some((e) => e.href === href), `${href} in ${SIDEBAR}`).toBe(true)
      expect(sheet.some((e) => e.href === href), `${href} in ${SHEET}`).toBe(false)
    }
    for (const href of SHEET_ONLY) {
      expect(sheet.some((e) => e.href === href), `${href} in ${SHEET}`).toBe(true)
      expect(sidebar.some((e) => e.href === href), `${href} in ${SIDEBAR}`).toBe(false)
    }
    for (const href of [...DESKTOP_ONLY, ...SHEET_ONLY]) {
      expect(SHARED.map((e) => e.href), href).not.toContain(href)
    }
  })

  it('entries that appear in both do not disagree about label or icon', () => {
    for (const a of sidebar) {
      const b = sheet.find((e) => e.href === a.href)
      if (!b) continue
      expect(b.label, a.href).toBe(a.label)
      expect(b.icon, a.href).toBe(a.icon)
    }
  })
})

describe('More survives the leagues flag being off (E79 / D231(3))', () => {
  // With `leagues` OFF and `mockDrafts` ON, More still shows My stats and
  // Mock Drafts on both form factors. The static half of that claim is what
  // gates each row; the rendered half was driven in the browser for MP.9
  // (desktop sidebar More, and the sheet at 375px, with NEXT_PUBLIC_FLAG_
  // LEAGUES=false and NEXT_PUBLIC_FLAG_MOCK_DRAFTS=true).
  for (const [href, flag] of [
    ['/app/stats', null],
    ['/app/mocks', 'mockDrafts'],
  ] as const) {
    it(`${href} is gated on ${flag ?? 'nothing'} — never on leagues`, () => {
      for (const [file, entries] of [
        [SIDEBAR, sidebarEntries()],
        [SHEET, sheetEntries()],
      ] as const) {
        expect(entries.find((e) => e.href === href)?.flag, file).toBe(flag)
      }
    })
  }
})

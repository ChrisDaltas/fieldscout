import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

import {
  DRAFT_OPTIONS_ENTRIES,
  sectionDomId,
  type DraftOptionsEntry,
  type DraftOptionsSectionId,
} from './draft-options-ops'

/**
 * Pins for the `Draft Options` menu (tasks-DR DR.3; spec §16.2
 * `draft-options-menu`, §8.7's v2.12 note, D152/D153) — the DR.2 idiom:
 * an ops golden (the group catalog as stored literals) plus source-level
 * structural pins (`jsx: "preserve"` keeps Vite from importing a `.tsx`;
 * what is pinned is what is in the returned tree and behind which gate —
 * the mounts are measured by the DR.3 PR's per-variant DOM inventories).
 *
 * What is pinned, and why:
 *   - the EIGHT v1 groups, 1:1 with the shipped panel sections, stored as
 *     literals (§8.7's control groups; Manual Edit Mode and End Draft are
 *     deliberately absent until L.C3.2);
 *   - the enumerated-list construction (no hard-coded ladder — L.C3.2
 *     appends entries, never restructures);
 *   - the mock gate: the ONLY `<DraftOptionsMenu` mount sits behind the
 *     bar's `showDraftOptions` (D110(1) — the ops golden in
 *     `command-bar-ops.test.ts` pins `draftOptions: false` for every mock
 *     row of the variant table, so gate + model together keep every
 *     commissioner group off a mock);
 *   - the open-at-section wiring: menu choice → room state → panel anchor,
 *     with every catalog entry owning a `sectionDomId` anchor in the panel;
 *   - NO SECOND DOOR to commissioner power in the room (the
 *     `launch-scope-gates` sweep idiom over `src/components/draft/`) — the
 *     finding-preventer for "the button came back";
 *   - D152: the menu adds no shadow of its own — the resting overlay shadow
 *     is the DropdownMenuContent primitive's, allowlisted in
 *     `elevation-rule.test.ts`;
 *   - F72's dead-control half: the retired extend-current checkbox stays
 *     retired, and the panel can only ever send `extendCurrent: false`
 *     (migration 090 deleted the arm — `true` refuses in every state).
 */

const MENU = 'src/components/draft/draft-options-menu.tsx'
const OPS = 'src/components/draft/draft-options-ops.ts'
const BAR = 'src/components/draft/draft-command-bar.tsx'
const ROOM = 'src/components/draft/draft-room.tsx'
const PANEL = 'src/components/draft/commish-draft-panel.tsx'
const DRAFT_DIR = 'src/components/draft'

function read(rel: string): string {
  return readFileSync(path.resolve(process.cwd(), rel), 'utf8')
}

/** Source with comments removed — these files DISCUSS their chrome at
 *  length, and a pin a comment can satisfy is not pinning the code. */
function code(rel: string): string {
  return read(rel)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((line) => !line.trim().startsWith('//'))
    .join('\n')
}

/** The `{<cond> && ( … )}` block removed (the room-exits idiom), so "this
 *  control is not behind that gate" is pinned by construction. */
function withoutGate(source: string, cond: string): string {
  const marker = `{${cond} && (`
  const start = source.indexOf(marker)
  if (start === -1) throw new Error(`gate not found: ${marker}`)
  let i = start + marker.length - 1 // at the '('
  let depth = 0
  for (; i < source.length; i += 1) {
    if (source[i] === '(') depth += 1
    else if (source[i] === ')') {
      depth -= 1
      if (depth === 0) break
    }
  }
  return source.slice(0, start) + source.slice(i + 1)
}

function countOccurrences(haystack: string, needle: string): number {
  let count = 0
  let i = haystack.indexOf(needle)
  while (i !== -1) {
    count += 1
    i = haystack.indexOf(needle, i + needle.length)
  }
  return count
}

// ---------------------------------------------------------------------------
// The golden group catalog (§8.7 → the shipped panel's eight sections)
// ---------------------------------------------------------------------------

const GOLDEN_ENTRIES: readonly DraftOptionsEntry[] = [
  { id: 'clock', label: 'Clock & timers' },
  { id: 'undo', label: 'Undo picks' },
  { id: 'fix-pick', label: 'Fix a pick' },
  { id: 'force-pick', label: 'Pick for a manager' },
  { id: 'order', label: 'Draft order' },
  { id: 'autopick', label: 'Autopick' },
  { id: 'seats', label: 'Reassign a seat' },
  { id: 'reset', label: 'Reset draft', destructive: true },
]

/** Catalog id → the panel section component its anchor must wrap (the 1:1
 *  contract with `commish-draft-panel.tsx`'s render list). */
const SECTION_COMPONENTS: Record<DraftOptionsSectionId, string> = {
  clock: 'ClockSection',
  undo: 'UndoSection',
  'fix-pick': 'FixPickSection',
  'force-pick': 'ForcePickSection',
  order: 'OrderSection',
  autopick: 'AutopickSection',
  seats: 'SeatControlsSection',
  reset: 'ResetSection',
}

describe('the group catalog — eight groups, 1:1 with the shipped sections', () => {
  it('matches the golden table exactly (ids, labels, order, destructive flags)', () => {
    expect(DRAFT_OPTIONS_ENTRIES).toEqual(GOLDEN_ENTRIES)
  })

  it('Reset draft is the ONE destructive entry', () => {
    const destructive = DRAFT_OPTIONS_ENTRIES.filter((e) => e.destructive)
    expect(destructive.map((e) => e.id)).toEqual(['reset'])
  })

  it('the M3 entries are deliberately absent until L.C3.2 builds them', () => {
    // No disabled placeholders for unbuilt features (DR.3 item 3); the ops
    // catalog names L.C3.2 as the extension point in its docblock.
    const labels = DRAFT_OPTIONS_ENTRIES.map((e) => e.label)
    expect(labels).not.toContain('Manual Edit Mode')
    expect(labels).not.toContain('End Draft')
    expect(read(OPS)).toMatch(/L\.C3\.2/)
  })

  it('sectionDomId derives the anchor id', () => {
    expect(sectionDomId('clock')).toBe('draft-options-clock')
    expect(sectionDomId('reset')).toBe('draft-options-reset')
  })
})

describe('the menu renders the enumerated catalog, not a hard-coded ladder', () => {
  const menu = code(MENU)

  it('maps DRAFT_OPTIONS_ENTRIES', () => {
    expect(menu).toMatch(/DRAFT_OPTIONS_ENTRIES\.map/)
  })

  it('inlines no group label of its own', () => {
    for (const entry of GOLDEN_ENTRIES) {
      expect(menu, entry.label).not.toContain(entry.label)
    }
  })

  it('gives the destructive entry the negative treatment behind its flag', () => {
    expect(menu).toMatch(/entry\.destructive[\s\S]*?text-negative-strong/)
  })

  it('adds no shadow of its own — D152 rides the dropdown primitive', () => {
    expect(menu).not.toMatch(/shadow-hard/)
    // The comment naming the exception is the D152 requirement; the carried
    // shadow itself lives in (and is allowlisted for) the primitive.
    expect(read(MENU)).toMatch(/D152/)
    expect(code('src/components/ui/dropdown-menu.tsx')).toMatch(/(?<!:)shadow-hard-4/)
  })
})

describe('the mock gate — no commissioner group reachable on a mock (D110(1))', () => {
  it('the bar mounts the menu ONLY behind showDraftOptions', () => {
    const bar = code(BAR)
    expect(bar).toMatch(/<DraftOptionsMenu/)
    expect(withoutGate(bar, 'showDraftOptions')).not.toMatch(/<DraftOptionsMenu/)
  })

  it('the bar carries no direct Draft Options control anymore', () => {
    // The label lives in the menu component; a "Draft Options" literal
    // reappearing in the bar is the retired direct-open button coming back.
    expect(code(BAR)).not.toMatch(/Draft Options/)
  })
})

describe('open-at-section wiring (menu choice → room state → panel anchor)', () => {
  const room = code(ROOM)
  const panel = code(PANEL)

  it('the room stores the chosen section and opens the panel there', () => {
    expect(room).toMatch(/onOpenDraftOptions=\{openDraftOptionsAt\}/)
    expect(room).toMatch(/setDraftOptionsSection\(section\)\s*\n\s*setDraftOptionsOpen\(true\)/)
    expect(room).toMatch(/openAtSection=\{draftOptionsSection\}/)
  })

  it('every catalog entry owns a sectionDomId anchor wrapping its section', () => {
    for (const entry of DRAFT_OPTIONS_ENTRIES) {
      const component = SECTION_COMPONENTS[entry.id]
      expect(component, `no section component mapped for '${entry.id}'`).toBeTruthy()
      expect(panel, entry.id).toMatch(
        new RegExp(`sectionDomId\\('${entry.id}'\\)\\}>\\s*<${component}`),
      )
    }
  })

  it('the panel scrolls to the chosen anchor when opened', () => {
    expect(panel).toMatch(/<ScrollToSection section=\{openAtSection\} \/>/)
    expect(panel).toMatch(/scrollIntoView/)
  })
})

describe('no second door to commissioner power (the launch-scope-gates sweep)', () => {
  const files = readdirSync(path.resolve(process.cwd(), DRAFT_DIR)).filter(
    (f) => f.endsWith('.tsx') && !f.endsWith('.test.tsx'),
  )

  it('finds the room components to sweep', () => {
    // Guards against the glob silently matching nothing after a move.
    expect(files.length).toBeGreaterThan(15)
    expect(files).toContain('draft-room.tsx')
    expect(files).toContain('draft-command-bar.tsx')
  })

  it('exactly ONE CommishDraftPanel mount, in the room', () => {
    const mounts = files.map(
      (f) => [f, countOccurrences(code(`${DRAFT_DIR}/${f}`), '<CommishDraftPanel')] as const,
    )
    const total = mounts.reduce((sum, [, n]) => sum + n, 0)
    expect(total, JSON.stringify(mounts.filter(([, n]) => n > 0))).toBe(1)
    expect(mounts.find(([f]) => f === 'draft-room.tsx')?.[1]).toBe(1)
  })

  it('exactly ONE site opens it — the menu handler in the room', () => {
    const opens = files.map(
      (f) => [f, countOccurrences(code(`${DRAFT_DIR}/${f}`), 'setDraftOptionsOpen(true)')] as const,
    )
    const total = opens.reduce((sum, [, n]) => sum + n, 0)
    expect(total, JSON.stringify(opens.filter(([, n]) => n > 0))).toBe(1)
    expect(opens.find(([f]) => f === 'draft-room.tsx')?.[1]).toBe(1)
  })

  it('exactly ONE DraftOptionsMenu mount, in the bar', () => {
    const mounts = files.map(
      (f) => [f, countOccurrences(code(`${DRAFT_DIR}/${f}`), '<DraftOptionsMenu')] as const,
    )
    const total = mounts.reduce((sum, [, n]) => sum + n, 0)
    expect(total, JSON.stringify(mounts.filter(([, n]) => n > 0))).toBe(1)
    expect(mounts.find(([f]) => f === 'draft-command-bar.tsx')?.[1]).toBe(1)
  })
})

describe("F72's dead control stays dead (migration 090 / spec v2.12.5)", () => {
  const panel = code(PANEL)

  it('the extend-current checkbox is gone, hint and all', () => {
    expect(panel).not.toContain('Also extend the current pick')
    expect(panel).not.toContain('resume first')
    expect(panel).not.toContain('setExtendCurrent')
    expect(read(PANEL)).not.toMatch(/@\/components\/ui\/checkbox/)
  })

  it('the panel can only ever send extendCurrent: false', () => {
    // 090 deleted the extend-in-place arm — `true` refuses in EVERY state,
    // so the literal false is the one honest payload.
    expect(panel).toMatch(/extendCurrent: false/)
    expect(panel).not.toMatch(/extendCurrent: true/)
    expect(panel).not.toMatch(/extendCurrent,/)
  })
})

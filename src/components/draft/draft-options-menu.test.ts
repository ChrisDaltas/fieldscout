import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

import {
  AUCTION_DRAFT_OPTIONS_ENTRIES,
  DRAFT_OPTIONS_ENTRIES,
  draftOptionsEntries,
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
 *     literals (§8.7's control groups) — and, since **L.C3.2**, the ELEVEN
 *     AUCTION groups as their own golden: Manual Edit Mode, Edit current
 *     nomination, Team budgets and End draft arrive, "Fix a pick" is
 *     REPLACED by Manual Edit Mode (§8.7's v2.10 ruling), and none of the
 *     four is reachable in a snake room (their RPCs refuse a snake draft);
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
  'manual-edit': 'ManualEditSection',
  'cancel-nomination': 'CancelNominationSection',
  budget: 'BudgetSection',
  'force-pick': 'ForcePickSection',
  order: 'OrderSection',
  autopick: 'AutopickSection',
  seats: 'SeatControlsSection',
  reset: 'ResetSection',
  end: 'EndDraftSection',
}

const GOLDEN_AUCTION_ENTRIES: readonly DraftOptionsEntry[] = [
  { id: 'clock', label: 'Clock & timers' },
  { id: 'undo', label: 'Undo nominations' },
  { id: 'manual-edit', label: 'Manual Edit Mode' },
  { id: 'cancel-nomination', label: 'Edit current nomination' },
  { id: 'budget', label: 'Team budgets' },
  { id: 'force-pick', label: 'Nominate for a manager' },
  { id: 'order', label: 'Nomination order' },
  { id: 'autopick', label: 'Autopick' },
  { id: 'seats', label: 'Reassign a seat' },
  { id: 'reset', label: 'Reset draft', destructive: true },
  { id: 'end', label: 'End draft', destructive: true },
]

describe('the group catalog — eight groups, 1:1 with the shipped sections', () => {
  it('matches the golden table exactly (ids, labels, order, destructive flags)', () => {
    expect(DRAFT_OPTIONS_ENTRIES).toEqual(GOLDEN_ENTRIES)
  })

  it('Reset draft is the ONE destructive entry', () => {
    const destructive = DRAFT_OPTIONS_ENTRIES.filter((e) => e.destructive)
    expect(destructive.map((e) => e.id)).toEqual(['reset'])
  })

  it('a SNAKE room lists no auction group (the engine refuses them by type)', () => {
    // The ops catalog states the replacement rule in prose too, so a future
    // reader meets the reason and not just the two arrays.
    expect(read(OPS)).toMatch(/L\.C3\.2/)
    const ids = draftOptionsEntries(false).map((e) => e.id)
    for (const auctionOnly of ['manual-edit', 'cancel-nomination', 'budget', 'end']) {
      expect(ids, auctionOnly).not.toContain(auctionOnly)
    }
    expect(draftOptionsEntries(false)).toEqual(GOLDEN_ENTRIES)
  })

  it('sectionDomId derives the anchor id', () => {
    expect(sectionDomId('clock')).toBe('draft-options-clock')
    expect(sectionDomId('reset')).toBe('draft-options-reset')
    expect(sectionDomId('manual-edit')).toBe('draft-options-manual-edit')
  })
})

describe('the AUCTION catalog (L.C3.2) — eleven groups, in the panel order', () => {
  it('matches the golden table exactly', () => {
    expect(AUCTION_DRAFT_OPTIONS_ENTRIES).toEqual(GOLDEN_AUCTION_ENTRIES)
    expect(draftOptionsEntries(true)).toEqual(GOLDEN_AUCTION_ENTRIES)
  })

  it('Manual Edit Mode REPLACES Fix a pick (§8.7 v2.10), never joins it', () => {
    const ids = AUCTION_DRAFT_OPTIONS_ENTRIES.map((e) => e.id)
    expect(ids).toContain('manual-edit')
    expect(ids).not.toContain('fix-pick')
  })

  it('Reset and End are the TWO destructive entries, End last', () => {
    const destructive = AUCTION_DRAFT_OPTIONS_ENTRIES.filter((e) => e.destructive)
    expect(destructive.map((e) => e.id)).toEqual(['reset', 'end'])
    expect(AUCTION_DRAFT_OPTIONS_ENTRIES.at(-1)?.id).toBe('end')
  })

  it('every id is unique and every entry carries a label', () => {
    const ids = AUCTION_DRAFT_OPTIONS_ENTRIES.map((e) => e.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const entry of AUCTION_DRAFT_OPTIONS_ENTRIES) {
      expect(entry.label.length, entry.id).toBeGreaterThan(0)
    }
  })
})

describe('the menu renders the enumerated catalog, not a hard-coded ladder', () => {
  const menu = code(MENU)

  it('maps the enumerated catalog for its draft type', () => {
    expect(menu).toMatch(/draftOptionsEntries\(isAuction\)/)
    expect(menu).toMatch(/entries\.map/)
  })

  it('inlines no group label of its own', () => {
    for (const entry of [...GOLDEN_ENTRIES, ...GOLDEN_AUCTION_ENTRIES]) {
      expect(menu, entry.label).not.toContain(entry.label)
    }
  })

  it('the destructive group sits under ONE separator, however many entries', () => {
    // An auction has two destructive entries (Reset, End); one separator
    // opens the group, not one per entry.
    expect(menu).toMatch(/entry\.id === firstDestructiveId && <DropdownMenuSeparator/)
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

  it('every catalog entry owns a focusable sectionDomId anchor wrapping its section', () => {
    // Both catalogs: an auction entry appended without an anchor (or without
    // a SECTION_COMPONENTS row) fails here by construction — DR.3's design,
    // exercised for real by L.C3.2's four new groups.
    for (const entry of [...DRAFT_OPTIONS_ENTRIES, ...AUCTION_DRAFT_OPTIONS_ENTRIES]) {
      const component = SECTION_COMPONENTS[entry.id]
      expect(component, `no section component mapped for '${entry.id}'`).toBeTruthy()
      expect(panel, entry.id).toMatch(
        new RegExp(`sectionDomId\\('${entry.id}'\\)\\} tabIndex=\\{-1\\}>\\s*<${component}`),
      )
    }
  })

  it('opening at a section focuses and scrolls its anchor via onOpenAutoFocus', () => {
    // onOpenAutoFocus, not a mount effect: Radix's own open auto-focus runs
    // AFTER mount effects and resets the sheet's scroll (measured in the
    // DR.3 browser pass — a rAF-scheduled scrollIntoView ended at
    // scrollTop 0).
    expect(panel).toMatch(/onOpenAutoFocus=\{\(event\) => \{\s*if \(!openAtSection\) return/)
    expect(panel).toMatch(/anchor\.focus\(\{ preventScroll: true \}\)/)
    expect(panel).toMatch(/anchor\.scrollIntoView\(\{ block: 'start' \}\)/)
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

import { readFileSync } from 'node:fs'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

import { execSync } from 'node:child_process'

/**
 * LV.11 — the split between `FilterChip` and the shared tab/segment control,
 * pinned so it cannot drift back by accident.
 *
 * Chris, 2026-08-11: *"Use the tab component for now, we can create one for
 * filters later."* Single-select chip rows moved onto `Segment` / `SegmentItem`
 * (`ui/tabs.tsx`). **Two shapes deliberately did not**, because a segment
 * asserts that exactly one item is active:
 *
 * - **multi-select** — several on at once;
 * - **single-select where zero selected is valid** — tapping the on chip clears
 *   it and nothing is active.
 *
 * Converting either is a behaviour regression wearing a restyle, and it is the
 * single most likely "tidy-up" a future session would attempt — the rows *look*
 * like the ones that moved. So the allow-list below is the contract: a file may
 * only keep `FilterChip` if it is named here **with a reason**, and a converted
 * file may not reintroduce it.
 *
 * This is a source pin, the same idiom as `lists/lists-cutover.test.ts` — it
 * reads files rather than rendering, because the thing being protected is a
 * *decision*, not a rendered pixel.
 */

const ROOT = path.resolve(process.cwd(), 'src')

/** The only reasons a row may stay a `FilterChip`. A closed vocabulary. */
type Reason = 'multi-select' | 'zero-selected-is-valid' | 'styleguide-demo'

/**
 * Every file allowed to import `FilterChip`, and why. Adding a row here is a
 * design decision: the question to answer is "can this row be in a state where
 * zero items, or two items, are selected?". If the answer is no, it belongs on
 * `Segment`.
 */
const FILTER_CHIP_CALLERS: Record<string, Reason> = {
  // `components/lists/lists-browse.tsx` was here for its multi-select tag row.
  // LV.7 deleted that page whole (the design's Lists page carries the mode
  // segment and My lists / Saved and nothing else), so the row is gone with it
  // — not converted, and not silently moved somewhere else.
  // Position filter is a Set; each chip toggles independently.
  'components/lists/builder/player-sidebar.tsx': 'multi-select',
  // Ranking styles are multi-select AND carry a 1-3 weight each; the AI-expert
  // picker is Optional and starts with none chosen.
  'components/lists/generate-ai-modal.tsx': 'multi-select',
  // Flex-slot positions and IR designations are both multi-select. Also inside
  // the paused leagues build's tree (ACTIVE-BUILD.md), so untouched either way.
  'components/leagues/roster-slot-builder.tsx': 'multi-select',
  // Tapping the pressed position clears it back to null = all positions.
  'components/layout/rail/players-panel.tsx': 'zero-selected-is-valid',
  // Documents the surviving component beside the segment it was split from.
  'app/app/(shell)/styleguide/page.tsx': 'styleguide-demo',
}

/**
 * Rows that moved. Each of these must import the shared control and must NOT
 * import `FilterChip` — except the files that appear in both lists, which keep
 * one row of each kind and are checked only for the `Segment` import.
 */
const CONVERTED: string[] = [
  'app/app/(shell)/admin/posts/page.tsx',
  'components/explore/explore-feed.tsx',
  'components/layout/rail/players-panel.tsx',
  'components/lists/generate-ai-modal.tsx',
  'components/lists/list-form-dialog.tsx',
  // `components/lists/lists-browse.tsx`'s position row was converted at LV.11
  // and the file was deleted at LV.7 — recorded here rather than dropped
  // silently, because "the entry vanished" and "the row reverted" look the same
  // in a diff.
  'components/weekly-ranks/weekly-ranks-view.tsx',
]

function read(rel: string) {
  return readFileSync(path.join(ROOT, rel), 'utf8')
}

/**
 * Every file under `src/` that imports `FilterChip`, found by grep rather than
 * by walking a hand-written list — the point is to catch a file nobody thought
 * to mention.
 */
function filesImportingFilterChip(): string[] {
  const out = execSync(
    `grep -rl "FilterChip" ${JSON.stringify(ROOT)} --include=*.tsx || true`,
    { encoding: 'utf8' },
  )
  return out
    .split('\n')
    .filter(Boolean)
    .map((abs) => path.relative(ROOT, abs))
    .filter((rel) => rel !== 'components/ui/badge.tsx')
    // A file may mention the name only in a comment explaining why it does not
    // use one; the contract is about the import.
    .filter((rel) => /from ['"]@\/components\/ui\/badge['"]/.test(read(rel)))
    .filter((rel) => /\bFilterChip\b/.test(read(rel).split('\n').filter((l) => l.includes('import')).join('\n')))
    .sort()
}

describe('LV.11 — FilterChip keeps exactly the rows a segment cannot express', () => {
  it('FilterChip still has consumers, so the component is not dead code', () => {
    const callers = filesImportingFilterChip()
    expect(
      callers.length,
      'No file imports FilterChip any more. If that is deliberate, delete the ' +
        'component from ui/badge.tsx in the same change rather than leaving it ' +
        'orphaned — and delete this test with it.',
    ).toBeGreaterThan(0)
  })

  it('every FilterChip caller is on the allow-list with a recorded reason', () => {
    const callers = filesImportingFilterChip()
    const undocumented = callers.filter((f) => !(f in FILTER_CHIP_CALLERS))
    expect(
      undocumented,
      'These files import FilterChip but are not in FILTER_CHIP_CALLERS. A row ' +
        'may only stay a chip if it is multi-select, or if zero-selected is a ' +
        'valid state. Anything one-of-many belongs on Segment (LV.11).',
    ).toEqual([])
  })

  it('the allow-list has no stale entries', () => {
    const callers = new Set(filesImportingFilterChip())
    const stale = Object.keys(FILTER_CHIP_CALLERS).filter((f) => !callers.has(f))
    expect(
      stale,
      'These files are on the allow-list but no longer import FilterChip — ' +
        'either they were converted (drop the entry) or the grep is wrong.',
    ).toEqual([])
  })

  it('the converted rows use the shared control', () => {
    const missing = CONVERTED.filter(
      (f) => !/from ['"]@\/components\/ui\/tabs['"]/.test(read(f)),
    )
    expect(
      missing,
      'These files were converted onto Segment/SegmentItem at LV.11 and no ' +
        'longer import ui/tabs. Reverting one to a hand-rolled control ' +
        'reintroduces the fourth look D9 removed.',
    ).toEqual([])
  })

  it('the two rows that must never become segments are still chips', () => {
    // Named individually rather than inferred, because these two are the whole
    // point: both are single-select, both look convertible, and converting
    // either removes the user's ability to select nothing.
    const railPanel = read('components/layout/rail/players-panel.tsx')
    expect(railPanel).toMatch(/setPosition\(on \? pos : null\)/)

    const aiModal = read('components/lists/generate-ai-modal.tsx')
    expect(aiModal).toMatch(/cur === p\.username \? null : p\.username/)
  })

  it('the primitives record that this unification is temporary', () => {
    // Chris ruled it "for now" and a purpose-built filter control comes later.
    // If someone rewrites these headers, the next filter-control task loses the
    // only note saying these rows are candidates to move back.
    expect(read('components/ui/tabs.tsx')).toContain('for now')
    expect(read('components/ui/badge.tsx')).toContain('LV.11')
  })
})

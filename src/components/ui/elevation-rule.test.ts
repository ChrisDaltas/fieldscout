import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

/**
 * Elevation is a hover/press affordance, never a resting state
 * (Chris, 2026-08-11; CLAUDE.md → Styling → "Elevation";
 * docs/design/lists/README.md §Geometry: ".fs-lift = box-shadow: none →
 * --shadow-4 on hover ... Buttons press flat on :active").
 *
 * The design system has always said this — the app drifted from it, and ~15
 * resting elevations accumulated across 12 files before anyone measured. The
 * shared `ui/` primitives are where that drift does the most damage: one
 * resting `shadow-hard-*` in `button.tsx` floated every primary button on
 * every screen at once.
 *
 * So this pins the primitives, not the whole app. A `shadow-hard-*` in
 * `src/components/ui/**` must be reached through an interaction prefix
 * (`hover:`, `active:`, `focus:`, `group-hover:`, `data-[state=…]:`) unless
 * the file is a true overlay — something that floats above the page and
 * therefore is elevated at rest by definition.
 *
 * Deliberately cheap and deliberately narrow: one test over one directory,
 * same source-pin idiom as `src/lib/lists-v2-flag.test.ts`. It does not try
 * to police feature components — a reviewer can, and the rule in CLAUDE.md
 * tells them what to look for.
 */

const UI_DIR = path.resolve(process.cwd(), 'src/components/ui')

/**
 * True overlays: they float above the page, so a resting shadow is correct.
 * Adding a file here is a design decision, not a way to silence the test —
 * the question to answer is "does this element float above the page, or is it
 * in normal flow?".
 */
const OVERLAY_FILES: Record<string, string> = {
  'dialog.tsx': 'modal — floats above the page',
  'popover.tsx': 'overlay panel',
  'dropdown-menu.tsx': 'overlay menu',
  'select.tsx': 'overlay listbox',
  'toast.tsx': 'floats over the whole app',
  'command.tsx': 'command palette — carries the transparent dialog shell’s shadow',
  'sheet.tsx': 'edge-anchored overlay',
  'tooltip.tsx': 'overlay',
}

/** `shadow-hard-*` NOT preceded by an interaction-state prefix. */
const RESTING_SHADOW = /(?<![\w-])(?<!:)shadow-hard-[\w-]+/g

/** Interaction prefixes that make an elevation legitimate. */
const INTERACTION_PREFIX = /(hover|active|focus|focus-visible|group-hover|peer-hover|data-\[[^\]]*\]):$/

function restingShadowsIn(source: string): string[] {
  const hits: string[] = []
  for (const match of source.matchAll(RESTING_SHADOW)) {
    const before = source.slice(Math.max(0, match.index - 40), match.index)
    if (INTERACTION_PREFIX.test(before)) continue
    // Ignore prose in comments — the rule is about class strings, and the
    // primitives document themselves.
    const line = source.slice(source.lastIndexOf('\n', match.index) + 1, match.index)
    if (/^\s*(\/\/|\*|\/\*)/.test(line)) continue
    hits.push(match[0])
  }
  return hits
}

describe('elevation is a hover affordance, never a resting state', () => {
  const files = readdirSync(UI_DIR).filter(
    (f) => f.endsWith('.tsx') && !f.endsWith('.test.tsx'),
  )

  it('finds the ui/ primitives to check', () => {
    // Guards against the glob silently matching nothing after a move.
    expect(files.length).toBeGreaterThan(20)
    expect(files).toContain('button.tsx')
    expect(files).toContain('card.tsx')
  })

  for (const file of files) {
    const why = OVERLAY_FILES[file]

    if (why) {
      it(`${file} is a true overlay (${why}) — stays elevated at rest`, () => {
        // The inverse assertion: if someone "fixes" an overlay by making its
        // shadow hover-only, a floating panel loses the thing that makes it
        // read as floating. Only assert on the ones that actually have one.
        const source = readFileSync(path.join(UI_DIR, file), 'utf8')
        if (source.includes('shadow-hard-')) {
          expect(restingShadowsIn(source).length).toBeGreaterThan(0)
        }
      })
      continue
    }

    it(`${file} carries no resting shadow-hard-*`, () => {
      const source = readFileSync(path.join(UI_DIR, file), 'utf8')
      const resting = restingShadowsIn(source)
      expect(
        resting,
        `${file} elevates at rest (${resting.join(', ')}). Elevation is a ` +
          'hover/press affordance — move it behind hover:, or drop it. If this ' +
          'component is a true overlay, add it to OVERLAY_FILES with a reason.',
      ).toEqual([])
    })
  }
})

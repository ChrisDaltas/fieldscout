import { readFileSync } from 'node:fs'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

/**
 * LV.12 — the Side by side picker, pinned at the source.
 *
 * **Source pins, not renders** — the same idiom and the same reason as
 * `src/components/ui/elevation-rule.test.ts` and
 * `src/components/lists/ai-surfaces.test.ts`: these are `.tsx`, which Vite
 * cannot parse under Next's `jsx: "preserve"`.
 *
 * Three of the four groups below guard a decision that a plausible future edit
 * would undo silently:
 *
 * 1. **The set the picker offers.** The delivery plan §6 row says the picker
 *    *"honours the My lists / Saved tab"*. The design package says otherwise —
 *    `ListsScreen.jsx:431` concatenates own + saved, `:49` hides the tab
 *    control in this mode, and `screens/side-by-side-picker.png` renders all 9
 *    of the prototype's 7 + 2 lists — and the design LAW outranks the plan
 *    (`PROGRESS-lists-v2.md` header). Reinstating the filter to "follow the
 *    plan" would leave a viewer unable to compare their own board with a saved
 *    one and no control on screen to fix it.
 * 2. **Selection is session-only (D3).** No `persist`, no `localStorage`, no
 *    server write. Seven stores in this app persist; adding an eighth here
 *    "for convenience" was considered and declined.
 * 3. **Elevation is a hover state.** Selected is a *resting* condition, so it
 *    is fill and border, never a shadow (CLAUDE.md → Elevation).
 * 4. The copy, which is the design's own and is quoted verbatim in the LAW.
 */

const read = (file: string) => readFileSync(path.resolve(process.cwd(), file), 'utf8')

/**
 * The same file with its comments removed.
 *
 * Every negative assertion below has to read this rather than the raw source:
 * both files document the decisions they encode, in prose that necessarily
 * quotes the very words the assertion forbids ("tab", "SideBySidePlaceholder").
 * Matching the raw text would fail on the explanation instead of the code.
 */
const code = (file: string) =>
  read(file)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')

const PICKER = 'src/components/lists/v2/side-by-side-picker.tsx'
const PAGE = 'src/components/lists/v2/lists-page-v2.tsx'

describe('LV.12 — the picker offers every list, not the active tab', () => {
  it('the page passes own + saved, concatenated in that order', () => {
    const source = read(PAGE)
    expect(source).toMatch(/const comparable = React\.useMemo\(\s*\(\) => \[\.\.\.mine, \.\.\.saved\]/)
    expect(source).toMatch(/<SideBySidePicker\s+lists=\{comparable\}/)
  })

  it('the picker takes no tab, so it cannot be filtered by one', () => {
    const source = code(PICKER)
    expect(source).not.toMatch(/\btab\b\s*[:,}]/)
    expect(source).not.toContain("'mine'")
    expect(source).not.toContain("'saved'")
  })

  it('the My lists / Saved control stays hidden in Side by side', () => {
    expect(read(PAGE)).toMatch(/const tabSwitch =\s*\n?\s*mode === 'compare' \? null/)
  })
})

describe('LV.12 — the chosen comparison is session-only (D3)', () => {
  it('the page holds it in plain component state', () => {
    expect(read(PAGE)).toMatch(
      /const \[compareIds, setCompareIds\] = React\.useState<string\[\]>\(\[\]\)/,
    )
  })

  it('neither file persists or writes the selection', () => {
    for (const file of [PICKER, PAGE]) {
      const source = code(file)
      expect(source, file).not.toContain('localStorage')
      expect(source, file).not.toContain('persist(')
      expect(source, file).not.toContain('createJSONStorage')
    }
  })

  it('the picker performs no data access of its own', () => {
    const source = code(PICKER)
    expect(source).not.toContain('useQuery')
    expect(source).not.toContain('useMutation')
    expect(source).not.toContain('fetch(')
  })
})

describe('LV.12 — elevation and composition', () => {
  /** `shadow-hard-*` NOT preceded by an interaction-state prefix. */
  const RESTING_SHADOW = /(?<![\w-])(?<!:)shadow-hard-[\w-]+/g

  it('the picker carries no resting shadow', () => {
    const source = code(PICKER)
    const hits = [...source.matchAll(RESTING_SHADOW)].map((match) => match[0])
    expect(hits).toEqual([])
    expect(source).toContain('hover:shadow-hard-4')
  })

  it('selected is carried by fill and border, never by a shadow', () => {
    expect(read(PICKER)).toMatch(/on \? 'border-accent bg-accent-soft' : 'border-ink bg-white'/)
  })

  it('the cover is the shared CoverTile, not a second implementation (D11)', () => {
    const source = read(PICKER)
    expect(source).toContain("import { ListCoverTile } from './cover-tile'")
    expect(source).toContain('<ListCoverTile list={list} players={list.first_players} size={24} />')
    expect(source).toContain("import { Button } from '@/components/ui/button'")
  })

  it('the whole-mode placeholder is gone', () => {
    expect(code(PAGE)).not.toContain('SideBySidePlaceholder')
  })
})

describe('LV.12 — the copy is the design LAW’s, verbatim', () => {
  const source = read(PICKER)

  it('carries the heading and the sub-line the reference shows', () => {
    expect(source).toContain('Pick the lists to compare')
    expect(source).toMatch(
      /They show up as columns across the page\. Mark players off as they go in your draft and\s+every column updates\./,
    )
  })

  it('the CTA reads "Select at least one list" at zero and stays on screen', () => {
    expect(source).toContain("'Select at least one list'")
    // `disabled`, not conditionally rendered — the reference draws the washed
    // out button rather than an empty space.
    expect(source).toContain('disabled={chosen.length === 0}')
  })

  it('the CTA pluralises "Show N list(s) side by side"', () => {
    expect(source).toContain(
      '`Show ${chosen.length} list${chosen.length === 1 ? \'\' : \'s\'} side by side`',
    )
  })
})

import { readFileSync } from 'node:fs'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

/**
 * SE.7 component-source pins for `scoring-editor.tsx` (the launch-scope-gates
 * sweep idiom — the component is .tsx, which this vitest setup cannot render,
 * so the seams are pinned at source; the logic itself lives in
 * `scoring-editor-ops.ts` and is behaviour-tested there).
 *
 * D276 honesty note, up front: every pin here is a MEMBER pin — it proves a
 * named door exists (or a named token does not), never that no other door
 * exists. The membership-level guarantees live in the ops suite (catalog set
 * equalities) and in `composeCatalog`'s init throw.
 */

const read = (rel: string): string =>
  readFileSync(path.resolve(process.cwd(), rel), 'utf8')

const editorSource = read('src/components/leagues/scoring-editor.tsx')
const opsSource = read('src/components/leagues/scoring-editor-ops.ts')
const settingsPanelSource = read('src/components/leagues/settings-panel.tsx')

describe('scoring-editor.tsx source pins', () => {
  it('never names return_yards — an ungated row for it cannot be hand-rendered here (D173; rendering flows from the catalog)', () => {
    // The catalog side (gated entry filtered by renderableFields) is
    // behaviour-tested in the ops suite; this closes the other named door —
    // a hand-written form row in the component.
    expect(editorSource).not.toMatch(/return_yards/)
  })

  it('saves through the ONE ops door (saveScoringDoc) and never calls the mutation directly', () => {
    expect(editorSource).toMatch(/saveScoringDoc\(\{/)
    // `mutateAsync` may be destructured and passed by reference; a direct
    // call — the door around the normalization duty — may not appear.
    expect(editorSource).not.toMatch(/mutateAsync\(/)
  })

  it('steps from STEPPER_POSITIONS, not a re-spelled position list', () => {
    expect(editorSource).toMatch(/STEPPER_POSITIONS\.map/)
    expect(editorSource).not.toMatch(/'QB'\s*,\s*'RB'/)
  })

  it('reserves the two SE.8 slots by name (sample lines + D/ST tier tables)', () => {
    const slots = editorSource.match(/SE\.8 fills this slot/g) ?? []
    expect(slots.length).toBe(2)
  })

  it('keeps the design-system rules: no dark: variants, no arbitrary hex or arbitrary shadows, no resting elevation', () => {
    expect(editorSource).not.toMatch(/\bdark:/)
    expect(editorSource).not.toMatch(/#[0-9a-fA-F]{3,8}\b/)
    expect(editorSource).not.toMatch(/shadow-\[/)
    // Elevation is a hover state, never a resting one (CLAUDE.md ruling):
    // every hard-shadow token in this file must sit behind an interaction
    // prefix. (Today the file carries none of its own — the Save button's
    // elevation rides the Button primitive's `shadow` prop, which
    // elevation-rule.test.ts polices.)
    const shadowUses = editorSource.match(/[\w:-]*shadow-hard[\w-]*/g) ?? []
    const unprefixed = shadowUses.filter(
      (token) =>
        !/^(hover|active|focus-visible|group-hover):/.test(token),
    )
    expect(unprefixed).toStrictEqual([])
  })
})

describe('scoring-editor-ops.ts source pins', () => {
  it('the exported catalog passes through composeCatalog — the F136 init guard cannot be bypassed by the export itself', () => {
    expect(opsSource).toMatch(
      /export const SCORING_EDITOR_SECTIONS[^=]*=\s*composeCatalog\(/,
    )
  })
})

describe('settings-panel mount seam', () => {
  it('the settings surface mounts the editor (SE.7); the fork ENTRY stays SE.9', () => {
    expect(settingsPanelSource).toMatch(/<ScoringEditor leagueId=\{leagueId\} \/>/)
    // No Customize/fork affordance ships in SE.7 — that entry point is
    // SE.9's (D170); the editor renders only once a fork already exists.
    expect(settingsPanelSource).not.toMatch(/Customize/)
    expect(editorSource).not.toMatch(/scoring\/fork|useForkScoringTemplate/)
  })
})

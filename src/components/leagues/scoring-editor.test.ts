import { readdirSync, readFileSync } from 'node:fs'
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

  it('SE.8 fills SE.7’s two reserved slots: the sample line mounts on every page with the position AND the doc-as-edited; the tier tables mount on the D/ST page (F178)', () => {
    expect(editorSource).not.toMatch(/SE\.8 fills this slot/)
    expect(editorSource).toMatch(/<SampleLine position=\{position\} doc=\{activeDoc\} \/>/)
    expect(editorSource).toMatch(
      /position === 'DST' && \(\s*<DstTierTables doc=\{activeDoc\}/,
    )
    // The doc the sample scores is the WORKING copy while editing (F178:
    // "not the persisted one — the sample line recomputes as values are
    // edited"): activeDoc's edit arm reads `working`.
    expect(editorSource).toMatch(
      /activeDoc: ScoringRulesDoc = mode\.kind === 'edit' \? \(working \?\? mode\.doc\) : mode\.doc/,
    )
  })

  it('F191: the remount key derives from DOCUMENT CONTENT ONLY — status/editable reconcile via props, so a failed refetch cannot discard unsaved typing', () => {
    expect(editorSource).toMatch(/key=\{canonicalDocJson\(doc\)\}/)
    // The defective shape — `${canonicalDocJson(doc)}|…status…|…editable…` —
    // may not reappear: no template literal composes the doc json with
    // further key segments.
    expect(editorSource).not.toMatch(/canonicalDocJson\(doc\)\}\s*\|/)
    expect(editorSource).not.toMatch(/\$\{String\(editable\)\}/)
  })

  it('R682: the stepper tablist has roving tabindex, arrow-key selection and aria-controls', () => {
    expect(editorSource).toMatch(/onKeyDown=\{handleStepperKeyDown\}/)
    expect(editorSource).toMatch(/'ArrowRight'/)
    expect(editorSource).toMatch(/'ArrowLeft'/)
    expect(editorSource).toMatch(/'Home'/)
    expect(editorSource).toMatch(/'End'/)
    expect(editorSource).toMatch(/aria-controls=\{panelId\}/)
    expect(editorSource).toMatch(/tabIndex=\{index === stepIndex \? 0 : -1\}/)
    expect(editorSource).toMatch(/role="tabpanel"/)
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

describe('the F59 gate — the editor renders ZERO boundary inputs (SE.8(4); the no-second-door sweep)', () => {
  // D276 honesty note: these are sweep pins over the component tree's
  // SOURCE — they prove no component can even NAME the cut lists (so no
  // input can bind one), and that no ops file under src/components writes
  // one. They cannot prove a future file outside the swept tree stays
  // clean; the server-side guardrails (SE.3/SE.4) are the law behind them.
  const componentFiles = (
    readdirSync(path.resolve(process.cwd(), 'src/components'), {
      recursive: true,
    }) as string[]
  )
    .filter((rel) => !rel.includes('.test.'))
    .map((rel) => path.join('src/components', rel))

  it('no component .tsx file mentions tier_cuts at all — a boundary field cannot be rendered by a component that cannot name it', () => {
    const offenders = componentFiles
      .filter((file) => file.endsWith('.tsx'))
      .filter((file) => /tier_cuts/.test(read(file)))
    expect(offenders).toStrictEqual([])
  })

  it('no file under src/components WRITES tier_cuts — no object-literal member, no property assignment (reads in ops files are the allowed door)', () => {
    const offenders = componentFiles
      .filter((file) => file.endsWith('.ts') || file.endsWith('.tsx'))
      .filter((file) => {
        const source = read(file)
        return /tier_cuts\s*:/.test(source) || /\.tier_cuts\s*=/.test(source)
      })
    expect(offenders).toStrictEqual([])
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

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

describe('R687 — the sample-total boundary, pinned rather than asserted (D276)', () => {
  // The ops docblock's charter sentence says the sample path "NEVER computes
  // real scores: no league, matchup, or player total anywhere in the product
  // comes from this path." D276's rule: a "never" needs a killing cell or a
  // hedge. This is the killing cell — the no-second-door sweep over ALL of
  // src/: nothing outside the editor's own files may import the sample-total
  // path, so a draft/room/production surface that reaches for it reds here.
  // D276 honesty note: a sweep over source proves no CURRENT file imports it;
  // the server walls (104/105 — clients cannot write scores) are the law
  // behind the sentence, and this pin is a MEMBERSHIP pin over the swept
  // tree, red on any new importer inside src/.
  it('no file outside scoring-editor* imports sampleLineTotal or SAMPLE_PLAYERS', () => {
    const srcFiles = (
      readdirSync(path.resolve(process.cwd(), 'src'), {
        recursive: true,
      }) as string[]
    )
      .filter((rel) => rel.endsWith('.ts') || rel.endsWith('.tsx'))
      .map((rel) => path.join('src', rel))
      .filter(
        (file) =>
          !file.includes(path.join('components', 'leagues', 'scoring-editor')),
      )
    const offenders = srcFiles.filter((file) =>
      /sampleLineTotal|SAMPLE_PLAYERS/.test(read(file)),
    )
    expect(offenders).toStrictEqual([])
  })
})

describe('settings-panel mount seam', () => {
  it('the settings surface mounts the editor (SE.7) AND carries the fork entry (SE.9/D170)', () => {
    expect(settingsPanelSource).toMatch(/<ScoringEditor leagueId=\{leagueId\} \/>/)
    // SE.9 flipped SE.7's absence pin into its positive form: the settings
    // mount is where the Customize entry lives — the fork mutation
    // (`useForkScoringTemplate`) is invoked HERE, at the league-context
    // mount, never inside the shared picker (which only emits the id) and
    // never inside the editor. The two league-less picker mounts are pinned
    // Customize-free in scoring-template-picker.render.test.ts. (R691: the
    // suite is a .ts file rendering the .tsx component via createElement.)
    expect(settingsPanelSource).toMatch(/useForkScoringTemplate/)
    expect(settingsPanelSource).toMatch(/customize=\{\{/)
    // The editor itself still never forks — its empty state POINTS at the
    // entry (F179(a)) but the mutation and route stay out of this file.
    expect(editorSource).not.toMatch(/scoring\/fork|useForkScoringTemplate/)
    // …and the shared picker never mutates: no fork hook, no fetch of the
    // fork route — it emits the template id through the customize context.
    const pickerSource = read('src/components/leagues/scoring-template-picker.tsx')
    expect(pickerSource).not.toMatch(/scoring\/fork|useForkScoringTemplate|useMutation/)
  })
})

describe('F194 — the empty state and the §7.3 window (SE.9 review R689)', () => {
  // D276 honesty note: these are MEMBER pins over the component source — the
  // logic they guard is one boolean branch, and the branch's two renderings
  // are browser-verified (a `setup` league reads the Customize pointer, an
  // out-of-window league reads the locked line). SC.3's session log carries
  // that walk.
  it('the caller passes the ALREADY-COMPUTED window down — never re-derived inside the empty state', () => {
    expect(editorSource).toMatch(/inEditWindow=\{access\.inEditWindow\}/)
    // The component takes it as a prop; nothing inside ScoringEditorEmpty
    // recomputes access (the F194 fix is a pass-down, not a second
    // derivation).
    expect(editorSource).toMatch(/inEditWindow: boolean/)
  })

  it('the Customize pointer renders ONLY inside the window branch; out of it the locked line renders instead', () => {
    // The empty state's copy branches on the prop…
    expect(editorSource).toMatch(/\{inEditWindow \? \(/)
    // …and the out-of-window arm is the shared locked-line constant, not a
    // re-worded second lock message.
    expect(editorSource).toMatch(/\) : \(\s*\/\/ F194/)
    expect(editorSource).toMatch(/SCORING_LOCKED_MESSAGE\s*\)\}/)
  })

  it('ONE locked line: the literal is defined once and both renderings (notice + empty state) read the constant', () => {
    const literal = /Scoring locks when the draft starts/g
    expect(editorSource.match(literal)?.length).toBe(1)
    // The constant has (at least) its definition, the accessNotices use and
    // the empty-state use.
    const uses = editorSource.match(/SCORING_LOCKED_MESSAGE/g) ?? []
    expect(uses.length).toBeGreaterThanOrEqual(3)
  })
})

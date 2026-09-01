/**
 * scoring-template-picker.render.test.ts — SE.9's THREE-MOUNT Customize
 * render pin (tasks-SE §0(D) + the SE.9(1) corrected bullet).
 *
 * WHY THIS FILE EXISTS: the colocated `scoring-template-picker.test.ts` is
 * pure-ops — zero render assertions (`grep -c 'render(' → 0` was the §0(D)
 * measurement) — so nothing could catch the Customize affordance leaking
 * into a mount where it is meaningless. The picker has THREE mounts and only
 * one has a league (D170):
 *   1. the create wizard (`league-create-modal.tsx`) — league not created
 *      yet; a league is BORN on a template (`create_league`'s template-only
 *      check), so Customize there would offer a fork with no league to own it;
 *   2. the settings panel (`settings-panel.tsx`) — THE league-context mount;
 *   3. the standalone mock launcher (`mock-launch-dialog.tsx`, MP.4) — NO
 *      league at all (`drafts.league_id` nullable, migration 095).
 *
 * These are REAL renders — `renderToStaticMarkup` over the actual component
 * with the templates query cache pre-seeded (fetches are effects; effects
 * don't run in a static render, so the cached rows are what the component
 * sees) — written with `createElement` in a .ts file; the imported .tsx
 * component transforms via the `oxc.jsx` override this task added to
 * vitest.config.ts (tsconfig keeps Next's `jsx: preserve`).
 *
 * D276 honesty notes:
 *   - The three mount CONFIGURATION pins render the picker with each mount's
 *     exact props — they red if the PICKER leaks the affordance. A future
 *     mount-site edit that starts PASSING league context from a league-less
 *     mount is caught by the source sweeps below (mount census + per-file
 *     prop check), which are member pins over today's tree.
 *   - The visibility matrix is a MEMBERSHIP pin over the enumerated
 *     role × status space (the six statuses of migration 059's CHECK, the
 *     three `league_members.role` values + null for a non-member). It reds
 *     if visibility deviates ANYWHERE in that matrix; it cannot speak to
 *     values outside the enums, which the DB CHECKs make unstorable.
 *
 * SC.3 (Scout preselection) note: `renderPicker` + `FIXTURE_ROWS` are the
 * reusable rig — preselection render pins land BESIDE these `describe`s with
 * no rewrite (pass `value: <scout row id>` and assert on the markup).
 */
import { readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { scoringTemplatesKeys } from '@/hooks/use-scoring-templates'
import { SCORING_TEMPLATES } from '@/lib/leagues/scoring/templates'

import { scoringEditorAccess } from './scoring-editor-ops'
import {
  ScoringTemplatePicker,
  type ScoringTemplatePickerProps,
} from './scoring-template-picker'
import {
  canCustomize,
  type ScoringCustomizeContext,
  type ScoringTemplateRow,
} from './scoring-template-picker-ops'

// ---------------------------------------------------------------------------
// Rig
// ---------------------------------------------------------------------------

/** The 7 authored templates as fetched rows (the ops test's fixture shape). */
const FIXTURE_ROWS: ScoringTemplateRow[] = SCORING_TEMPLATES.map((t, i) => ({
  id: `row-${i + 1}`,
  name: t.name,
  description: t.description,
  rules: t.rules,
}))

const noop = () => undefined

function renderPicker(props: Partial<ScoringTemplatePickerProps>): string {
  const client = new QueryClient()
  client.setQueryData(scoringTemplatesKeys.all, FIXTURE_ROWS)
  return renderToStaticMarkup(
    createElement(
      QueryClientProvider,
      { client },
      createElement(ScoringTemplatePicker, { value: null, onChange: noop, ...props }),
    ),
  )
}

/** Count of rendered Customize buttons (each carries the aria-label). */
function customizeCount(markup: string): number {
  return (markup.match(/aria-label="Customize /g) ?? []).length
}

const settingsContext = (
  overrides?: Partial<ScoringCustomizeContext>,
): ScoringCustomizeContext => ({
  myRole: 'commissioner',
  leagueStatus: 'setup',
  onCustomize: noop,
  pendingTemplateId: null,
  disabledReason: null,
  ...overrides,
})

// ---------------------------------------------------------------------------
// 1. The three mount configurations (each mount's EXACT props)
// ---------------------------------------------------------------------------

describe('the three-mount Customize render pin (SE.9(1); D170)', () => {
  it('WIZARD configuration (value + styleFilter + onChange, no league context): zero Customize', () => {
    // league-create-modal.tsx passes value/styleFilter/onChange only —
    // styleFilter starts undefined and narrows on the style step.
    for (const styleFilter of [undefined, 'ppr', 'no_ppr'] as const) {
      const markup = renderPicker({ styleFilter })
      expect(customizeCount(markup), `styleFilter=${String(styleFilter)}`).toBe(0)
      expect(markup).not.toContain('Customize')
    }
  })

  it('MOCK-LAUNCHER configuration (value + onChange only — a standalone mock has NO league): zero Customize', () => {
    const markup = renderPicker({})
    expect(customizeCount(markup)).toBe(0)
    expect(markup).not.toContain('Customize')
  })

  it('SETTINGS configuration (league context: commissioner, setup): Customize on every card, and ONLY as many as there are cards', () => {
    const markup = renderPicker({ customize: settingsContext() })
    expect(customizeCount(markup)).toBe(FIXTURE_ROWS.length)
    // …and the cards themselves are what carry it (one per card, not a
    // stray global affordance): every fixture template name gets a button.
    for (const row of FIXTURE_ROWS) {
      expect(markup).toContain(`aria-label="Customize ${row.name}"`)
    }
  })

  it('the templates-only mounts render BYTE-IDENTICAL markup with and without the change (wizard/mock unchanged claim, measured)', () => {
    // SE.9(1): "the wizard's picker is byte-identical in behavior". The
    // strongest cheap form: an omitted context and an explicit undefined
    // produce the same markup, and neither contains any customize artifact
    // (button, pending label, or disabled-reason line).
    const omitted = renderPicker({})
    const explicit = renderPicker({ customize: undefined })
    expect(explicit).toBe(omitted)
    expect(omitted).not.toMatch(/Customiz/)
  })
})

// ---------------------------------------------------------------------------
// 2. The visibility matrix — commissioner-only, setup/scheduled only
// ---------------------------------------------------------------------------

/** Migration 059:121's CHECK, verbatim members — the full status enum. */
const LEAGUE_STATUSES = [
  'setup',
  'scheduled',
  'drafting',
  'in_season',
  'playoffs',
  'complete',
] as const

/** 052's `league_members.role` values, plus null = not a member. */
const ROLES = ['commissioner', 'co_commissioner', 'manager', null] as const

/** The exact combinations Customize may render for — stored literal. */
const VISIBLE_COMBOS = new Set([
  'commissioner|setup',
  'commissioner|scheduled',
  'co_commissioner|setup',
  'co_commissioner|scheduled',
])

describe('the visibility matrix (membership pin over role × status)', () => {
  it('renders Customize for EXACTLY {commissioner, co_commissioner} × {setup, scheduled} — all 24 combos rendered', () => {
    for (const myRole of ROLES) {
      for (const leagueStatus of LEAGUE_STATUSES) {
        const markup = renderPicker({
          customize: settingsContext({ myRole, leagueStatus }),
        })
        const expected = VISIBLE_COMBOS.has(`${myRole}|${leagueStatus}`)
        expect(
          customizeCount(markup) > 0,
          `role=${String(myRole)} status=${leagueStatus}`,
        ).toBe(expected)
      }
    }
  })

  it('canCustomize agrees with scoringEditorAccess(...).canEdit across the whole matrix (the pinned mirror — picker-ops deliberately does not import editor-ops)', () => {
    for (const myRole of ROLES) {
      for (const leagueStatus of LEAGUE_STATUSES) {
        expect(
          canCustomize({ myRole, leagueStatus }),
          `role=${String(myRole)} status=${leagueStatus}`,
        ).toBe(scoringEditorAccess(myRole, leagueStatus).canEdit)
      }
    }
  })
})

// ---------------------------------------------------------------------------
// 3. In-context states (pending fork, unsaved-settings guard, loading)
// ---------------------------------------------------------------------------

describe('customize context states', () => {
  it('a fork in flight: the in-flight card shows the pending label, every Customize button disables', () => {
    const markup = renderPicker({
      customize: settingsContext({ pendingTemplateId: 'row-1' }),
    })
    expect(markup).toContain('Customizing…')
    const disabled = (markup.match(/aria-label="Customize [^"]+" disabled=""/g) ?? []).length
    expect(disabled).toBe(FIXTURE_ROWS.length)
  })

  it('a disabledReason renders as a line above the grid and disables the buttons — a fork must not silently discard unsaved form edits', () => {
    const reason = 'Save or discard your settings changes first — customizing scoring reloads this page.'
    const markup = renderPicker({ customize: settingsContext({ disabledReason: reason }) })
    expect(markup).toContain(reason)
    const disabled = (markup.match(/aria-label="Customize [^"]+" disabled=""/g) ?? []).length
    expect(disabled).toBe(FIXTURE_ROWS.length)
  })

  it('the loading skeleton renders no Customize even WITH a qualifying context (no cards, no affordance)', () => {
    const client = new QueryClient()
    // No cached rows → isPending → the skeleton grid.
    const markup = renderToStaticMarkup(
      createElement(
        QueryClientProvider,
        { client },
        createElement(ScoringTemplatePicker, {
          value: null,
          onChange: noop,
          customize: settingsContext(),
        }),
      ),
    )
    expect(markup).not.toContain('Customize')
  })
})

// ---------------------------------------------------------------------------
// 4. Mount census + per-mount source sweep (the leak the render configs
//    cannot see: a league-less MOUNT starting to pass the prop)
// ---------------------------------------------------------------------------

describe('mount census and per-mount prop sweep', () => {
  const read = (rel: string): string =>
    readFileSync(path.resolve(process.cwd(), rel), 'utf8')

  it('the picker has EXACTLY three mounts — a fourth must come here and declare its league context', () => {
    const srcFiles = (
      readdirSync(path.resolve(process.cwd(), 'src'), { recursive: true }) as string[]
    )
      .filter((rel) => (rel.endsWith('.ts') || rel.endsWith('.tsx')) && !rel.includes('.test.'))
      .map((rel) => path.join('src', rel))
    const mounts = srcFiles.filter((file) => /<ScoringTemplatePicker/.test(read(file)))
    expect(mounts.sort()).toStrictEqual([
      'src/components/draft/mock-launch-dialog.tsx',
      'src/components/leagues/league-create-modal.tsx',
      'src/components/leagues/settings-panel.tsx',
    ])
  })

  it('ONLY the settings mount passes the customize prop; the two league-less mounts pass none', () => {
    expect(read('src/components/leagues/settings-panel.tsx').match(/customize=\{/g)?.length).toBe(1)
    expect(read('src/components/leagues/league-create-modal.tsx')).not.toMatch(/customize=/)
    expect(read('src/components/draft/mock-launch-dialog.tsx')).not.toMatch(/customize=/)
  })
})

// ---------------------------------------------------------------------------
// 5. SC.3 — the Scout preselection at the render surface + the F193 counts
//    (landing BESIDE the rig exactly as the header's SC.3 note reserved)
// ---------------------------------------------------------------------------

const scoutRow = FIXTURE_ROWS.find((r) => r.name === 'Scout Scoring')!
const espnRow = FIXTURE_ROWS.find((r) => r.name === 'ESPN Standard')!

/** Count of pressed (selected) cards in the markup. */
function selectedCount(markup: string): number {
  return (markup.match(/aria-pressed="true"/g) ?? []).length
}

describe('SC.3 — preselection renders through `value` (the picker stays controlled; the mounts derive the default)', () => {
  it('value = the resolved Scout id renders the Scout card selected — and ONLY it', () => {
    const markup = renderPicker({ value: scoutRow.id })
    expect(selectedCount(markup)).toBe(1)
    // The selected card is Scout's: its name sits in the same card as the
    // pressed state (cards render name-first, Scout leads the grid).
    const pressedCard = markup.slice(markup.indexOf('aria-pressed="true"'))
    expect(pressedCard.indexOf('Scout Scoring')).toBeGreaterThan(-1)
    expect(pressedCard.indexOf('Scout Scoring')).toBeLessThan(pressedCard.indexOf('ESPN Standard'))
    expect(markup).toContain('Selected')
  })

  it("an explicit DIFFERENT pick renders selected instead — `value` is law, the default never overrides at any layer", () => {
    const markup = renderPicker({ value: espnRow.id })
    expect(selectedCount(markup)).toBe(1)
    const pressedCard = markup.slice(markup.indexOf('aria-pressed="true"'))
    // The pressed card is ESPN Standard's (grid order: Scout renders before
    // the pressed card, so Scout is NOT the pressed one).
    expect(pressedCard.indexOf('ESPN Standard')).toBeGreaterThan(-1)
    expect(pressedCard).not.toContain('Scout Scoring')
  })

  it('a null value renders NOTHING selected (the loud-degradation rendering: no Scout row ⇒ no preselection, the user must pick)', () => {
    const markup = renderPicker({ value: null })
    expect(selectedCount(markup)).toBe(0)
    expect(markup).not.toContain('Selected')
  })

  it('the Scout card carries the "FieldScout\'s default" marker — the recommended default reads as one', () => {
    const markup = renderPicker({})
    expect(markup.match(/FieldScout(&#x27;|')s default/g)?.length).toBe(1)
    // …and it survives selection (moves below the Selected badge, exactly
    // like the platform markers do).
    const selected = renderPicker({ value: scoutRow.id })
    expect(selected.match(/FieldScout(&#x27;|')s default/g)?.length).toBe(1)
  })
})

describe('F193 — the loading/empty counts derive from the template list (never a stale literal)', () => {
  it('the skeleton renders ONE placeholder per known template (7 today; an eighth template moves this with the order list)', () => {
    const client = new QueryClient()
    const markup = renderToStaticMarkup(
      createElement(
        QueryClientProvider,
        { client },
        createElement(ScoringTemplatePicker, { value: null, onChange: noop }),
      ),
    )
    expect(markup.match(/h-44/g)?.length).toBe(SCORING_TEMPLATES.length)
    expect(SCORING_TEMPLATES.length).toBe(7)
  })

  it('the zero-rows empty state prints the DERIVED count — "The 7 league scoring templates ship with the database seed"', () => {
    const client = new QueryClient()
    client.setQueryData(scoringTemplatesKeys.all, [])
    const markup = renderToStaticMarkup(
      createElement(
        QueryClientProvider,
        { client },
        createElement(ScoringTemplatePicker, { value: null, onChange: noop }),
      ),
    )
    expect(markup).toContain('No scoring templates yet.')
    expect(markup).toMatch(/The <!-- -->7<!-- --> league scoring templates ship|The 7 league scoring templates ship/)
    expect(markup).not.toContain('The 6 league scoring templates')
  })
})

describe('SC.3 — the two league-less mounts WIRE the preselection; the settings mount never defaults over a stored reference', () => {
  const read = (rel: string): string =>
    readFileSync(path.resolve(process.cwd(), rel), 'utf8')
  const wizardSource = read('src/components/leagues/league-create-modal.tsx')
  const mockSource = read('src/components/draft/mock-launch-dialog.tsx')
  const settingsSource = read('src/components/leagues/settings-panel.tsx')

  // D276 honesty note: these are MEMBER pins over today's tree — they red
  // when a mount DROPS the preselection wiring (the resolver call, the
  // effective value on the picker, the default handed to the submit
  // builder), and the ops suite reds when the resolver stops resolving
  // Scout by name. They cannot prove a future fourth mount wires it; the
  // mount census above bounds the mount set.
  it('the WIZARD resolves the default (No-PPR view only), renders the effective value, and submits it', () => {
    expect(wizardSource).toMatch(/scoringStyle === 'no_ppr'\s*\?\s*resolveDefaultTemplateId\(templatesQuery\.data\)/)
    expect(wizardSource).toMatch(/value=\{effectiveScoringId\}/)
    expect(wizardSource).toMatch(/toCreateInput\(draft, defaultTemplateId\)/)
    // The style step opens on Scout's own family so the preselected card is
    // VISIBLE (a selection the user can't see is the "nothing happened"
    // shape).
    expect(wizardSource).toMatch(/useState<'ppr' \| 'no_ppr'>\('no_ppr'\)/)
  })

  it('the MOCK LAUNCHER resolves the default, renders the effective value, and feeds it to BOTH the payload and the gate reason', () => {
    expect(mockSource).toMatch(/resolveDefaultTemplateId\(templatesQuery\.data\)/)
    expect(mockSource).toMatch(/value=\{effectiveScoringId\}/)
    expect(mockSource).toMatch(/toMockLaunchInput\(draft, defaultTemplateId\)/)
    expect(mockSource).toMatch(/mockLaunchBlockedReason\(draft, defaultTemplateId\)/)
  })

  it('the SETTINGS mount never touches the resolver — a league\'s STORED scoring reference is never defaulted over', () => {
    expect(settingsSource).not.toMatch(/resolveDefaultTemplateId|effectiveTemplateSelection/)
  })
})

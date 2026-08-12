import { readFileSync } from 'node:fs'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

/**
 * LV.5 — the AI list-generation surfaces exist on the screens that actually
 * ship, and carry no colour an inline style could outrank.
 *
 * **Why this file exists.** CLAUDE.md → Redesign is explicit:
 *
 * > AI list generation and influencer personas/AI experts exist in the app but
 * > not the prototype. Keep them and restyle them in the new design language —
 * > **never leave them in the old style, never remove them.**
 *
 * They *were* removed, and silently. LV.2 and LV.3 rebuilt the Lists page and
 * the open list as new files under `lists/v2/`, and neither carried the
 * "Create with AI" trigger or the build banner across. Nothing failed, because
 * nothing asked: the legacy page still had both, and `featureFlags.listsV2`
 * decided which one production served. Behind that flag — the launch
 * configuration — AI list generation had no entry point at all, and a queued
 * build was never claimed and narrated nothing. That is a launch-scope surface:
 * CLAUDE.md → Active Builds ships "Lists + Stats/player research + **AI stat
 * lists**".
 *
 * A prose rule in CLAUDE.md did not stop that happening once, so it is pinned
 * here instead. **LV.7 removed the flag and the legacy page**, which makes these
 * mounts the only ones there are: deleting either, or pointing the build show at
 * a route that no longer renders a list, turns this file red.
 *
 * **Source pins, not renders** — the same idiom and the same reason as
 * `src/components/ui/elevation-rule.test.ts`: these are `.tsx`, which Vite
 * cannot parse under Next's `jsx: "preserve"`.
 */

const read = (file: string) => readFileSync(path.resolve(process.cwd(), file), 'utf8')

const LISTS_PAGE_V2 = 'src/components/lists/v2/lists-page-v2.tsx'
const DETAIL_PANEL_V2 = 'src/components/lists/v2/list-detail-panel.tsx'
const GENERATE_MODAL = 'src/components/lists/generate-ai-modal.tsx'

/** Every file LV.5 restyled, for the colour rules below. */
const AI_COMPONENTS = [
  GENERATE_MODAL,
  'src/components/lists/generate-ai-button.tsx',
  'src/components/lists/ai-build-banner.tsx',
  'src/components/ui/ai-insight.tsx',
] as const

/**
 * The persona surfaces. LV.5 went **shallow** here on purpose (PROGRESS §4):
 * they were already carried into the Field Scout token language by the phase-4
 * reskin, they are flag-gated off at launch (`featureFlags.personas`), and
 * redesigning a screen nobody sees, with no reference in the design package,
 * is the improvisation the redesign rules warn against.
 *
 * "Shallow" is not "unguarded". They were audited against the binding rules and
 * measured in the browser — resting `box-shadow: none`, hover `shadow-hard-4`
 * plus the −2/−2 lift, no inline style — and those rules are pinned below so
 * the surfaces cannot rot back while they are out of sight. The elevation guard
 * in `ui/elevation-rule.test.ts` deliberately covers only `src/components/ui/**`,
 * so nothing else was watching these files.
 */
const PERSONA_COMPONENTS = [
  'src/components/personas/persona-card.tsx',
  'src/components/personas/persona-badge.tsx',
] as const

const ALL_SURFACES = [...AI_COMPONENTS, ...PERSONA_COMPONENTS] as const

describe('AI list generation survives the v2 rebuild (LV.5)', () => {
  it('the v2 Lists page mounts the "Create with AI" trigger', () => {
    // The one entry point into AI list generation. Without it the flag flip at
    // LV.7 removes a launch-scope feature from the app with no error anywhere.
    expect(read(LISTS_PAGE_V2)).toContain('<GenerateAiButton')
  })

  it('the v2 open list mounts the build banner and claims the job', () => {
    const source = read(DETAIL_PANEL_V2)
    // The banner is the whole "watch the AI build it" promise the dialog makes.
    expect(source).toContain('<AiBuildBanner')
    // ...and the banner alone is not enough: `useAiListBuild` is what *claims* a
    // queued job and runs generate → add → order. Rendering the banner without
    // it would show a job that never progresses.
    expect(source).toContain('useAiListBuild(listId)')
  })

  it('the v2 open list is read-only while the AI owns it', () => {
    // Legacy: `isOwner = data.is_owner && !aiBuild.building`. Dropping this lets
    // the user drag rows while the ordering pass is rewriting them, and the two
    // writes race over the same reorder route.
    expect(read(DETAIL_PANEL_V2)).toContain('!aiBuild.building')
  })

  it('the build show lands on the Lists page, where a list actually opens', () => {
    const source = read(GENERATE_MODAL)
    // A list opens in the Lists page's right-hand panel (PROGRESS §7 gap 1), and
    // the page pins its selection to the queued job — so this is the push, with
    // no query parameter and no flag left to consult (LV.7 collapsed both arms).
    expect(source).toContain("router.push('/app/lists')")
    // `/app/lists/<id>` is a redirect back into that same panel now, so pushing
    // it would be a pointless extra hop through the router.
    expect(source).not.toContain('`/app/lists/${created.id}`')
    expect(source).not.toContain('featureFlags')
  })

  it('the Lists page knows which list the AI is building', () => {
    // No `?list=` parameter: the queued job already names its list, and the page
    // pins the selection to it. Losing this read means the build runs on a list
    // the user cannot see.
    expect(read(LISTS_PAGE_V2)).toContain('useAiBuildStore')
  })
})

describe('AI surfaces obey the colour rules (LV.5)', () => {
  /**
   * `style={{ background… }}` / `color…` — an inline colour outranks the
   * `:hover` rule and silently kills the hover state. This has bitten the
   * project repeatedly (LV.9 and LV.11 both probed it deliberately).
   *
   * Deliberately narrow: an inline *width* is data and is allowed — the build
   * banner's progress bar is exactly that.
   */
  const INLINE_COLOUR = /style=\{\{[^}]*\b(background|backgroundColor|color|borderColor|fill|stroke)\b/

  it.each(ALL_SURFACES)('%s writes no colour in an inline style', (file) => {
    expect(INLINE_COLOUR.test(read(file))).toBe(false)
  })

  it.each(ALL_SURFACES)('%s uses theme tokens, never a literal hex', (file) => {
    // Colours come from `tailwind.config.ts`. A literal hex here is a value the
    // theme cannot restyle.
    const source = read(file).replace(/\/\*[\s\S]*?\*\//g, '')
    expect(source.match(/#[0-9a-fA-F]{3,8}\b/g) ?? []).toEqual([])
  })

  /**
   * Elevation is a hover/press affordance, never a resting one (CLAUDE.md).
   * Same predicate as `ui/elevation-rule.test.ts`, applied to the AI and
   * persona feature components that guard does not reach.
   */
  it.each(ALL_SURFACES)('%s carries no resting elevation', (file) => {
    const source = read(file)
    const resting: string[] = []
    for (const match of source.matchAll(/(?<![\w-])(?<!:)shadow-hard-[\w-]+/g)) {
      const before = source.slice(Math.max(0, match.index - 40), match.index)
      if (/(hover|active|focus|focus-visible|group-hover|peer-hover|data-\[[^\]]*\]):$/.test(before)) continue
      resting.push(match[0])
    }
    expect(resting).toEqual([])
  })
})
